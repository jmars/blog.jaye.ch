/**
 * tools/search/search.js — the search pipeline for the /search/ page.
 *
 * THREE SIGNALS over the published pieces, fused into one ranked list, and each
 * result carries the reasons it is there:
 *
 *   lexical  a sorted vocabulary (lowercased word tokens) with a doc posting
 *            list per term; a query word is looked up exactly and as a PREFIX,
 *            and a hit in a piece's title or a heading weighs more than a hit
 *            in the body. The score is tf-idf with a BINARY term frequency: the
 *            index records presence per piece, not counts, and says so.
 *   vector   per piece, a 160-dimension int8 tf-idf vector, L2-normalised. This
 *            is a tf-idf VECTOR SPACE, not a neural embedding, and no projector
 *            is shipped: the query is projected with the same signed FNV-1a hash
 *            the build used, so a term that landed in a dimension at render time
 *            lands in the same one at query time.
 *   graph    a minimal SEMI-NAIVE DATALOG evaluator over the blog's own graph
 *            (post, link, cites, source), with the rules declared as data. It
 *            answers which pieces are related to a hit, and why.
 *
 * The build inlines this file into the page, comment-free. Phase 2 replaces the
 * lexical and datalog INTERNALS (the Zig datalog-dafsa engine) behind this same
 * surface, so everything the page writes against is the interface below and
 * nothing else:
 *
 *   Search.providers = { lexical(q, opts), vector(q, opts), graph(q, opts) }
 *                    (a lexical entry also carries `named`: the query named it
 *                    by an exact term hit, which outranks a similar/neighbour)
 *   Search.query(text, opts) -> { results: [{i, score, why}], counts }
 */
(function () {
  'use strict';

  var DIM = 160;          // vector dimensions, fixed: the hash's modulus
  var SEED_N = 6;         // hits handed to the graph rules as their seeds
  var PREFIX_CAP = 120;   // vocabulary terms one prefix may expand to
  var RESULT_CAP = 24;    // results returned for one query
  var GRAPH_CAP = 12;     // results the graph may add that no word or vector found
  var TUPLE_CAP = 4000;   // facts the datalog evaluator may derive per query
  var ROUND_CAP = 8;      // semi-naive rounds before the evaluator stops
  /* The fusion weights order pieces WITHIN a rank; they do not decide the rank
   * itself — see `tier`. A title or heading hit weighs 2.6x a body hit, so a
   * plain body exact match floors at W_LEX/2.6 = 0.238 after normalisation,
   * BELOW W_VEC and below GW.points_at: measured on "proclus", a vector-only
   * "similar" (0.45) and a dozen graph-only neighbours (0.26) outranked two
   * pieces whose prose literally contains the word (0.245, 0.338). No split of
   * these weights fixes that without dropping W_VEC under 0.238 — which is not
   * a ranking rule, it is that weight again — so the literal match holds a rank.
   */
  var W_LEX = 0.62;       // fusion weights: the words and the vectors
  var W_VEC = 0.38;
  var GW = { related: 0.34, points_at: 0.26, same_series: 0.20, near: 0.14 };
  var VEC_FLOOR = 0.34;   // a piece must reach this fraction of the best cosine
  var WORD = /[a-z][a-z'-]+/g;

  /** A piece's rank: 1 when the query's words literally name it (an exact term
   * hit in its prose), 0 otherwise. A piece only the vectors called similar, or
   * only the graph reached, never sorts above one the words named — the rank is
   * compared before any score. */
  function tier(named, i) { return named[i] ? 1 : 0; }

  /* ---------- the shared hash: the one thing both sides must agree on ------ */

  /**
   * 32-bit FNV-1a over a term's UTF-16 code units.
   *
   * THE BUILD HOLDS THE SAME FUNCTION (tools/build.mjs, fnv1a) — a vector index
   * is meaningless unless the query's term lands in the same dimension with the
   * same sign, and no projector is shipped to guarantee it. The multiplication
   * by 16777619 (0x01000193) is written as shifts so no Math.imul is needed:
   * 16777619 = 2^24 + 2^8 + 2^7 + 2^4 + 2^1 + 1.
   */
  function fnv1a(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }

  /** A term's dimension and sign, from the one hash. */
  function project(term, dim) {
    var h = fnv1a(term);
    return { at: h % dim, sign: ((h >>> 31) & 1) ? -1 : 1 };
  }

  /* ---------- tokenising: the same rule the index was built with ---------- */

  /** The query's words: lowercased, `[a-z][a-z'-]+`, three or more characters,
   * stopwords dropped, each word once — the index's own rule, so a query is
   * read exactly as the pieces were. A query of stopwords alone has no terms at
   * all: they were never indexed (they are the words that join nothing), and
   * answering "the" with fifty-eight pieces would be noise, not an answer. */
  function tokenize(text, stop) {
    var ws = String(text).toLowerCase().match(WORD) || [];
    var out = [], i, w;
    for (i = 0; i < ws.length; i++) {
      w = ws[i];
      if (w.length >= 3 && !stop[w] && out.indexOf(w) < 0) out.push(w);
    }
    return out;
  }

  /* ---------- the index, decoded from the page's own data block ---------- */

  function makeIndex(data) {
    var stop = {}, parts = String(data.stop || '').split(' ');
    var i, d;
    for (i = 0; i < parts.length; i++) if (parts[i]) stop[parts[i]] = 1;
    var terms = data.lex.terms ? data.lex.terms.split(' ') : [];
    var at = {};
    for (i = 0; i < terms.length; i++) at[terms[i]] = i;
    var strong = {}, st = data.lex.strong || [];
    for (i = 0; i < st.length; i++) strong[st[i][0]] = st[i];
    var source = {};
    for (i = 0; i < data.graph.source.length; i++) source[data.graph.source[i][0]] = data.graph.source[i];
    var n = data.docs.length;
    var vnorm = new Array(n);
    for (i = 0; i < n; i++) {
      var v = data.vec[i], s = 0;
      for (d = 0; d < v.length; d++) s += v[d] * v[d];
      vnorm[i] = Math.sqrt(s) || 1;
    }
    return {
      dim: data.dim || DIM, n: n, stop: stop, terms: terms, at: at,
      postings: data.lex.postings, strong: strong, docs: data.docs,
      vec: data.vec, vnorm: vnorm, graph: data.graph, source: source,
      hints: data.hints || [],
    };
  }

  function lowBound(arr, x) {
    var lo = 0, hi = arr.length;
    while (lo < hi) {
      var mid = (lo + hi) >>> 1;
      if (arr[mid] < x) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  /** Inverse document frequency of a vocabulary term, by its index in the
   * vocabulary: the posting list's length IS the document frequency. */
  function idfOfIndex(idx, ti) {
    return Math.log(1 + idx.n / Math.max(1, idx.postings[ti].length));
  }

  /** idf of a QUERY word: the length of its posting list, which IS its document
   * frequency. Only ever called for a word the index holds — see `vector`,
   * which drops the rest. */
  function idfOfTerm(idx, t) {
    var ti = idx.at[t];
    return Math.log(1 + idx.n / Math.max(1, idx.postings[ti].length));
  }

  /* ---------- provider 1: the lexical index ------------------------------- */

  /** Exact and prefix lookup over the sorted vocabulary, scored as tf-idf with a
   * binary term frequency and title/heading hits weighted above body hits. Each
   * result also says whether the query's words NAMED it (`named`: at least one
   * exact term hit, not a prefix), which is the rank the fusion sorts on. */
  function lexical(idx, text, opts) {
    var toks = tokenize(text, idx.stop);
    var score = {}, why = {}, named = {}, i, j;
    var T = idx.terms.length;
    for (i = 0; i < toks.length; i++) {
      var t = toks[i];
      var lo = lowBound(idx.terms, t);
      var hi = lo;
      while (hi < T && hi - lo < PREFIX_CAP && idx.terms[hi].indexOf(t) === 0) {
        var term = idx.terms[hi], post = idx.postings[hi];
        var exact = term === t;
        var w = idfOfIndex(idx, hi) * (exact ? 1 : 0.55);
        var st = idx.strong[hi];
        for (j = 0; j < post.length; j++) {
          var d = post[j];
          score[d] = (score[d] || 0) + w * (st && st.indexOf(d) > 0 ? 2.6 : 1);
          if (exact) named[d] = 1;
          var r = why[d] || (why[d] = []);
          var label = (exact ? 'term: "' : 'prefix: "') + t + '"';
          if (r.indexOf(label) < 0 && r.length < 6) r.push(label);
        }
        hi++;
      }
    }
    var out = [];
    for (var key in score) out.push({ i: +key, score: score[key], why: why[key], named: !!named[key] });
    return out;
  }

  /** The pieces a lexical pass found by exact hit — the query's own words. */
  function namedSet(lex) {
    var named = {}, i;
    for (i = 0; i < lex.length; i++) if (lex[i].named) named[lex[i].i] = 1;
    return named;
  }

  /* ---------- provider 2: the tf-idf vector space -------------------------- */

  /** Project the query with the same signed FNV-1a hash and take the cosine
   * against the stored vectors. Nothing is fetched, no projector is shipped.
   *
   * Only pieces materially close to the query are called similar: `floor` is
   * the fraction of the best cosine a piece must reach, because 160 hashed
   * dimensions give every piece some small positive cosine with every query and
   * a signal that names everything names nothing. */
  function vector(idx, text, opts) {
    opts = opts || {};
    var toks = tokenize(text, idx.stop);
    if (!toks.length) return [];
    var q = new Array(idx.dim), i, d, known = 0;
    for (d = 0; d < idx.dim; d++) q[d] = 0;
    for (i = 0; i < toks.length; i++) {
      // A word the pieces never use has no vector meaning: its dimension would
      // be filled by the pieces' own unrelated terms, so projecting it answers
      // with noise — measured, a nonsense word scored above the floor for 57 of
      // 58 pieces. Only words the index holds are projected, and the index
      // holds every word the pieces do use.
      if (idx.at[toks[i]] === undefined) continue;
      var p = project(toks[i], idx.dim);
      q[p.at] += p.sign * idfOfTerm(idx, toks[i]);
      known++;
    }
    if (!known) return [];
    var qn = 0;
    for (d = 0; d < idx.dim; d++) qn += q[d] * q[d];
    qn = Math.sqrt(qn);
    if (!qn) return [];
    var all = [], best = 0;
    for (i = 0; i < idx.n; i++) {
      var v = idx.vec[i], dot = 0;
      for (d = 0; d < idx.dim; d++) dot += q[d] * v[d];
      var cos = dot / (qn * idx.vnorm[i]);
      if (cos > 0) {
        all.push({ i: i, score: cos, why: ['similar'] });
        if (cos > best) best = cos;
      }
    }
    var floor = (opts.floor === undefined ? VEC_FLOOR : opts.floor) * best;
    return all.filter(function (e) { return e.score >= floor; });
  }

  /* ---------- provider 3: a semi-naive datalog evaluator ------------------- */

  /**
   * The rules, as DATA. A rule is a head atom and a body of atoms; an argument
   * is a variable (an upper-case name), an anonymous slot ('_'), or a ground
   * value (a number, or any other string). 'neq' is the one builtin: it filters
   * when its two arguments are already bound to the same value.
   *
   * The evaluator derives these; nothing here is written as a hand-coded join,
   * which is the point — Phase 2 replaces the evaluator, not the rules.
   */
  var RULES = [
    { head: ['hit', 'P'], body: [['seed', 'P']] },
    { head: ['related', 'P', 'Q', 'S'],
      body: [['hit', 'P'], ['hit', 'Q'], ['cites', 'P', 'S'], ['cites', 'Q', 'S'], ['neq', 'P', 'Q']] },
    { head: ['same_series', 'P', 'Q'],
      body: [['hit', 'P'], ['post', 'P', '_', 'S', '_', '_'], ['post', 'Q', '_', 'S', '_', '_'], ['neq', 'P', 'Q']] },
    { head: ['points_at', 'P', 'Q'],
      body: [['hit', 'P'], ['link', 'P', 'Q'], ['neq', 'P', 'Q']] },
    { head: ['path1', 'P', 'Q'], body: [['link', 'P', 'Q']] },
    { head: ['path2', 'P', 'Q'], body: [['path1', 'P', 'R'], ['link', 'R', 'Q']] },
    { head: ['near', 'P', 'Q'],
      body: [['hit', 'P'], ['path2', 'P', 'Q'], ['neq', 'P', 'Q']] }
  ];

  function isVar(a) {
    if (typeof a !== 'string' || a === '_' || !a.length) return false;
    var c = a.charCodeAt(0);
    return c >= 65 && c <= 90;
  }

  /** A fact store: one relation per predicate, de-duplicated by tuple. */
  function Datalog(facts) {
    this.rel = {};
    this.seen = {};
    this.derived = 0;
    this.capped = false;
    this.rounds = 0;
    for (var p in facts) {
      if (!facts[p]) continue;
      for (var i = 0; i < facts[p].length; i++) this.add(p, facts[p][i]);
    }
  }
  Datalog.prototype.relOf = function (p) {
    if (!this.rel[p]) { this.rel[p] = []; this.seen[p] = {}; }
    return this.rel[p];
  };
  Datalog.prototype.add = function (p, t) {
    var k = t.join('\u0001');
    if (!this.seen[p]) { this.rel[p] = []; this.seen[p] = {}; }
    if (this.seen[p][k]) return false;
    this.seen[p][k] = 1;
    this.rel[p].push(t);
    return true;
  };
  Datalog.prototype.copy = function (env) {
    var e = {}, k;
    for (k in env) e[k] = env[k];
    return e;
  };
  /** Bind one fact against one atom's arguments, or null if it cannot. */
  Datalog.prototype.bind = function (args, t, env) {
    if (t.length !== args.length) return null;
    var out = this.copy(env);
    for (var j = 0; j < args.length; j++) {
      var a = args[j], v = t[j];
      if (a === '_') continue;
      if (isVar(a)) {
        if (out[a] === undefined) out[a] = v;
        else if (out[a] !== v) return null;
      } else if (a !== v) return null;
    }
    return out;
  };
  /** Every environment satisfying the body from position k. Position `ovPos`,
   * when given, reads its facts from `ovTuples` (the semi-naive delta) rather
   * than from the full relation. */
  Datalog.prototype.solve = function (body, k, env, ovPos, ovTuples) {
    if (k >= body.length) return [env];
    var atom = body[k], pred = atom[0], args = atom.slice(1), i, q;
    if (pred === 'neq') {
      var x = isVar(args[0]) ? env[args[0]] : args[0];
      var y = isVar(args[1]) ? env[args[1]] : args[1];
      if (x !== undefined && y !== undefined && x === y) return [];
      return [env];
    }
    var tuples = k === ovPos ? ovTuples : this.relOf(pred);
    var out = [];
    for (i = 0; i < tuples.length; i++) {
      var e = this.bind(args, tuples[i], env);
      if (!e) continue;
      var rest = this.solve(body, k + 1, e, ovPos, ovTuples);
      for (q = 0; q < rest.length; q++) out.push(rest[q]);
    }
    return out;
  };
  /** Head tuples for a body's solutions, added to the store and to `next`. */
  Datalog.prototype.emit = function (head, envs, next) {
    var pred = head[0], args = head.slice(1), added = false, i, j;
    for (i = 0; i < envs.length; i++) {
      var t = new Array(args.length);
      for (j = 0; j < args.length; j++) t[j] = isVar(args[j]) ? envs[i][args[j]] : args[j];
      if (this.add(pred, t)) {
        (next[pred] || (next[pred] = [])).push(t);
        this.derived++;
        added = true;
        if (this.derived > TUPLE_CAP) { this.capped = true; return added; }
      }
    }
    return added;
  };
  /** Semi-naive evaluation: a rule whose body holds no derived predicate runs
   * once; every other rule runs against the PREVIOUS ROUND'S new tuples in one
   * body position at a time, which is what keeps the cost a function of the
   * facts derived rather than of the relation crossed with itself. */
  Datalog.prototype.run = function (rules) {
    var idb = {}, r, j;
    for (r = 0; r < rules.length; r++) idb[rules[r].head[0]] = 1;
    var delta = {}, round = 0;
    while (round < ROUND_CAP && !this.capped) {
      round++;
      this.rounds = round;
      var next = {}, added = false;
      for (r = 0; r < rules.length; r++) {
        var rule = rules[r], body = rule.body, pos = [];
        for (j = 0; j < body.length; j++) if (idb[body[j][0]]) pos.push(j);
        if (!pos.length) {
          if (round > 1) continue;
          if (this.emit(rule.head, this.solve(body, 0, {}), next)) added = true;
        } else {
          for (j = 0; j < pos.length; j++) {
            var d = delta[body[pos[j]][0]];
            if (!d || !d.length) continue;
            if (this.emit(rule.head, this.solve(body, 0, {}, pos[j], d), next)) added = true;
          }
        }
      }
      if (!added) break;
      delta = next;
    }
    return this;
  };

  /** The graph signal for a query: seed the rules with the strongest hits and
   * read the derived relations back as scores and reasons. */
  function graph(idx, text, opts) {
    opts = opts || {};
    var counts = { derived: 0, capped: false, rounds: 0, related: 0, same_series: 0, points_at: 0, near: 0 };
    var out = [], why = {}, score = {};
    var seeds = opts.seeds || topSeeds(idx, text, SEED_N);
    if (!idx || !seeds.length) return { list: out, counts: counts };
    var db = new Datalog({
      seed: seeds.map(function (i) { return [i]; }),
      post: idx.graph.post, link: idx.graph.link, cites: idx.graph.cites,
    }).run(RULES);
    counts.derived = db.derived;
    counts.capped = db.capped;
    counts.rounds = db.rounds;
    var slug = function (i) { return idx.docs[i] ? idx.docs[i].slug : '?'; };
    var short = function (id) { return idx.source[id] ? idx.source[id][1] : id; };
    function note(q, s, reason) {
      score[q] = Math.max(score[q] || 0, s);
      var r = why[q] || (why[q] = []);
      if (r.indexOf(reason) < 0 && r.length < 4) r.push(reason);
    }
    var rel = db.relOf('related'), i, t;
    counts.related = rel.length;
    for (i = 0; i < rel.length; i++) {
      t = rel[i];
      note(t[1], GW.related, 'graph: also cites "' + short(t[2]) + '", like ' + slug(t[0]));
    }
    rel = db.relOf('points_at');
    counts.points_at = rel.length;
    for (i = 0; i < rel.length; i++) {
      t = rel[i];
      note(t[1], GW.points_at, 'graph: linked from ' + slug(t[0]));
    }
    rel = db.relOf('same_series');
    counts.same_series = rel.length;
    for (i = 0; i < rel.length; i++) {
      t = rel[i];
      note(t[1], GW.same_series, 'graph: same series as ' + slug(t[0]) + ' (' + (idx.docs[t[0]] ? idx.docs[t[0]].series : t[1]) + ')');
    }
    rel = db.relOf('near');
    counts.near = rel.length;
    for (i = 0; i < rel.length; i++) {
      t = rel[i];
      note(t[1], GW.near, 'graph: two links from ' + slug(t[0]));
    }
    for (var key in score) out.push({ i: +key, score: score[key], why: why[key] });
    out.sort(function (a, b) { return b.score - a.score || a.i - b.i; });
    return { list: out, counts: counts };
  }

  /** The strongest hits of a query: the seeds the graph rules start from, and
   * the cap the page states. The two providers are normalised by their own best
   * score first, so one of them cannot seed the graph by scale alone — and a
   * piece the words name seeds ahead of one only a vector or the graph reached,
   * the same rank the fused query sorts on. */
  function topSeeds(idx, text, n) {
    if (!idx) return [];
    var lex = lexical(idx, text, {}), vec = vector(idx, text, {}), i, key;
    var m = {}, named = namedSet(lex), maxL = 0, maxV = 0;
    for (i = 0; i < lex.length; i++) if (lex[i].score > maxL) maxL = lex[i].score;
    for (i = 0; i < vec.length; i++) if (vec[i].score > maxV) maxV = vec[i].score;
    for (i = 0; i < lex.length; i++) m[lex[i].i] = (m[lex[i].i] || 0) + W_LEX * (lex[i].score / (maxL || 1));
    for (i = 0; i < vec.length; i++) m[vec[i].i] = (m[vec[i].i] || 0) + W_VEC * (vec[i].score / (maxV || 1));
    var best = [];
    for (key in m) best.push([+key, m[key]]);
    best.sort(function (a, b) { return tier(named, b[0]) - tier(named, a[0]) || b[1] - a[1] || a[0] - b[0]; });
    var out = [];
    for (i = 0; i < best.length && i < n; i++) out.push(best[i][0]);
    return out;
  }

  /** The facets, as a predicate over the pieces. */
  function allowed(idx, i, opts) {
    var d = idx.docs[i];
    if (!d) return false;
    if (opts.series && d.series !== opts.series) return false;
    if (opts.kind && d.kind !== opts.kind) return false;
    return true;
  }

  /* ---------- the fused query --------------------------------------------- */

  function query(text, opts) {
    var idx = S._idx;
    opts = opts || {};
    var t0 = now();
    var counts = { terms: 0, results: 0, related: 0, same_series: 0, points_at: 0, near: 0, derived: 0, capped: false, rounds: 0, graphOnlyDropped: 0, ms: 0 };
    if (!idx) return { results: [], counts: counts };
    var toks = tokenize(text, idx.stop);
    counts.terms = toks.length;
    if (!toks.length) return { results: [], counts: counts };

    var lex = lexical(idx, text, opts), vec = vector(idx, text, opts), i, key;
    var m = {}, why = {}, named = namedSet(lex), maxL = 0, maxV = 0;
    for (i = 0; i < lex.length; i++) if (lex[i].score > maxL) maxL = lex[i].score;
    for (i = 0; i < vec.length; i++) if (vec[i].score > maxV) maxV = vec[i].score;
    for (i = 0; i < lex.length; i++) {
      m[lex[i].i] = (m[lex[i].i] || 0) + (maxL ? W_LEX * (lex[i].score / maxL) : 0);
      why[lex[i].i] = (why[lex[i].i] || []).concat(lex[i].why).slice(0, 6);
    }
    for (i = 0; i < vec.length; i++) {
      m[vec[i].i] = (m[vec[i].i] || 0) + (maxV ? W_VEC * (vec[i].score / maxV) : 0);
      var r = why[vec[i].i] || (why[vec[i].i] = []);
      if (r.indexOf('similar') < 0 && r.length < 6) r.push('similar');
    }
    var keys = [];
    for (key in m) if (allowed(idx, +key, opts)) keys.push(+key);
    keys.sort(function (a, b) { return tier(named, b) - tier(named, a) || m[b] - m[a] || a - b; });

    var g = graph(idx, text, { seeds: keys.slice(0, SEED_N) });
    counts.derived = g.counts.derived;
    counts.capped = g.counts.capped;
    counts.rounds = g.counts.rounds;
    counts.related = g.counts.related;
    counts.same_series = g.counts.same_series;
    counts.points_at = g.counts.points_at;
    counts.near = g.counts.near;
    var graphOnly = 0, graphOnlyDropped = 0;
    for (i = 0; i < g.list.length; i++) {
      var e = g.list[i];
      if (!allowed(idx, e.i, opts)) continue;
      if (m[e.i] === undefined) {
        // a piece no word and no vector found: it is here on the graph's word
        // alone, and only so many of those are worth showing — a graph that can
        // name every piece names nothing. The ones the cap drops are COUNTED,
        // not silently lost: a reader cannot tell a short list from a bound.
        if (graphOnly >= GRAPH_CAP) { graphOnlyDropped++; continue; }
        graphOnly++;
        m[e.i] = e.score;
        why[e.i] = [];
      } else {
        m[e.i] += e.score * 0.35;
      }
      var r2 = why[e.i] || (why[e.i] = []);
      for (var j = 0; j < e.why.length; j++) if (r2.indexOf(e.why[j]) < 0 && r2.length < 6) r2.push(e.why[j]);
    }
    counts.graphOnlyDropped = graphOnlyDropped;
    var all = [];
    for (key in m) if (allowed(idx, +key, opts)) all.push({ i: +key, score: m[key], why: why[key] || [] });
    all.sort(function (a, b) { return tier(named, b.i) - tier(named, a.i) || b.score - a.score || a.i - b.i; });
    counts.results = all.length;
    counts.ms = Math.round((now() - t0) * 10) / 10;
    return { results: all.slice(0, opts.limit || RESULT_CAP), counts: counts };
  }

  function now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  /* ---------- the page: snippets, rendering, URL state, keyboard ---------- */

  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ESC[c]; }); }
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&'); }

  /** A snippet with every word the query reaches marked, drawn from the piece's
   * own summary, headings and opening passage — the page says so, because the
   * full text of fifty-eight pieces is not in the page.
   *
   * A heading the query reaches is the sharpest line to show, joined to the
   * piece's own summary for context; otherwise the summary (a sentence about the
   * piece); the opening is the last resort. A result the graph alone put here
   * matches nothing in any of them, and shows the summary like any other. */
  function snippet(idx, i, toks) {
    var d = idx.docs[i], heads = d.heads || [], summary = d.summary || '', lede = d.lede || '';
    var hitHead = '', h, t;
    for (h = 0; h < heads.length && !hitHead; h++) {
      for (t = 0; t < toks.length; t++) {
        if (heads[h].toLowerCase().indexOf(toks[t]) >= 0) { hitHead = heads[h]; break; }
      }
    }
    var text = hitHead && summary ? hitHead + ' — ' + summary : (hitHead || summary || lede);
    if (text.length > 260) {
      var p0 = -1;
      for (t = 0; t < toks.length; t++) {
        var p = text.toLowerCase().indexOf(toks[t]);
        if (p >= 0 && (p0 < 0 || p < p0)) p0 = p;
      }
      var start = p0 > 90 ? p0 - 90 : 0;
      text = (start ? '…' : '') + text.slice(start, start + 250) + '…';
      if (start) text = text.replace(/^\S+\s/, '…');
    }
    var html = esc(text);
    if (toks.length) {
      var parts = toks.slice(0).sort(function (a, b) { return b.length - a.length; });
      var re = new RegExp('\\b(?:' + parts.map(escRe).join('|') + ")[a-z'-]*", 'gi');
      html = html.replace(re, function (w) { return '<mark>' + w + '</mark>'; });
    }
    return html;
  }

  function resultHtml(idx, r, toks) {
    var d = idx.docs[r.i];
    return '<li class="sr">' +
      '<a class="sr-t" href="/' + esc(d.slug) + '/">' + esc(d.title) + '</a>' +
      '<div class="sr-m">' + esc(d.series || 'unfiled') + ' · ' + esc(d.kind || '') + ' · ' + esc(d.date || '') +
      '<span class="sr-sc">' + r.score.toFixed(2) + '</span></div>' +
      '<p class="sr-s">' + snippet(idx, r.i, toks) + '</p>' +
      '<ul class="sr-w">' + r.why.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' +
      '</li>';
  }

  function render(idx, box, status, text, opts) {
    var res = query(text, opts || {});
    var toks = tokenize(text, idx.stop);
    if (!res.results.length) {
      box.innerHTML = '<li class="sr-none">' +
        (toks.length
          ? 'Nothing in the published pieces answers to that.'
          : 'Type a word — the pieces are searched by their words, their vectors and their links.') +
        '</li>' +
        (idx.hints.length && !toks.length
          ? '<li class="sr-hint">Try: ' + idx.hints.map(function (h) {
              return '<button type="button" class="sr-go" data-q="' + esc(h) + '">' + esc(h) + '</button>';
            }).join(' ') + '</li>'
          : '');
    } else {
      box.innerHTML = res.results.map(function (r) { return resultHtml(idx, r, toks); }).join('');
    }
    var c = res.counts;
    var shown = res.results.length;
    status.textContent = shown
      ? '# ' + shown + (c.results > shown ? ' of ' + c.results : '') + ' result' +
        (c.results === 1 ? '' : 's') + ' · ' + c.ms + ' ms · the graph rules fired: ' +
        c.related + ' shared-citation, ' + c.points_at + ' link, ' + c.same_series + ' same-series, ' + c.near + ' two-hop' +
        (c.graphOnlyDropped
          ? ' · ' + c.graphOnlyDropped + ' graph-only result' + (c.graphOnlyDropped === 1 ? '' : 's') + ' beyond the cap'
          : '') +
        (c.capped ? ' · expansion capped' : '')
      : '';
    return res;
  }

  /** `?q=` and the facets, so a search is a link someone can send. */
  function readUrl() {
    var q = '', s = '', k = '', raw = String((window.location && window.location.search) || '').replace(/^\?/, '');
    var parts = raw ? raw.split('&') : [];
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split('='), val = decodeURIComponent(kv[1] || '');
      if (kv[0] === 'q') q = val;
      else if (kv[0] === 'series') s = val;
      else if (kv[0] === 'kind') k = val;
    }
    return { q: q, series: s, kind: k };
  }
  function writeUrl(st) {
    var q = [];
    if (st.q) q.push('q=' + encodeURIComponent(st.q));
    if (st.series) q.push('series=' + encodeURIComponent(st.series));
    if (st.kind) q.push('kind=' + encodeURIComponent(st.kind));
    try {
      window.history.replaceState(null, '', '/search/' + (q.length ? '?' + q.join('&') : ''));
    } catch (e) { /* a browser that refuses history still searches */ }
  }

  function wire() {
    var idx = S._idx;
    var box = document.getElementById('sres');
    var status = document.getElementById('sstatus');
    var input = document.getElementById('sq');
    if (!idx || !box || !input) return false;
    var series = document.getElementById('sf-series');
    var kind = document.getElementById('sf-kind');
    var url = readUrl();
    if (url.q) input.value = url.q;
    if (url.series && series) series.value = url.series;
    if (url.kind && kind) kind.value = url.kind;
    function stateOf() {
      return { q: input.value, series: series ? series.value : '', kind: kind ? kind.value : '' };
    }
    function run(push) {
      var st = stateOf();
      render(idx, box, status, st.q, { series: st.series, kind: st.kind });
      if (push) writeUrl(st);
    }
    run(false);
    var form = document.getElementById('sf');
    if (form) form.addEventListener('submit', function (e) { e.preventDefault(); run(true); });
    input.addEventListener('input', function () { run(true); });
    if (series) series.addEventListener('change', function () { run(true); });
    if (kind) kind.addEventListener('change', function () { run(true); });
    box.addEventListener('click', function (e) {
      var el = e.target;
      if (el && el.className === 'sr-go') { input.value = el.getAttribute('data-q'); run(true); }
    });
    if (!url.q) { try { input.focus({ preventScroll: true }); } catch (e) { } }
    return true;
  }

  function boot() {
    var el = document.getElementById('search-data');
    if (!el) return null;
    try { S.init(JSON.parse(el.textContent)); } catch (e) { return null; }
    wire();
    return S._idx;
  }

  /* ---------- the surface Phase 2 keeps -------------------------------- */

  var S = {
    DIM: DIM,
    fnv1a: fnv1a,
    project: project,
    tokenize: tokenize,
    index: makeIndex,
    _idx: null,
    init: function (data) { S._idx = makeIndex(data); return S._idx; },
    providers: {
      lexical: function (q, opts) { return lexical(S._idx, q, opts || {}); },
      vector: function (q, opts) { return vector(S._idx, q, opts || {}); },
      graph: function (q, opts) { return graph(S._idx, q, opts || {}); },
    },
    query: function (text, opts) { return query(text, opts); },
    snippet: function (i, text) { return snippet(S._idx, i, tokenize(text, S._idx.stop)); },
    render: function (box, status, text, opts) { return render(S._idx, box, status, text, opts || {}); },
    readUrl: readUrl,
    writeUrl: writeUrl,
    wire: wire,
    boot: boot,
  };
  if (typeof window !== 'undefined') window.Search = S;
  // the script is inlined into the page, so it must not depend on where the
  // markup sits relative to it
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
