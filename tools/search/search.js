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
 * The vocabulary itself is held as a MINIMAL ACYCLIC AUTOMATON (built in
 * tools/build.mjs) rather than as a string of words: the client walks it back
 * out at load, in the sorted order the postings are indexed by, and a query
 * wrapped in slashes is answered by walking the same automaton with a small NFA
 * — which is what lets a pattern match the MIDDLE of a word, a question no
 * posting list can be asked. A word behind a `~` is answered by the same
 * automaton a third way: an edit-distance row is carried down it and a branch is
 * abandoned the moment it leaves the budget, so every word within k edits of the
 * query is found without measuring the query against each of the fifteen
 * thousand words in turn.
 *
 * The build inlines this file into the page, comment-free. Phase 2 replaces the
 * lexical and datalog INTERNALS (the Zig datalog-dafsa engine) behind this same
 * surface, so everything the page writes against is the interface below and
 * nothing else:
 *
 *   Search.providers = { lexical(q, opts), vector(q, opts), graph(q, opts) }
 *                    (a lexical entry also carries `named`: the query named it
 *                    by an exact term hit, which outranks a similar/neighbour)
 *   Search.matchPattern(body, opts) -> { terms, capped }
 *   Search.matchFuzzy(word, k) -> { words: [{w, d}], capped }
 *   Search.matchPrefix(prefix, cap) -> { terms, capped }
 *   Search.query(text, opts) -> { results: [{i, score, why, named}], counts, marks }
 *                    (a result carries the same `named` the providers use: the
 *                    query's own words are in it, which is the split the page
 *                    renders — the named rows stand, the related ones follow)
 *
 * Three things read the same automaton three more ways for the reader, and none
 * of them has an index of its own: the words that BEGIN with what is being typed
 * (the box's completions), the words within an edit of a word that found nothing
 * (the "did you mean"), and the fuzzy walk above. All three are reported when a
 * bound stops them — a bounded list and a short one look the same otherwise.
 */
(function () {
  'use strict';

  var DIM = 160;          // vector dimensions, fixed: the hash's modulus
  var SEED_N = 6;         // hits handed to the graph rules as their seeds
  var PREFIX_CAP = 120;   // vocabulary terms one prefix may expand to
  var FUZZY_CAP = 200;    // vocabulary terms one fuzzy word may expand to
  var RESULT_CAP = 24;    // results returned for one query
  var GRAPH_CAP = 12;     // results the graph may add that no word or vector found
  var COMPLETE_CAP = 8;   // vocabulary terms the box offers for one typed prefix
  var COMPLETE_MIN = 3;   // characters a word needs before any are offered
  var SUGGEST_CAP = 24;   // near words one typo may be weighed against
  var THIN = 2;           // results at or below which a misspelling is offered
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
  /* A fuzzy term: one or two tildes and the word they mark. The word obeys the
   * index's rule below (three characters and longer, no stopword), so `~ab` is
   * nothing rather than a walk for a word the list cannot hold. */
  var FUZZY_MARK = /~{1,2}[a-z][a-z'-]*/g;
  var FUZZY_TILDES = /^~+/;
  /* A phrase: a quoted run of words. The quotes are not decoration and not a
   * word delimiter — the run between them is matched as ONE demand, and the
   * words inside it are taken OUT of the ordinary OR-ed words, or the quotes
   * would answer a question the reader did not ask. The match admits any
   * characters around the words (a stopword may sit inside a quoted run; it is
   * the reader's phrase and it is matched as written), which is also why the
   * mark is greedy-lazy: a second quote opens the NEXT phrase. */
  var PHRASE_MARK = /"([^"]*)"/g;

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
   * answering "the" with fifty-eight pieces would be noise, not an answer.
   *
   * A word behind a `~` is NOT one of these. It is a fuzzy term (see
   * `fuzzyTerms`), matched against the whole list by an edit-distance walk
   * rather than looked up, and leaving it in the ordinary words as well would
   * make the `~` a decoration: `~proclus` would be answered by the exact
   * lookups for `proclus` and the walk would decide nothing. No piece's prose
   * contains a `~`, so this cannot take a word away from an ordinary query.
   *
   * A word inside a quoted phrase is not ordinary either (see `phraseTerms`):
   * the run between the quotes is ONE demand with an order, and its words are
   * taken out of the loose ones by `stripPhrases` before this runs. */
  function tokenize(text, stop) {
    var ws = stripPhrases(String(text), stop).toLowerCase().replace(FUZZY_MARK, ' ').match(WORD) || [];
    var out = [], i, w;
    for (i = 0; i < ws.length; i++) {
      w = ws[i];
      if (w.length >= 3 && !stop[w] && out.indexOf(w) < 0) out.push(w);
    }
    return out;
  }

  /* ---------- the query's fuzzy terms ------------------------------------- */

  /** The words a query asks for fuzzily, read off the RAW text: the word behind
   * one `~` is matched within one edit, behind two within two. One tilde is the
   * typo people actually make; two is an explicit widening, because an edit
   * budget of two reaches several times as many words and a list that answers
   * with everything is not an answer. */
  function fuzzyTerms(text, stop) {
    var s = String(text).toLowerCase(), out = [], m, w;
    FUZZY_MARK.lastIndex = 0;
    while ((m = FUZZY_MARK.exec(s))) {
      w = m[0].replace(FUZZY_TILDES, '');
      if (w.length >= 3 && !stop[w]) out.push({ q: w, k: m[0].length - w.length });
    }
    return out;
  }

  /* ---------- the query's phrases ------------------------------------------ */

  /** The quoted runs, read off the RAW text, in the order they appear. A run
   * becomes a SEQUENCE: every word of the run with its offset in the run's own
   * token list — offsets count stopwords too, because the body's position
   * stream counts them: "love of wisdom" is love@0, of@1, wisdom@2, and the
   * match is wisdom at anchor+2, not anchor+1. A stopword inside a phrase is
   * therefore PART OF THE PHRASE (the reader wrote it inside a demand that is
   * matched as written) but never an anchor (no positions exist for a word the
   * index does not hold); a repeated word is matched at every occurrence (the
   * sequence keeps duplicates; only the MARKS deduplicate).
   *
   * A run with no recordable word at all (`""`, `"?!"`, "of the and") is not a
   * phrase and not an error — it is dropped and reported. A run of ONE word is
   * that word's exact positions, which the same matcher answers. A run holding
   * a word the VOCABULARY does not carry cannot be matched; the matcher
   * reports the word and answers nothing, which is the honest answer to a
   * phrase the corpus cannot say. */
  function phraseTerms(text, stop) {
    var out = [], dropped = [], m;
    PHRASE_MARK.lastIndex = 0;
    while ((m = PHRASE_MARK.exec(String(text)))) {
      var toks = m[1].toLowerCase().match(WORD) || [];
      var seq = [];
      for (var i = 0; i < toks.length; i++) {
        if (toks[i].length >= 3 && !stop[toks[i]]) seq.push({ w: toks[i], off: i });
      }
      if (!seq.length) { dropped.push(m[1]); continue; }
      var uniq = [];
      for (var j = 0; j < seq.length; j++) if (uniq.indexOf(seq[j].w) < 0) uniq.push(seq[j].w);
      out.push({ text: m[1], words: uniq, seq: seq });
    }
    return { phrases: out, dropped: dropped };
  }

  /** The query with its phrases lifted out. The runs' words are removed (a
   * quoted word is part of a demand, not a loose OR-ed term); the quotes
   * themselves are removed from the text entirely, so a phrase's words cannot
   * come back as prefix hits through the back door. */
  function stripPhrases(text, stop) {
    if (String(text).indexOf('"') < 0) return String(text);
    var ph = phraseTerms(text, stop);
    var out = String(text);
    for (var i = 0; i < ph.phrases.length; i++) {
      var re = new RegExp('[a-z\'-]*' + escReWord(ph.phrases[i].text) + '[a-z\'-]*', 'gi');
      out = out.replace(re, ' ');
    }
    out = out.replace(/"/g, ' ');
    return out;
  }

  /** `escRe` for a phrase body: the phrase's own text may hold regex
   * characters, and the strip builds a regex from it. */
  function escReWord(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** The words of every quoted run — for the MARKS, which show what the reader
   * asked for however it was asked: a phrase's words are marked in the snippet
   * and the title exactly as loose words are. */
  function phraseWords(text, stop) {
    var ph = phraseTerms(text, stop), out = [], i, j;
    for (i = 0; i < ph.phrases.length; i++) {
      for (j = 0; j < ph.phrases[i].words.length; j++) {
        if (out.indexOf(ph.phrases[i].words[j]) < 0) out.push(ph.phrases[i].words[j]);
      }
    }
    return out;
  }

  /* ---------- the automaton the words are held in -------------------------- */

  /** The sixty-four characters the build wrote the automaton in (tools/build.mjs,
   * DAFSA_ENC — the two must agree, or every word comes back as nonsense). */
  var ENC = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_~';
  var ENC_AT = (function () {
    var m = {}, i;
    for (i = 0; i < ENC.length; i++) m[ENC.charAt(i)] = i;
    return m;
  })();

  /**
   * The automaton, decoded from the three streams the build emitted. State ids
   * run in post-order (a state's children are always lower-numbered), which is
   * what the delta column relies on: a transition stores its source's id minus
   * its target's, so the target is `i - delta`.
   */
  function decodeDafsa(d) {
    var s = d.s, l = d.l, t = d.t;
    var n = s.length;
    var off = new Int32Array(n + 1), fin = new Uint8Array(n), to = new Int32Array(l.length);
    var e = 0, at = 0, i, k;
    for (i = 0; i < n; i++) {
      var c = ENC_AT[s.charAt(i)];
      fin[i] = c >>> 5;
      var deg = c & 31;
      off[i] = e;
      for (k = 0; k < deg; k++) {
        var v = 0, mul = 1, cv;
        do {
          cv = ENC_AT[t.charAt(at++)];
          v += (cv & 31) * mul;
          mul *= 32;
        } while (cv >= 32);
        to[e++] = i - v;
      }
    }
    off[n] = e;
    return { n: n, off: off, fin: fin, to: to, lbl: l, root: n - 1 };
  }

  /**
   * The words, walked back out of the automaton.
   *
   * A depth-first walk that takes each state's transitions in label order and
   * writes a word whenever it passes a final state. The order is the whole
   * point: it is the sorted order — a word is written before any word it
   * begins, and siblings are visited in alphabetical order — so the position a
   * word comes out at IS its row in the postings. The vocabulary therefore
   * needs no index of its own in the page: it is stored as the automaton, and
   * every query holds the same array it always did.
   */
  function dafsaTerms(g) {
    var out = [], chars = [];
    (function visit(st) {
      if (g.fin[st]) out.push(chars.join(''));
      for (var e = g.off[st]; e < g.off[st + 1]; e++) {
        chars.push(g.lbl.charAt(e));
        visit(g.to[e]);
        chars.pop();
      }
    })(g.root);
    return out;
  }

  /* ---------- the same automaton, walked with an edit budget --------------- */

  /**
   * The words within `k` edits of a query word, walked over the automaton with a
   * DP row — NOT by measuring the query against every word of the list, which
   * would pay an edit-distance matrix per word (measured on this vocabulary:
   * 25 ms a query against 0.1 ms at k=1 and 0.7 ms at k=2 here).
   *
   * The row carried at a state holds the distance between each PREFIX of the
   * query and the word prefix the path spells: descending a transition computes
   * the next row from the previous one plus that label, and a branch is dropped
   * as soon as the row's smallest entry passes k. Dropping the whole branch is
   * what makes it cheap, and it is sound because a row's minimum never falls as
   * the word grows — every way of computing a new cell produces at least the
   * smallest entry of the row above it. A final state whose query-length cell is
   * within k is a word of the answer, carrying the distance it was found at.
   *
   * The operation is OSA (optimal string alignment): an adjacent SWAP counts as
   * ONE edit, not two, so `proculs` for `proclus` — the commonest typo there is —
   * is one edit away and not two. Seeing a swap needs the row one step further
   * back than plain Levenshtein does, so each state carries two rows and the
   * label it arrived by.
   *
   * The automaton is acyclic, so a (state, row, row-before, label) reached again
   * could only re-derive what it derived the first time, and the walk remembers
   * the ones that reached no word — but it is NOT built here: the key has to
   * carry all four, and building it costs more than the revisits it saves.
   * Measured over the whole vocabulary at k=2 — every term of the list as a
   * query — 12.0 s without it against 37.1 s with it, and no query reached
   * 20,000 states either way. The pruning is what bounds the walk.
   *
   * The cap is the page's usual one, and it is REPORTED: a short query is within
   * two edits of hundreds of words, the walk stops at the cap in the list's own
   * order, and the line above the results says so rather than letting a bounded
   * list look like a short one.
   */
  function fuzzyWalk(g, q, k, cap) {
    var m = q.length, words = [], chars = [], capped = false;
    var qi = new Int32Array(m + 1), j;
    for (j = 1; j <= m; j++) qi[j] = q.charCodeAt(j - 1);

    function visit(st, row, prev, last) {
      var e, c, cc, next, min, v, jj;
      if (g.fin[st] && row[m] <= k) {
        words.push({ w: chars.join(''), d: row[m] });
        if (words.length >= cap) { capped = true; return true; }
      }
      for (e = g.off[st]; e < g.off[st + 1]; e++) {
        c = g.lbl.charAt(e);
        cc = g.lbl.charCodeAt(e);
        next = new Int32Array(m + 1);
        next[0] = row[0] + 1;
        min = next[0];
        for (jj = 1; jj <= m; jj++) {
          v = Math.min(row[jj] + 1, next[jj - 1] + 1, row[jj - 1] + (qi[jj] === cc ? 0 : 1));
          if (prev && jj > 1 && last === q.charAt(jj - 1) && c === q.charAt(jj - 2)) {
            v = Math.min(v, prev[jj - 2] + 1);
          }
          next[jj] = v;
          if (v < min) min = v;
        }
        if (min > k) continue;
        chars.push(c);
        if (visit(g.to[e], next, row, c)) { chars.pop(); return true; }
        chars.pop();
      }
      return false;
    }

    var root0 = new Int32Array(m + 1);
    for (j = 0; j <= m; j++) root0[j] = j;
    visit(g.root, root0, null, null);
    return { words: words, capped: capped };
  }

  /* ---------- the same automaton, walked down a prefix ---------------------- */

  /**
   * The words that BEGIN with a prefix, taken off the automaton rather than off
   * a scan of the list: descend the transitions the prefix spells (a missing
   * label is a prefix no word has), then enumerate what the state reached
   * accepts, in label order, which is the list's own order. A DAFSA merges
   * suffixes, so the state reached is shared with every other word that gets
   * there — what it accepts IS the set of completions, so sharing changes
   * nothing.
   *
   * The enumeration is bounded (a two- or three-letter prefix reaches hundreds
   * of words) and the bound is REPORTED: an enumerating walk that stopped is a
   * different answer from a list that ended, and only one of them is honest to
   * show without a word about it.
   */
  function prefixWalk(g, prefix, cap) {
    var st = g.root, i, e, next, out = [], chars = [], capped = false;
    for (i = 0; i < prefix.length; i++) {
      next = -1;
      for (e = g.off[st]; e < g.off[st + 1]; e++) {
        if (g.lbl.charAt(e) === prefix.charAt(i)) { next = g.to[e]; break; }
      }
      if (next < 0) return { terms: out, capped: false };
      st = next;
    }
    (function visit(s) {
      if (g.fin[s]) {
        out.push(prefix + chars.join(''));
        // one word PAST the offer is what proves there are more: stopping at
        // the cap itself cannot tell a list that ended from one that was cut
        if (out.length > cap) return true;
      }
      for (var e2 = g.off[s]; e2 < g.off[s + 1]; e2++) {
        chars.push(g.lbl.charAt(e2));
        if (visit(g.to[e2])) { chars.pop(); return true; }
        chars.pop();
      }
      return false;
    })(st);
    if (out.length > cap) { out.length = cap; capped = true; }
    return { terms: out, capped: capped };
  }

  /* ---------- the misspelling a thin answer offers ------------------------- */

  /**
   * The one word of the query that is not in the list and has a word within one
   * edit of it — the "did you mean" the page offers when almost nothing was
   * found. It is the SAME walk the `~` syntax uses (fuzzyWalk, budget one), not
   * a second matcher: a query that returns nothing and a query the reader wrote
   * with a `~` are asking the list the same question.
   *
   * A word the list already holds is never offered a correction (it was
   * answered), and the correction replaces the misspelled word IN the query, so
   * a phrase keeps its other words. Nothing is rewritten without being shown:
   * the page prints the word it has in mind and the reader runs it or does not.
   */
  function suggestWords(idx, text, toks) {
    if (!idx.dafsa || !toks.length) return null;
    var best = null, i, wi, hit, cand, re, corrected;
    for (i = 0; i < toks.length; i++) {
      if (idx.at[toks[i]] !== undefined) continue;
      hit = fuzzyWalk(idx.dafsa, toks[i], 1, SUGGEST_CAP);
      for (wi = 0; wi < hit.words.length; wi++) {
        cand = hit.words[wi];
        if (!best || cand.d < best.d || (cand.d === best.d && cand.w < best.to)) {
          best = { from: toks[i], to: cand.w, d: cand.d, capped: hit.capped };
        }
      }
    }
    if (!best) return null;
    re = new RegExp('\\b' + escRe(best.from) + '\\b', 'i');
    corrected = String(text).replace(re, best.to);
    if (corrected === String(text)) return null;
    best.corrected = corrected;
    return best;
  }

  /* ---------- the index, decoded from the page's own data block ---------- */

  function makeIndex(data) {
    var stop = {}, parts = String(data.stop || '').split(' ');
    var i, d;
    for (i = 0; i < parts.length; i++) if (parts[i]) stop[parts[i]] = 1;
    var dafsa = data.lex.dafsa ? decodeDafsa(data.lex.dafsa) : null;
    var terms = dafsa ? dafsaTerms(dafsa) : [];
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
      dafsa: dafsa, hints: data.hints || [],
      deepUrl: typeof data.deep === 'string' ? data.deep : '',
    };
  }

  /* ---------- the fetched half: body positions and passages --------------- */

  /* The deep index is FETCHED, once, on the first query that needs it — an
   * in-memory promise caches it, so a second query reuses the decode, and the
   * browser's own HTTP cache makes a second visit cheap. Without it — before
   * it lands, or when the fetch fails — the page searches EXACTLY as it did
   * before this half existed: no phrases (a quoted run falls back to its words
   * as ordinary terms, still OR-ed), no passage snippets, everything else
   * untouched. A reader must never see a broken page because a fetch failed,
   * so nothing waits on it and nothing throws through it. */
  var deepPromise = null;

  /** The facets' current values, read off the page's own controls — the
   * re-render a landed fetch triggers must answer with the facets the reader
   * set, not the defaults. */
  function querySeries() {
    var el = document.getElementById('sf-series');
    return el ? el.value : '';
  }
  function querySort() {
    var el = document.getElementById('sf-sort');
    return el ? el.value : '';
  }

  function deepOf(idx) {
    if (!idx.deepUrl || typeof fetch !== 'function') return null;
    if (!deepPromise) {
      deepPromise = fetch(idx.deepUrl, { credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
        .then(function (raw) {
          var dec = makeDeep(idx, raw);
          idx.deep = dec;
          // the query that ran while this was in flight answered on the words
          // only and said so — now that the phrases can be matched, the page
          // answers again, with the query the reader already typed
          var box = document.getElementById('sres');
          var status = document.getElementById('sstatus');
          var input = document.getElementById('sq');
          if (box && status && input && input.value.indexOf('"') >= 0) {
            try { render(idx, box, status, input.value, { series: querySeries(), sort: querySort() }); } catch (e) { }
          }
          return dec;
        })
        .catch(function () {
          deepPromise = null;   // a later query may retry; this one degrades
          return null;
        });
    }
    return deepPromise;
  }

  /** The decoded deep half. `lex` addresses a term's runs by the term's own
   * index in the vocabulary (row count == vocabulary, empty rows included), so
   * no second lookup structure is needed. BM25 needs three things the inline
   * half does not carry: the BODY length of each piece (in tokens), which
   * `len` holds, and the body term frequencies, which `runs` gives without
   * decoding (a run's length IS its term's body frequency in that piece) — the
   * third, the document frequency, is the posting list's own length as
   * before. `k1` and `b` are BM25's usual calibration: k1=1.2 is the standard
   * saturation point (a term's tenth occurrence adds much less than its
   * first), b=0.75 the usual length normalisation (a piece half again as long
   * is not half again as relevant); neither is tuned on this corpus, which is
   * the point of using the standard values rather than inventing fit. */
  var BM25_K1 = 1.2, BM25_B = 0.75;

  function makeDeep(idx, raw) {
    var pass = raw.pass, passAt = raw.passAt;
    var n = idx.n;
    var len = new Array(n);
    var i, d;
    // body length in tokens: every word of every passage (the stream counts
    // them all, whatever their kind), which is the length BM25's normaliser
    // wants — the same stream the positions are offsets into
    for (d = 0; d < n; d++) {
      var total = 0;
      for (i = 0; i < pass[d].length; i++) {
        total += ((pass[d][i].toLowerCase().match(WORD) || []).length);
      }
      len[d] = total;
    }
    var avg = 0;
    for (d = 0; d < n; d++) avg += len[d];
    avg = n ? avg / n : 1;
    return { lex: raw.lex, pass: pass, passAt: passAt, len: len, avg: avg, k1: BM25_K1, b: BM25_B };
  }

  /** A term's positions in one piece, or null: [piece, first, delta, …] ->
   * absolute stream positions. `max` bounds the work; undefined means all. */
  function positionsOf(deep, ti, d, max) {
    var row = deep.lex[ti];
    if (!row) return null;
    var out = null, take = max === undefined ? Infinity : max;
    for (var r = 0; r < row.length; r++) {
      var run = row[r];
      if (run[0] !== d) continue;
      out = [];
      var p = 0, k;
      for (k = 1; k < run.length && out.length < take; k++) {
        p = k === 1 ? run[k] : p + run[k];
        out.push(p);
      }
      return out;
    }
    return null;
  }

  /** BM25 for one term in one piece. The idf is the same one the whole page
   * uses (the posting list's length IS the document frequency), so the two
   * scorers cannot disagree about a word's rarity. */
  function bm25(deep, idx, ti, d, tf) {
    var df = idx.postings[ti].length;
    var idf = Math.log(1 + (idx.n - df + 0.5) / (df + 0.5));
    var dl = deep.len[d] || deep.avg;
    return idf * (tf * (deep.k1 + 1)) / (tf + deep.k1 * (1 - deep.b + deep.b * (dl / deep.avg)));
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
   * exact term hit, not a prefix), which is the rank the fusion sorts on.
   *
   * A fuzzy term lands in the same postings, the same idf and the same
   * title/heading boost — it is a term hit by a word the reader did not quite
   * type. Two things differ, and both are the point:
   *
   *   - it NEVER sets `named`, so a word the query did not use can never be
   *     ranked as one the query did. The rank is compared before any score, so
   *     a piece found only fuzzily sits below every piece a literal word found,
   *     however large the fuzzy score;
   *   - its weight is scaled by how far the word it found is from the word it
   *     asked for: 1 - d/(len+1), with the length of the word TYPED. One edit on
   *     a fourteen-letter word is one wrong letter in fourteen and should cost
   *     less than one edit on a three-letter word, which is a third of it. At
   *     d = 0 the weight is the term's own, so `~proclus` alone finds what
   *     `proclus` finds — one rank lower, which is what asking fuzzily means.
   *
   * `stats`, when given, is where the walk's own numbers go (words matched, the
   * budget used, whether the cap stopped it, its time) so the page can report
   * them; the search page passes one, a caller that only wants the list does
   * not. */
  function lexical(idx, text, opts, stats) {
    var toks = tokenize(text, idx.stop);
    var deep = idx.deep || null;
    var score = {}, why = {}, named = {}, hitAt = {};
    var i, j;
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
          // BM25 for an exact body hit (k1=1.2, b=0.75, the standard
          // calibration — see makeDeep); a prefix hit keeps the tf-idf weight
          // it always had, because positions exist for terms, not for prefixes
          var s = w * (st && st.indexOf(d) > 0 ? 2.6 : 1);
          if (deep && exact) {
            var pos = positionsOf(deep, hi, d, 64);
            if (pos) s = bm25(deep, idx, hi, d, pos.length) * (st && st.indexOf(d) > 0 ? 2.6 : 1);
            if (pos && pos.length) {
              if (hitAt[d] === undefined || pos[0] < hitAt[d]) hitAt[d] = pos[0];
            }
          }
          score[d] = (score[d] || 0) + s;
          if (exact) named[d] = 1;
          var r = why[d] || (why[d] = []);
          var label = (exact ? 'term: "' : 'prefix: "') + t + '"';
          if (r.indexOf(label) < 0 && r.length < 6) r.push(label);
        }
        hi++;
      }
    }
    var fz = fuzzyTerms(text, idx.stop);
    if (stats) {
      stats.words = 0;
      stats.k = 0;
      stats.capped = false;
      stats.ms = 0;
      stats.off = false;
    }
    if (fz.length && !idx.dafsa) {
      // no automaton, no walk: the fuzzy terms are dropped and SAID to have been
      // dropped, rather than silently answered with nothing (or thrown over)
      if (stats) stats.off = true;
    } else if (fz.length) {
      var t0 = now(), fi, wi, hit, fq, fw, fd, ti, fpost, fst, fr, flabel;
      for (fi = 0; fi < fz.length; fi++) {
        fq = fz[fi].q;
        hit = fuzzyWalk(idx.dafsa, fq, fz[fi].k, FUZZY_CAP);
        if (hit.capped) { if (stats) stats.capped = true; }
        if (stats && fz[fi].k > stats.k) stats.k = fz[fi].k;
        for (wi = 0; wi < hit.words.length; wi++) {
          ti = idx.at[hit.words[wi].w];
          if (ti === undefined) continue;
          if (stats) stats.words++;
          fd = hit.words[wi].d;
          fpost = idx.postings[ti];
          fst = idx.strong[ti];
          fw = idfOfIndex(idx, ti) * (1 - fd / (fq.length + 1));
          flabel = 'fuzzy: "' + fq + '" → ' + hit.words[wi].w +
            ' (' + fd + (fd === 1 ? ' edit)' : ' edits)');
          for (j = 0; j < fpost.length; j++) {
            var fd2 = fpost[j];
            score[fd2] = (score[fd2] || 0) + fw * (fst && fst.indexOf(fd2) > 0 ? 2.6 : 1);
            fr = why[fd2] || (why[fd2] = []);
            if (fr.indexOf(flabel) < 0 && fr.length < 6) fr.push(flabel);
          }
        }
      }
      if (stats) stats.ms = Math.round((now() - t0) * 10) / 10;
    }
    var out = [];
    for (var key in score) out.push({ i: +key, score: score[key], why: why[key], named: !!named[key], hitAt: hitAt[key] || null });
    return out;
  }

  /** The pieces a lexical pass found by exact hit — the query's own words. */
  function namedSet(lex) {
    var named = {}, i;
    for (i = 0; i < lex.length; i++) if (lex[i].named) named[lex[i].i] = 1;
    return named;
  }

  /* ---------- the phrases, matched on positions ----------------------------- */

  /** One phrase, against the body positions: the phrase is its SEQUENCE of
   * recordable words with their run offsets, and a piece holds the phrase when
   * one anchor position P has every recorded word at exactly P+its offset —
   * adjacency in the body's own token stream, where a stopword inside the run
   * occupies the position it occupies in the phrase (that is what "matched as
   * written" means for a positional index).
   *
   * The scan anchors on the SEQUENCE'S FIRST word (positions of a word are
   * short; a phrase's candidate set is its first word's), and each anchor is
   * tested against the rest with a binary search over each word's own
   * positions — the standard positional intersection. It stops at the first
   * hit (a phrase needs only to be shown once) and the position it found names
   * the passage the snippet opens.
   *
   * A phrase with a word the VOCABULARY does not hold has no positions: it
   * matches nothing and the word is reported. A phrase of ONE word is its
   * exact term's positions — the same path, one anchor test — so one matcher,
   * one reason string and one snippet rule answer every quoted run. */
  function phraseMatch(deep, idx, phrase) {
    var seq = phrase.seq;
    for (var v = 0; v < seq.length; v++) {
      if (idx.at[seq[v].w] === undefined) return { docs: {}, missing: seq[v].w };
    }
    var docs = {};
    var row = deep.lex[idx.at[seq[0].w]];
    for (var r = 0; r < (row ? row.length : 0); r++) {
      var d = row[r][0];
      var anchors = positionsOf(deep, idx.at[seq[0].w], d);
      if (!anchors) continue;
      // the other recorded words' positions in this piece, fetched once
      var rest = [];
      var dead = false;
      for (var w = 1; w < seq.length; w++) {
        var pos = positionsOf(deep, idx.at[seq[w].w], d);
        if (!pos) { dead = true; break; }
        rest.push(pos);
      }
      if (dead) continue;
      for (var p = 0; p < anchors.length; p++) {
        var at = anchors[p], ok = true;
        for (var w2 = 1; w2 < seq.length; w2++) {
          var want = at + seq[w2].off - seq[0].off;
          var list = rest[w2 - 1];
          var lo = lowBound(list, want);
          if (lo >= list.length || list[lo] !== want) { ok = false; break; }
        }
        if (ok) { docs[d] = at; break; }
      }
    }
    return { docs: docs, missing: null };
  }

  /* ---------- a pattern, walked over the automaton ------------------------- */

  /**
   * The pattern syntax, and only it: literal characters, `.` for any character,
   * `*` `+` `?` for repetition, `[abc]` / `[a-z]` / `[^abc]` for a set of
   * characters, `|` to alternate between expressions, `()` to group them, and
   * `^` and `$` for the start and the end of a word. There are no escapes and
   * no counted repetition; a pattern using either is refused with a reason.
   *
   * It is compiled to a small NFA here and run by this file — never handed to
   * the browser's own regular-expression engine, which backtracks, and a
   * pattern typed into a search box is not a program to run.
   *
   * A pattern with nothing anchoring it matches at ANY position in a word, and
   * that is the capability the word list does not have: it holds words, so it
   * answers whole words and the beginnings of words, and a query that is only
   * the middle of a word is not a lookup at all.
   */
  function parsePattern(body) {
    var i = 0, anchoredStart = false, anchoredEnd = false;

    function fail(msg) { throw new Error(msg); }

    function charClass() {
      i++;
      var neg = false, set = {}, n = 0, k;
      if (body.charAt(i) === '^') { neg = true; i++; }
      while (i < body.length && body.charAt(i) !== ']') {
        var c = body.charAt(i);
        if (c === '\\') fail('a backslash escape is not supported');
        if (body.charAt(i + 1) === '-' && i + 2 < body.length && body.charAt(i + 2) !== ']') {
          var lo = c.charCodeAt(0), hi = body.charCodeAt(i + 2);
          if (hi < lo) fail('the range in a character class runs backwards');
          for (k = lo; k <= hi; k++) set[k] = 1;
          i += 3;
        } else {
          set[c.charCodeAt(0)] = 1;
          i++;
        }
        n++;
      }
      if (body.charAt(i) !== ']') fail('a character class is not closed');
      if (!n) fail('an empty character class is not supported');
      i++;
      return { t: 'set', set: set, neg: neg };
    }

    function atom() {
      var c = body.charAt(i);
      if (!c) fail('the pattern ends where a character was expected');
      if (c === '(') {
        i++;
        var inner = alt();
        if (body.charAt(i) !== ')') fail('a group is not closed');
        i++;
        return inner;
      }
      if (c === '[') return charClass();
      if (c === '.') { i++; return { t: 'any' }; }
      if (c === '^') fail('^ is only supported at the beginning of the pattern');
      if (c === '$') fail('$ is only supported at the end of the pattern');
      if (c === '*' || c === '+' || c === '?') fail('there is nothing for "' + c + '" to repeat');
      if (c === '{' || c === '}') fail('counted repetition is not supported');
      if (c === '\\') fail('a backslash escape is not supported');
      if (c < ' ' || c > '~') fail('the pattern holds a character that is not a printable one');
      i++;
      return { t: 'one', c: c };
    }

    function repeat() {
      var a = atom(), c;
      for (;;) {
        c = body.charAt(i);
        if (c === '*') { i++; a = { t: 'star', a: a }; }
        else if (c === '+') { i++; a = { t: 'plus', a: a }; }
        else if (c === '?') { i++; a = { t: 'opt', a: a }; }
        else return a;
      }
    }

    function concat() {
      var parts = [], c;
      while (i < body.length) {
        c = body.charAt(i);
        if (c === '|' || c === ')') break;
        if (c === '$') {
          if (i !== body.length - 1) fail('$ is only supported at the end of the pattern');
          anchoredEnd = true;
          i++;
          break;
        }
        parts.push(repeat());
      }
      return parts.length === 1 ? parts[0] : { t: 'cat', parts: parts };
    }

    function alt() {
      var branches = [concat()];
      while (body.charAt(i) === '|') { i++; branches.push(concat()); }
      return branches.length === 1 ? branches[0] : { t: 'alt', branches: branches };
    }

    if (body.charAt(0) === '^') { anchoredStart = true; i = 1; }
    var ast = alt();
    if (i < body.length) fail('there is more in the pattern than one expression');
    return { ast: ast, anchoredStart: anchoredStart, anchoredEnd: anchoredEnd };
  }

  /** A pattern as a small NFA (Thompson's construction): a state that consumes
   * one character code, a state that moves on nothing, and a split into two
   * branches. Holes (unset exits) are patched as fragments are joined. */
  function compileRe(p) {
    var nfa = [];
    function alloc(op) {
      nfa.push({ op: op, set: null, neg: null, out: -1, out1: -1 });
      return nfa.length - 1;
    }
    function patch(holes, target) {
      for (var i = 0; i < holes.length; i++) {
        if (holes[i][1]) nfa[holes[i][0]].out1 = target;
        else nfa[holes[i][0]].out = target;
      }
    }
    function compile(n) {
      var s, k, f, g;
      if (n.t === 'one' || n.t === 'any') {
        s = alloc('char');
        if (n.t === 'one') nfa[s].set = n.c.charCodeAt(0);
        return { start: s, holes: [[s, 0]] };
      }
      if (n.t === 'set') {
        s = alloc('char');
        if (n.neg) nfa[s].neg = n.set;
        else nfa[s].set = n.set;
        return { start: s, holes: [[s, 0]] };
      }
      if (n.t === 'cat') {
        if (!n.parts.length) {
          s = alloc('eps');
          return { start: s, holes: [[s, 0]] };
        }
        f = compile(n.parts[0]);
        for (k = 1; k < n.parts.length; k++) {
          g = compile(n.parts[k]);
          patch(f.holes, g.start);
          f = { start: f.start, holes: g.holes };
        }
        return f;
      }
      if (n.t === 'alt') {
        f = compile(n.branches[0]);
        for (k = 1; k < n.branches.length; k++) {
          g = compile(n.branches[k]);
          s = alloc('split');
          nfa[s].out = f.start;
          nfa[s].out1 = g.start;
          f = { start: s, holes: f.holes.concat(g.holes) };
        }
        return f;
      }
      if (n.t === 'star') {
        f = compile(n.a);
        s = alloc('split');
        nfa[s].out = f.start;
        patch(f.holes, s);
        return { start: s, holes: [[s, 1]] };
      }
      if (n.t === 'plus') {
        f = compile(n.a);
        s = alloc('split');
        patch(f.holes, s);
        nfa[s].out = f.start;
        return { start: f.start, holes: [[s, 1]] };
      }
      f = compile(n.a); // '?'
      s = alloc('split');
      nfa[s].out = f.start;
      return { start: s, holes: f.holes.concat([[s, 1]]) };
    }
    var frag = compile(p.ast);
    var acc = alloc('accept');
    patch(frag.holes, acc);
    var pre = -1;
    if (!p.anchoredStart) {
      // with nothing anchoring it, the pattern may begin at ANY position, so a
      // state that moves on nothing is always in the running set and the
      // pattern is entered again from it after every character (see `walk`)
      pre = alloc('eps');
      nfa[pre].out = frag.start;
    }
    return { nfa: nfa, start: frag.start, acc: acc, pre: pre, sticky: !p.anchoredEnd };
  }

  /**
   * A compiled pattern.
   *
   * `walk` carries a SET OF NFA STATES down the automaton's states and memoises
   * it. Matching from an automaton state depends on that state and on the NFA
   * set and on nothing else, and the automaton is acyclic, so a subtree that
   * reaches no word is walked once and remembered; a subtree that does is
   * walked for the words it holds. The cap bounds the other direction: a
   * pattern such as /e/ reaches thousands of words, and the walk stops at the
   * cap and reports that it did, because a bounded list and a short list look
   * the same to a reader.
   */
  function Pattern(text, body) {
    var p = parsePattern(body);
    var c = compileRe(p);
    this.text = text;
    this.body = body;
    this.nfa = c.nfa;
    this.start = c.start;
    this.acc = c.acc;
    this.pre = c.pre;
    this.sticky = c.sticky;
    this.anchoredStart = p.anchoredStart;
    this.clo = {};
  }

  /** A set of NFA states, closed over its moves on nothing and sorted, so it
   * can be a key for the memo. */
  Pattern.prototype.closure = function (list) {
    var start = list.slice().sort(function (a, b) { return a - b; });
    var k = start.join('.');
    var had = this.clo[k];
    if (had) return had;
    var nfa = this.nfa, seen = {}, stack = start.slice(), i, j;
    for (i = 0; i < start.length; i++) seen[start[i]] = 1;
    while (stack.length) {
      var nd = nfa[stack.pop()];
      if (nd.op === 'char' || nd.op === 'accept') continue;
      for (j = 0; j < 2; j++) {
        var o = j ? nd.out1 : nd.out;
        if (o < 0 || seen[o]) continue;
        seen[o] = 1;
        stack.push(o);
      }
    }
    var out = [];
    for (var id in seen) out.push(+id);
    out.sort(function (a, b) { return a - b; });
    this.clo[k] = out;
    return out;
  };

  /** The states one character moves the set to. */
  Pattern.prototype.step = function (list, code) {
    var nfa = this.nfa, out = [], i, nd;
    for (i = 0; i < list.length; i++) {
      nd = nfa[list[i]];
      if (nd.op !== 'char') continue;
      if (nd.neg ? !nd.neg[code] : (nd.set === null || (typeof nd.set === 'number' ? nd.set === code : !!nd.set[code]))) {
        out.push(nd.out);
      }
    }
    return out;
  };

  /** The words the pattern reaches, in the vocabulary's own order. */
  Pattern.prototype.walk = function (g) {
    var self = this, matches = [], chars = [], dead = {}, capped = false;
    var ACC = this.acc, sticky = this.sticky, NONE = [];
    if (!g) return { terms: matches, capped: capped };
    // unanchored: the empty move into the pattern is re-entered at every
    // position, which is what makes an unanchored pattern match inside a word
    var base = this.anchoredStart ? null : [this.pre];
    var init = this.closure(base || [this.start]);

    function visit(st, cur, hit) {
      var matched, memo = null;
      if (sticky && hit) {
        // the pattern already matched on the way down, so every word below this
        // state matches and nothing needs stepping
        matched = true;
      } else {
        memo = st + '|' + cur.join('.');
        if (dead[memo]) return false;
        matched = cur.indexOf(ACC) >= 0;
      }
      var found = false;
      if (g.fin[st] && matched) {
        matches.push(chars.join(''));
        if (matches.length >= PREFIX_CAP) { capped = true; return true; }
        found = true;
      }
      for (var e = g.off[st]; e < g.off[st + 1]; e++) {
        var next;
        if (matched && sticky) {
          next = NONE;
        } else {
          var nxt = self.step(cur, g.lbl.charCodeAt(e));
          if (!nxt.length) {
            if (!base) continue;
            next = init;
          } else {
            next = self.closure(base ? base.concat(nxt) : nxt);
          }
        }
        chars.push(g.lbl.charAt(e));
        if (visit(g.to[e], next, matched)) found = true;
        chars.pop();
        if (capped) return true;
      }
      if (memo && !found) dead[memo] = 1;
      return found;
    }

    visit(g.root, init, false);
    return { terms: matches, capped: capped };
  };

  /** A query between slashes is a pattern, not a list of words. The wrapper is
   * the whole syntax — a `/` cannot appear inside a pattern, which is the price
   * of a delimiter a terminal-shaped box can carry. */
  function patternOf(text) {
    var raw = String(text).trim();
    if (raw.length < 2 || raw.charAt(0) !== '/' || raw.charAt(raw.length - 1) !== '/') return null;
    var body = raw.slice(1, raw.length - 1);
    if (!body) return { text: raw, body: body, error: 'nothing is between the slashes' };
    try {
      return { text: raw, body: body, pattern: new Pattern(raw, body) };
    } catch (e) {
      return { text: raw, body: body, error: e.message };
    }
  }

  /** A pattern's words, scored exactly as the words a plain query names: each
   * is an exact term hit (so the piece holds the fusion's top rank), weighted
   * by the idf of the word that matched and boosted where that word stands in
   * a title or a heading. The reason carried is the pattern itself. */
  function patternLexical(idx, pat, terms) {
    var score = {}, why = {}, named = {}, label = 're: "' + pat.text + '"';
    var i, j, ti, post, w, st, d, r;
    for (i = 0; i < terms.length; i++) {
      ti = idx.at[terms[i]];
      if (ti === undefined) continue;
      post = idx.postings[ti];
      w = idfOfIndex(idx, ti);
      st = idx.strong[ti];
      for (j = 0; j < post.length; j++) {
        d = post[j];
        score[d] = (score[d] || 0) + w * (st && st.indexOf(d) > 0 ? 2.6 : 1);
        named[d] = 1;
        r = why[d] || (why[d] = []);
        if (r.indexOf(label) < 0 && r.length < 6) r.push(label);
      }
    }
    var out = [];
    for (var key in score) out.push({ i: +key, score: score[key], why: why[key], named: true });
    return out;
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
    // THE SAME-SERIES SIGNAL IS COLLAPSED, not itemised. It fires once per seed
    // into every piece in that seed's series, so a query with six seeds used to
    // write a badge per neighbour — MEASURED on "wetiko": four of one result's six
    // badges were "same series as X (readings)", which crowded out the reasons
    // that say something (a term hit, a vector match, a shared citation) and told
    // the reader only what the result's own series label already says. So the
    // signal still scores — it is a real, if weak, reason — and ONE badge states
    // it, once, with the count: "graph: 4 of its neighbours are in its series".
    // The same collapsing applies to `near`, which is weaker still.
    rel = db.relOf('same_series');
    counts.same_series = rel.length;
    var seriesCount = {};
    for (i = 0; i < rel.length; i++) {
      t = rel[i];
      seriesCount[t[1]] = (seriesCount[t[1]] || 0) + 1;
      score[t[1]] = Math.max(score[t[1]] || 0, GW.same_series);
    }
    Object.keys(seriesCount).forEach(function (q) {
      var n = seriesCount[q];
      var r = why[q] || (why[q] = []);
      r.push(n === 1
        ? 'graph: one neighbour in its series'
        : 'graph: ' + n + ' of its neighbours are in its series');
    });
    rel = db.relOf('near');
    counts.near = rel.length;
    var nearCount = {};
    for (i = 0; i < rel.length; i++) {
      t = rel[i];
      nearCount[t[1]] = (nearCount[t[1]] || 0) + 1;
      score[t[1]] = Math.max(score[t[1]] || 0, GW.near);
    }
    Object.keys(nearCount).forEach(function (q) {
      var r = why[q] || (why[q] = []);
      r.push('graph: reached by two hops');
    });
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
    return runQuery(text, opts, 0);
  }

  /** The query, with the zero-result fuzzy fallback able to call it once more.
   * `depth` bounds the recursion: the fallback runs the corrected text, and a
   * corrected text that itself finds nothing is returned as it is rather than
   * corrected again — one fallback per query, never a chain. */
  function runQuery(text, opts, depth) {
    var idx = S._idx;
    opts = opts || {};
    var t0 = now();
    var counts = { terms: 0, results: 0, related: 0, same_series: 0, points_at: 0, near: 0, derived: 0, capped: false, rounds: 0, graphOnlyDropped: 0, ms: 0, pattern: '', matched: 0, reCapped: false, reError: '', fuzzy: 0, fuzzyWords: 0, fuzzyK: 0, fuzzyCapped: false, fuzzyMs: 0, fuzzyOff: false, sort: opts.sort || 'rel', suggest: null, fallbackFrom: '', fallbackTo: '', phrases: 0, phraseDocs: 0, phraseMiss: '', phraseDropped: false, phrasePending: false };
    if (!idx) return { results: [], counts: counts };
    var pat = patternOf(text);
    var lex, vec, toks = [], fzs = [], phr = { phrases: [], dropped: [] }, fstats = {}, marks = null, i, key, mi;
    var phraseKeep = null;   // piece -> first match position, when a phrase ran
    if (pat) {
      // a pattern is NOT tokenised: its punctuation is the query, and a word
      // list of what is left of it would answer a different question
      counts.pattern = pat.text;
      if (pat.error) {
        counts.reError = pat.error;
        counts.ms = Math.round((now() - t0) * 10) / 10;
        return { results: [], counts: counts };
      }
      var hit = pat.pattern.walk(idx.dafsa);
      counts.matched = hit.terms.length;
      counts.reCapped = hit.capped;
      lex = patternLexical(idx, pat, hit.terms);
      vec = [];
      marks = {};
      for (mi = 0; mi < hit.terms.length; mi++) marks[hit.terms[mi]] = 1;
    } else {
      toks = tokenize(text, idx.stop);
      fzs = fuzzyTerms(text, idx.stop);
      phr = phraseTerms(text, idx.stop);
      counts.terms = toks.length;
      counts.fuzzy = fzs.length;
      counts.phrases = phr.phrases.length;
      // the phrase halves need the fetched positions; ask once here. A phrase
      // whose words are ALL unknown to the vocabulary is unanswerable without
      // any fetch, so it degrades to its words as ordinary terms
      var phrKnown = phr.phrases.filter(function (p) {
        return p.words.some(function (w) { return idx.at[w] !== undefined; });
      });
      counts.phrasePending = !!(phrKnown.length && !idx.deep);
      if (phrKnown.length && !idx.deep && !S._deepAsked) {
        S._deepAsked = true;
        deepOf(idx);
      }
      // a query of nothing but a fuzzy term is still a query: the walk is the
      // only signal it has, and the word list has no ordinary word to offer
      if (!toks.length && !fzs.length && !phr.phrases.length) return { results: [], counts: counts };
      lex = lexical(idx, text, opts, fstats);
      vec = vector(idx, text, opts);
      counts.fuzzyWords = fstats.words;
      counts.fuzzyK = fstats.k;
      counts.fuzzyCapped = fstats.capped;
      counts.fuzzyMs = fstats.ms;
      counts.fuzzyOff = fstats.off;
      // the phrases: each quoted run is one AND-ed demand over the positions.
      // With the deep half present, a phrase NAMES the pieces its words are
      // adjacent in — a piece no phrase named is out of the answer however
      // many of its words it holds, the loose words order what is left, and a
      // piece only a phrase found is in the answer on the phrase's own weight.
      // Without the deep half the tokeniser kept the quoted words out of the
      // loose ones, so they are folded back in as plain terms here: the page
      // still answers, on the words, and the line above the results says the
      // phrase is still loading rather than pretending the words were loose.
      if (idx.deep && phrKnown.length) {
        var phDocs = [], phMissed = null;
        for (var pi = 0; pi < phrKnown.length; pi++) {
          var pm = phraseMatch(idx.deep, idx, phrKnown[pi]);
          if (pm.missing && !phMissed) phMissed = pm.missing;
          phDocs.push(pm.docs);
        }
        counts.phraseMiss = phMissed || '';
        var keep = {};   // piece -> the FIRST position a phrase matched at
        for (var pd in phDocs[0]) {
          var all = true;
          for (var ki = 1; ki < phDocs.length; ki++) {
            if (phDocs[ki][pd] === undefined) { all = false; break; }
          }
          if (all) keep[pd] = phDocs[0][pd];
        }
        counts.phraseDocs = Object.keys(keep).length;
        phraseKeep = keep;
        var lexBy = {};
        for (var li = 0; li < lex.length; li++) lexBy[lex[li].i] = lex[li];
        var merged = [];
        for (var kd in keep) {
          var di = +kd;
          var row = lexBy[di] || { i: di, score: 0, why: [], named: false, hitAt: null };
          var weight = 0;
          var whyAdd = [];
          for (var pj = 0; pj < phrKnown.length; pj++) {
            if (phDocs[pj][kd] === undefined) continue;
            var wsum = 0;
            for (var wi = 0; wi < phrKnown[pj].words.length; wi++) {
              var wti = idx.at[phrKnown[pj].words[wi]];
              if (wti !== undefined) wsum += idfOfIndex(idx, wti);
            }
            weight += wsum;
            whyAdd.push('phrase: "' + phrKnown[pj].text + '"');
          }
          row.score += weight;
          row.named = true;
          row.hitAt = keep[kd];
          for (var wa = 0; wa < whyAdd.length; wa++) {
            if (row.why.indexOf(whyAdd[wa]) < 0 && row.why.length < 6) row.why.push(whyAdd[wa]);
          }
          merged.push(row);
        }
        lex = merged;
      } else if (phr.phrases.length && !idx.deep) {
        var back = [];
        for (var bi = 0; bi < phr.phrases.length; bi++) {
          for (var bj = 0; bj < phr.phrases[bi].words.length; bj++) {
            var bw = phr.phrases[bi].words[bj];
            if (idx.at[bw] !== undefined && back.indexOf(bw) < 0) back.push(bw);
          }
        }
        if (back.length && (!toks.length || back.some(function (w) { return toks.indexOf(w) < 0; }))) {
          lex = lexical(idx, back.join(' '), opts, fstats);
        }
        counts.phraseDropped = true;
      }
    }
    var m = {}, why = {}, named = namedSet(lex), maxL = 0, maxV = 0;
    var hitAt = {};   // piece -> the earliest body position a query word sat at
    for (i = 0; i < lex.length; i++) {
      if (lex[i].score > maxL) maxL = lex[i].score;
      if (lex[i].hitAt && (hitAt[lex[i].i] === undefined || lex[i].hitAt < hitAt[lex[i].i])) {
        hitAt[lex[i].i] = lex[i].hitAt;
      }
    }
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
    for (key in m) if (allowed(idx, +key, opts)) {
      all.push({ i: +key, score: m[key], why: why[key] || [], hitAt: hitAt[key] !== undefined ? hitAt[key] : null, named: !!named[+key] });
    }
    // a phrase is a demand on the ANSWER, not a boost to the words: with the
    // deep half present, the pieces a phrase named are the whole of the answer
    // — the loose words, the vectors and the graph order and enrich what is
    // left, and nothing else enters
    if (phraseKeep) {
      all = all.filter(function (r) { return phraseKeep[r.i] !== undefined; });
    }
    all.sort(function (a, b) { return tier(named, b.i) - tier(named, a.i) || b.score - a.score || a.i - b.i; });
    // The other order the page offers: newest first, over the SAME results —
    // the mode reorders the answer, it does not select a different one. The
    // index carries each piece's own date, so nothing is derived. Ties fall
    // back to the relevance order, so a day with several pieces is stable.
    if (opts.sort === 'new') {
      all.sort(function (a, b) {
        var da = idx.docs[a.i].date || '', db = idx.docs[b.i].date || '';
        if (da !== db) return da < db ? 1 : -1;
        return tier(named, b.i) - tier(named, a.i) || b.score - a.score || a.i - b.i;
      });
    }
    counts.results = all.length;
    counts.ms = Math.round((now() - t0) * 10) / 10;
    // A thin answer is where a misspelling shows, and the walk for it is the
    // same one a `~` runs — paid only when the answer is thin, so an ordinary
    // query never enters it.
    if (!pat && all.length <= THIN) counts.suggest = suggestWords(idx, text, toks);
    // Zero results is the one case where the correction is RUN rather than
    // offered. A typo should not dead-end: if the query found nothing and a word
    // within one edit of one of its words exists, that word's search is done for
    // the reader, and the page SAYS it did it ("no exact match — showing words
    // within one edit of …", plus the results). It is only ever a zero-result
    // fallback: a query with any hit is never silently expanded, and the reader's
    // own words are never rewritten in the box. The correction itself comes from
    // the same walk, so the two agree by construction.
    if (!pat && all.length === 0 && counts.suggest && !counts.suggest.capped && depth < 1) {
      var fb = runQuery(counts.suggest.corrected, opts, depth + 1);
      if (fb.results.length) {
        fb.counts.fallbackFrom = text;
        fb.counts.fallbackTo = counts.suggest.to;
        return fb;
      }
    }
    return { results: all.slice(0, opts.limit || RESULT_CAP), counts: counts, marks: marks };
  }

  function now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  /* ---------- the page: snippets, rendering, URL state, keyboard ---------- */

  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ESC[c]; }); }
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&'); }

  /** Mark, in already-escaped HTML, every word the query reaches — the rule the
   * snippet and the result title both use, so the two cannot drift apart. A
   * pattern query marks the words the walk reached, not the pattern: the words
   * are what the results are built from, and the pattern is a rule. */
  function markText(html, toks, marks) {
    if (marks) {
      return html.replace(/[a-z][a-z'-]*/g, function (w) {
        return marks[w.toLowerCase()] ? '<mark>' + w + '</mark>' : w;
      });
    }
    if (!toks.length) return html;
    var parts = toks.slice(0).sort(function (a, b) { return b.length - a.length; });
    var re = new RegExp('\\b(?:' + parts.map(escRe).join('|') + ")[a-z'-]*", 'gi');
    return html.replace(re, function (w) { return '<mark>' + w + '</mark>'; });
  }

  /** A snippet with every word the query reaches marked. Two sources, in order:
   * the PASSAGE the match sat in, when the fetched half is there and a body
   * position named one (the passage is windowed when it is enormous and the
   * elision is marked); otherwise the piece's own summary, headings and
   * opening passage — the fallback the page always had, unchanged.
   *
   * A heading the query reaches is the sharpest line to show, joined to the
   * piece's own summary for context; otherwise the summary (a sentence about
   * the piece); the opening is the last resort. A result the graph alone put
   * here matches nothing in any of them, and shows the summary like any other. */
  var SNIPPET_MAX = 300;

  function snippet(idx, i, toks, marks, at) {
    var d = idx.docs[i], heads = d.heads || [], summary = d.summary || '', lede = d.lede || '';
    if (idx.deep && at !== undefined && at !== null && idx.deep.pass[i]) {
      var bounds = idx.deep.passAt[i];
      var p = 0, k;
      for (k = 0; k < bounds.length; k++) if (bounds[k] <= at) p = k;
      var text = idx.deep.pass[i][p] || '';
      if (text) {
        if (text.length > SNIPPET_MAX) {
          // window around the FIRST query word the passage holds, not the
          // passage head: the passage can be very long (they are paragraphs,
          // some several thousand characters) and the reader's word may sit
          // deep in it
          var find = -1, t;
          for (t = 0; t < toks.length; t++) {
            var at2 = text.toLowerCase().indexOf(toks[t]);
            if (at2 >= 0 && (find < 0 || at2 < find)) find = at2;
          }
          if (find < 0) find = 0;
          var start = find > 110 ? find - 110 : 0;
          text = (start ? '…' : '') + text.slice(start, start + SNIPPET_MAX - 20) + '…';
        }
        return markText(esc(text), toks, marks);
      }
    }
    var hitHead = '', h, t;
    for (h = 0; h < heads.length && !hitHead; h++) {
      for (t = 0; t < toks.length; t++) {
        if (heads[h].toLowerCase().indexOf(toks[t]) >= 0) { hitHead = heads[h]; break; }
      }
    }
    var text2 = hitHead && summary ? hitHead + ' — ' + summary : (hitHead || summary || lede);
    if (text2.length > 260) {
      var p0 = -1;
      for (t = 0; t < toks.length; t++) {
        var pp = text2.toLowerCase().indexOf(toks[t]);
        if (pp >= 0 && (p0 < 0 || pp < p0)) p0 = pp;
      }
      var start2 = p0 > 90 ? p0 - 90 : 0;
      text2 = (start2 ? '…' : '') + text2.slice(start2, start2 + 250) + '…';
      if (start2) text2 = text2.replace(/^\S+\s/, '…');
    }
    var html = esc(text2);
    return markText(html, toks, marks);
  }

  /** A result line. The title is marked by the SAME rule the snippet is: a
   * result the query's words reached should say so where the reader looks
   * first, not only in the passage under it. The link carries the query, so
   * the piece the reader opens marks the words it was found by — the snippet
   * already showed WHERE, this is the same answer continued on the page
   * itself.
   *
   * `folded` marks a row the query did NOT name: it is rendered in the page,
   * under the row that counts the related results, and starts out hidden. It is
   * in the list and not fetched — the disclosure only shows what is already
   * there. */
  function resultHtml(idx, r, toks, marks, text, folded) {
    var d = idx.docs[r.i];
    var link = '/' + esc(d.slug) + '/' + (text ? '?q=' + encodeURIComponent(text) : '');
    return '<li class="sr' + (folded ? ' sr-rel' : '') + '"' + (folded ? ' hidden' : '') + '>' +
      '<a class="sr-t" href="' + link + '">' + markText(esc(d.title), toks, marks) + '</a>' +
      '<div class="sr-m">' + esc(d.series || 'unfiled') + ' · ' + esc(d.kind || '') + ' · ' + esc(d.date || '') +
      '<span class="sr-sc">' + r.score.toFixed(2) + '</span></div>' +
      '<p class="sr-s">' + snippet(idx, r.i, toks, marks, r.hitAt) + '</p>' +
      '<ul class="sr-w">' + r.why.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' +
      '</li>';
  }

  /** The query as the two lines that count the groups state it: the words that
   * NAME a piece. Those are the ordinary words and a quoted run — the run AS
   * WRITTEN, because that is the demand the pieces were asked, stopwords and
   * all — and never a `~word`: the walk found a word the reader did not type, so
   * a fuzzy word names nothing and is left out of the quotation. A pattern is
   * quoted as the pattern it is (it carries its own slashes). Cut short with a
   * mark when the query is long: this is a quotation of the query, not the
   * query. */
  function queryLabel(text, c, toks, stop) {
    if (c.pattern) return c.pattern;
    var ph = phraseTerms(text, stop), ws = toks.slice(0), pi;
    for (pi = 0; pi < ph.phrases.length; pi++) ws.push(ph.phrases[pi].text);
    if (!ws.length) ws = [String(text).replace(/~/g, ' ').replace(/\s+/g, ' ').trim()];
    var label = ws.slice(0, 6).join(' ');
    if (label.length > 46) label = label.slice(0, 45).replace(/\s\S*$/, '') + '…';
    return label;
  }

  /** The row the related results stand behind — the disclosure, and the sentence
   * that says what it holds. It is a BUTTON carrying aria-expanded, not a native
   * `<details>`: the results are the children of an `<ol>`, which admits only
   * `<li>` and script elements, so a `<details>` would have to wrap the related
   * rows in a SECOND list inside an `<li>` — taking them out of the list the
   * arrow keys walk. A button toggling the siblings keeps one list, one order.
   *
   * The count is always in it and never a bare "more": the reader must be able
   * to see that the tail exists, how big it is, and that the query is not in
   * it. Both wordings ride on the element (data-more/data-less) so the toggle
   * needs no second copy of the numbers. */
  function tailRowHtml(relN, label, words, isPattern) {
    var what = isPattern
      ? 'the pattern ' + esc(label) + ' reached no word of theirs'
      : words > 1
        ? 'none of your words is in them'
        : '"' + esc(label) + '" is not in ' + (relN === 1 ? 'it' : 'them');
    var more = relN + ' more ' + (relN === 1 ? 'is' : 'are') + ' related — ' + what;
    var less = 'hide the ' + relN + ' related result' + (relN === 1 ? '' : 's');
    return '<li class="sr-tail" role="presentation">' +
      '<button type="button" class="sr-more" aria-expanded="false" data-more="' + esc(more) +
      '" data-less="' + esc(less) + '">' + esc(more) + '</button></li>';
  }

  function render(idx, box, status, text, opts) {
    opts = opts || {};
    var res = query(text, opts);
    var c = res.counts;
    // the words the MARKS show: a phrase's own words included, quoted or not
    var mkToks = c.pattern ? [] : tokenize(text, idx.stop).concat(
      c.phrases ? phraseWords(text, idx.stop) : []);
    var toks = c.pattern ? [] : tokenize(text, idx.stop);
    var pieces = res.results;
    /* THE SPLIT the engine already keeps, now rendered as one. `named` is set
     * when an EXACT term hit named a piece — the query's own words are in its
     * prose — and `tier` already sorts on it, so the named rows are the top of
     * the list by construction and the rest is what the VECTORS called similar,
     * what the GRAPH reached, what a PREFIX or a fuzzy word found, or what a
     * phrase only partly holds. Those are related to the query, not the query's
     * answer: measured on "wetiko", of the 24 rows the page showed, 6 pieces
     * contain the word and the other 18 do not — and they were interleaved with
     * the 6 all the way down.
     *
     * So the named rows stand and the related ones follow behind one row that
     * COUNTS them — never dropped, never hidden without a count, one click or
     * one arrow key away. The split is not made when nothing names the query
     * (a prefix like "procl" names nothing, and folding the whole answer away
     * while the reader is still typing would be worse than the crowding), and
     * not under `newest first`: there the reader has chosen an order over the
     * answer, and the engine's own `sort=new` path already puts the date above
     * the rank. */
    var namedN = 0, relN = 0, ri;
    for (ri = 0; ri < res.results.length; ri++) {
      if (res.results[ri].named) namedN++;
      else relN++;
    }
    var folded = namedN > 0 && relN > 0 && c.sort !== 'new';
    // The text the answer was computed for. When the zero-result fallback ran,
    // that is the CORRECTED query — the split belongs to it, because the reader's
    // own words named nothing, which is exactly what a fallback is.
    var atext = c.fallbackFrom ? c.fallbackTo : text;
    var atoks = c.fallbackFrom ? tokenize(atext, idx.stop) : toks;
    var label = queryLabel(atext, c, atoks, idx.stop);
    var labelN = label ? label.split(' ').length : 0;
    // A pattern is already quoted as the pattern it is (see queryLabel); the
    // words of a query are quoted here, once, so every sentence that states the
    // split quotes them the same way.
    var qlabel = c.pattern ? esc(label) : '"' + esc(label) + '"';
    if (!pieces.length) {
      var msg;
      if (c.reError) msg = 'That pattern is not one this page can read: ' + c.reError + '.';
      else if (c.pattern) msg = c.matched
        ? 'Nothing in the published pieces answers to the words that pattern reached.'
        : 'No word in the list answers to that pattern.';
      else if (toks.length) msg = 'Nothing in the published pieces answers to that.';
      else if (c.fuzzy) msg = c.fuzzyOff
        ? 'There is no word list in this page to match that against.'
        : 'No word in the list is within ' + c.fuzzyK + (c.fuzzyK === 1 ? ' edit' : ' edits') +
          ' of a word you marked. Two tildes widen it to two.';
      else msg = 'Type a word — the pieces are searched by their words, their vectors and their links.';
      if (c.phrases && !c.pattern) {
        // a phrase that matched nothing is SAID, with its own text, rather
        // than padded out with its words' separate hits
        if (c.phraseMiss) msg = 'No piece says that phrase — the word "' + c.phraseMiss + '" is not one the pieces use at all.';
        else if (!c.phraseDocs) msg = 'No piece has those words next to each other, in that order.';
      }
      box.innerHTML = (msg ? '<li class="sr-none">' + esc(msg) + '</li>' : '') +
        (idx.hints.length && !toks.length && !c.pattern
          ? '<li class="sr-hint">Try: ' + idx.hints.map(function (h) {
              return '<button type="button" class="sr-go" data-q="' + esc(h) + '">' + esc(h) + '</button>';
            }).join(' ') + '</li>'
          : '');
    } else {
      // The named rows, then the row that counts the related ones, then those
      // rows themselves — the SAME markup, in the same order, each row in the
      // group the engine put it in.
      var list = '';
      for (ri = 0; ri < pieces.length; ri++) {
        if (!folded || pieces[ri].named) list += resultHtml(idx, pieces[ri], mkToks, res.marks, text);
      }
      if (folded) {
        list += tailRowHtml(relN, label, labelN, !!c.pattern);
        for (ri = 0; ri < pieces.length; ri++) {
          if (!pieces[ri].named) list += resultHtml(idx, pieces[ri], mkToks, res.marks, text, 1);
        }
      }
      box.innerHTML = list;
    }
    var shown = res.results.length;
    var sug = c.suggest;
    // When the correction was RUN rather than offered (the zero-result fallback),
    // the line says so and names the word it used; the offer stays for the thin
    // case, where the reader's own query did find something.
    var note = c.fallbackFrom && shown
      ? 'no exact match for "' + esc(c.fallbackFrom) + '" — showing words within one edit of ' +
        '<b>' + esc(c.fallbackTo) + '</b>'
      : sug
        ? 'did you mean <button type="button" class="sr-go" data-q="' + esc(sug.corrected) + '">' +
          esc(sug.to) + '</button>?' + (sug.capped ? ' (the near words stopped at ' + SUGGEST_CAP + ')' : '')
        : '';
    var head = '';
    if (c.reError) {
      head = '# nothing searched · the pattern ' + esc(c.pattern) + ' is not one this page can read: ' + esc(c.reError);
    } else if (shown) {
      // The pieces' clause states the SPLIT as well as the count: how many of
      // them the query NAMED, and — when the related rows are folded below —
      // how many more are related to it. "of N" is the pieces' total, so a cap
      // is still reported; the reader can add the two numbers and get what is
      // on the page, which is what the disclosure shows.
      var capOf = c.results > shown ? ' of ' + c.results : '';
      var verb = namedN === 1 ? (c.pattern ? 'matches' : 'names') : (c.pattern ? 'match' : 'name');
      var pieceText = namedN
        ? namedN + capOf + ' piece' + (c.results === 1 ? '' : 's') + ' ' + verb + ' ' + qlabel
        : shown + capOf + ' piece' + (c.results === 1 ? '' : 's') + ' · none ' +
          (c.pattern ? 'matches' : 'names') + ' ' + qlabel;
      if (folded) pieceText += ' · ' + relN + ' more ' + (relN === 1 ? 'is' : 'are') + ' related';
      var groups = pieceText;
      head = '# ' + groups + ' · ' + c.ms + ' ms · ' +
        (c.pattern
          ? 'the pattern ' + esc(c.pattern) + ' reached ' + c.matched + ' word' + (c.matched === 1 ? '' : 's') +
            (c.reCapped ? ' (the list stops at ' + PREFIX_CAP + ')' : '') + ' · '
          : '') +
        (c.fuzzy
          ? 'fuzzy: ' + (c.fuzzyOff
              ? 'no word list to match against'
              : c.fuzzyWords + ' word' + (c.fuzzyWords === 1 ? '' : 's') + ' within ' + c.fuzzyK +
                (c.fuzzyK === 1 ? ' edit' : ' edits') +
                (c.fuzzyCapped ? ' (the list stops at ' + FUZZY_CAP + ')' : '')) + ' · '
          : '') +
        (c.sort === 'new' ? 'newest first · ' : '') +
        (c.phrasePending ? 'the phrases are still loading — these results are the words only · ' : '') +
        (c.phrases
          ? (c.phraseDocs + ' piece' + (c.phraseDocs === 1 ? '' : 's') + ' say the phrase' +
            (c.phrases > 1 ? 's' : '') + (c.phraseMiss ? ' (the word "' + esc(c.phraseMiss) + '" is in no piece)' : '') + ' · ')
          : '') +
        'the graph rules fired: ' +
        c.related + ' shared-citation, ' + c.points_at + ' link, ' + c.same_series + ' same-series, ' + c.near + ' two-hop' +
        (c.graphOnlyDropped
          ? ' · ' + c.graphOnlyDropped + ' graph-only result' + (c.graphOnlyDropped === 1 ? '' : 's') + ' beyond the cap'
          : '') +
        (c.capped ? ' · expansion capped' : '');
    }
    if (head && note) status.innerHTML = head + ' · ' + note;
    else if (head) status.textContent = head;
    else if (note) status.innerHTML = '# nothing was found for that · ' + note;
    else if (c.phrasePending) status.textContent = '# the phrases are still loading — these results are the words only';
    else status.textContent = '';
    return res;
  }

  /** `?q=`, the facets and the result order, so a search is a link someone can
   * send. The order is in the URL only when it is not the default. */
  function readUrl() {
    var q = '', s = '', k = '', so = '', raw = String((window.location && window.location.search) || '').replace(/^\?/, '');
    var parts = raw ? raw.split('&') : [];
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split('='), val = decodeURIComponent(kv[1] || '');
      if (kv[0] === 'q') q = val;
      else if (kv[0] === 'series') s = val;
      else if (kv[0] === 'kind') k = val;
      else if (kv[0] === 'sort') so = val;
    }
    return { q: q, series: s, kind: k, sort: so };
  }
  function writeUrl(st) {
    var q = [];
    if (st.q) q.push('q=' + encodeURIComponent(st.q));
    if (st.series) q.push('series=' + encodeURIComponent(st.series));
    if (st.kind) q.push('kind=' + encodeURIComponent(st.kind));
    if (st.sort && st.sort !== 'rel') q.push('sort=' + encodeURIComponent(st.sort));
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
    var sortSel = document.getElementById('sf-sort');
    var comp = document.getElementById('scomp');
    var compList = document.getElementById('scomp-list');
    var compCap = document.getElementById('scomp-cap');
    var url = readUrl();
    if (url.q) input.value = url.q;
    if (url.series && series) series.value = url.series;
    if (url.kind && kind) kind.value = url.kind;
    if (url.sort && sortSel) sortSel.value = url.sort;
    var sel = -1;              // the result the arrow keys have reached
    var compTerms = [];        // the completions the box is offering
    var compAt = -1;           // the one of them the arrow keys have reached
    function stateOf() {
      return {
        q: input.value,
        series: series ? series.value : '',
        kind: kind ? kind.value : '',
        sort: sortSel ? sortSel.value : '',
      };
    }
    function run(push) {
      var st = stateOf();
      render(idx, box, status, st.q, { series: st.series, kind: st.kind, sort: st.sort });
      sel = -1;
      if (push) writeUrl(st);
    }

    /* ---- the keyboard's selection over the results ---------------------- */

    function rows() { return box.querySelectorAll('li.sr'); }
    /* The folded tail: the rows the query did NOT name stand in the list behind
     * the one row that counts them (see tailRowHtml). Opening it shows rows that
     * are ALREADY in the page; nothing is fetched and nothing is lost. */
    function tailBtn() { return box.querySelector('button.sr-more'); }
    function setTail(open) {
      var b = tailBtn(), r = box.querySelectorAll('li.sr-rel'), i;
      for (i = 0; i < r.length; i++) r[i].hidden = !open;
      if (b) {
        b.setAttribute('aria-expanded', open ? 'true' : 'false');
        b.textContent = open ? b.getAttribute('data-less') : b.getAttribute('data-more');
      }
    }
    box.addEventListener('click', function (e) {
      var b = tailBtn(), t = e.target;
      if (!b) return;
      while (t && t !== box && t !== b) t = t.parentNode;
      if (t !== b) return;
      setTail(b.getAttribute('aria-expanded') !== 'true');
    });
    function paintSel() {
      var r = rows(), i;
      for (i = 0; i < r.length; i++) {
        if (i === sel) r[i].classList.add('sr-on');
        else r[i].classList.remove('sr-on');
      }
      // a selection that walks into the folded tail OPENS it: a key must never
      // rest on a row that is not on the screen
      if (sel >= 0 && r[sel] && r[sel].hidden) setTail(true);
      if (sel >= 0 && r[sel] && typeof r[sel].scrollIntoView === 'function') {
        try { r[sel].scrollIntoView({ block: 'nearest' }); } catch (e) { }
      }
    }
    function moveSel(d) {
      var r = rows();
      if (!r.length) return false;
      sel = sel < 0 ? (d > 0 ? 0 : r.length - 1) : sel + d;
      if (sel < 0) sel = 0;
      if (sel >= r.length) sel = r.length - 1;
      paintSel();
      return true;
    }
    function edgeSel(key) {
      var r = rows();
      if (!r.length) return false;
      sel = key === 'Home' ? 0 : r.length - 1;
      paintSel();
      return true;
    }
    function openSelected() {
      var r = rows();
      if (sel < 0 || !r[sel]) return false;
      var a = r[sel].querySelector('a.sr-t');
      if (!a) return false;
      window.location.href = a.getAttribute('href');
      return true;
    }

    /* ---- the completion list under the box ------------------------------ */
    /* ARIA: the input is a combobox over a listbox (aria-expanded,
     * aria-controls, aria-activedescendant), and each completion is an option.
     * That is the pattern for a text field that raises a list of suggestions —
     * the reader stays in the field and the DOM focus never leaves it, so
     * aria-activedescendant is what tells assistive tech which option is
     * current. A simpler choice (a plain list announced by role=status) was
     * considered and rejected: the list is INTERACTIVE (arrows move in it,
     * Enter takes one), and a status region is not operable. */

    function wordAt() {
      var v = input.value, pos = input.selectionStart, pre, m;
      if (typeof pos !== 'number' || pos < 0 || pos > v.length) pos = v.length;
      pre = v.slice(0, pos);
      m = pre.match(/[a-z][a-z'-]*$/i);
      if (m) return { word: m[0].toLowerCase(), start: pre.length - m[0].length, end: pos };
      m = v.match(/[a-z][a-z'-]*$/i);
      if (m) return { word: m[0].toLowerCase(), start: v.length - m[0].length, end: v.length };
      return null;
    }
    function closeComp() {
      compTerms = [];
      compAt = -1;
      if (comp) comp.hidden = true;
      if (compList) compList.innerHTML = '';
      if (compCap) { compCap.hidden = true; compCap.textContent = ''; }
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }
    function paintComp() {
      var lis = compList.children, i, on;
      for (i = 0; i < lis.length; i++) {
        on = i === compAt;
        lis[i].className = on ? 'sc sc-on' : 'sc';
        lis[i].setAttribute('aria-selected', on ? 'true' : 'false');
      }
      if (compAt >= 0) input.setAttribute('aria-activedescendant', 'scomp-' + compAt);
      else input.removeAttribute('aria-activedescendant');
    }
    function openComp(prefix) {
      if (!idx.dafsa || !comp || !compList || prefix.length < COMPLETE_MIN) { closeComp(); return false; }
      var hit = prefixWalk(idx.dafsa, prefix, COMPLETE_CAP);
      if (!hit.terms.length) { closeComp(); return false; }
      compTerms = hit.terms;
      compAt = -1;
      compList.innerHTML = hit.terms.map(function (t, k) {
        return '<li class="sc" id="scomp-' + k + '" role="option" aria-selected="false">' + esc(t) + '</li>';
      }).join('');
      if (compCap) {
        compCap.hidden = !hit.capped;
        compCap.textContent = hit.capped ? 'the list stops at ' + COMPLETE_CAP + ' words' : '';
      }
      comp.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      return true;
    }
    function updateComp() {
      var w = wordAt();
      if (!w || w.word.length < COMPLETE_MIN) { closeComp(); return; }
      openComp(w.word);
    }
    function moveComp(d) {
      if (!compTerms.length) return false;
      compAt = compAt < 0 ? (d > 0 ? 0 : compTerms.length - 1) : compAt + d;
      if (compAt < 0) compAt = 0;
      if (compAt >= compTerms.length) compAt = compTerms.length - 1;
      paintComp();
      return true;
    }
    function acceptComp(k) {
      if (k < 0 || compTerms[k] === undefined) return false;
      var w = wordAt();
      if (!w) return false;
      var v = input.value;
      input.value = v.slice(0, w.start) + compTerms[k] + v.slice(w.end);
      closeComp();
      return true;
    }

    run(false);
    var form = document.getElementById('sf');
    if (form) form.addEventListener('submit', function (e) { e.preventDefault(); closeComp(); run(true); });
    input.addEventListener('input', function () { run(true); updateComp(); });
    if (series) series.addEventListener('change', function () { run(true); });
    if (kind) kind.addEventListener('change', function () { run(true); });
    if (sortSel) sortSel.addEventListener('change', function () { run(true); });
    input.addEventListener('blur', function () {
      // the list cannot be used without the field: leaving the field, or
      // clicking one of its own options, closes it. The click is handled first
      // (see below), so it is not lost to this.
      if (compTerms.length) closeComp();
    });
    input.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'Escape') {
        if (compTerms.length) { e.preventDefault(); closeComp(); return; }
        if (sel >= 0) { e.preventDefault(); sel = -1; paintSel(); }
        return;
      }
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        if (compTerms.length) { e.preventDefault(); moveComp(k === 'ArrowDown' ? 1 : -1); return; }
        if (rows().length) { e.preventDefault(); moveSel(k === 'ArrowDown' ? 1 : -1); }
        return;
      }
      if (k === 'Home' || k === 'End') {
        if (compTerms.length) return;          // the list is open: it owns these
        if (sel >= 0) { e.preventDefault(); edgeSel(k); }
        return;
      }
      if (k === 'Enter') {
        if (compTerms.length && compAt >= 0) { e.preventDefault(); acceptComp(compAt); run(true); return; }
        if (!compTerms.length && sel >= 0 && openSelected()) e.preventDefault();
      }
    });
    box.addEventListener('click', function (e) {
      var el = e.target;
      if (el && el.className === 'sr-go') { input.value = el.getAttribute('data-q'); run(true); }
    });
    // the "did you mean" button is in the LINE above the results, not in the
    // list: the offer belongs with what the page says it found, so it takes its
    // own handler rather than the list's.
    status.addEventListener('click', function (e) {
      var el = e.target;
      if (el && el.className === 'sr-go') { input.value = el.getAttribute('data-q'); run(true); }
    });
    if (compList) compList.addEventListener('mousedown', function (e) {
      var li = e.target, lis = compList.children, i;
      for (i = 0; i < lis.length; i++) if (lis[i] === li) { acceptComp(i); run(true); break; }
    });
    if (!url.q) { try { input.focus({ preventScroll: true }); } catch (e) { } }
    return true;
  }

  function boot() {
    var el = document.getElementById('search-data');
    if (!el) return null;
    try { S.init(JSON.parse(el.textContent)); } catch (e) { return null; }
    wire();
    // The fetched half starts loading as soon as the page does: the first
    // query should usually find it already there, and a reader who never
    // searches has paid for a request that may still be in the browser's cache
    // by the time they do. Nothing waits on it and nothing breaks without it.
    deepOf(S._idx);
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
    /** The words a pattern reaches, off the automaton — the query's own path
     * into the index, exposed so a test can ask it directly. A pattern the
     * reader cannot read comes back with `error`, never as an empty answer. */
    matchPattern: function (body) {
      var idx = S._idx;
      if (!idx) return { terms: [], capped: false };
      try {
        return new Pattern('/' + body + '/', body).walk(idx.dafsa);
      } catch (e) {
        return { terms: [], capped: false, error: e.message };
      }
    },
    /** The pieces a quoted phrase's words are ADJACENT in — the phrase path
     * into the positions, exposed so a test can hold it against a brute-force
     * adjacency scan of the pieces' own text. With no fetched half the answer
     * is empty and `off` says why: the same honest degradation the page shows. */
    matchPhrase: function (text) {
      var idx = S._idx;
      if (!idx) return { docs: [], off: true };
      var ph = phraseTerms(text, idx.stop);
      if (!ph.phrases.length) return { docs: [], off: false };
      if (!idx.deep) return { docs: [], off: true };
      var pm = phraseMatch(idx.deep, idx, ph.phrases[0]);
      var out = [];
      for (var d in pm.docs) out.push({ i: +d, at: pm.docs[d] });
      out.sort(function (a, b) { return a.i - b.i; });
      return { docs: out, off: false, missing: pm.missing };
    },
    /** The fetched half, for a test to install before the fetch lands (or in
     * place of one): the same decode the page runs on the fetched bytes. */
    loadDeep: function (raw) {
      var idx = S._idx;
      if (!idx) return null;
      idx.deep = makeDeep(idx, raw);
      return idx.deep;
    },
    /** The passage a stream position sits in, and the passage itself — the
     * join the snippet uses, exposed so a test can check it against the
     * piece's own paragraphs. */
    passageAt: function (i, at) {
      var idx = S._idx;
      if (!idx || !idx.deep) return null;
      var bounds = idx.deep.passAt[i] || [];
      var p = 0;
      for (var k = 0; k < bounds.length; k++) if (bounds[k] <= at) p = k;
      return { p: p, text: (idx.deep.pass[i] || [])[p] || '' };
    },
    query: function (text, opts) { return query(text, opts); },
    /** The words within `k` edits of a word, off the automaton — the fuzzy
     * path into the index, exposed so a test can hold it against a plain scan of
     * the word list. `k` defaults to one edit, the budget a single `~` asks for.
     * With no automaton there is nothing to walk and the answer is empty. */
    matchFuzzy: function (word, k) {
      var idx = S._idx;
      if (!idx || !idx.dafsa) return { words: [], capped: false };
      return fuzzyWalk(idx.dafsa, String(word).toLowerCase(), k === undefined ? 1 : k, FUZZY_CAP);
    },
    /** The words that begin with a prefix, off the same automaton — the walk
     * the box's completions use, exposed so a test can hold it against the word
     * list. The cap defaults to the box's own, and is reported when it stops
     * the walk. */
    matchPrefix: function (prefix, cap) {
      var idx = S._idx;
      if (!idx || !idx.dafsa) return { terms: [], capped: false };
      return prefixWalk(idx.dafsa, String(prefix).toLowerCase(), cap === undefined ? COMPLETE_CAP : cap);
    },
    snippet: function (i, text) { return snippet(S._idx, i, tokenize(text, S._idx.stop)); },
    _deepAsked: false,
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
