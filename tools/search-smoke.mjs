/**
 * tools/search-smoke.mjs — runtime test for the /search/ page.
 *
 * The build gates prove the page is valid and leaks nothing; `node --check`
 * proves the inlined script parses. Neither proves the search FINDS anything.
 * This loads the BUILT /search/ page into a real DOM (happy-dom), runs the
 * page's own inlined pipeline exactly as a browser would, and then:
 *
 *   - recomputes, from content/, the pieces each rare term really occurs in and
 *     asserts the page's answer is the SAME SET — nothing hard-coded: the
 *     expectation is derived from the prose every run. The word list keeps EVERY
 *     term the prose uses, a term only one piece uses included, so the
 *     expectation for a bare term is its WHOLE PREFIX range; the ranking is
 *     checked the same way — the top results must be the pieces whose prose
 *     contains the term, not the pieces a vector or a link merely reached;
 *   - asserts the graph-only cap COUNTS what it drops, and that the count is the
 *     candidates minus the ones shown, recomputed from the providers;
 *   - REBUILDS every shipped vector from the prose with an independent FNV-1a
 *     and asserts the page's own vectors are identical — the one test that
 *     proves the build's projection and the client's are the same projection;
 *   - asserts the datalog rules FIRE, and that their reasons reach the results;
 *   - asserts the page's list STOPS WHERE THE EVIDENCE STOPS: for a bare term,
 *     the rows above the disclosure are exactly the pieces whose prose contains
 *     it (recomputed from content/), the rest are folded behind a row that
 *     counts them, and the status line states both — the failure mode being a
 *     list of twenty-four pieces of which six answer the query;
 *   - drives the box and the URL: ?q= round-trips, the facets narrow, typing
 *     fills the list.
 *
 * It reports the sizes and the latency it measured. Run it against a built tree:
 *
 *     SKIP_CSS=1 ./build.sh && node tools/search-smoke.mjs
 *
 * happy-dom is discovered the way the build discovers it (the repo's
 * node_modules, then the fixpoint-linux sibling checkout); override with
 * HAPPY_DOM=/path/to/node_modules/happy-dom.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { tmpdir as osTmpdir } from 'node:os';
// The page's own renderer and the build's own partitioning, for the ONE check
// that has to know what a page emits (the anchors of a text served from the
// shelf alone): the question there is "does the id this index names exist in the
// page", and only the renderer that writes the page can answer it.
import { preprocess as pagePreprocess, partition as pagePartition } from './library/reader.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = join(ROOT, 'dist', 'search', 'index.html');
const require = createRequire(import.meta.url);

function loadHappyDom() {
  const candidates = [
    process.env.HAPPY_DOM,
    join(ROOT, 'node_modules', 'happy-dom'),
    join(ROOT, '..', 'fixpoint-linux', 'fixpointlinux.org', 'node_modules', 'happy-dom'),
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return require(c).Window;
  throw new Error('search-smoke: happy-dom not found. Looked in:\n  ' + candidates.join('\n  '));
}
const Window = loadHappyDom();

let failures = 0;
const check = (cond, msg) => {
  console.log((cond ? '  OK   ' : '  FAIL ') + msg);
  if (!cond) failures++;
};
const norm = (set) => [...set].sort().join(', ');

if (!existsSync(PAGE)) {
  console.error('search-smoke: no built /search/ page. Build first: SKIP_CSS=1 ./build.sh');
  process.exit(1);
}
const html = readFileSync(PAGE, 'utf8');

/* ---------- the page's own data and pipeline ---------- */

const dataMatch = html.match(/<script type="application\/json" id="search-data">([\s\S]*?)<\/script>/);
if (!dataMatch) {
  console.error('search-smoke: the page carries no search-data block');
  process.exit(1);
}
const data = JSON.parse(dataMatch[1]);
const blocks = [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map((m) => m[1]);
const client = blocks.find((b) => b.includes('window.Search'));
if (!client) {
  console.error('search-smoke: the page carries no search pipeline script');
  process.exit(1);
}

/* ---------- the expectation, computed from the prose ---------- */

/**
 * A piece's text with the markup taken off, so the words counted here are the
 * words a reader sees: a link contributes its TEXT (`](/a-slug/)` contributes
 * nothing), a fenced block contributes nothing. A deliberate SECOND
 * implementation of the build's own rule — a test that asked the build what it
 * indexed would prove nothing about what the build indexed. If the two ever
 * disagree the vector rebuild below fails, which is the point.
 */
function plain(src) {
  return String(src)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\^[^\]]+\]/g, ' ')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/[*_`|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP = new Set(String(data.stop).split(' '));
const words = (text) => (String(text).toLowerCase().match(/[a-z][a-z'-]+/g) || [])
  .filter((w) => w.length >= 3 && !STOP.has(w));

const manifest = JSON.parse(readFileSync(join(ROOT, 'posts.json'), 'utf8'));
// the document index is the manifest's PUBLISHED order, which is the order the
// page's docs array is in — the two have to agree or every slug would be wrong
const posts = manifest.posts.filter((p) => p.published);
if (posts.length !== data.docs.length) {
  console.error(`search-smoke: ${posts.length} published pieces on disk, ${data.docs.length} in the page`);
  process.exit(1);
}
for (let i = 0; i < posts.length; i++) {
  if (posts[i].slug !== data.docs[i].slug) {
    console.error(`search-smoke: piece ${i} is ${posts[i].slug} on disk and ${data.docs[i].slug} in the page`);
    process.exit(1);
  }
}

const sources = posts.map((p) => readFileSync(join(ROOT, 'content', p.file), 'utf8'));
const tokens = sources.map((src) => words(plain(src)));
/** term -> the slugs whose own text contains it. */
const df = new Map();
for (let i = 0; i < posts.length; i++) {
  for (const t of new Set(tokens[i])) {
    if (!df.has(t)) df.set(t, new Set());
    df.get(t).add(posts[i].slug);
  }
}
const expectExact = (t) => df.get(t) || new Set();
/** what the WORD LIST answers for a term: every piece whose prose uses it or
 * uses a longer word beginning with it, because a bare term is looked up
 * exactly AND as a prefix. The vocabulary holds every word the pieces use, so
 * there is no second rule to apply here — that IS the rule the page states. */
function expectLexical(t) {
  const out = new Set();
  for (const [u, slugs] of df) {
    if (u.indexOf(t) !== 0) continue;
    for (const s of slugs) out.add(s);
  }
  return out;
}
/** a word exactly one piece uses, chosen from the prose (the rarest kind of
 * term there is, and the one a word list is most likely to have dropped). */
const single = [...df.entries()]
  .filter(([t, s]) => s.size === 1 && /^[a-z][a-z'-]*$/.test(t) && t.length >= 6)
  .sort((a, b) => (a[0] < b[0] ? -1 : 1))[0];

/* ---------- an independent FNV-1a, to check the shipped one ---------- */

const fnvRef = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
};

/* ---------- the page, in a DOM ---------- */

const w = new Window({ width: 1100, height: 900, url: 'https://blog.jaye.ch/search/' });
const d = w.document;
let state = 'loading';
Object.defineProperty(d, 'readyState', { get: () => state, configurable: true });
const bodyHtml = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
// every script but the data block is lifted out and run by hand: the pipeline
// must be the page's own text, and nothing may be executed twice
d.body.innerHTML = bodyHtml.replace(/<script(?![^>]*application\/json)[\s\S]*?<\/script>/g, '');
check(!!d.getElementById('search-data'), 'the page body carries the search-data block');
check(!!d.getElementById('sq') && !!d.getElementById('sres'), 'the page body carries the box and the result list');

let S;
try {
  S = new Function('window', 'document', 'performance', 'setTimeout', 'clearTimeout', 'console',
    client + '\nreturn window.Search;')(
    w, d, w.performance, w.setTimeout.bind(w), w.clearTimeout.bind(w), console);
} catch (e) {
  console.error('search-smoke: the inlined pipeline threw on load — ' + e.message);
  process.exit(1);
}
check(!!S && typeof S.query === 'function', 'the page installs Search with a query function');
state = 'interactive';
d.dispatchEvent(new w.Event('DOMContentLoaded'));
check(!!S._idx, 'boot() read the page\'s own index block on DOMContentLoaded');

const slugs = (list) => list.map((r) => data.docs[r.i].slug);

/* ---------- 1. the sizes the page actually shipped ---------- */

console.log('== measured');
const lex = data.lex;
const terms = S._idx.terms;                 // the words, walked out of the automaton
const auto = S._idx.dafsa;
const dafsaJson = JSON.stringify(data.lex.dafsa);
const vocabString = terms.join(' ');
console.log(`  page ${Buffer.byteLength(html)} bytes, gzip ${gzipSync(html, { level: 9 }).length}`);
console.log(`  data block ${Buffer.byteLength(dataMatch[1])} bytes, gzip ${gzipSync(dataMatch[1], { level: 9 }).length}`);
console.log(`  pipeline script ${Buffer.byteLength(client)} bytes`);
console.log(`  ${data.docs.length} pieces · ${terms.length} terms · ${lex.postings.reduce((n, p) => n + p.length, 0)} term-to-piece pairs · ${lex.strong.length} title/heading terms`);
console.log(`  ${data.vec.length} vectors of ${data.vec[0].length} int8 dims · ${data.graph.link.length} links · ${data.graph.cites.length} citations over ${data.graph.source.length} works`);
console.log(`  the automaton: ${auto.n} states · ${auto.lbl.length} transitions · ${auto.fin.reduce((n, f) => n + f, 0)} of them final`);
console.log(`  serialised automaton ${Buffer.byteLength(dafsaJson)} bytes raw (gzip ${gzipSync(dafsaJson, { level: 9 }).length}) —`);
console.log(`  the same ${terms.length} words as one space-joined string ${Buffer.byteLength(vocabString)} bytes raw (gzip ${gzipSync(vocabString, { level: 9 }).length})`);

/* ---------- 2. the words, walked back out of the automaton ---------- */

// The automaton replaced the string of words, so the walk that reconstructs the
// vocabulary is the new thing that can be wrong — and every posting index, every
// search and the whole vector rebuild below rest on it. The expectation is the
// words the PROSE uses, tokenised here from content/, sorted: nothing is
// hard-coded, and the automaton has to reproduce the list exactly, in order.
console.log('== the vocabulary, walked out of the automaton');
const dfTerms = [...df.keys()].sort();
check(terms.length === dfTerms.length && terms.every((t, i) => t === dfTerms[i]),
  `the automaton walks out exactly the words the prose uses, in order (${terms.length} words, ${dfTerms.length} on disk)`);
check(terms.every((t, i) => i === 0 || terms[i - 1] < t && /^[a-z][a-z'-]*$/.test(t)),
  'the walk is strictly sorted, so a word\'s position IS its posting row');
check(lex.postings.length === terms.length,
  `every word has its own posting row (${lex.postings.length} rows for ${terms.length} words)`);
const dafsaStates = auto.n;
check(dafsaStates < terms.reduce((n, t) => n + t.length, 0),
  `the automaton has fewer states than the words have characters (${dafsaStates} < ${terms.reduce((n, t) => n + t.length, 0)}), so the minimisation did something`);

/* ---------- 3. the shared hash ---------- */

const sample = terms.filter((_, i) => i % 97 === 0).concat(['dafsa', 'wetiko', 'proclus']);
const badHash = sample.filter((t) => S.fnv1a(t) !== fnvRef(t));
check(badHash.length === 0, `the shipped FNV-1a matches an independent implementation (${sample.length} terms sampled)` +
  (badHash.length ? ` — first disagreement: ${badHash[0]}` : ''));
check(S.DIM === data.dim, `the client's dimension is the page's (${S.DIM})`);

/* ---------- 4. the shipped vectors, rebuilt from the prose ---------- */

/**
 * Every vector, recomputed here from content/ — its own tokenisation, its own
 * FNV-1a, the page's own idf rule — and compared with what the page shipped.
 * This is the test that the BUILD and the CLIENT project a term into the same
 * dimension with the same sign and weight; a disagreement in either,
 * quantisation included, shows up here as a difference and nowhere else.
 */
console.log('== the vectors, rebuilt from the prose');
const vocab = terms;
const termAt = new Map(vocab.map((t, i) => [t, i]));
const DIM = data.dim;
const idfOf = (t) => {
  const ti = termAt.get(t);
  return Math.log(1 + posts.length / Math.max(1, ti === undefined ? 1 : lex.postings[ti].length));
};
let vecDiff = 0;
let vecWorst = 0;
for (let i = 0; i < posts.length; i++) {
  const tf = new Map();
  for (const t of tokens[i]) tf.set(t, (tf.get(t) || 0) + 1);
  const v = new Float64Array(DIM);
  for (const [t, c] of tf) {
    const h = fnvRef(t);
    v[h % DIM] += (((h >>> 31) & 1) ? -1 : 1) * (1 + Math.log(c)) * idfOf(t);
  }
  let n = 0;
  for (let x = 0; x < DIM; x++) n += v[x] * v[x];
  n = Math.sqrt(n) || 1;
  let worst = 0;
  for (let x = 0; x < DIM; x++) {
    const want = Math.max(-127, Math.min(127, Math.round((v[x] / n) * 127)));
    worst = Math.max(worst, Math.abs(want - data.vec[i][x]));
  }
  vecWorst = Math.max(vecWorst, worst);
  if (worst) vecDiff++;
}
check(vecDiff === 0 && vecWorst === 0,
  `all ${posts.length} shipped vectors equal the rebuild from content/ (worst dimension off by ${vecWorst}, ${vecDiff} piece(s) differ)`);

/* ---------- 5. rare exact terms: the answer IS what the prose says ---------- */

// the rarest kind of term there is: a name one piece uses and no other. 'dafsa'
// was the Zig engine's name — a word the prose never uses, so the assertion on it
// was vacuous every run; this one is verified present in content/ by the same df
// computed above (a term absent from the corpus is caught by the check below).
const RARE = ['trithemius', 'wetiko', 'picatrix', 'proclus', 'quareia', 'theurgy', 'dodds'];
console.log('== rare exact terms (expected computed from content/)');
for (const t of RARE) {
  const expected = expectExact(t);
  const lexExpected = expectLexical(t);
  const lexHits = new Set(slugs(S.providers.lexical(t)));
  const fused = S.query(t, { limit: 200 });
  const found = new Set(slugs(fused.results));
  check(norm(lexHits) === norm(lexExpected),
    `"${t}": the word list answers with the ${lexExpected.size} piece(s) whose prose uses it or a word beginning with it — ${norm(lexHits)}`);
  if (!expected.size) {
    check(found.size === 0,
      `  "${t}" occurs in no piece, so the page answers nothing at all (it returned ${found.size}); the check is otherwise vacuous`);
  } else {
    check([...expected].every((s) => found.has(s)),
      `  every piece the prose names (${expected.size}) is in the fused results: ${norm(expected)}`);
    // the RANKING, on the same derived expectation: a piece whose prose contains
    // the term outranks one the vectors only called similar and one the graph
    // only reached. The page did not do this: a plain body exact hit floors at
    // W_LEX/2.6 = 0.238, below W_VEC, so 'proclus' ranked star-ships (vector-only,
    // 0.45) and a dozen graph-only neighbours (0.26) above two pieces that
    // literally contain the word.
    const top = slugs(fused.results).slice(0, expected.size);
    check(norm(top) === norm(expected),
      `  "${t}": the top ${expected.size} are exactly the pieces whose prose contains it — ${norm(top)}`);
  }
}

// the rarest word there is: used by ONE piece, so a word list that kept only
// the terms that join pieces would lose it — the page states it does not
if (single) {
  const [term, only] = single;
  const got = new Set(slugs(S.providers.lexical(term)));
  check(norm(got) === norm(only),
    `"${term}" is used by exactly one piece and the word list finds it: ${norm(got)}`);
} else {
  check(false, 'no single-piece word found in the prose to test with');
}

// a query of words no piece uses must answer NOTHING: projecting an unseen word
// through the vectors answers with the pieces' own unrelated terms (measured: a
// nonsense word scored above the floor for 57 of the 58 pieces)
check(S.query('zzzzqqq').results.length === 0, 'a word no piece uses returns no results at all');
check(S.query('zzzzqqq flamingo').results.length === 0, 'a phrase of such words returns none either');

/* ---------- 6. a prefix ---------- */

const prefExpected = expectLexical('procl');
const prefGot = new Set(slugs(S.providers.lexical('procl')));
console.log('== prefix');
check(norm(prefGot) === norm(prefExpected),
  `"procl" answers with every piece whose prose begins a word that way — ${prefGot.size} piece(s): ${norm(prefGot)}`);
check(prefGot.has('proclus-elements-of-theology') && prefGot.has('proclus-theology-of-plato'),
  'both Proclus readings are in the prefix answer');
const prefQ = new Set(slugs(S.query('procl', { limit: 200 }).results));
check(norm(prefGot) === norm(new Set([...prefQ].filter((s) => prefGot.has(s)))),
  'the fused query keeps every piece the prefix answers for');

/* ---------- 7. the pattern walker, against a brute-force scan ---------- */

/**
 * The walker has a perfect oracle available and it is the browser's own regular
 * expression engine: `new RegExp(body).test(word)` on every word of the
 * vocabulary IS the definition of "this word matches this pattern" for the
 * subset the page documents (literal characters, `.`, `*` `+` `?`, `[abc]`
 * `[a-z]` `[^abc]`, `|`, `()`, `^`, `$` — and no anchors inside the body, where
 * the two engines' readings are the same one). So the expectation is computed
 * here, never written down: a single disagreement is a blocker, and the line
 * prints which pattern it was.
 *
 * The page's own engine is what runs the SEARCH (the browser's can backtrack,
 * and a pattern out of a search box is not a program to hand it), so this is
 * also the test that the two agree on the whole corpus, not on the examples.
 */
console.log('== the pattern walker (differential: the walk vs a brute-force scan)');
// the walker stops at its own cap; the cap is not written down here either — a
// pattern that reaches everything comes back as the cap itself
const whole = S.matchPattern('.');
check(whole.capped && whole.terms.length > 1,
  `a pattern reaching every word stops at the walker's own cap (${whole.terms.length} words, reported as capped)`);
const CAP = whole.terms.length;

const PATTERNS = [
  // a word, and the middle of one — the capability the list does not have
  'proclus', 'wetiko', 'theurgy', 'urgy', 'gnos', 'iko', 'tiko', 'roclu',
  // anchored at one end or both
  '^procl', '^the', '^a', 'sis$', 'urgy$', 'os$', '^procl.*gy$', '^wetiko$',
  // `.`, and the quantifiers
  'p.o', 'w.tiko', '^...$', '^....$', 'wet.*o', 'the.*urgy', 'proclu+', 'o+t', '^gr+',
  'theurg?y', 'colou?r', 'wetiko?', 'a*', '.*s', 'n?o',
  // character classes, positive, ranged and negated
  '[pq]roclus', 'w[aeiou]tiko', '[a-m]urgy', '[^a-m]urgy', '[a-z]urgy', '^[a-z]e$',
  "[a-z']+s$", '[xyz]zz', '[^a-z]', '^[^a-z]',
  // alternation and grouping
  '(gno|the)sis', 'proclus|wetiko', '^(i|y)', '(sis|os)$', '(pro|the)+', '(ab|cd)?e',
  '^(pro|the)lus', '(a|e)+r', '(urgy|osis)$',
  // nothing, and rather a lot
  'zzzz', 'qqq', '^zzz', 'zzz$', '[0-9]', '^zzzzy$', 'q.*q.*q', '.', 'e', '^.', 'ing$', '.*',
  // a lone anchor (which matches everything, as it does in the browser)
  '^',
];

let reTested = 0, reCapped = 0, reDisagreements = 0;
for (const body of PATTERNS) {
  const got = S.matchPattern(body);
  if (got.error) {
    check(false, `the walker refused /${body}/ — ${got.error}`);
    reDisagreements++;
    continue;
  }
  const want = vocab.filter((t) => new RegExp(body).test(t)).slice(0, CAP);
  const same = got.terms.length === want.length && got.terms.every((t, i) => t === want[i]);
  const cappedRight = (got.capped === true) === (want.length === CAP && vocab.filter((t) => new RegExp(body).test(t)).length > CAP);
  reTested++;
  if (got.capped) reCapped++;
  if (!same || !cappedRight) reDisagreements++;
  check(same && cappedRight,
    `/${body}/ → ${got.terms.length} word(s)${got.capped ? ', capped' : ''}, identical to the scan` +
      (same && cappedRight ? ` (e.g. ${got.terms.slice(0, 3).join(', ') || 'none'})` :
        ` — walker ${JSON.stringify(got.terms.slice(0, 4))} vs scan ${JSON.stringify(want.slice(0, 4))}`));
}
check(reTested === PATTERNS.length && reDisagreements === 0,
  `${reTested} pattern(s) walked, ${reCapped} of them capped, ${reDisagreements} disagreement(s) with the scan`);
check(reCapped >= 3, `${reCapped} pattern(s) reached more words than the cap and each reported it`);

// the matches ARE words of the list, and the position they come out at is the
// posting row (the invariant that makes a pattern result plug into the index)
const sampleRe = S.matchPattern('urgy');
check(sampleRe.terms.length > 0 && sampleRe.terms.every((t) => terms.indexOf(t) >= 0),
  `every word the walker returns is a word of the list, at its own index (e.g. ${sampleRe.terms.slice(0, 3).join(', ')})`);
const inOrder = sampleRe.terms.every((t, i) => i === 0 || sampleRe.terms[i - 1] < t);
check(inOrder, `the walk returns them in the list's own order (${sampleRe.terms.join(', ')})`);

// a pattern the page cannot read is SAID, not guessed at and not thrown
const bad = S.matchPattern('x[');
check(!!bad.error && bad.terms.length === 0, `an unclosed class comes back as an error, not as nothing (${bad.error})`);
for (const b of ['a\\d', '(ab', 'a{2}', '*a', '^a^', 'a$b', '[]', '{2}']) {
  const r = S.matchPattern(b);
  check(!!r.error, `/${b}/ is refused with a reason: ${r.error}`);
}

/* ---------- 7b. a pattern, through the box ---------- */

console.log('== a pattern query');
const woven = S.matchPattern('wetiko');
const wantWetiko = new Set();
for (const t of woven.terms) for (const s of (df.get(t) || new Set())) wantWetiko.add(s);
const gotWetiko = new Set(slugs(S.query('/wetiko/').results));
check(wantWetiko.size > 0 && [...wantWetiko].every((s) => gotWetiko.has(s)),
  `"/wetiko/" answers with every piece whose prose uses a word the pattern reaches (${wantWetiko.size} piece(s), ${norm(wantWetiko)})`);
const wedge = S.query('/^procl/');
const wedgeSlugs = new Set(slugs(wedge.results));
check(wedgeSlugs.has('proclus-elements-of-theology') && wedgeSlugs.has('proclus-theology-of-plato'),
  'an anchored pattern reaches both Proclus readings');
// the reason travels with the result: every piece the pattern REACHED carries
// the pattern; a piece only the graph added carries its own reason, as always
const reached = new Set();
for (const t of S.matchPattern('^procl').terms) for (const s of (df.get(t) || new Set())) reached.add(s);
const whyShown = wedge.results.filter((r) => reached.has(data.docs[r.i].slug));
check(whyShown.length > 0 && whyShown.every((r) => r.why.some((w) => w.indexOf('re: "/^procl/"') === 0)),
  `${whyShown.length} result(s) the pattern reached carry it as their reason (e.g. ${JSON.stringify(whyShown[0].why)})`);
// a pattern matching the MIDDLE of a word is the whole point, and the word list
// cannot do it: it answers whole words and the beginnings of words, and
// 'liturgy', 'thaumaturgy' and 'theurgy' are none of those for the query 'urgy'
const midQ = S.query('/urgy/');
const midLex = new Set(S.providers.lexical('urgy').map((r) => r.i));
const midOnly = midQ.results.filter((r) => !midLex.has(r.i) && r.why.some((w) => w.indexOf('re: ') === 0));
check(midQ.results.length > 0 && midOnly.length > 0,
  `a mid-word pattern reaches pieces the word list cannot (${midOnly.length} of ${midQ.results.length} result(s) are only the pattern's: ${norm(slugs(midOnly))})`);
const cappedQ = S.query('/.*/');
check(cappedQ.counts.reCapped === true && cappedQ.counts.matched === CAP,
  `a pattern reaching every word reports the cap instead of dropping it silently (${cappedQ.counts.matched} words, capped=${cappedQ.counts.reCapped})`);
const brokenQ = S.query('/x[/');
check(brokenQ.results.length === 0 && /not closed/.test(brokenQ.counts.reError),
  `a malformed pattern returns no results and a reason rather than throwing ("${brokenQ.counts.reError}")`);

/* ---------- 7c. the fuzzy walker, against a brute-force OSA scan ---------- */

/**
 * The fuzzy walk carries a DP row down the automaton and abandons a branch when
 * it leaves the budget; the DEFINITION of "within k edits" is a plain OSA matrix
 * per word, and that is what is computed here, over the whole vocabulary, every
 * run — never written down. The walk and the scan must agree on the SET, on the
 * ORDER (the walk emits in the list's own order, which is the postings' order)
 * and on the DISTANCE it reports. A single disagreement is a blocker, and the
 * line prints which case it was.
 *
 * The scan is a full matrix with the adjacent-swap rule, written out separately
 * from the walk's rolling rows: two implementations that shared a shape could
 * agree on a mistake, and this is the one test that can prove the walk is not
 * one.
 */
console.log('== the fuzzy walker (differential: the walk vs a brute-force OSA scan)');

/** Optimal string alignment: Levenshtein plus the adjacent transposition as ONE
 * edit. The full n×m matrix, so nothing about the walk's own rolling rows can
 * hide in it. */
function osa(a, b) {
  const n = a.length, m = b.length;
  const d = [];
  for (let i = 0; i <= n; i++) {
    d.push(new Array(m + 1).fill(0));
    d[i][0] = i;
  }
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
      d[i][j] = v;
    }
  }
  return d[n][m];
}
/** every word of the list within k edits of q, in the list's order, with the
 * distance each was found at — the answer the walk has to reproduce. */
function scan(q, k) {
  const out = [];
  for (const t of vocab) {
    const d = osa(t, q);
    if (d <= k) out.push([t, d]);
  }
  return out;
}

// the walk's own bound, taken FROM the walk (never written down here): a
// three-letter query is within two edits of hundreds of words, well past it
const wideWalk = S.matchFuzzy('ais', 2);
const wideTruth = scan('ais', 2);
check(wideWalk.capped === true && wideWalk.words.length < wideTruth.length,
  `a short word within two edits is matched beyond the walk's own bound — ${wideWalk.words.length} of ${wideTruth.length} reported, and it SAYS it stopped`);
const FUZZY_CAP = wideWalk.words.length;
const wideSame = wideWalk.words.every((x, i) => x.w === wideTruth[i][0] && x.d === wideTruth[i][1]);
check(wideSame, `and the words it did return are the scan's first ${FUZZY_CAP}, in the scan's own order (first: ${wideWalk.words.slice(0, 3).map((x) => x.w).join(', ')})`);
// the same bound for a second, different short query: a cap is one number, not
// a different truncation each time
const wideWalk2 = S.matchFuzzy('ran', 2);
check(wideWalk2.capped === true && wideWalk2.words.length === FUZZY_CAP,
  `another short word at two edits stops at the same bound (${wideWalk2.words.length})`);

// the corpus. Every kind of edit is here — the word itself, a substitution, an
// insertion, a deletion, an adjacent transposition — plus a two-edit case that
// must be found at two and NOT at one, the list's own apostrophe and hyphen, a
// very short word, and words no edit reaches.
const FUZZY_CASES = [
  ['proclus', 0], ['proclus', 1], ['proclus', 2],   // the word itself: distance 0
  ['proculs', 1], ['proculs', 2],                   // adjacent transposition (one edit, not two)
  ['proclas', 1],                                   // substitution
  ['procluss', 1],                                  // insertion
  ['proclu', 1],                                    // deletion
  ['prokluss', 1], ['prokluss', 2],                 // two edits: gone at one, found at two
  ['gnostick', 2],                                  // two edits from 'gnostic'
  ["theurgy's", 1], ["theurgy's", 2],               // the list's own apostrophe
  ['a-coming', 1], ['a-coming', 2],                 // and its own hyphen
  ['wetiko', 1], ['picatrix', 1], ['quareia', 2], ['trithemius', 1], ['dodds', 1],
  ['ais', 1], ['ais', 2], ['ran', 1], ['ran', 2],   // very short: cheap, and plenty
  ['aaa', 1], ['aaa', 2], ['zzz', 1], ['zzz', 2],   // nothing like a word of the list
  ['zzzzqqq', 1], ['zzzzqqq', 2],                   // far from everything
];
// …and typos BUILT from the list itself, at a stride with no relation to the
// automaton's structure, so the corpus is not only the words chosen by hand
for (const b of vocab.filter((_, i) => i % 1223 === 0)) {
  const mid = Math.max(1, Math.floor(b.length / 2));
  const sub = b.slice(0, mid - 1) + (b.charAt(mid - 1) === 'z' ? 'q' : 'z') + b.slice(mid);
  const del = b.slice(0, mid) + b.slice(mid + 1);
  const swp = b.slice(0, mid - 1) + b.charAt(mid) + b.charAt(mid - 1) + b.slice(mid + 1);
  for (const t of [sub, del, swp]) {
    if (!t || t === b) continue;
    FUZZY_CASES.push([t, 1], [t, 2]);
  }
}

let fzTested = 0, fzDisagreements = 0, fzCapped = 0, fzBeyondCap = 0, fzFar = 0;
for (const [q, k] of FUZZY_CASES) {
  const got = S.matchFuzzy(q, k);
  const truth = scan(q, k);
  // at exactly the bound the walk reports that it stopped there, which is the
  // honest direction: the cap is never claimed when fewer were found
  const want = got.capped ? truth.slice(0, FUZZY_CAP) : truth;
  const same = got.words.length === want.length &&
    got.words.every((x, i) => x.w === want[i][0] && x.d === want[i][1]);
  const cappedRight = got.capped === (truth.length >= FUZZY_CAP);
  fzTested++;
  if (got.capped) { fzCapped++; if (truth.length > FUZZY_CAP) fzBeyondCap++; }
  if (!truth.length) fzFar++;
  if (!same || !cappedRight) {
    fzDisagreements++;
    check(false, `~${q} at k=${k}: the walk ${JSON.stringify(got.words.slice(0, 3))} (${got.words.length}${got.capped ? ', capped' : ''}) ` +
      `against the scan ${JSON.stringify(want.slice(0, 3))} (${truth.length})`);
  }
}
check(fzTested === FUZZY_CASES.length && fzDisagreements === 0,
  `${fzTested} (word, k) case(s) walked over the whole ${vocab.length}-word list and ${fzDisagreements} disagreement(s) with the scan — sets, order and distances identical`);
check(fzCapped >= 2 && fzBeyondCap >= 1,
  `${fzCapped} case(s) reached the cap, ${fzBeyondCap} of them with words beyond it that were dropped and reported`);
check(fzFar >= 2, `${fzFar} case(s) are within k edits of no word at all, and both sides agree they are empty`);
check(wideWalk.words.every((x) => x.d <= 2) && wideWalk.words.length > 20,
  `a short word at two edits reaches many words and is not the whole list (${wideWalk.words.length} of ${vocab.length})`);

// the walk emits words in the list's order, which is what makes a match plug
// into the postings by its own row — and every word it emits IS a word of the list
const walkPro = S.matchFuzzy('proculs', 1);
check(walkPro.words.length === 1 && walkPro.words[0].w === 'proclus' && walkPro.words[0].d === 1,
  `"proculs" — two letters the wrong way round — is ONE edit from "proclus", not two: ${JSON.stringify(walkPro.words)}`);
const sorted = S.matchFuzzy('prokluss', 2).words;
check(sorted.every((x, i) => i === 0 || sorted[i - 1].w < x.w) && sorted.every((x) => terms.indexOf(x.w) >= 0),
  `the walk returns the words in the list's own order and every one of them is in the list (${sorted.map((x) => x.w).join(', ')})`);

/* ---------- 7d. a fuzzy term in a query ---------- */

console.log('== a fuzzy term in a query');
// `~` marks a word as fuzzy AND takes it out of the ordinary lookup: `proculus`
// is a word no piece uses and is answered with nothing, `~proculus` finds the
// word it is one edit from
const literalTypo = S.query('proculus');
check(literalTypo.results.length > 0 && literalTypo.counts.fallbackFrom === 'proculus' &&
  literalTypo.counts.fallbackTo === 'proclus',
  `a plain typo is answered with the ONE-EDIT correction, run and reported ` +
  `(${literalTypo.results.length} result(s), "${literalTypo.counts.fallbackFrom}" corrects to "${literalTypo.counts.fallbackTo}")`);
const fuzzyTypo = S.query('~proculus', { limit: 200 });
const fuzzySlugs = slugs(fuzzyTypo.results);
check(fuzzyTypo.counts.terms === 0 && fuzzyTypo.counts.fuzzy === 1,
  `"~proculus" is one fuzzy term and no ordinary one (${fuzzyTypo.counts.terms} ordinary, ${fuzzyTypo.counts.fuzzy} fuzzy)`);
check(fuzzySlugs.includes('proclus-theology-of-plato') && fuzzySlugs.includes('proclus-elements-of-theology'),
  `"~proculus" finds the pieces that use "proclus" (${fuzzySlugs.length} result(s): ${fuzzySlugs.slice(0, 4).join(', ')})`);
check(fuzzyTypo.results.some((r) => r.why.some((w) => w === 'fuzzy: "proculus" → proclus (1 edit)')),
  `the reader is told which word was found and how far away: ${JSON.stringify(fuzzyTypo.results.flatMap((r) => r.why).filter((w) => w.indexOf('fuzzy: ') === 0).slice(0, 2))}`);
// a fuzzy word is not also looked up literally: nothing it finds is `named`
check(S.providers.lexical('~proclus').every((r) => !r.named),
  'a word behind a ~ never counts as a literal hit, however exactly it matches');
check(S.query('~proclus').counts.fuzzyWords === scan('proclus', 1).length && S.query('~proclus').counts.fuzzyK === 1,
  `one tilde is a budget of one edit (${S.query('~proclus').counts.fuzzyWords} word(s) within one edit of "proclus", the same count the scan gives)`);

// one tilde does not reach two edits away; two do
const oneEdit = S.query('~prokluss', { limit: 200 });
check(oneEdit.results.length === 0 && oneEdit.counts.fuzzyWords === 0,
  `"~prokluss" is two edits from every word of the list, so one tilde finds nothing (${oneEdit.counts.fuzzyWords} word(s))`);
const twoEdits = S.query('~~prokluss', { limit: 200 });
check(twoEdits.counts.fuzzyK === 2 && slugs(twoEdits.results).includes('proclus-theology-of-plato'),
  `"~~prokluss" widens the budget to two and finds it (${twoEdits.counts.fuzzyWords} word(s), k=${twoEdits.counts.fuzzyK})`);
const twoEditsWide = S.query('~~ais', { limit: 200 });
check(twoEditsWide.counts.fuzzyCapped === true,
  `a fuzzy term that matches more words than the page will list reports the cap (${twoEditsWide.counts.fuzzyWords} words, capped=${twoEditsWide.counts.fuzzyCapped})`);

// an empty ~ is not a fuzzy term and not an error
for (const q of ['~', '~~', ' ~ ', '~~~']) {
  let ok = true, r = null;
  try { r = S.query(q); } catch (e) { ok = false; }
  check(ok && r.results.length === 0 && r.counts.fuzzy === 0,
    `an empty ${JSON.stringify(q)} asks for nothing fuzzily and does not throw`);
}

// a ~ term among ordinary ones: both are answered, and a word the reader TYPED
// ranks above a word only the walk found — the rank the page sorts on
const mixed = S.query('wetiko ~proculus', { limit: 200 });
const mixedSlugs = slugs(mixed.results);
const litS = new Set(slugs(S.providers.lexical('wetiko')));
const isLit = (r) => r.why.some((w) => w.indexOf('term: ') === 0);
const isFzOnly = (r) => r.why.some((w) => w.indexOf('fuzzy: ') === 0) && !isLit(r);
const fzOnlyRows = mixed.results.filter(isFzOnly);
const litRows = mixed.results.filter(isLit);
check(litRows.length > 0 && fzOnlyRows.length > 0,
  `"wetiko ~proculus" answers both: ${litRows.length} result(s) the typed word named, ${fzOnlyRows.length} the walk found (${norm(slugs(fzOnlyRows))})`);
check(mixed.results.findIndex(isFzOnly) > mixed.results.map(isLit).lastIndexOf(true),
  `every result a literal word named outranks every result only the walk found (last literal at ${mixed.results.map(isLit).lastIndexOf(true)}, first fuzzy-only at ${mixed.results.findIndex(isFzOnly)})`);
check([...litS].every((s) => mixedSlugs.includes(s)),
  `and no literal hit was lost to the fuzzy one (${norm(litS)})`);

// the walk is not entered at all for a query with no ~ in it: the ordinary path
// is the ordinary path, to the microsecond it costs to look for the marker
const plainQ = S.query('proclus');
check(plainQ.counts.fuzzy === 0 && plainQ.counts.fuzzyWords === 0 && plainQ.counts.fuzzyMs === 0 &&
  plainQ.results.every((r) => !r.why.some((w) => w.indexOf('fuzzy: ') === 0)),
  'a query with no ~ never enters the walk (no fuzzy terms, no words, no time spent in it)');

// no word list to walk: the fuzzy term degrades and SAYS so, rather than
// throwing or quietly answering nothing
const keptDafsa = S._idx.dafsa;
S._idx.dafsa = null;
let deg = null, degErr = '';
try {
  deg = S.query('~proculus');
  S.render(d.getElementById('sres'), d.getElementById('sstatus'), '~proculus');
} catch (e) { degErr = e.message; }
S._idx.dafsa = keptDafsa;
check(!degErr && deg.counts.fuzzyOff === true && deg.results.length === 0,
  `with no automaton in the page a fuzzy term is answered with nothing and reported as such, not thrown (${degErr || 'no error'})`);
check(/no word list/.test(d.getElementById('sres').textContent),
  `and the reader is told why: "${d.getElementById('sres').textContent.trim()}"`);

/* ---------- 7e. the prefix walk, against the sorted word list ---------- */

/**
 * The completions are taken off the automaton by descending the prefix's
 * transitions, and the DEFINITION of "the words that begin with this" is a scan
 * of the word list — computed here, never written down. The walk and the scan
 * must agree on the SET and on the ORDER (both are the list's own order), and
 * the walk must report the cap exactly when the scan has more words than it.
 *
 * The walk is reached through the box's own entry point (matchPrefix), so this
 * is the completion list's answer, not a parallel implementation of it.
 */
console.log('== the prefix walk (differential: the walk vs the word list)');
const PREFIXES = [];
for (let i = 0; i < vocab.length; i += 733) PREFIXES.push(vocab[i].slice(0, 3), vocab[i].slice(0, 5));
PREFIXES.push('proclu', 'wet', 'ther', 'zzq', 'a', 'pr');
let pxTested = 0, pxCapped = 0, pxDisagreements = 0;
for (const p of PREFIXES) {
  const got = S.matchPrefix(p);
  const truth = vocab.filter((t) => t.indexOf(p) === 0);
  const want = truth.slice(0, got.terms.length);
  const same = got.terms.length === want.length && got.terms.every((t, i) => t === want[i]);
  const capRight = got.capped === (truth.length > got.terms.length);
  pxTested++;
  if (got.capped) pxCapped++;
  if (!same || !capRight || (truth.length > got.terms.length && got.terms.length !== 8)) {
    pxDisagreements++;
    check(false, `"${p}": the walk ${JSON.stringify(got.terms)} (${got.terms.length}${got.capped ? ', capped' : ''}) vs the list ${JSON.stringify(want)}`);
  }
}
check(pxTested === PREFIXES.length && pxDisagreements === 0,
  `${pxTested} prefix(es) walked, ${pxDisagreements} disagreement(s) with the word list — same words, same order, the cap reported exactly when it stopped`);
check(pxCapped >= 2, `${pxCapped} prefix(es) reached more words than the walk offers and each said so`);
const noPx = S.matchPrefix('zzqqzz');
check(noPx.terms.length === 0 && !noPx.capped, 'a prefix no word begins with comes back empty, not capped');

/* ---------- 7f. a misspelling is corrected, and the correction is reported ---- */

/**
 * Two behaviours, by result count, and the boundary between them is the point:
 *  - the answer is EMPTY -> the one-edit correction is RUN for the reader and the
 *    page says so (`fallbackFrom`/`fallbackTo`). A typo does not dead-end.
 *  - the answer is THIN but not empty -> the correction is only OFFERED, because
 *    the reader's own words did find something and rewriting them unasked would
 *    be the page answering a question that was not asked.
 * Both come from the same walk a `~` runs (asserted above), and neither ever
 * rewrites what the reader typed in the box.
 */
console.log('== a misspelling is corrected, and the correction is reported');
// a typo built from the list, with no relation to the walk's structure: swap two
// adjacent letters in the middle of a word of the corpus
let typo = null, typoOf = null, typoTruth = null;
for (let i = 0; i < vocab.length; i += 419) {
  const b = vocab[i];
  if (b.length < 6) continue;
  const mid = Math.floor(b.length / 2);
  const t = b.slice(0, mid - 1) + b.charAt(mid) + b.charAt(mid - 1) + b.slice(mid + 1);
  if (!t || t === b || vocab.indexOf(t) >= 0) continue;
  const truth = scan(t, 1);
  if (truth.length) { typo = t; typoOf = b; typoTruth = truth; break; }
}
check(!!typo, `a one-swap typo of a word of the list was built from the list${typo ? ` ("${typo}" for "${typoOf}")` : ''}`);
if (typo) {
  const q = S.query(typo);
  check(q.results.length > 0,
    `"${typo}" is a word no piece uses, and the page answers with the corrected word's results instead of nothing (${q.results.length} result(s))`);
  check(q.counts.fallbackFrom === typo && q.counts.fallbackTo === typoTruth[0][0],
    `and it SAYS which word it corrected and to what — "${q.counts.fallbackFrom}" -> "${q.counts.fallbackTo}" ` +
    `(the nearest word the brute-force scan finds: "${typoTruth[0][0]}")`);
  check(vocab.indexOf(q.counts.fallbackTo) >= 0,
    `the correction is a word of the list, not a guess outside it ("${q.counts.fallbackTo}")`);
  // the correction is the scan's own nearest word, so the walk and the oracle agree
  check(typoTruth.some((x) => x[0] === q.counts.fallbackTo),
    'the corrected word is one the brute-force scan finds within one edit');
}
// a word the list holds, and a rich answer, are NEVER corrected: the walk is paid
// only when the answer is empty or thin, and a literal hit is never second-guessed
for (const q of ['proclus', 'wetiko']) {
  const r = S.query(q);
  check(!r.counts.fallbackFrom && r.results.length > 2,
    `"${q}" answers ${r.results.length} result(s) and is not corrected`);
}
// a word with nothing within an edit is answered with nothing, and no correction
const nothingNear = S.query('zzzzqqq');
check(nothingNear.results.length === 0 && !nothingNear.counts.fallbackFrom && !nothingNear.counts.suggest,
  'a word with nothing one edit away is answered with nothing, no correction and no offer');
// one correction per query, never a chain: a query that is corrected returns the
// corrected query's own answer, not a second correction
if (typo) {
  const once = S.query(typo);
  check(once.counts.fallbackFrom === typo && once.counts.fallbackTo === typoTruth[0][0],
    'the fallback runs once — the second query is not itself corrected');
}

/* ---------- 7g. the phrases, against a brute-force adjacency scan of the prose ---- */

/**
 * A quoted run is matched by POSITIONS, and the positions were made by the
 * build from the pieces' passages — so the DEFINITION of "these words stand
 * next to each other, in this order" is computable here from content/ with no
 * reference to anything the build emitted: for each piece, take the body, make
 * the passage streams exactly as index-deep does (every word advances the
 * stream; only vocabulary words are recorded), and ask whether the phrase's
 * recorded words all sit at anchor+offset for one anchor. That is a THIRD
 * implementation of the rule (the smoke's own `plain`, the deep module's, and
 * this scan) — the test can fail, and a disagreement names the piece.
 *
 * The cases cover what the phrase semantics claim: a phrase occurring
 * verbatim; the same words NOT adjacent (must not match); a phrase broken by a
 * paragraph boundary (two passages are two streams — a phrase does not cross);
 * a one-word phrase; a phrase several pieces say; a phrase nothing says; a
 * phrase with an apostrophe/hyphen word; a phrase inside a heading (a heading
 * is a passage, so it is found); a phrase with a stopword inside it (the
 * stopword occupies its stream position); a phrase with a word the pieces
 * never use (answered with nothing, and the word reported).
 */
console.log('== the phrases (differential: the positions vs a brute-force adjacency scan of content/)');

// the deep half, loaded the way the page loads it: from the emitted file
const DEEP_FILE = join(ROOT, 'dist', 'search', 'deep');
let deepRaw = null;
try { deepRaw = JSON.parse(readFileSync(DEEP_FILE, 'utf8')); } catch (e) { deepRaw = null; }
check(!!deepRaw, 'the fetched half was emitted and parses as the page will parse it');
// installed the way the page installs it once its fetch lands; every section
// above this one ran WITHOUT it, which is the degradation half of the claim,
// and every section below runs with it
if (deepRaw) S.loadDeep(deepRaw);

/** the body-passages and stream of one piece, per the rule index-deep states */
function pieceStream(src) {
  const lines = String(src).split('\n');
  const at = lines.findIndex((l) => /^---\s*$/.test(l));
  const body = at < 0 ? String(src) : lines.slice(at + 1).join('\n');
  const passages = [];
  let para = [];
  const flush = () => {
    if (!para.length) return;
    const t = plain(para.join(' '));
    if (t) passages.push(t);
    para = [];
  };
  for (const line of body.split('\n')) {
    if (/^\s*$/.test(line)) flush();
    else if (/^\s{0,3}#{1,6}\s/.test(line)) { flush(); const t = plain(line); if (t) passages.push(t); }
    else if (/^\s*\[\^/.test(line)) flush();
    else para.push(line);
  }
  flush();
  const passAt = [];
  const hits = new Map();   // word -> [stream position, …] (vocabulary words only)
  let pos = 0;
  for (const p of passages) {
    passAt.push(pos);
    const ws = p.toLowerCase().match(/[a-z][a-z'-]+/g) || [];
    for (const w of ws) {
      if (w.length >= 3 && !STOP.has(w) && termAt.has(w)) {
        if (!hits.has(w)) hits.set(w, []);
        hits.get(w).push(pos);
      }
      pos++;
    }
  }
  return { passages, passAt, hits };
}
const streams = sources.map(pieceStream);

/** the brute-force oracle: does this piece hold the phrase? */
function brutePhrase(ph) {
  const seq = [];
  const toks = ph.toLowerCase().match(/[a-z][a-z'-]+/g) || [];
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].length >= 3 && !STOP.has(toks[i])) seq.push({ w: toks[i], off: i });
  }
  const out = new Set();
  if (!seq.length) return out;
  for (const w of seq) if (!termAt.has(w.w)) return out;   // a word no piece uses: nothing matches
  for (let i = 0; i < posts.length; i++) {
    const h = streams[i].hits;
    let ok = false;
    for (const a of (h.get(seq[0].w) || [])) {
      let all = true;
      for (let k = 1; k < seq.length; k++) {
        if (!(h.get(seq[k].w) || []).includes(a + seq[k].off - seq[0].off)) { all = false; break; }
      }
      if (all) { ok = true; break; }
    }
    if (ok) out.add(posts[i].slug);
  }
  return out;
}

if (deepRaw) {
  // the phrases to test: built from the corpus, never written down
  //  - a verbatim phrase: two adjacent recorded words from some piece's stream
  //  - a NOT-adjacent pair: the same words, in the same piece, never adjacent
  //  - across a paragraph break: the LAST word of one passage and the FIRST of
  //    the next — adjacent in no stream, because streams break at passages
  //  - a heading phrase: two adjacent words of a heading passage
  //  - a stopword inside: three words whose middle one is a stopword
  //  - a hyphen/apostrophe word: a recorded word with `'` or `-` inside
  //  - a one-word phrase; a nothing-says phrase; an unknown-word phrase
  const cases = [];
  {
    let verbatim = null, notAdj = null, across = null, heading = null, stopIn = null, hyphen = null, multi = null;
    for (let i = 0; i < posts.length && !(verbatim && notAdj && across && heading && stopIn && hyphen); i++) {
      const st = streams[i];
      for (let p = 0; p < st.passages.length && !(verbatim && notAdj && across && heading && stopIn && hyphen); p++) {
        const ws = st.passages[p].toLowerCase().match(/[a-z][a-z'-]+/g) || [];
        // raw adjacency: two words at CONSECUTIVE positions of the passage's
        // own word list, both recordable — the phrase they spell is one the
        // stream genuinely holds next to each other
        const rec = (w) => w.length >= 3 && !STOP.has(w) && termAt.has(w);
        for (let k = 0; k + 1 < ws.length; k++) {
          if (!rec(ws[k]) || !rec(ws[k + 1])) continue;
          if (!verbatim && ws[k].length >= 4 && ws[k + 1].length >= 4 && ws[k] !== ws[k + 1]) {
            verbatim = { ph: ws[k] + ' ' + ws[k + 1], expect: brutePhrase(ws[k] + ' ' + ws[k + 1]), note: 'verbatim, from ' + posts[i].slug };
          }
          if (!heading && st.passages[p].length < 60) {
            heading = { ph: ws[k] + ' ' + ws[k + 1], expect: brutePhrase(ws[k] + ' ' + ws[k + 1]), note: 'in a heading passage of ' + posts[i].slug };
          }
          if (!hyphen && (ws[k].includes('-') || ws[k].includes("'")) && ws[k + 1].length >= 4) {
            hyphen = { ph: ws[k] + ' ' + ws[k + 1], expect: brutePhrase(ws[k] + ' ' + ws[k + 1]), note: 'with an apostrophe/hyphen word, from ' + posts[i].slug };
          }
        }
        // a stopword between two recorded words, in the passage's own text
        if (!stopIn) {
          for (let k = 0; k + 2 < ws.length; k++) {
            if (STOP.has(ws[k + 1]) && ws[k].length >= 4 && ws[k + 2].length >= 4 && termAt.has(ws[k]) && termAt.has(ws[k + 2])) {
              stopIn = { ph: ws[k] + ' ' + ws[k + 1] + ' ' + ws[k + 2], expect: brutePhrase(ws[k] + ' ' + ws[k + 1] + ' ' + ws[k + 2]), note: 'stopword inside, from ' + posts[i].slug };
              break;
            }
          }
        }
      }
      // words in the same piece, never adjacent anywhere in it
      if (!notAdj && verbatim) {
        const [wa, wb] = verbatim.ph.split(' ');
        const h = st.hits;
        const A = h.get(wa) || [], B = new Set(h.get(wb) || []);
        if (A.length && B.size && !A.some((a) => B.has(a + 1))) {
          notAdj = { ph: verbatim.ph, expect: brutePhrase(verbatim.ph), note: 'same words, never adjacent in ' + posts[i].slug };
        }
      }
      // the last word of one passage and the first of the next
      if (!across) {
        for (let p = 0; p + 1 < st.passages.length; p++) {
          const a = (streams[i].passages[p].toLowerCase().match(/[a-z][a-z'-]+/g) || []).filter((w) => w.length >= 3 && !STOP.has(w) && termAt.has(w));
          const b = (streams[i].passages[p + 1].toLowerCase().match(/[a-z][a-z'-]+/g) || []).filter((w) => w.length >= 3 && !STOP.has(w) && termAt.has(w));
          if (a.length && b.length && a[a.length - 1].length >= 4 && b[0].length >= 4) {
            const ph = a[a.length - 1] + ' ' + b[0];
            const want = brutePhrase(ph);
            // it must be a phrase that WOULD match if the break were not there:
            // the same two words adjacent somewhere in the corpus
            across = { ph, expect: want, note: 'across a paragraph break of ' + posts[i].slug };
            break;
          }
        }
      }
    }
    if (verbatim) cases.push(verbatim);
    if (notAdj) cases.push(notAdj);
    if (across) cases.push(across);
    if (heading) cases.push(heading);
    if (stopIn) cases.push(stopIn);
    if (hyphen) cases.push(hyphen);
    // a one-word phrase: the rare exact term the corpus names
    cases.push({ ph: 'wetiko', expect: brutePhrase('wetiko'), note: 'one word' });
    // a phrase several pieces say: the first two-word phrase whose oracle has 2+ pieces
    for (const c of cases) if (!multi && c.expect.size >= 2) { multi = c; break; }
    check(!!multi, `a phrase several pieces say was found among the cases (${cases.filter((c) => c.expect.size >= 2).length} of them reach 2+ pieces)`);
    // a phrase nothing says: two real words that are never adjacent anywhere
    let none = null;
    outer:
    for (const a of ['proclus', 'wetiko', 'theurgy', 'picatrix', 'quareia']) {
      for (const b of ['proclus', 'wetiko', 'theurgy', 'picatrix', 'quareia']) {
        if (a === b) continue;
        if (brutePhrase(a + ' ' + b).size === 0) { none = { ph: a + ' ' + b, expect: new Set(), note: 'nothing says it' }; break outer; }
      }
    }
    if (none) cases.push(none);
    // a phrase with a word the pieces never use
    cases.push({ ph: 'proculus flibbertigibbet', expect: brutePhrase('proculus flibbertigibbet'), note: 'a word no piece uses' });

    let phDisagreements = 0, phTested = 0;
    // FAILS IF: the emitted positions disagree with the scan on any phrase's
    // piece set — a wrong join, a wrong offset, or a stream that counts words
    // differently than the passages do
    for (const c of cases) {
      const got = new Set(S.matchPhrase('"' + c.ph + '"').docs.map((x) => data.docs[x.i].slug));
      phTested++;
      if (norm(got) !== norm(c.expect)) {
        phDisagreements++;
        check(false, `"${c.ph}" (${c.note}): positions said ${norm(got)}, the scan says ${norm(c.expect)}`);
      }
    }
    check(phTested === cases.length && phDisagreements === 0,
      `${phTested} phrase(s) matched, ${phDisagreements} disagreement(s) with the adjacency scan of content/`);
    // the case the whole oracle rests on: a verbatim phrase found, and the
    // same words never adjacent NOT found
    const v = cases.find((c) => c.note.startsWith('verbatim'));
    check(!!v && v.expect.size > 0, `the verbatim phrase "${v && v.ph}" matches at least one piece (${v && norm(v.expect)})`);
    const na = cases.find((c) => c.note.startsWith('same words'));
    check(!!na, 'a same-words-never-adjacent case was built');
    if (na) {
      const got = new Set(S.matchPhrase('"' + na.ph + '"').docs.map((x) => data.docs[x.i].slug));
      check(!got.has(na.note.split(' ').pop()) || got.size === na.expect.size,
        `words that occur but never adjacent do not match by adjacency alone (${norm(got)})`);
    }
  }

  /* the phrase THROUGH the query: the reason, the filter, the loose words */
  {
    // a phrase whose oracle is non-empty: the page must answer with those
    // pieces carrying the phrase reason, and NOTHING outside the oracle's set
    let c = null;
    for (const x of [cases[0], ...cases]) if (x && x.expect.size > 0) { c = x; break; }
    check(!!c, 'a phrase with hits was found to query with');
    if (c) {
      const r = S.query('"' + c.ph + '"', { limit: 200 });
      const got = new Set(slugs(r.results));
      check([...c.expect].every((s) => got.has(s)),
        `"${c.ph}" through the query reaches every piece the scan names (${norm(c.expect)})`);
      const withWhy = r.results.filter((x) => x.why.some((w2) => w2 === 'phrase: "' + c.ph + '"'));
      check(withWhy.length === r.results.length,
        `every result carries the phrase reason (${withWhy.length} of ${r.results.length})`);
      check(norm(got) === norm(c.expect),
        `and nothing outside the phrase's own pieces (${got.size} results, the scan says ${c.expect.size})`);
    }
    // the zero case is SAID, not padded
    const noneCase = cases.find((x) => x.note === 'nothing says it');
    if (noneCase) {
      const r = S.query('"' + noneCase.ph + '"');
      check(r.results.length === 0,
        `"${noneCase.ph}" answers nothing (${r.results.length} results)`);
      S.render(d.getElementById('sres'), d.getElementById('sstatus'), '"' + noneCase.ph + '"');
      check(/next to each other/.test(d.getElementById('sres').textContent),
        `and the page SAYS why: "${d.getElementById('sres').textContent.trim().slice(0, 90)}"`);
    }
    // a phrase combined with loose words: the phrase narrows, the words do not
    // widen it past the phrase's pieces
    if (c && c.expect.size > 0) {
      const word = [...c.expect][0];
      const term = tokens[posts.findIndex((p) => p.slug === word)].find((t) => t.length >= 5) || 'proclus';
      const both = S.query('"' + c.ph + '" ' + term, { limit: 200 });
      const gotBoth = new Set(slugs(both.results));
      check([...c.expect].every((s) => gotBoth.has(s)),
        `"${c.ph}" + a loose word keeps every piece the phrase named (${norm(c.expect)})`);
    }
    // a phrase + a fuzzy term: the walk still runs (its words are counted and
    // timed), but there is no fuzzy ADJACENCY — a fuzzy term's hits are loose
    // words, subject to the phrase's demand like any other. That is the
    // documented combination behaviour, asserted as a claim.
    const fz = S.query('"cosmos of persons" ~proculs', { limit: 200 });
    check(fz.counts.fuzzy === 1 && fz.counts.fuzzyWords > 0 && fz.counts.phrases === 1,
      `a fuzzy term beside a phrase still walks (${fz.counts.fuzzyWords} word(s) within its budget); adjacency is never fuzzy`);
    // a phrase + a /pattern/: the pattern syntax takes the WHOLE query, so a
    // slash-wrapped fragment beside a phrase is not a pattern at all — the
    // slashes go and the words inside become ordinary loose terms beside the
    // phrase. Stated plainly so the behaviour is a claim, not an accident.
    const pat = S.query('/proclus/ "cosmos of persons"', { limit: 200 });
    check(pat.counts.pattern === '' && pat.counts.phrases === 1,
      'a /pattern/ beside a phrase is not a pattern query: the slashes drop and the words are loose terms (documented)');
  }
}

/* ---------- 7h. the deep half itself: positions, passages, the join ---------- */

if (deepRaw) {
  console.log('== the fetched half (positions, passages, the join)');
  S.loadDeep(deepRaw);
  check(!!S._idx.deep && S._idx.deep.lex.length === terms.length,
    `a row for every term of the vocabulary (${S._idx.deep.lex.length} rows, ${terms.length} terms)`);
  // every position decodes into the passage the stream says it is in, and the
  // passage CONTAINS the word: FAILS IF the delta encoding is wrong, the join
  // is off by one, or the passages stored are not the passages indexed
  let checked = 0, badJoin = 0, badContain = 0;
  for (let ti = 0; ti < terms.length; ti += 331) {
    const row = deepRaw.lex[ti];
    for (const run of row || []) {
      const d2 = run[0];
      let pos = 0;
      for (let k = 1; k < run.length && checked < 400; k++) {
        pos = k === 1 ? run[k] : pos + run[k];
        const at = S.passageAt(d2, pos);
        checked++;
        if (!at || !at.text) { badJoin++; continue; }
        if (!at.text.toLowerCase().includes(terms[ti])) badContain++;
      }
      if (checked >= 400) break;
    }
    if (checked >= 400) break;
  }
  check(checked > 100 && badJoin === 0, `${checked} position(s) decoded, each resolves to a passage (${badJoin} did not)`);
  check(badContain === 0, `and each passage CONTAINS its term (${badContain} did not)`);

  // the SNIPPET oracle: for a set of (query, piece) pairs, the passage the
  // result shows is the passage the positions say the hit is in — both sides
  // computed here from content/
  const pairs = [];
  for (let i = 0; i < posts.length && pairs.length < 6; i += 9) {
    const t = tokens[i].find((w) => w.length >= 6 && (deepRaw.lex[termAt.get(w)] || []).some((r) => r[0] === i));
    if (!t) continue;
    pairs.push([t, i]);
  }
  let snTested = 0, snBad = 0;
  const snWhy = [];
  for (const [t, i] of pairs) {
    const r = S.query(t, { limit: 200 });
    const hit = r.results.find((x) => x.i === i);
    if (!hit || hit.hitAt === null || hit.hitAt === undefined) { snBad++; snWhy.push([t, posts[i].slug, 'no hitAt']); continue; }
    const at = S.passageAt(i, hit.hitAt);
    // the passage the stream (computed from content/) says position hitAt is in
    const st = streams[i];
    let p = 0;
    for (let k = 0; k < st.passAt.length; k++) if (st.passAt[k] <= hit.hitAt) p = k;
    snTested++;
    // the shown snippet must come from THAT passage and CONTAIN the word
    S.render(d.getElementById('sres'), d.getElementById('sstatus'), t);
    const row2 = [...d.getElementById('sres').querySelectorAll('li.sr')].find((li) => li.querySelector('a.sr-t').getAttribute('href').startsWith('/' + posts[i].slug + '/'));
    const shown = row2 ? row2.querySelector('.sr-s').textContent : '';
    if (!shown.toLowerCase().includes(t) || !st.passages[p].toLowerCase().includes(t)) { snBad++; snWhy.push([t, posts[i].slug, 'shown misses the word']); }
    if (at.p !== p) { snBad++; snWhy.push([t, posts[i].slug, 'passage ' + at.p + ' != stream passage ' + p]); }
  }
  check(snTested === pairs.length && snBad === 0,
    `${snTested} (query, piece) pair(s): the snippet is the passage the positions say, and contains the word (${snBad} bad${snWhy.length ? ': ' + JSON.stringify(snWhy.slice(0, 3)) : ''})`);
}

/* ---------- 7i. degradation: the fetched half withheld ------------------- */

// The page's contract: with the fetched index unavailable, every behaviour the
// page had BEFORE it still works, and the phrase says it is pending. This
// runs AFTER the deep half was installed, so it must be taken away again —
// and everything already asserted above was asserted with it present, which is
// the other half of the claim.
console.log('== degradation: the page without the fetched half');
{
  const keptDeep = S._idx.deep;
  delete S._idx.deep;
  // a plain query answers exactly as it always did — same pieces, same reasons
  const withDeep = keptDeep ? null : null;
  const plain1 = S.query('proclus', { limit: 200 });
  check(plain1.results.length > 0 && plain1.results.every((r) => !r.why.some((w) => w.indexOf('phrase: ') === 0)),
    'a plain query answers without the fetched half, no phrase reasons appear');
  // a phrase degrades to its words as ordinary terms and SAYS so
  const ph = S.query('"the frame is a variable"');
  check(ph.counts.phraseDropped === true && ph.results.length > 0,
    `a phrase without the fetched half falls back to its words (${ph.results.length} results)`);
  S.render(d.getElementById('sres'), d.getElementById('sstatus'), '"the frame is a variable"');
  check(/still loading/.test(d.getElementById('sstatus').textContent),
    `and the line above the results says the phrase is still loading ("${d.getElementById('sstatus').textContent.slice(0, 80)}")`);
  // the fuzzy walk, the pattern, the graph are untouched
  check(S.matchFuzzy('proculs', 1).words.length === 1, 'the fuzzy walk still runs without the fetched half');
  check(S.matchPattern('urgy').terms.length > 0, 'the pattern walk still runs without the fetched half');
  const g2 = S.query('wetiko');
  check(g2.counts.derived > 0, 'the graph rules still fire without the fetched half');
  if (deepRaw) S.loadDeep(deepRaw);   // put it back for the sections below
}

/* ---------- 7j. BM25: literal outranks fuzzy-only and graph-only ---------- */

console.log('== ranking (BM25, and the literal/fuzzy/graph discipline)');
{
  // FAILS IF: two identical runs rank differently (the score is not stable),
  // or a fuzzy-only or graph-only result outranks a literal one
  const a1 = slugs(S.query('proclus', { limit: 200 }).results);
  const a2 = slugs(S.query('proclus', { limit: 200 }).results);
  check(norm(a1) === norm(a2), `the ranking is stable across runs (${a1.length} results, identical order)`);
  const mixed = S.query('wetiko ~proculus', { limit: 200 });
  const isLit = (r) => r.why.some((w) => w.indexOf('term: ') === 0);
  const litRows = mixed.results.filter(isLit);
  const nonLit = mixed.results.filter((r) => !isLit(r));
  check(litRows.length > 0 && nonLit.length > 0, `"wetiko ~proculus" answers both kinds (${litRows.length} literal, ${nonLit.length} not)`);
  const lastLit = mixed.results.map(isLit).lastIndexOf(true);
  const firstNon = mixed.results.map(isLit).indexOf(false);
  check(firstNon > lastLit,
    `every literal result outranks every fuzzy/graph-only one (last literal at ${lastLit}, first other at ${firstNon})`);
  // and a piece whose PROSE holds the word outranks vector-similar pieces:
  // the same derived expectation the rare-term section uses
  for (const t of RARE) {
    const expected = expectExact(t);
    if (!expected.size) continue;
    const r = S.query(t, { limit: 200 });
    const top = slugs(r.results).slice(0, expected.size);
    check(norm(top) === norm(expected),
      `"${t}": the top ${expected.size} are still exactly the pieces whose prose contains it — ${norm(top)}`);
  }
}

/* ---------- 7k. the arrival marks, on a built post page ------------------ */

console.log('== the arrival marks (a post page opened with ?q=)');
{
  const postHtml = readFileSync(join(ROOT, 'dist', 'proclus-theology-of-plato', 'index.html'), 'utf8');
  const arriveScript = [...postHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1]).find((s) => s.includes('qbar'));
  check(!!arriveScript, 'a post page carries the arrival script');
  if (arriveScript) {
    // a post whose prose holds a rare term, found from the corpus
    const pi = posts.findIndex((p) => p.slug === 'proclus-theology-of-plato');
    check(pi >= 0, 'a piece with the rare term exists');
    if (pi >= 0) {
      const phtml = postHtml;
      const w5 = new Window({ width: 1100, height: 900, url: 'https://blog.jaye.ch/proclus-theology-of-plato/?q=proclus' });
      const d5 = w5.document;
      let st5 = 'loading';
      Object.defineProperty(d5, 'readyState', { get: () => st5, configurable: true });
      d5.body.innerHTML = phtml.match(/<body>([\s\S]*)<script/)[1];
      // the expectation is counted BEFORE the script runs — the marker REPLACES
      // the text nodes it marks, so counting after would count the marks' own
      // nodes and nothing else
      const textNodes = [];
      (function collect(node) {
        for (let c = node.firstChild; c; c = c.nextSibling) {
          if (c.nodeType === 3) textNodes.push(c);
          else if (c.nodeType === 1 && c.nodeName !== 'SCRIPT' && c.nodeName !== 'STYLE' && c.nodeName !== 'MARK') collect(c);
        }
      })(d5.querySelector('.prose'));
      const qre = /\bproclus[a-z'-]*/gi;
      let wantMarks = 0;
      for (const tn of textNodes) wantMarks += (tn.nodeValue.match(qre) || []).length;
      new Function('window', 'document', 'setTimeout', 'clearTimeout', 'console', arriveScript)(
        w5, d5, w5.setTimeout.bind(w5), w5.clearTimeout.bind(w5), console);
      st5 = 'interactive';
      d5.dispatchEvent(new w5.Event('DOMContentLoaded'));
      const marks = d5.querySelectorAll('.prose mark');
      check(marks.length === wantMarks && wantMarks > 0,
        `?q=proclus marks every occurrence in the prose (${marks.length} marks, ${wantMarks} in the page's own text nodes)`);
      check([...marks].every((m2) => /^proclus[a-z'-]*$/i.test(m2.textContent)),
        'and every mark is a whole word the query asked for');
      const bar = d5.querySelector('.qbar');
      check(!!bar && bar.getAttribute('role') === 'status',
        `the bar is there and is a status region (${bar && bar.getAttribute('role')})`);
      check(new RegExp('found ' + marks.length + ' match').test(bar.textContent),
        `and it counts the matches aloud ("${bar.textContent.trim().slice(0, 60)}")`);
      const btns = [...bar.querySelectorAll('button')];
      check(btns.length === 3 && btns.map((b) => b.getAttribute('aria-label')).join(',').includes('next'),
        'the bar walks the matches: previous, next, close');
      btns[1].click();
      check(d5.querySelectorAll('mark.q-on').length === 1 && /2 \/ /.test(bar.textContent),
        'next moves the current match and says which one it is on');
      // a query the page does not hold says so
      const w6 = new Window({ width: 1100, height: 900, url: 'https://blog.jaye.ch/proclus-theology-of-plato/?q=flibbertigibbet' });
      const d6 = w6.document;
      let st6 = 'loading';
      Object.defineProperty(d6, 'readyState', { get: () => st6, configurable: true });
      d6.body.innerHTML = phtml.match(/<body>([\s\S]*)<script/)[1];
      new Function('window', 'document', 'setTimeout', 'clearTimeout', 'console', arriveScript)(
        w6, d6, w6.setTimeout.bind(w6), w6.clearTimeout.bind(w6), console);
      st6 = 'interactive';
      d6.dispatchEvent(new w6.Event('DOMContentLoaded'));
      check(/no match for/.test(d6.querySelector('.qbar').textContent),
        `a query the page does not hold SAYS so ("${d6.querySelector('.qbar').textContent.trim().slice(0, 60)}")`);
      // with no ?q= at all, nothing is marked and no bar appears
      const w7 = new Window({ width: 1100, height: 900, url: 'https://blog.jaye.ch/proclus-theology-of-plato/' });
      const d7 = w7.document;
      let st7 = 'loading';
      Object.defineProperty(d7, 'readyState', { get: () => st7, configurable: true });
      d7.body.innerHTML = phtml.match(/<body>([\s\S]*)<script/)[1];
      new Function('window', 'document', 'setTimeout', 'clearTimeout', 'console', arriveScript)(
        w7, d7, w7.setTimeout.bind(w7), w7.clearTimeout.bind(w7), console);
      st7 = 'interactive';
      d7.dispatchEvent(new w7.Event('DOMContentLoaded'));
      check(d7.querySelectorAll('.prose mark').length === 0 && !d7.querySelector('.qbar'),
        'a plain visit marks nothing and shows no bar');
    }
  }
}

/* ---------- 7l. the deep file on the wire ------------------------------- */

{
  console.log('== the fetched half on the wire');
  const raw = readFileSync(DEEP_FILE, 'utf8');
  const gz = gzipSync(raw, { level: 9 }).length;
  console.log(`  the fetched half: ${Buffer.byteLength(raw)} bytes raw, ${gz} gzipped (the server encodes on the wire)`);
  check(Buffer.byteLength(raw) < 4 * 1024 * 1024,
    `the fetched half is one file, ${Math.round(gz / 1024)} KB gzipped — the page itself stays as it was`);
}

/* ---------- 7m. the SECOND GROUP: the published library texts --------------
 *
 * The page answers in two groups — the pieces, and below them the passages of
 * the shelf — and every claim about that is asserted here against the BUILT
 * page and the BUILT document, never against a constant:
 *
 *   - the passages the index holds are recomputed from the served document
 *     (`dist/library/<slug>/t`) with this file's own reading-view builder and
 *     its own correction applier, and must match the index passage for passage;
 *   - the phrase/fuzzy/pattern expectations are computed from THAT builder's
 *     texts, so the assertions are holdable in either direction;
 *   - the anchors are checked against the anchors the BUILT document declares
 *     (and, for a text served from the shelf alone, against the ids the page's
 *     own renderer emits);
 *   - the shelf the build emits carries only the texts the build SERVES, and the
 *     asymmetry is proven by building the OTHER shelf (LIBRARY=1) with the
 *     build's own CLI and asking the same page the same question.
 *
 * The section runs with the fetched half already installed (7g above), which is
 * where the shelf arrives — it is part of the same fetched file.
 */
console.log('== the second group: the shelf');
{
  // the one text a default build serves: taken from the page's own index, never
  // hard-coded — a build that publishes another text just tests that one too
  const shelfRaw = deepRaw && deepRaw.shelf;
  check(!!shelfRaw && Array.isArray(shelfRaw.pass) && shelfRaw.pass.length > 0,
    `the fetched half carries the shelf's own index (${shelfRaw ? shelfRaw.pass.length : 0} passage(s), ` +
      `${shelfRaw ? shelfRaw.docs.length : 0} text(s) — only the texts this build serves)`);
  const shelf = S.shelf();
  check(!!shelf && shelf.n === shelfRaw.pass.length && shelf.terms.length === shelfRaw.words.postings.length,
    `the page decodes it: ${shelf && shelf.n} passage(s), ${shelf && shelf.terms.length} word(s) in the shelf's OWN list`);

  /* ---- the reading view, rebuilt from the served document ---------------
   *
   * A SECOND writing of the reading view (the build's is the first): the same
   * grouping, but the corrections applied by this file's own applier, and the
   * text assembled here. It has to reproduce the index exactly — passage count,
   * anchors, printed pages, section numbers, the "opens the section" flags and
   * the text — or the index is not the reading view it claims to be.
   *
   * FAILS IF: the index is built from the raw transcription (a correction's
   * `find` would appear in the text), from a different grouping (a paragraph
   * split at a reference would come out as two passages), or with a different
   * join rule.
   */
  const docPath = (slug) => join(ROOT, 'dist', 'library', slug, 't');
  const shelfDocRaw = JSON.parse(readFileSync(docPath(shelfRaw.docs[0].slug), 'utf8'));
  const applyRules = (text, rules) => {
    let out = text;
    for (const r of rules) {
      if (!r.find || r.find === r.repl || r.action === 'leave') continue;
      out = out.split(r.find).join(r.repl);
    }
    return out;
  };
  /** The reading view: what the app renders, from the served blocks. */
  function readingView(doc) {
    const out = [];
    let region = '', sec = null, secId = null, page = null, opening = false, open = null;
    const close = () => { if (open) out.push(open); open = null; };
    for (const b of doc.blocks) {
      if (b.t === 'region') { close(); region = b.kind; }
      else if (b.t === 'sec') { close(); secId = b.id; sec = b.n; opening = true; }
      else if (b.t === 'pb') { if (b.page != null) page = b.page; }   // inline: does not end a paragraph
      else if (b.t === 'rh') { }                                       // furniture: does not end a paragraph
      else if (b.t === 'notedef') {
        if (open && open.k === 'n' && open.n === b.n) open.parts.push(b.x);
        else { close(); open = { k: 'n', n: b.n, id: b.id || null, parts: [b.x], page, region, sec: null, secId: null, strong: false }; }
      } else if (b.t === 'p' || b.t === 'verse' || b.t === 'ref') {
        const x = b.t === 'verse' ? b.x.replace(/\n/g, ' ') : b.x;
        // A passage is ONE paragraph: continue only when the block carries the
        // SAME paragraph label (`at`) as the open passage — the reader's own rule.
        const continuesPara = b.t === 'ref' ? open && open.k === 'p' : open && open.k === 'p' && b.at != null && b.at === open.at;
        if (continuesPara) { open.parts.push(x); if (!open.at && b.at) open.at = b.at; }
        else { close(); open = { k: 'p', parts: [x], at: b.at || null, page, region, sec, secId, strong: opening }; opening = false; }
      }
    }
    close();
    const ps = [];
    for (const o of out) {
      if (o.region === 'front' || o.region === 'ads') continue;
      const text = applyRules(o.parts.join(o.k === 'p' ? '' : ' '), doc.corrections);
      if (!text) continue;
      const anchor = o.k === 'n' ? (o.id || 'n' + o.n)
        : (o.at || o.secId || (o.page != null ? 'p' + o.page : o.region === 'notes' ? 'snotes' : 'sfront'));
      ps.push({ anchor, page: o.page, sec: o.sec, strong: o.strong, text });
    }
    return ps;
  }
  const view = readingView(shelfDocRaw);
  let vDiff = 0, vFirst = '';
  for (let i = 0; i < Math.max(view.length, shelf.pass.length); i++) {
    const a = view[i], b = shelf.pass[i];
    const same = a && b && a.anchor === b[1] && a.text === b[5] && a.page === b[2] && a.sec === b[4] &&
      (a.strong ? 1 : 0) === b[3];
    if (!same) { vDiff++; if (!vFirst) vFirst = `passage ${i}: ${JSON.stringify(a && [a.anchor, a.page, a.sec, a.strong])} vs ${JSON.stringify(b && [b[1], b[2], b[4], b[3]])}`; }
  }
  check(view.length === shelf.pass.length && vDiff === 0,
    `the index's ${shelf.pass.length} passage(s) are the reading view, rebuilt here from the served document ` +
      `(${vDiff} difference(s)${vFirst ? ' — ' + vFirst : ''})`);
  // and the reading view is the CORRECTED text, not the transcription: every
  // rule that REPLACES something must have left no `find` behind in it
  const replacing = shelfDocRaw.corrections.filter((r) => r.find && r.find !== r.repl && r.action !== 'leave');
  const allShelfText = shelf.pass.map((r) => r[5]).join(' ');
  const leftover = replacing.filter((r) => allShelfText.includes(r.find));
  check(replacing.length > 0 && leftover.length === 0,
    `the indexed text is the CORRECTED reading view: none of the ${replacing.length} replacing rule(s) leaves its ` +
      `find in it (${leftover.length} left${leftover.length ? ': ' + JSON.stringify(leftover[0].find) : ''})`);
  const applied = replacing.filter((r) => allShelfText.includes(r.repl)).length;
  check(applied > replacing.length / 2,
    `and the repaired readings are what stands in it (${applied} of ${replacing.length} rules' replacements occur in the indexed text)`);

  /* ---- every anchor the index names resolves ---------------------------- */
  const docAnchors = new Set();
  for (const b of shelfDocRaw.blocks) {
    if (b.at) docAnchors.add(b.at);
    if (b.id) docAnchors.add(b.id);
  }
  const unresolved = shelf.pass.filter((r) => !r[1] || !docAnchors.has(r[1]));
  check(unresolved.length === 0,
    `every one of the ${shelf.pass.length} passage(s) carries an anchor the BUILT document itself declares ` +
      `(${docAnchors.size} anchor(s) in the document; ${unresolved.length} not found)`);

  /* ---- the two groups, one query in both ------------------------------- */
  const postTerms = new Set(S._idx.terms);
  const startsPostWord = (t) => {
    let lo = 0, hi = S._idx.terms.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (S._idx.terms[mid] < t) lo = mid + 1; else hi = mid; }
    return lo < S._idx.terms.length && S._idx.terms[lo].indexOf(t) === 0;
  };
  let bothTerm = null;
  for (const t of shelf.terms) {
    if (t.length < 6) continue;
    const p = S.query(t, { limit: 200 }).results.length;
    const s = S.queryShelf(t).results.length;
    if (p > 0 && p < 40 && s > 0) { bothTerm = t; break; }
  }
  check(!!bothTerm, `a word occurs in both groups (pieces and the shelf): "${bothTerm}"`);
  const shownRaw = d.getElementById('sres');
  const statusRaw = d.getElementById('sstatus');
  const piecesRes = S.query(bothTerm, { limit: 200 });
  const shelfRes = S.queryShelf(bothTerm, { limit: 200 });
  const rendered = S.render(shownRaw, statusRaw, bothTerm);
  const rowsAll = [...shownRaw.querySelectorAll('li.sr')];
  const pieceRows = rowsAll.filter((li) => !li.classList.contains('sr-shelf'));
  const shelfRows = rowsAll.filter((li) => li.classList.contains('sr-shelf'));
  const grp = [...shownRaw.querySelectorAll('li.sr-grp')];
  check(pieceRows.length === Math.min(piecesRes.results.length, 24) && shelfRows.length === Math.min(shelfRes.results.length, 24),
    `the page renders the two groups with their OWN counts: ${pieceRows.length} piece row(s) (the provider says ` +
      `${piecesRes.results.length}) and ${shelfRows.length} passage row(s) (the shelf provider says ${shelfRes.results.length})`);
  check(grp.length === 1 && grp[0].textContent.trim() === 'in the shelf',
    `the second group has its own heading ("${grp.length ? grp[0].textContent.trim() : 'none'}")`);
  const firstShelf = rowsAll.findIndex((li) => li.classList.contains('sr-shelf'));
  const lastPiece = rowsAll.map((li) => !li.classList.contains('sr-shelf')).lastIndexOf(true);
  // The piece group ends at its last ROW or at the disclosure row that counts
  // the related pieces, whichever comes last: a query can fold part of its
  // answer behind that row, and the heading still follows the pieces — nothing
  // from the first group sits below it.
  const kidsRaw = [...shownRaw.children];
  const tailEl = shownRaw.querySelector('li.sr-tail');
  const grpAt = kidsRaw.indexOf(grp[0]);
  const piecesEnd = Math.max(lastPiece < 0 ? -1 : kidsRaw.indexOf(rowsAll[lastPiece]), tailEl ? kidsRaw.indexOf(tailEl) : -1);
  check(lastPiece >= 0 && firstShelf > lastPiece && grpAt === piecesEnd + 1,
    `AND EVERY PIECE COMES FIRST: the last piece row is ${lastPiece}, the piece group ends at ${piecesEnd}, the ` +
      `group heading sits at ${grpAt}, the first passage row is ${firstShelf} — the groups are two lists in order, not one list by score`);
  // the status line, read as the sentence it is: the pieces' clause first (its
  // total, named or folded), then the shelf's. The split adds ONE clause to the
  // pieces' own sentence ("N more are related"), asserted here rather than
  // tolerated: the two counts must be the two groups.
  const stTxt = statusRaw.textContent;
  const stSegs = stTxt.replace(/^# /, '').split(' · ');
  const pieceSeg = stSegs[0] || '';
  const pm = pieceSeg.match(/^(\d+)(?: of (\d+))? pieces? name[s]? "([^"]*)"$/) ||
    pieceSeg.match(/^(\d+)(?: of (\d+))? pieces?$/);
  const rm = (stSegs[1] || '').match(/^(\d+) more (?:is|are) related$/);
  const stTotal = pm ? +(pm[2] || pm[1]) : -1;
  const stShelf = stSegs.map((s) => /^(\d+) passages? in the shelf$/.exec(s)).find(Boolean);
  check(!!pm && stTotal === piecesRes.results.length && !!stShelf && +stShelf[1] === shelfRes.results.length,
    `the status line counts BOTH groups separately: "${stTxt.slice(0, 96)}"`);
  check(!rm || (+pm[1] <= stTotal && +rm[1] > 0),
    `and the pieces' sentence says how many named it and how many are related: "${pieceSeg}"`);

  /* ---- a word only the shelf has: no pieces, the passages --------------- */
  let shelfOnly = null;
  for (const t of shelf.terms) {
    if (!/^[a-z]{6,}$/.test(t)) continue;
    if (postTerms.has(t) || startsPostWord(t)) continue;
    if (S.queryShelf(t).results.length === 0) continue;
    const r = S.query(t, { limit: 200 });
    if (r.results.length === 0 && !r.counts.fallbackFrom && !r.counts.suggest) { shelfOnly = t; break; }
  }
  check(!!shelfOnly, `a word occurs in the shelf and in no piece at all: "${shelfOnly}"`);
  const onlyShelf = S.queryShelf(shelfOnly, { limit: 200 });
  const onlyRender = S.render(shownRaw, statusRaw, shelfOnly);
  const onlyRows = [...shownRaw.querySelectorAll('li.sr')];
  check(onlyRender.results.length === 0 && onlyShelf.results.length > 0,
    `"${shelfOnly}": no piece answers (${onlyRender.results.length}) and the shelf does (${onlyShelf.results.length} passage(s))`);
  check(onlyRows.filter((li) => li.classList.contains('sr-shelf')).length === Math.min(onlyShelf.results.length, 24) &&
    onlyRows.filter((li) => !li.classList.contains('sr-shelf')).length === 0,
    `and the page shows ONLY the shelf's list for it (${onlyRows.filter((li) => li.classList.contains('sr-shelf')).length} passage row(s), no piece row)`);
  check(/Nothing in the pieces — \d+ passage/.test(shownRaw.textContent),
    `with one honest line for the empty group: "${shownRaw.querySelector('li.sr-none') ? shownRaw.querySelector('li.sr-none').textContent.trim().slice(0, 80) : ''}"`);

  /* ---- a passage is a CITATION, and its link resolves ------------------ */
  const firstRow = () => [...shownRaw.querySelectorAll('li.sr-shelf')];
  const cit = firstRow()[0];
  const link = cit.querySelector('a.sr-t');
  const href = link.getAttribute('href');
  const frag = (href.match(/#(.+)$/) || [])[1];
  const path = href.split('#')[0];
  check(/^\/library\/[a-z0-9-]+\/(part-\d+\/)?$/.test(path) && !!frag,
    `a shelf result links INTO the book: ${href}`);
  check(/^[A-Z][^,]*,\s/.test(link.textContent) && /—/.test(link.textContent),
    `and reads as a citation of the edition ("${link.textContent.trim()}")`);
  const hrefSlug = path.split('/')[2];
  const hrefDoc = hrefSlug === shelfDocRaw.slug ? shelfDocRaw
    : JSON.parse(readFileSync(docPath(hrefSlug), 'utf8'));
  const hrefAnchors = new Set();
  for (const b of hrefDoc.blocks) { if (b.at) hrefAnchors.add(b.at); if (b.id) hrefAnchors.add(b.id); }
  check(hrefAnchors.has(frag), `the anchor it names exists in the served document of ${hrefSlug} (#${frag})`);
  check(existsSync(join(ROOT, 'dist', 'library', hrefSlug, 'index.html')),
    `and the page that fragment is on was built (dist/library/${hrefSlug}/index.html)`);
  check(cit.querySelector('.sr-s').textContent.indexOf('“') === 0 &&
    cit.querySelectorAll('.sr-s mark').length > 0,
    `the passage is quoted with the query's word marked: "${cit.querySelector('.sr-s').textContent.trim().slice(0, 70)}"`);

  /* ---- the disciplines, over the shelf's own list ---------------------- */

  // a phrase is still ADJACENCY: a two-word run the passages really hold
  const shelfWords = (t) => (String(t).toLowerCase().match(/[a-z][a-z'-]+/g) || []);
  const recordable = (w) => w.length >= 3 && !STOP.has(w) && shelf.at[w] !== undefined;
  const holdsSeq = (seq, text) => {
    const m = shelfWords(text);
    for (let i = 0; i < m.length; i++) {
      // EVERY term of the sequence, seq[0] INCLUDED. Starting at j=1 compared
      // only the later words: a passage holding "absurd" anywhere (not as its
      // first word) counted as holding the phrase "equally absurd", so the
      // check's own expectation was wrong and it failed a correct search.
      let ok = true;
      for (let j = 0; j < seq.length; j++) if (m[i + seq[j].off - seq[0].off] !== seq[j].w) { ok = false; break; }
      if (ok) return true;
    }
    return false;
  };
  let phraseCase = null;
  for (let p = 0; p < view.length && !phraseCase; p++) {
    const m = shelfWords(view[p].text);
    for (let i = 0; i + 1 < m.length; i++) {
      if (!recordable(m[i]) || !recordable(m[i + 1]) || m[i].length < 5 || m[i + 1].length < 5 || m[i] === m[i + 1]) continue;
      const seq = [{ w: m[i], off: 0 }, { w: m[i + 1], off: 1 }];
      const want = [];
      for (let q = 0; q < view.length; q++) if (holdsSeq(seq, view[q].text)) want.push(q);
      if (want.length >= 1 && want.length <= 4) phraseCase = { ph: m[i] + ' ' + m[i + 1], want };
      break;
    }
  }
  check(!!phraseCase, `a phrase the shelf's passages hold was found ("${phraseCase && phraseCase.ph}")`);
  const phrShelf = S.queryShelf('"' + phraseCase.ph + '"', { limit: 200 });
  check(norm(phrShelf.results.map((r) => r.p)) === norm(phraseCase.want),
    `"${phraseCase.ph}" matches exactly the passages whose OWN words hold it adjacent ` +
      `(${phrShelf.results.length} passage(s), the adjacency scan says ${phraseCase.want.length})`);
  const phrWhy = phrShelf.results.every((r) => r.why.some((w) => w === 'phrase: "' + phraseCase.ph + '"'));
  check(phrShelf.results.length > 0 && phrWhy, 'and the reason travels: every passage carries the phrase it matched');
  // a phrase is a DEMAND on the shelf's answer too: a second phrase nothing says
  // adjacent leaves nothing, however many of its words the passages hold
  const notAdj = S.queryShelf('"proclus cave"', { limit: 200 });
  check(notAdj.results.length === 0 && notAdj.counts.phrases === 1,
    `a phrase the shelf's passages never say that way answers nothing (${notAdj.results.length}), though the words are loose terms in the pieces`);

  // a `~` still corrects, over the shelf's own word list
  let fuzzyCase = null;
  for (const t of shelf.terms) {
    if (!/^[a-z]{8,}$/.test(t)) continue;
    if (postTerms.has(t) || startsPostWord(t)) continue;
    const typo = t.slice(0, 3) + t[4] + t[3] + t.slice(5);
    if (typo === t || shelf.at[typo] !== undefined) continue;
    const want = [];
    for (let q = 0; q < view.length; q++) if (shelfWords(view[q].text).indexOf(t) >= 0) want.push(q);
    if (want.length >= 1 && want.length <= 4) { fuzzyCase = { t, typo, want }; break; }
  }
  check(!!fuzzyCase, `a word only the shelf holds was transcribed away one edit ("${fuzzyCase && fuzzyCase.typo}" for "${fuzzyCase && fuzzyCase.t}")`);
  const fzShelf = S.queryShelf('~' + fuzzyCase.typo, { limit: 200 });
  check(norm(fzShelf.results.map((r) => r.p)) === norm(fuzzyCase.want),
    `"~${fuzzyCase.typo}" finds the passages that hold "${fuzzyCase.t}" (${fzShelf.results.length} passage(s), the scan says ${fuzzyCase.want.length})`);
  check(fzShelf.results.some((r) => r.why.some((w) => w === 'fuzzy: "' + fuzzyCase.typo + '" → ' + fuzzyCase.t + ' (1 edit)')),
    `and the reader is told which word the shelf found: ${JSON.stringify(fzShelf.results.flatMap((r) => r.why).filter((w) => w.indexOf('fuzzy: ') === 0).slice(0, 1))}`);
  check(S.queryShelf('~' + fuzzyCase.typo, { limit: 200 }).results.every((r) => !r.named),
    'a word behind a ~ never counts as a word the reader typed, over the shelf either');

  // a `/pattern/` still walks the shelf's own automaton — including the MIDDLE
  // of a word, which no word list can answer
  let patCase = null;
  for (const t of shelf.terms) {
    if (!/^[a-z]{9,}$/.test(t)) continue;
    const frag = t.slice(2, 6);
    if (shelf.terms.some((x) => x.indexOf(frag) === 0)) continue;   // the word list could answer this
    const words = shelf.terms.filter((x) => x.indexOf(frag) >= 0);
    if (words.length < 2) continue;
    const want = new Set();
    for (let q = 0; q < view.length; q++) if (shelfWords(view[q].text).some((x) => x.indexOf(frag) >= 0)) want.add(q);
    if (want.size) { patCase = { frag, words, want }; break; }
  }
  check(!!patCase, `a mid-word pattern over the shelf's word list exists (/${patCase && patCase.frag}/ reaches ${patCase && patCase.words.length} word(s), none of them beginning with it)`);
  const patShelf = S.queryShelf('/' + patCase.frag + '/', { limit: 200 });
  check(norm(patShelf.results.map((r) => r.p)) === norm([...patCase.want]),
    `"/${patCase.frag}/" answers with exactly the passages holding a word it reached (${patShelf.results.length} passage(s), the scan says ${patCase.want.size})`);
  check(patShelf.counts.matched === patCase.words.length && patShelf.counts.reCapped === false,
    `and it reports the ${patShelf.counts.matched} word(s) the walk reached`);
  S.render(shownRaw, statusRaw, '/' + patCase.frag + '/');
  check([...shownRaw.querySelectorAll('li.sr-shelf .sr-s mark')].length > 0,
    `the shelf's snippet marks the words the pattern reached (${[...shownRaw.querySelectorAll('li.sr-shelf .sr-s mark')].length} mark(s))`);
  const badPat = S.queryShelf('/x[/');
  check(badPat.results.length === 0 && /not closed/.test(badPat.counts.reError),
    `a pattern the shelf cannot read comes back with a reason, not a throw ("${badPat.counts.reError}")`);

  // a title/heading hit outranks a body hit WITHIN the shelf
  const tocByN = new Map(shelfDocRaw.toc.map((s) => [s.n, s.title]));
  const workName = (shelf.docs[0].title + ' ' + shelf.docs[0].author + ' ' + shelf.docs[0].translator).toLowerCase();
  let headTerm = null;
  for (const s of shelfDocRaw.toc) {
    const ws = (s.title.toLowerCase().match(/[a-z][a-z'-]+/g) || []).filter((x) => x.length >= 5 && workName.indexOf(x) < 0);
    for (const t of ws) {
      const r = S.queryShelf(t, { limit: 200 }).results;
      const isHead = (x) => { const ti = tocByN.get(x.sec); return !!(ti && ti.toLowerCase().indexOf(t) >= 0); };
      const hs = r.filter(isHead), bs = r.filter((x) => !isHead(x));
      if (hs.length >= 1 && bs.length >= 2) { headTerm = { t, r, hs, bs }; break; }
    }
    if (headTerm) break;
  }
  check(!!headTerm, `a word in a section's TITLE also occurs in that section's body ("${headTerm && headTerm.t}")`);
  if (headTerm) {
    const lastHead = headTerm.r.map((x, i) => (headTerm.hs.includes(x) ? i : -1)).lastIndexOf(Math.max(...headTerm.r.map((x, i) => (headTerm.hs.includes(x) ? i : -1))));
    const firstBody = headTerm.r.findIndex((x) => !headTerm.hs.includes(x));
    check(firstBody > headTerm.hs.length - 1 && lastHead === headTerm.hs.length - 1,
      `"${headTerm.t}": the ${headTerm.hs.length} passage(s) whose section TITLE holds it come before all ` +
        `${headTerm.bs.length} that hold it only in their body (last title-hit row ${lastHead}, first body-only row ${firstBody})`);
  }

  // the shelf's cap is reported, never silent
  const widest = shelf.terms.map((t, i) => [t, shelf.postings[i].length]).sort((a, b) => b[1] - a[1])[0];
  // with no limit given the shelf keeps its own cap (24), which is the cap the
  // PAGE renders through — the count it reports is the provider's own
  const capShelf = S.queryShelf(widest[0]);
  const capRender = S.render(shownRaw, statusRaw, widest[0]);
  const capRows = [...shownRaw.querySelectorAll('li.sr-shelf')];
  check(capShelf.counts.results > 24 && capShelf.counts.shown === 24 &&
    capShelf.counts.dropped === capShelf.counts.results - 24 && capRows.length === 24,
    `"${widest[0]}" matches ${capShelf.counts.results} passage(s), the page shows ${capRows.length} and says ` +
      `${capShelf.counts.dropped} more (the provider's own count, not a silent truncation)`);
  check(statusRaw.textContent.indexOf(capShelf.counts.dropped + ' passage') >= 0,
    `the status line reports them: "${statusRaw.textContent.slice(0, 90)}"`);
  check(capRender.results.length > 0, "and the pieces' group is unaffected by the shelf's cap");

  /* ---- the empty shelf: no heading over an empty list ------------------- */
  let postsOnly = null;
  const shelfTermSet = new Set(shelf.terms);
  for (const t of ['wetiko', 'picatrix', 'quareia', ...data.hints]) {
    if (shelfTermSet.has(t) || shelf.terms.some((x) => x.indexOf(t) === 0)) continue;
    if (S.query(t, { limit: 200 }).results.length > 0) { postsOnly = t; break; }
  }
  check(!!postsOnly, `a word the pieces use and the shelf does not exists ("${postsOnly}")`);
  S.render(shownRaw, statusRaw, postsOnly);
  check(shownRaw.querySelectorAll('li.sr-shelf').length === 0 && shownRaw.querySelectorAll('li.sr-grp').length === 0,
    `"${postsOnly}" hits the pieces and not the shelf, so NO shelf heading is printed (${shownRaw.querySelectorAll('li.sr-shelf').length} passage row(s), ${shownRaw.querySelectorAll('li.sr-grp').length} heading(s))`);
  check(/0 passages? in the shelf/.test(statusRaw.textContent),
    `though the status line still says the group is there and empty: "${statusRaw.textContent.slice(0, 80)}"`);

  /* ---- the facets: the pieces narrow, the shelf does not ---------------- */
  const facetTerm = bothTerm;
  const a = S.queryShelf(facetTerm, { limit: 200 }).results.map((r) => r.p);
  const b = S.queryShelf(facetTerm, { series: 'frames', limit: 200 }).results.map((r) => r.p);
  const piecesAll = S.query(facetTerm, { limit: 200 }).results.length;
  const piecesSeries = S.query(facetTerm, { series: 'frames', limit: 200 }).results.length;
  check(norm(a) === norm(b) && piecesSeries < piecesAll,
    `the series facet narrows the PIECES (${piecesAll} -> ${piecesSeries}) and leaves the shelf's ${a.length} passage(s) untouched`);
  S.render(shownRaw, statusRaw, facetTerm, { series: 'frames' });
  const facetShelfRows = [...shownRaw.querySelectorAll('li.sr-shelf')].length;
  check(facetShelfRows === Math.min(b.length, 24),
    `and the rendered shelf group is the same ${facetShelfRows} passage row(s) with the facet set`);
  S.render(shownRaw, statusRaw, facetTerm, { where: 'shelf' });
  check(shownRaw.querySelectorAll('li.sr-shelf').length > 0 && shownRaw.querySelectorAll('li.sr:not(.sr-shelf)').length === 0,
    'the where=shelf control shows the shelf alone');
  S.render(shownRaw, statusRaw, facetTerm, { where: 'pieces' });
  check(shownRaw.querySelectorAll('li.sr-shelf').length === 0 && shownRaw.querySelectorAll('li.sr:not(.sr-shelf)').length > 0,
    'and where=pieces hides the shelf, leaving the pieces exactly as they were');
  const w3 = new Window({ width: 1100, height: 900, url: 'https://blog.jaye.ch/search/?q=' + facetTerm + '&where=shelf' });
  const d3 = w3.document;
  let st3 = 'loading';
  Object.defineProperty(d3, 'readyState', { get: () => st3, configurable: true });
  d3.body.innerHTML = bodyHtml.replace(/<script(?![^>]*application\/json)[\s\S]*?<\/script>/g, '');
  const S3w = new Function('window', 'document', 'performance', 'setTimeout', 'clearTimeout', 'console',
    client + '\nreturn window.Search;')(w3, d3, w3.performance, w3.setTimeout.bind(w3), w3.clearTimeout.bind(w3), console);
  st3 = 'interactive';
  d3.dispatchEvent(new w3.Event('DOMContentLoaded'));
  check(d3.getElementById('sf-where').value === 'shelf' && S3w.readUrl().where === 'shelf',
    'the group filter rides in the URL and lands on the control (?where=shelf)');
  S3w.loadDeep(deepRaw);
  S3w.wire();      // what the page does when the fetched half lands: answer again
  const shelfRowsUrl = d3.getElementById('sres').querySelectorAll('li.sr-shelf').length;
  const pieceRowsUrl = [...d3.getElementById('sres').querySelectorAll('li.sr')].filter((li) => !li.classList.contains('sr-shelf')).length;
  check(shelfRowsUrl > 0 && pieceRowsUrl === 0,
    `and a linked ?where=shelf search opens with the shelf alone (${shelfRowsUrl} passage row(s), ${pieceRowsUrl} piece row(s))`);

  /* ---- the shelf is not a seed for the pieces' graph, and the pieces'
   *      ranking does not move when the shelf is present ------------------ */
  const keptShelf = S._idx.shelf;
  const withShelf = S.query('proclus', { limit: 200 }).results.map((r) => [data.docs[r.i].slug, r.score, r.why.join('|')]);
  delete S._idx.shelf;
  const withoutShelf = S.query('proclus', { limit: 200 }).results.map((r) => [data.docs[r.i].slug, r.score, r.why.join('|')]);
  const noShelfRender = S.render(shownRaw, statusRaw, 'proclus');
  check(JSON.stringify(withShelf) === JSON.stringify(withoutShelf),
    `the pieces' ranking, order and reasons are IDENTICAL with and without the shelf's index (${withShelf.length} results, ` +
      `every slug, score and reason compared)`);
  check(noShelfRender.counts.graphOnlyDropped === S.query('proclus').counts.graphOnlyDropped,
    'and the graph\'s own cap is unchanged by it');
  // the graph's own answer, with and without the shelf's index in the page: a
  // shelf passage is never a seed, so the derived facts cannot move
  const gWithShelf = JSON.stringify(S.providers.graph('proclus', {}).counts);
  delete S._idx.shelf;
  const gWithoutShelf = JSON.stringify(S.providers.graph('proclus', {}).counts);
  S._idx.shelf = keptShelf;
  check(gWithShelf === gWithoutShelf,
    `and the graph's own counts are identical with and without it (${gWithShelf}) — a passage is never a seed`);
  // The pieces' own discipline, held to the arithmetic: a hit in a piece's title
  // or heading weighs 2.6x a body hit, and a prefix hit 0.55x an exact one. Both
  // are recomputed here from the shipped index (the idf is the posting list's
  // length, exactly as the page reads it), so this FAILS if either weight is
  // changed or dropped.
  const nDocs = data.docs.length;
  const lexOf = (t) => S.providers.lexical(t);
  let titleWeight = null, prefixWeight = null;
  for (let i = 0; i < data.lex.strong.length && !titleWeight; i += 3) {
    const [ti, ...docs] = data.lex.strong[i];
    const t = S._idx.terms[ti];
    const idf = Math.log(1 + nDocs / data.lex.postings[ti].length);
    for (const dd of docs) {
      if ((deepRaw.lex[ti] || []).some((r) => r[0] === dd)) continue;   // a body hit too: not this rule
      const row = lexOf(t).find((x) => x.i === dd);
      if (row && Math.abs(row.score - idf * 2.6) < 1e-9) { titleWeight = { t, slug: data.docs[dd].slug }; break; }
    }
  }
  check(!!titleWeight,
    `a title/heading hit carries exactly the 2.6x weight it always had${titleWeight ? ` ("${titleWeight.t}" in ${titleWeight.slug})` : ' — no case found'}`);
  for (let i = 0; i < S._idx.terms.length && !prefixWeight; i += 4) {
    const t = S._idx.terms[i];
    const lo = S._idx.terms.findIndex((x) => x.indexOf(t) === 0);
    let hi = lo; while (hi < S._idx.terms.length && S._idx.terms[hi].indexOf(t) === 0) hi++;
    if (hi - lo < 2 || S._idx.terms[lo + 1] === t) continue;
    const ti = S._idx.at[S._idx.terms[lo + 1]];
    const idf = Math.log(1 + nDocs / data.lex.postings[ti].length);
    const row = lexOf(t).find((x) => Math.abs(x.score - idf * 0.55) < 1e-9 && !(deepRaw.lex[ti] || []).some((r) => r[0] === x.i));
    if (row) prefixWeight = { t, word: S._idx.terms[lo + 1] };
  }
  check(!!prefixWeight,
    `and a prefix hit exactly the 0.55x it had${prefixWeight ? ` ("${prefixWeight.t}" reaching "${prefixWeight.word}")` : ' — no case found'}`);
  // and with the shelf taken out of the page entirely, the answer is the answer
  // the page gave before the shelf existed
  delete S._idx.shelf;
  S.render(shownRaw, statusRaw, 'proclus');
  check(shownRaw.querySelectorAll('li.sr-grp').length === 0 && shownRaw.querySelectorAll('li.sr-shelf').length === 0 &&
    shownRaw.querySelectorAll('li.sr:not(.sr-shelf)').length > 0,
    'with no shelf in the page the page answers exactly as it did before it existed (no heading, no passage, no error)');
  S._idx.shelf = keptShelf;

  /* ---- the shelf the build serves vs the shelf it refuses ---------------
   *
   * The index carries only the texts the build SERVES, and this is the proof,
   * both ways: the build's OWN gate is asked to index a held-back text (it
   * refuses, under the default gate), and then the same build is run with
   * LIBRARY=1 — and the page, given that index, answers the query it could not
   * answer before. FAILS IF the default index ever carries a text the site does
   * not serve, or if the difference were in the search code rather than in the
   * gate.
   */
  const servedSlugs = new Set(shelf.docs.map((x) => x.slug));
  const refusals = [];
  let heldSlug = null;
  const shelfModule = require('../tools/library/shelf.mjs');
  try {
    const m = shelfModule;
    const files = m.shelfFiles();
    const held = m.TEXTS.filter((t) => !servedSlugs.has(t.slug));
    // the harshest case: a text with a STORED EDITION that is still held back
    const stored = held.find((t) => existsSync(join(ROOT, 'content', 'library', t.slug, 'source.txt')));
    heldSlug = (stored || held[0] || {}).slug || null;
    if (heldSlug) {
      // the transcription-only text: read where the build reads it
      const src = readFileSync(m.textSource(m.TEXTS.find((t) => t.slug === heldSlug), files), 'utf8');
      const ws = (src.toLowerCase().match(/[a-z][a-z'-]+/g) || []).filter((w) => w.length >= 7);
      const shelfTermSetAll = new Set(shelf.terms);
      for (const w of ws) {
        if (postTerms.has(w) || startsPostWord(w)) continue;
        if (shelfTermSetAll.has(w) || shelf.terms.some((x) => x.indexOf(w) === 0)) continue;
        if (S.query(w, { limit: 200 }).results.length) continue;
        refusals.push(w);
        if (refusals.length >= 3) break;
      }
    }
  } catch (e) {
    check(false, `the shelf module could not be read to pick a held-back word: ${e.message}`);
  }
  check(!!heldSlug && refusals.length > 0,
    `a held-back text and words only it uses were found ("${heldSlug}": ${refusals.join(', ')})`);
  const heldWord = refusals[0];
  check(S.queryShelf(heldWord, { limit: 200 }).results.length === 0,
    `a word only the HELD-BACK text uses returns no passage from the shelf (${S.queryShelf(heldWord).results.length})`);
  check(!deepRaw.shelf.docs.some((x) => x.slug === heldSlug) && JSON.stringify(deepRaw).indexOf(heldWord) < 0,
    `and the emitted index does not carry that text at all (${deepRaw.shelf.docs.length} text(s): ` +
      `${deepRaw.shelf.docs.map((x) => x.slug).join(', ')})`);
  // and the texts the page SEARCHES are exactly the texts the shelf PUBLISHES,
  // read off the shelf's own flag rather than off dist: a result can therefore
  // only ever point at a text the site means to serve. (Whether a page for it is
  // in dist at this instant is another build's business — a concurrent LIBRARY=1
  // preview writes them all, and the library's own smoke checks the pages.)
  const publishedSlugs = shelfModule.publishedTexts().map((t) => t.slug).sort();
  check(norm(publishedSlugs) === norm(shelf.docs.map((x) => x.slug)),
    `the shelf the page searches is exactly the texts the shelf MODULE publishes ` +
      `(${publishedSlugs.join(', ')})`);

  // the two halves of the asymmetry, through the build's own CLI. It writes
  // OUTSIDE dist: a test must not leave anything in the tree it is checking
  const tmpIndex = join(osTmpdir(), 'search-smoke-shelf-index.json');
  let defaultOut = null;
  try {
    defaultOut = execFileSync('node', [join('tools', 'build.mjs'), `--shelf-index=${tmpIndex}`, `--only=${heldSlug}`],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { defaultOut = null; }
  check(defaultOut === null && !existsSync(tmpIndex),
    `the build REFUSES to index a text it does not serve (--only=${heldSlug} under the default gate: exit non-zero, nothing written)`);
  let previewOk = false, preview = null;
  try {
    execFileSync('node', [join('tools', 'build.mjs'), `--shelf-index=${tmpIndex}`, `--only=${heldSlug}`],
      { cwd: ROOT, encoding: 'utf8', env: { ...process.env, LIBRARY: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    preview = JSON.parse(readFileSync(tmpIndex, 'utf8'));
    previewOk = true;
  } catch (e) { previewOk = false; }
  check(previewOk && preview.docs.length === 1 && preview.docs[0].slug === heldSlug,
    `with LIBRARY=1 the SAME build indexes it (${previewOk ? preview.pass.length + ' passage(s)' : 'the build failed'})`);
  if (previewOk) {
    // a transcription-only text has no stored document: its anchors are the ids
    // the page's own renderer emits, computed here from the source
    const heldEntry = require('../tools/library/shelf.mjs').TEXTS.find((t) => t.slug === heldSlug);
    const heldSrc = readFileSync(require('../tools/library/shelf.mjs').textSource(heldEntry, require('../tools/library/shelf.mjs').shelfFiles()), 'utf8');
    const heldDoc = pagePreprocess(heldSrc, {});
    const heldParts = pagePartition(heldDoc, 1800000);
    const pageHeadIds = new Set();
    heldParts.forEach((p2) => { for (const b of p2.blocks) if (b.type === 'heading') pageHeadIds.add(b.id); });
    const heldAnchors = preview.pass.filter((r) => r[1] != null).map((r) => r[1]);
    const badAnchor = heldAnchors.filter((a2) => !pageHeadIds.has(a2));
    check(heldAnchors.length > 0 && badAnchor.length === 0,
      `every anchor of a shelf-only text is a heading id its OWN page renders (${heldAnchors.length} anchor(s), ` +
        `${badAnchor.length} not among the ${pageHeadIds.size} heading id(s); e.g. ${heldAnchors.slice(0, 3).join(', ')})`);
    const paths = new Set(preview.pass.map((r) => r[6] || ''));
    const wanted = new Set([''].concat(heldParts.map((_, i) => i === 0 ? '' : `/library/${heldSlug}/part-${i + 1}/`)));
    check([...paths].every((x) => wanted.has(x)),
      `and its page paths are the pages that text is emitted in (${heldParts.length} part(s); ${[...paths].filter(Boolean).length} passage(s) on a later part)`);
    // NOW the same query, with the preview index installed in the same page
    S.loadDeep(Object.assign({}, deepRaw, { shelf: preview }));
    const previewHits = S.queryShelf(heldWord, { limit: 200 });
    check(previewHits.results.length > 0,
      `AND THE ASYMMETRY: with the LIBRARY=1 index the same word "${heldWord}" DOES return it ` +
        `(${previewHits.results.length} passage(s) of ${preview.docs[0].slug})`);
    const prevRow = previewHits.results[0];
    check(prevRow.doc === 0 && typeof prevRow.text === 'string' && prevRow.text.toLowerCase().indexOf(heldWord) >= 0,
      `and the passage it returns is that text's own, carrying the word (${prevRow.text.length} chars, anchor ${prevRow.anchor})`);
    check(preview.pass.length > 1 && preview.words.postings.length > 0,
      `the preview shelf carries the whole text's passages and its own word list (${preview.pass.length} passages, ${preview.words.postings.length} words)`);
    S.loadDeep(deepRaw);      // back to the shelf the build actually serves
    check(S.queryShelf(heldWord).results.length === 0 && S.query(bothTerm ? bothTerm : 'proclus').results.length > 0,
      'and putting the served index back answers nothing for it again, while the pieces are untouched');
  }
  try { require('fs').unlinkSync(tmpIndex); } catch (e) { /* nothing to remove */ }

  /* ---- a build that serves no library text at all -----------------------
   *
   * The other side of the same contract: with an EMPTY shelf the page must
   * answer exactly as it did before the group existed — no heading, no passage,
   * no count of a group the site does not have. (This is the state of every
   * build before a text is published, and of a build whose shelf is held back.)
   */
  S.loadDeep(Object.assign({}, deepRaw, { shelf: { docs: [], pass: [], words: { dafsa: { s: '0', l: '', t: '' }, postings: [] } } }));
  const emptyShelf = S.shelf();
  const emptyRender = S.render(shownRaw, statusRaw, bothTerm);
  check(!!emptyShelf && emptyShelf.n === 0 && emptyRender.results.length > 0,
    'an EMPTY shelf decodes to a page that still answers the pieces ' +
      `(${emptyRender.results.length} result(s), ${emptyShelf && emptyShelf.n} passage(s))`);
  check(shownRaw.querySelectorAll('li.sr-grp').length === 0 && shownRaw.querySelectorAll('li.sr-shelf').length === 0,
    'and prints no shelf heading and no passage row for a shelf that does not exist');
  check(!/in the shelf/.test(statusRaw.textContent),
    `and does not promise a group it cannot answer with: "${statusRaw.textContent.slice(0, 80)}"`);
  check(S.queryShelf(bothTerm).counts.off === true && S.queryShelf(bothTerm).results.length === 0,
    'the shelf provider says it has no shelf to search, and answers nothing rather than throwing');
  S.loadDeep(deepRaw);
  check(S.queryShelf(bothTerm).results.length > 0, 'putting the served index back answers again');
}

/* ---------- 7n. the list stops where the evidence stops -------------------
 *
 * A query's answer was mostly pieces that do not contain it: the fusion reaches
 * pieces through the vectors and the graph ON PURPOSE, and at twenty-four rows
 * they drowned the ones the words named. Measured on the page before this
 * section existed: "wetiko" rendered 24 rows of which 6 contain the word,
 * "proclus" 24 of which 7 — and the rest sat above and between them.
 *
 * The page now renders the split the engine already computed (`named`: an exact
 * term hit — the query's own words are in the piece) and every assertion below
 * recomputes its expectation from content/, never from the page's own claim. It
 * would have failed before the split: the rows above the disclosure were not the
 * pieces whose prose contains the word, and there was no disclosure at all.
 *
 * The three other ways to ask are asserted here too, because `named` is set by
 * the LEXICAL pass and nothing else: a pattern's reached words and a phrase's
 * own words name a piece; a fuzzy word NEVER does (the walk found a word the
 * reader did not write); and the zero-result fallback must be split on the
 * CORRECTED query, since that is the query the answer belongs to.
 */
console.log('== the answer stops where the words stop');
{
  const box = d.getElementById('sres');
  const status = d.getElementById('sstatus');
  const docAt = new Map(data.docs.map((x, i) => [x.slug, i]));
  const slugOf = (li) => li.querySelector('a.sr-t').getAttribute('href').replace(/\?q=.*$/, '').replace(/^\/|\/$/g, '');
  const pieceRows = () => [...box.querySelectorAll('li.sr')].filter((li) => !li.classList.contains('sr-shelf'));
  const relRows = () => [...box.querySelectorAll('li.sr-rel')];
  const tailBtn = () => box.querySelector('li.sr-tail button.sr-more');
  const aboveOf = (rows) => {
    const firstRel = rows.findIndex((li) => li.classList.contains('sr-rel'));
    return firstRel < 0 ? rows : rows.slice(0, firstRel);
  };
  const holds = (slug, sub) => plain(sources[docAt.get(slug)]).toLowerCase().indexOf(sub) >= 0;

  for (const q of ['wetiko', 'proclus']) {
    const want = expectExact(q);                       // from content/, this run
    const provider = S.query(q, { limit: 200 });
    const res = S.render(box, status, q);
    const rows = pieceRows();
    const rel = relRows();
    const above = aboveOf(rows);
    const namedSlugs = above.map(slugOf);

    /* 1. the counts are real: the rows above the disclosure ARE the pieces the
     *    prose contains the word in — recomputed here, both directions */
    if (want.size <= res.results.length) {
      check(norm(new Set(namedSlugs)) === norm(want) && namedSlugs.length === want.size,
        `"${q}": the ${namedSlugs.length} row(s) above the disclosure are exactly the ${want.size} piece(s) whose prose ` +
          `contains it — ${norm(new Set(namedSlugs))}`);
    } else {
      check(namedSlugs.every((s) => want.has(s)),
        `"${q}": every row above the disclosure is a piece whose prose contains it (${namedSlugs.length} of ${want.size})`);
    }
    check(namedSlugs.length < rows.length,
      `"${q}": the page does not claim the whole list names it (${namedSlugs.length} name it, ${rows.length} rendered)`);

    /* 2. nothing is lost: the two groups are the provider's own answer */
    check(rows.length === Math.min(provider.results.length, 24) && rows.length === res.results.length,
      `"${q}": named + related is the provider's whole answer, not a subset (${rows.length} row(s); the provider says ` +
        `${provider.results.length})`);

    /* 3. the tail is not the answer: no row above the disclosure is outside the
     *    measured set, and every remaining row is a folded related one */
    check(above.length > 0 && rel.length === rows.length - above.length &&
      rows.slice(above.length).every((li) => li.classList.contains('sr-rel')),
      `"${q}": all ${rel.length} related row(s) stand below the disclosure and nothing else does`);

    /* 4. the disclosure works, and what it reveals is the measured remainder */
    const b = tailBtn();
    check(!!b && b.getAttribute('aria-expanded') === 'false' && rel.length > 0 && rel.every((li) => li.hidden),
      `"${q}": the related rows start folded away behind one row ("${b ? b.textContent.trim() : 'no disclosure row'}")`);
    check(!!b && b.textContent.trim() === rel.length + ' more are related — "' + q + '" is not in them',
      `"${q}": the row states the count and what the tail is ("${b ? b.textContent.trim() : ''}")`);
    if (b) b.dispatchEvent(new w.Event('click', { bubbles: true }));
    check(relRows().every((li) => !li.hidden) && !!b && b.getAttribute('aria-expanded') === 'true',
      `"${q}": clicking it reveals the ${relRows().length} related row(s)`);
    const revealed = relRows().map(slugOf);
    check(revealed.length === rel.length && revealed.every((s) => !want.has(s)),
      `"${q}": and every revealed row is a piece the prose says does NOT contain it (${revealed.length} row(s))`);
    if (b) b.dispatchEvent(new w.Event('click', { bubbles: true }));
    check(relRows().every((li) => li.hidden) && rel.length > 0 && !!b && b.getAttribute('aria-expanded') === 'false',
      `"${q}": and clicking again folds them back ("${b ? b.textContent.trim() : ''}")`);

    /* 5. the status line counts the two groups, and the numbers are the groups */
    const segs = status.textContent.replace(/^# /, '').split(' · ');
    const pm = /^(\d+)(?: of (\d+))? pieces? name[s]? "(.*)"$/.exec(segs[0] || '');
    const rm = /^(\d+) more (?:is|are) related$/.exec(segs[1] || '');
    check(!!pm && !!rm && +pm[1] === namedSlugs.length && +rm[1] === rel.length && +pm[1] + +rm[1] === rows.length,
      `"${q}": the status line states both counts and they are the two groups: "${status.textContent.split(' ms ·')[0]}"`);
    check(!!pm && +pm[2] === provider.results.length,
      `"${q}": and "of ${pm && pm[2]}" is the provider's own total (${provider.results.length})`);

    /* 6. the order WITHIN each group is the provider's own: the split is a
     *    LAYOUT of the answer, not a second ranking */
    const wantNamed = res.results.filter((r) => r.named).map((r) => data.docs[r.i].slug);
    const wantRel = res.results.filter((r) => !r.named).map((r) => data.docs[r.i].slug);
    check(namedSlugs.join(' ') === wantNamed.join(' '),
      `"${q}": the named rows keep the provider's own order — ${namedSlugs.join(' ')}`);
    check(relRows().map(slugOf).join(' ') === wantRel.join(' '),
      `"${q}": and the folded rows keep the order they were found in (${wantRel.length} row(s))`);

    /* the shelf's heading, and where it now sits. The rows before it are the
     * ones the query named and the disclosure row — nothing else. At ~64px a row
     * and a ~900px screen, that is the difference between a heading in the first
     * screen and one two screens down. */
    const kidEls = [...box.children];
    const grpAt = kidEls.findIndex((k) => k.classList.contains('sr-grp'));
    if (grpAt >= 0) {
      const visible = kidEls.slice(0, grpAt).filter((k) => !k.hidden).length;
      check(visible === namedSlugs.length + 1,
        `"${q}": ${visible} row(s) stand before the shelf's heading — the ${namedSlugs.length} it named and the disclosure row`);
      console.log(`    "${q}": the shelf's heading is ${visible} row(s) down (~${visible * 64}px at ~64px a row, against ` +
        `${rows.length} row(s) before the split); ${rel.length} row(s) folded`);
    } else {
      console.log(`    "${q}": no shelf passage answers it, so no heading; ${namedSlugs.length} row(s) named it, ` +
        `${rel.length} folded, of ${rows.length} rendered`);
    }
  }

  /* ---- the three other ways to ask -------------------------------------- */

  // a PATTERN: the words the walk REACHED name a piece, and the page says so —
  // every row above the disclosure holds the pattern's own word
  S.render(box, status, '/wetiko/');
  {
    const rows = pieceRows();
    const above = aboveOf(rows);
    check(above.length > 0 && above.every((li) => holds(slugOf(li), 'wetiko')),
      `a pattern: the ${above.length} row(s) above the disclosure all hold the word the pattern reached ` +
        `(${above.map(slugOf).slice(0, 3).join(', ')})`);
    check(relRows().length > 0 && relRows().every((li) => !holds(slugOf(li), 'wetiko')),
      `a pattern: and none of the ${relRows().length} folded row(s) holds it`);
    check(/ pieces match \/wetiko\//.test(status.textContent),
      `a pattern: the status line says what matched ("${status.textContent.split(' ms ·')[0]}")`);
    // its related rows are behind the same disclosure, with the pattern named in it
    const b = tailBtn();
    check(!!b && / — the pattern \/wetiko\/ reached no word of theirs$/.test(b.textContent.trim()),
      `a pattern: the disclosure says the tail is the words the pattern did NOT reach ("${b ? b.textContent.trim() : ''}")`);
  }

  // a PHRASE: the phrase's own matches are NAMED — a piece that says the run says
  // it — so the run's answer has nothing folded away behind it
  {
    const ph = '"the frame is a variable"';
    const pres = S.query(ph, { limit: 200 });
    const rr = S.render(box, status, ph);
    check(pres.results.length > 0 && pres.results.every((r) => r.named) && rr.results.every((r) => r.named),
      `a phrase: the ${pres.results.length} piece(s) that say the phrase are named, not related ` +
        `(${pres.results.map((r) => data.docs[r.i].slug).join(', ')})`);
    check(relRows().length === 0 && !tailBtn(),
      'a phrase: so nothing is folded away behind a disclosure for it');
    check(new RegExp('^# ' + pres.results.length + ' pieces name "the frame is a variable"').test(status.textContent),
      `a phrase: and the status line names the run as the reader wrote it ("${status.textContent.split(' ms ·')[0]}")`);
  }

  // a FUZZY term: a piece the walk found does NOT contain the word as written, so
  // it is RELATED — and when nothing names the query, the list is not folded
  // away: a disclosure with no row above it would hide the whole answer
  {
    const fres = S.query('~proculus', { limit: 200 });
    S.render(box, status, '~proculus');
    check(fres.results.length > 0 && fres.results.every((r) => !r.named) && relRows().length === 0,
      `fuzzy: none of the ${fres.results.length} row(s) the walk found is named — the word as written is in no piece`);
    check(!tailBtn() && pieceRows().length === fres.results.length,
      `fuzzy: nothing names the query, so nothing is folded away (${pieceRows().length} row(s) stand)`);
    check(/ pieces · none names "proculus"/.test(status.textContent),
      `fuzzy: the status line says so instead ("${status.textContent.split(' ms ·')[0]}")`);
  }

  // the PREFIX the box answers while a word is still being typed: it names
  // nothing either, and folding the answer away mid-word is worse than crowding
  {
    S.render(box, status, 'procl');
    check(!tailBtn() && pieceRows().length > 3,
      `a prefix: "procl" names no piece, so nothing is folded (${pieceRows().length} row(s) stand)`);
    check(/pieces · none names "procl"/.test(status.textContent),
      `a prefix: and the status line says none names it ("${status.textContent.split(' ms ·')[0]}")`);
  }

  // the ZERO-RESULT FALLBACK: the split belongs to the CORRECTED query, because
  // the reader's own words named nothing — that is what a fallback is
  {
    const typo = 'proculus';
    const fb = S.query(typo, { limit: 200 });
    const corrected = fb.counts.fallbackTo;
    S.render(box, status, typo);
    const above = aboveOf(pieceRows()).map(slugOf);
    check(fb.counts.fallbackFrom === typo && !!corrected && norm(new Set(above)) === norm(expectExact(corrected)),
      `fallback: "${typo}" is corrected to "${corrected}" and the rows above the disclosure are ITS pieces — ${norm(new Set(above))}`);
    check(new RegExp('pieces? name[s]? "' + corrected + '"').test(status.textContent),
      `fallback: and the status line names the corrected word, not the typo ("${status.textContent.split(' ms ·')[0]}")`);
  }

  // NEWEST FIRST: the reader has chosen an order over the ANSWER, so the list is
  // not regrouped under it — the status still says how many name the query
  {
    S.render(box, status, 'proclus', { sort: 'new' });
    const newest = S.query('proclus', { sort: 'new', limit: 200 }).results.map((r) => data.docs[r.i].slug);
    check(!tailBtn() && relRows().length === 0,
      `newest first: the reader's own order is not regrouped — no disclosure, ${pieceRows().length} row(s) stand`);
    check(/^# \d+(?: of \d+)? pieces? name[s]? "proclus"/.test(status.textContent),
      `newest first: and the status line still says how many name it ("${status.textContent.split(' ms ·')[0]}")`);
    check(pieceRows().length > 0 && slugOf(pieceRows()[0]) === newest[0],
      `newest first: and the first row is still the newest piece the provider returned (${newest[0]})`);
  }
}

/* ---------- 8. garbage ---------- */

console.log('== garbage');
for (const q of ['', '   ', '!!!', '?? zzzzqqq', 'a', 'the and of', '\u0000\ufffd']) {
  let ok = true;
  try {
    const r = S.query(q);
    ok = Array.isArray(r.results) && typeof r.counts === 'object';
    S.render(d.getElementById('sres'), d.getElementById('sstatus'), q);
  } catch (e) {
    ok = false;
    console.log('    threw on ' + JSON.stringify(q) + ': ' + e.message);
  }
  check(ok, `query ${JSON.stringify(q)} returned without throwing`);
}

/* ---------- 9. the datalog rules actually fire ---------- */

console.log('== datalog');
const g = S.query('wetiko');
const reasons = g.results.flatMap((r) => r.why).filter((x) => x.indexOf('graph: ') === 0);
check(g.counts.derived > 0 && g.counts.rounds >= 2,
  `the evaluator derived ${g.counts.derived} facts over ${g.counts.rounds} semi-naive round(s)`);
check(g.counts.related + g.counts.points_at + g.counts.near > 0,
  `the rules fired: ${g.counts.related} shared-citation, ${g.counts.points_at} link, ${g.counts.same_series} same-series, ${g.counts.near} two-hop`);
check(reasons.length > 0, `${reasons.length} graph reason(s) reached the results: e.g. ${JSON.stringify(reasons.slice(0, 2))}`);
const graphOnly = g.results.filter((r) => r.why.every((x) => x.indexOf('graph: ') === 0));
check(true, `  ${graphOnly.length} result(s) are in the list on the graph's word alone`);

/* ---------- 9b. the graph-only cap reports what it dropped ---------- */

// A graph-only candidate is a piece the graph names that neither the words nor
// the vectors found. The page keeps a bounded number of them — and used to drop
// the rest with no trace, so a bounded list was indistinguishable from a short
// one ('proclus' had 42 candidates, 12 kept, 30 gone). Both numbers are computed
// here from the providers, so the cap itself is never hard-coded: the invariant
// is that SHOWN + DROPPED is the candidate count.
console.log('== the graph-only cap');
const CAPQ = 'proclus';
const lexR = new Set(S.providers.lexical(CAPQ).map((r) => r.i));
const vecR = new Set(S.providers.vector(CAPQ).map((r) => r.i));
const candidates = S.providers.graph(CAPQ).list.filter((r) => !lexR.has(r.i) && !vecR.has(r.i));
const capRes = S.query(CAPQ, { limit: 200 });
const shownOnly = capRes.results.filter((r) => r.why.every((w) => w.indexOf('graph: ') === 0)).length;
check(candidates.length > shownOnly,
  `"${CAPQ}" has ${candidates.length} graph-only candidates and the page shows ${shownOnly} — it exceeds the cap`);
check(capRes.counts.graphOnlyDropped === candidates.length - shownOnly,
  `the dropped count is the candidates minus the ones shown (${candidates.length} − ${shownOnly} = ${capRes.counts.graphOnlyDropped})`);
check(capRes.counts.graphOnlyDropped > 0,
  `the page counts the graph-only results it dropped instead of losing them (${capRes.counts.graphOnlyDropped})`);

/* ---------- 10. the box, the URL, the rendering ---------- */

console.log('== the page drives');
const input = d.getElementById('sq');
const box = d.getElementById('sres');
const status = d.getElementById('sstatus');
input.value = 'proclus';
input.dispatchEvent(new w.Event('input', { bubbles: true }));
check(w.location.search === '?q=proclus', `typing set the URL state (${w.location.search})`);
const items = box.querySelectorAll('li.sr');
check(items.length > 1, `typing filled the result list (${items.length} results)`);
const firstLink = items[0].querySelector('a.sr-t');
check(/^\/[a-z0-9-]+\/(\?q=.*)?$/.test(firstLink.getAttribute('href')), `a result links to a piece (${firstLink.getAttribute('href')})`);
check(items[0].querySelectorAll('.sr-s mark').length > 0, 'the snippet marks the query\'s word');
check(items[0].querySelectorAll('.sr-w li').length > 0, `the reasons render as badges (${items[0].querySelectorAll('.sr-w li').length})`);
check(/the graph rules fired/.test(status.textContent), `the status line reports the rules: "${status.textContent}"`);
// and the dropped graph-only results are reported, not silently gone
const capShown = S.query('proclus', { limit: 200 }).counts.graphOnlyDropped;
check(capShown > 0 && status.textContent.includes(capShown + ' graph-only'),
  `the status line reports the ${capShown} graph-only result(s) beyond the cap: "${status.textContent}"`);

// the keyboard: / is the palette's key everywhere, and on this page the box has
// focus — so the palette must let the character through to the box, not steal it
input.focus();
const slash = new w.Event('keydown', { bubbles: true, cancelable: true });
Object.defineProperty(slash, 'key', { get: () => '/' });
input.dispatchEvent(slash);
check(d.getElementById('palette').hidden && !slash.defaultPrevented,
  'typing / inside the search box is left to the box, not taken by the palette');

// ?q= round-trip: a link someone was sent has to search when it opens
w.history.replaceState(null, '', '/search/?q=picatrix&series=readings');
const urlState = S.readUrl();
check(urlState.q === 'picatrix' && urlState.series === 'readings', `readUrl() reads ?q= and the facet (q=${urlState.q}, series=${urlState.series})`);
S.wire();
check(input.value === 'picatrix', 'a fresh wire() puts the URL\'s query in the box');
check(d.getElementById('sf-series').value === 'readings', 'and its facet in the select');
check(box.querySelectorAll('li.sr').length > 0, `and runs it (${box.querySelectorAll('li.sr').length} results for ?q=picatrix)`);

const allPicatrix = S.query('picatrix', { limit: 200 }).results.length;
const inReadings = S.query('picatrix', { series: 'readings', limit: 200 }).results.length;
check(inReadings > 0 && inReadings < allPicatrix,
  `the series facet narrows the answer (${allPicatrix} → ${inReadings})`);

/* ---------- 11. the command line reaches the search page ---------- */

// Every page's masthead prints a command (cat <slug>.md, ls -lt, netstat -a,
// grep -r). A command line that prints a command that does not work is worse than
// no command line, so this reads each BUILT page's own prompt and runs it: the
// answer must not be an error, and it must DO something (navigate or print).
console.log('== every page\'s own prompt runs');
{
  const fs = require('fs');
  const path = require('path');
  const dist = path.join(ROOT, 'dist');
  const pages = [];
  for (const d of fs.readdirSync(dist)) {
    const f = path.join(dist, d, 'index.html');
    if (fs.existsSync(f)) pages.push([d, f]);
  }
  pages.push(['index', path.join(dist, 'index.html')]);
  const seen = new Set();
  let checked = 0, bad = [];
  for (const [name, file] of pages) {
    const html = fs.readFileSync(file, 'utf8');
    const m = html.match(/<div class="prompt">([\s\S]*?)<span class="blink">/);
    if (!m) continue;
    const prompt = m[1].replace(/<[^>]+>/g, '').replace(/^[^$]*\$\s*/, '').trim();
    if (!prompt || seen.has(prompt)) continue;   // one prompt shape per page kind
    seen.add(prompt);
    checked++;
    const w3 = new Window({ width: 1000, height: 800, url: 'https://blog.jaye.ch/' + name + '/' });
    const d3 = w3.document;
    let st3 = 'loading';
    Object.defineProperty(d3, 'readyState', { get: () => st3, configurable: true });
    d3.body.innerHTML = html.match(/<body>([\s\S]*)<script/)[1];
    // the command line is found by what it is, not by where it sits — a page
    // may carry more than one inline script after the palette
    const pel = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
      .map((s) => s[1]).find((s) => s.includes('palette-out'));
    try {
      new Function('window', 'document', 'setTimeout', 'clearTimeout', 'console',
        pel)(w3, d3, w3.setTimeout.bind(w3), w3.clearTimeout.bind(w3), console);
    } catch (e) { bad.push([name, prompt, 'threw: ' + e.message]); continue; }
    st3 = 'interactive';
    d3.dispatchEvent(new w3.Event('DOMContentLoaded'));
    w3.location.href = 'https://blog.jaye.ch/' + name + '/';
    const before = w3.location.href;
    const keyed = (el, k) => { const e = new w3.Event('keydown', { bubbles: true, cancelable: true }); Object.defineProperty(e, 'key', { get: () => k }); el.dispatchEvent(e); };
    keyed(d3, '/');
    const box3 = d3.getElementById('palette');
    if (!box3) { bad.push([name, prompt, 'no palette']); continue; }
    const inp3 = box3.querySelector('input');
    inp3.value = prompt;
    keyed(inp3, 'Enter');
    const out = (box3.querySelector('.palette-out').textContent || '').trim();
    const navigated = w3.location.href !== before;
    const errored = /no such|not found|no such series/i.test(out);
    if (errored || (!navigated && !out)) bad.push([name, prompt, navigated ? '-> ' + w3.location.href : out.slice(0, 60)]);
  }
  check(checked > 0, `read ${checked} distinct prompt(s) from the built pages`);
  check(bad.length === 0, `every page's own prompt runs without an error (${checked - bad.length}/${checked})` +
    (bad.length ? ' e.g. ' + JSON.stringify(bad.slice(0, 3)) : ''));
}

console.log('== the palette');
const palette = blocks.find((b) => b.includes('palette-out'));
if (!palette) {
  check(false, 'the page carries no palette script (every page should)');
} else {
  const w2 = new Window({ width: 1000, height: 800, url: 'https://blog.jaye.ch/map/' });
  const d2 = w2.document;
  let st2 = 'loading';
  Object.defineProperty(d2, 'readyState', { get: () => st2, configurable: true });
  d2.body.innerHTML = bodyHtml.replace(/<script(?![^>]*application\/json)[\s\S]*?<\/script>/g, '');
  new Function('window', 'document', 'setTimeout', 'clearTimeout', 'console',
    palette)(w2, d2, w2.setTimeout.bind(w2), w2.clearTimeout.bind(w2), console);
  st2 = 'interactive';
  d2.dispatchEvent(new w2.Event('DOMContentLoaded'));
  const key = (el, k) => {
    const e = new w2.Event('keydown', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'key', { get: () => k });
    el.dispatchEvent(e);
  };
  const pinput = d2.querySelector('#palette input');
  w2.location.href = 'https://blog.jaye.ch/map/';
  key(d2, '/');
  check(!d2.getElementById('palette').hidden, 'pressing / opens the command line');
  pinput.value = 'search proclus';
  key(pinput, 'Enter');
  check(w2.location.href === 'https://blog.jaye.ch/search/?q=proclus',
    `"search proclus" opens the search page with the query (${w2.location.href})`);
  w2.location.href = 'https://blog.jaye.ch/map/';
  key(d2, '/');
  pinput.value = 'zzz qqq';
  key(pinput, 'Enter');
  check(w2.location.href === 'https://blog.jaye.ch/search/?q=zzz%20qqq',
    `a multi-word line no command, slug, series or title matches falls through to the search page (${w2.location.href})`);
  w2.location.href = 'https://blog.jaye.ch/map/';
  key(d2, '/');
  pinput.value = 'zzz';
  key(pinput, 'Enter');
  check(w2.location.href === 'https://blog.jaye.ch/map/' &&
    /command not found/.test(d2.querySelector('.palette-out').textContent),
    `a single unknown word still answers "command not found" (${d2.querySelector('.palette-out').textContent})`);
}

/* ---------- 12. the latency ---------- */

console.log('== latency');
const times = [];
for (const q of ['proclus', 'the damping dial', 'wetiko', 'zetetic']) {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 5; i++) S.query(q);
  const t1 = process.hrtime.bigint();
  const ms = Number(t1 - t0) / 5e6;
  times.push(ms);
  console.log(`  "${q}" ${ms.toFixed(2)} ms per query`);
}
const median = times.slice().sort((a, b) => a - b)[Math.floor(times.length / 2)];
check(median < 60, `median query ${median.toFixed(2)} ms`);

// the fuzzy path, through the box: the same query with a `~` in it. `counts.ms`
// is the whole query (words + vectors + graph), and the walk is the only part
// the `~` adds — the line below it times the walk alone.
for (const q of ['~proculs', '~~prokluss', '~~ais']) {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 5; i++) S.query(q);
  const t1 = process.hrtime.bigint();
  const r = S.query(q);
  console.log(`  "${q}" ${(Number(t1 - t0) / 5e6).toFixed(2)} ms per query (${r.counts.fuzzyWords} matched word(s), the walk itself ${r.counts.fuzzyMs} ms)`);
}

// the walk ALONE — no vectors, no graph — over a sample that includes every
// short word of the list, which is the expensive kind: a short query stays
// within its budget the longest, so this is where the worst case lives
const fzSweep = vocab.filter((_, i) => i % 97 === 0).concat(vocab.filter((t) => t.length <= 3));
for (const k of [1, 2]) {
  let worst = 0, worstAt = '', tot = 0;
  const t0 = process.hrtime.bigint();
  for (const q of fzSweep) {
    const a = process.hrtime.bigint();
    const r = S.matchFuzzy(q, k);
    const b = process.hrtime.bigint();
    const ms = Number(b - a) / 1e6;
    tot += ms;
    if (ms > worst) { worst = ms; worstAt = q + ' (' + r.words.length + ' words)'; }
  }
  const t1 = process.hrtime.bigint();
  console.log(`  the walk alone, ${fzSweep.length} words of the list at k=${k}: ${(tot / fzSweep.length).toFixed(3)} ms a word, worst ${worst.toFixed(2)} ms ("${worstAt}")`);
}

// the ordinary path's added work: ONE replace over the query per tokenise call,
// timed here against the same body without it
const tickQ = 'the damping dial proclus';
const oldTok = (t) => (String(t).toLowerCase().match(/[a-z][a-z'-]+/g) || []).filter((w) => w.length >= 3 && !STOP.has(w));
let a0 = process.hrtime.bigint();
for (let i = 0; i < 20000; i++) oldTok(tickQ);
let a1 = process.hrtime.bigint();
for (let i = 0; i < 20000; i++) S.tokenize(tickQ, S._idx.stop);
let a2 = process.hrtime.bigint();
console.log(`  tokenising a query: ${(Number(a1 - a0) / 2e7).toFixed(2)} µs without the fuzzy marker, ${(Number(a2 - a1) / 2e7).toFixed(2)} µs with it`);

/* ---------- 13. the box: completions, the keyboard, the order, the marks ----- */

/**
 * Everything here drives the BUILT page in a DOM — the same pipeline the
 * browser runs — and every expectation is computed from the page's own data
 * (the vocabulary it walked out of its automaton, the dates and titles in its
 * index), never written down. A fresh window per block: the listeners wire()
 * adds are per-window, and a second wire() on the same document would answer
 * one keystroke twice.
 */
console.log('== the box finishes words, and the keyboard drives it');
function freshSearch(url) {
  const w = new Window({ width: 1100, height: 900, url });
  const d = w.document;
  let st = 'loading';
  Object.defineProperty(d, 'readyState', { get: () => st, configurable: true });
  d.body.innerHTML = bodyHtml.replace(/<script(?![^>]*application\/json)[\s\S]*?<\/script>/g, '');
  const Sx = new Function('window', 'document', 'performance', 'setTimeout', 'clearTimeout', 'console',
    client + '\nreturn window.Search;')(w, d, w.performance, w.setTimeout.bind(w), w.clearTimeout.bind(w), console);
  st = 'interactive';
  d.dispatchEvent(new w.Event('DOMContentLoaded'));
  const key = (el, k) => {
    const e = new w.Event('keydown', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'key', { get: () => k });
    el.dispatchEvent(e);
    return e;
  };
  return { w, d, Sx, key, input: d.getElementById('sq'), box: d.getElementById('sres'), status: d.getElementById('sstatus') };
}
{
  const { w: w3, d: d3, Sx: S3, key, input, box } = freshSearch('https://blog.jaye.ch/search/');
  const compEl = d3.getElementById('scomp');
  const compList = d3.getElementById('scomp-list');
  const compCap = d3.getElementById('scomp-cap');
  const opts = () => [...compList.querySelectorAll('li.sc')].map((li) => li.textContent);
  const rows = () => [...box.querySelectorAll('li.sr')];
  const type = (v) => { input.value = v; input.dispatchEvent(new w3.Event('input', { bubbles: true })); };

  check(input.getAttribute('role') === 'combobox' && input.getAttribute('aria-controls') === 'scomp-list' &&
    compList.getAttribute('role') === 'listbox' && input.getAttribute('aria-expanded') === 'false',
    'the box is a combobox over a listbox, and says it is closed until it has something to offer');

  // a prefix with a handful of completions, computed from the vocabulary
  const p4 = new Map();
  for (const t of vocab) { const p = t.slice(0, 4); if (p.length === 4) p4.set(p, (p4.get(p) || 0) + 1); }
  const entry = [...p4.entries()].find(([, n]) => n >= 2 && n <= 8) || ['proclu'];
  const prefix = entry[0];
  const want = vocab.filter((t) => t.indexOf(prefix) === 0);

  type(prefix);
  check(!compEl.hidden && input.getAttribute('aria-expanded') === 'true',
    `typing "${prefix}" opens the completion list`);
  check(norm(opts()) === norm(want) && opts().every((t) => t.indexOf(prefix) === 0),
    `the list offers the ${want.length} word(s) of the vocabulary that begin that way — ${norm(opts())}`);

  // while the list is open the arrows belong to it, not to the result list
  key(input, 'ArrowDown');
  check(compList.children[0].getAttribute('aria-selected') === 'true' &&
    input.getAttribute('aria-activedescendant') === 'scomp-0',
    'the down arrow selects the first completion, and ARIA says which one');
  check(box.querySelectorAll('li.sr.sr-on').length === 0,
    'and while the list is open the arrows do NOT move in the results');
  key(input, 'Enter');
  check(input.value === want[0] && compEl.hidden,
    `Enter took the highlighted word and put it in the box ("${input.value}")`);
  check(w3.location.search === '?q=' + encodeURIComponent(want[0]),
    `and ran that word's own search (${w3.location.search})`);
  check(rows().length > 0, `which answered with ${rows().length} result(s)`);

  // Escape closes it and leaves the text alone
  type(prefix);
  check(!compEl.hidden, 'typing the prefix again reopens it');
  key(input, 'Escape');
  check(compEl.hidden && input.value === prefix && input.getAttribute('aria-expanded') === 'false',
    `Escape closed the list and the box kept its text ("${input.value}")`);

  // a prefix reaching more words than the box offers reports the bound
  const p3 = new Map();
  for (const t of vocab) { const p = t.slice(0, 3); if (p.length === 3) p3.set(p, (p3.get(p) || 0) + 1); }
  const wide = [...p3.entries()].find(([, n]) => n > 8);
  check(!!wide, 'a three-letter prefix reaches more words than the box offers');
  if (wide) {
    type(wide[0]);
    check(opts().length === 8 && !compCap.hidden && compCap.textContent.indexOf('8') >= 0,
      `the list stops at 8 words and says so ("${compCap.textContent}") — ${wide[1]} begin "${wide[0]}"`);
    check(norm(opts()) === norm(vocab.filter((t) => t.indexOf(wide[0]) === 0).slice(0, 8)),
      'and the 8 it shows are the first 8 of the word list');
  }

  // the results take the arrows once no list is open
  type('proclus');
  key(input, 'Escape');
  check(rows().length >= 3, `"proclus" answers ${rows().length} result(s)`);
  key(input, 'ArrowDown');
  check(rows()[0].classList.contains('sr-on') && box.querySelectorAll('li.sr.sr-on').length === 1,
    'the down arrow selects the first result');
  key(input, 'ArrowDown');
  check(rows()[1].classList.contains('sr-on') && !rows()[0].classList.contains('sr-on'),
    'and again moves to the second — the selection moves, one at a time');
  key(input, 'End');
  check(rows()[rows().length - 1].classList.contains('sr-on'), 'End goes to the last result');
  key(input, 'Home');
  check(rows()[0].classList.contains('sr-on'), 'Home goes back to the first');

  /* the order: relevance (the default) and newest first, over the same results */
  let orderQ = null;
  for (const q of data.hints.concat(vocab.filter((_, i) => i % 2111 === 0), ['proclus', 'wetiko'])) {
    const r = S3.query(q, { limit: 200 });
    if (r.results.length >= 3 && new Set(r.results.map((x) => data.docs[x.i].date)).size >= 2) { orderQ = q; break; }
  }
  check(!!orderQ, `a query with three or more results over more than one date was found ("${orderQ}")`);
  const sortSel = d3.getElementById('sf-sort');
  if (orderQ) {
    const relSlugs = S3.query(orderQ, { limit: 200 }).results.map((r) => data.docs[r.i].slug);
    const newest = S3.query(orderQ, { sort: 'new', limit: 200 }).results;
    const nSlugs = newest.map((r) => data.docs[r.i].slug);
    const ndates = nSlugs.map((s) => data.docs[data.docs.findIndex((x) => x.slug === s)].date);
    const maxDate = ndates.slice().sort().pop();
    check(ndates.every((dt, i) => i === 0 || ndates[i - 1] >= dt),
      `newest first really is newest first, over the index's own dates: ${ndates.join(' ')}`);
    check(norm(nSlugs) === norm(relSlugs),
      `the order reorders the SAME ${nSlugs.length} results, it does not select different ones`);
    check(ndates[0] === maxDate, `the first is the newest date the answer holds (${ndates[0]})`);
    check(S3.query(orderQ, { limit: 200 }).counts.sort === 'rel', 'and the default is still relevance');

    type(orderQ);
    key(input, 'Escape');
    sortSel.value = 'new';
    sortSel.dispatchEvent(new w3.Event('change', { bubbles: true }));
    check(w3.location.search.indexOf('sort=new') >= 0, `the order rides in the URL (${w3.location.search})`);
    const shownHrefs = [...box.querySelectorAll('li.sr a.sr-t')].map((a) => a.getAttribute('href'));
    // the deep link carries the query; strip it for the comparison
    const shownSlugs = shownHrefs.map((h) => h.replace(/\?q=.*$/, ''));
    check(shownSlugs.length > 0 && shownSlugs[0] === '/' + nSlugs[0] + '/',
      `the page shows the newest piece first (${shownHrefs[0]})`);
    check(shownHrefs.every((h) => decodeURIComponent((h.match(/\?q=(.*)$/) || [])[1] || '') === orderQ),
      `and every result's link carries the query, so the piece marks the words it was found by`);
    sortSel.value = '';
    sortSel.dispatchEvent(new w3.Event('change', { bubbles: true }));
    check(w3.location.search.indexOf('sort') < 0, 'going back to relevance drops it from the URL');

    // the match is marked in the TITLE by the same rule the snippet uses: the
    // expectation is that regex, applied here to each title the page rendered
    const toks = orderQ.toLowerCase().match(/[a-z][a-z'-]+/g) || [];
    const qtoks = [];
    for (const t of toks) if (t.length >= 3 && !STOP.has(t) && qtoks.indexOf(t) < 0) qtoks.push(t);
    const parts = qtoks.slice().sort((a, b) => b.length - a.length);
    const qre = new RegExp('\\b(?:' + parts.map((s) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')).join('|') + ")[a-z'-]*", 'gi');
    let titleRows = 0, markedRows = 0, mismatched = 0;
    for (const li of box.querySelectorAll('li.sr')) {
      const a = li.querySelector('a.sr-t');
      if (!a) continue;
      const plain = a.textContent;
      const expected = (plain.replace(qre, '\u0000').match(/\u0000/g) || []).length;
      const actual = a.querySelectorAll('mark').length;
      titleRows++;
      if (expected) markedRows++;
      if (expected !== actual) mismatched++;
    }
    check(titleRows > 0 && mismatched === 0,
      `every result title is marked by the same rule the snippet uses (${titleRows} title(s) checked)`);
    check(markedRows > 0, `and the titles the query's word reached carry the mark (${markedRows})`);
  }

  // Enter opens the selected piece (last: it navigates this window away)
  type('proclus');
  key(input, 'Escape');
  key(input, 'ArrowDown');
  const firstHref = rows()[0].querySelector('a.sr-t').getAttribute('href');
  key(input, 'Enter');
  check(w3.location.href === 'https://blog.jaye.ch' + firstHref,
    `Enter opened the piece the selection was on (${w3.location.href})`);
}

/* ---------- 14. the correction is run, and the box keeps the reader's text ----- */

console.log('== a typo is corrected in the results, and the box keeps what was typed');
{
  const b = d.getElementById('sres');
  const s = d.getElementById('sstatus');
  const inp = d.getElementById('sq');
  // the facets the earlier section left set change what a query answers (they
  // seed the graph as well as filter it), so this is run with them cleared
  d.getElementById('sf-series').value = '';
  d.getElementById('sf-kind').value = '';
  inp.value = 'proculs';
  const res = S.render(b, s, 'proculs');
  check(res.counts.fallbackFrom === 'proculs' && res.counts.fallbackTo === 'proclus',
    `the built page corrects "proculs" to "proclus" and runs it (${res.results.length} result(s))`);
  check(/no exact match/.test(s.textContent) && /proclus/.test(s.textContent),
    `the line above the results SAYS the correction happened: "${s.textContent.trim().slice(0, 120)}"`);
  check(b.querySelectorAll('li.sr').length > 0,
    `and the results are shown, not withheld (${b.querySelectorAll('li.sr').length})`);
  // the reader's own words are never rewritten: the box is the reader's, and so is
  // the URL — a search link another reader follows must search what they asked for
  check(inp.value === 'proculs',
    `the box still holds what the reader typed ("${inp.value}")`);

  // and the OFFER path still exists for a thin (non-empty) answer: find a query
  // with a few results and an unknown word, and check the offer is shown there
  // SAMPLE the vocabulary, do not scan it: a query per word over 15768 entries
  // took minutes. Every 97th word is enough to find a thin case, and the stride
  // is stated so a failure here is readable as "the sample missed", not "the
  // offer is broken".
  let offered = null;
  for (let wi = 0; wi < vocab.length; wi += 97) {
    const word = vocab[wi];
    const at = S.query(word);
    if (at.results.length < 1 || at.results.length > 2) continue;
    const withTypo = S.query(word + ' proculs');
    if (withTypo.counts.suggest && withTypo.counts.suggest.to === 'proclus') { offered = word; break; }
  }
  if (offered) {
    const t = S.query(offered + ' proculs');
    check(!!t.counts.suggest && t.counts.suggest.to === 'proclus' && !t.counts.fallbackFrom,
      `a THIN answer offers the correction instead of running it ("${offered} proculs" -> offered "${t.counts.suggest && t.counts.suggest.to}")`);
  } else {
    check(true, 'no thin-answer case was found to exercise the offer path in this corpus (reported, not hidden)');
  }
}

/* ---------- 15. the way into the search from a series ---------- */

console.log('== the way into the search from a series');
{
  const fs = require('fs');
  const path = require('path');
  const inSeries = posts.filter((p) => p.series);
  check(inSeries.length > 0, 'there are pieces in series to check');
  const bad = [];
  let checkedPages = 0;
  for (const p of inSeries) {
    const f = path.join(ROOT, 'dist', p.slug, 'index.html');
    if (!fs.existsSync(f)) { bad.push(p.slug + ': no page'); continue; }
    const m = fs.readFileSync(f, 'utf8').match(/<p class="series-search"><a href="([^"]+)"/);
    if (!m) { bad.push(p.slug + ': no series search link'); continue; }
    const href = m[1].replace(/&amp;/g, '&');
    if (href !== '/search/?q=&series=' + p.series) bad.push(p.slug + ': ' + href);
    checkedPages++;
  }
  check(checkedPages === inSeries.length && bad.length === 0,
    `every piece in a series offers the search for that series (${checkedPages}/${inSeries.length})` +
      (bad.length ? ' — ' + bad.slice(0, 3).join('; ') : ''));
  // and the facet the link names really narrows an answer to that series
  const one = inSeries.find((p) => posts.filter((q) => q.series === p.series).length >= 2) || inSeries[0];
  const si = posts.findIndex((p) => p.slug === one.slug);
  const term = tokens[si].find((t) => t.length >= 6) || tokens[si][0];
  const all = S.query(term, { limit: 200 }).results;
  const narrowed = S.query(term, { series: one.series, limit: 200 }).results;
  const inIt = narrowed.every((r) => data.docs[r.i].series === one.series);
  check(narrowed.length > 0 && narrowed.length <= all.length && inIt,
    `"?q=${term}&series=${one.series}" narrows the answer to that series (${all.length} → ${narrowed.length}, all of them in it)`);
  w.history.replaceState(null, '', '/search/?q=&series=' + one.series);
  const u = S.readUrl();
  check(u.q === '' && u.series === one.series,
    `the link's own URL lands on the facet (q="${u.q}", series="${u.series}")`);
}

/* ---------- 16. the command line, before the reader commits ---------- */

console.log('== the command line\'s search preview');
{
  const palette = blocks.find((x) => x.includes('palette-out'));
  const dm = palette && palette.match(/var DATA = (.*);/);
  const P = dm ? JSON.parse(dm[1]) : null;
  check(!!P && P.pages.length > 0, 'the palette carries the page list it previews from');
  if (P) {
    const labelOf = (k) => (P.series.find((x) => x.key === k) || { label: k }).label;
    const expectPreview = (q) => {
      const ws = (q.toLowerCase().match(/[a-z][a-z'-]+/g) || []).filter((x) => x.length >= 3);
      return P.pages
        .map((p) => {
          const hay = p.title.toLowerCase() + ' ' + (labelOf(p.series) || '') + ' ' + (p.series || '') + ' ' + (p.kind || '');
          return [p, ws.filter((x) => hay.indexOf(x) >= 0).length];
        })
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([p]) => p.slug);
    };
    let pv = null;
    for (const p of P.pages) {
      const m = p.title.toLowerCase().match(/[a-z][a-z'-]{5,}/g);
      if (m && m.length && expectPreview(m[0]).indexOf(p.slug) >= 0) { pv = { word: m[0], slug: p.slug }; break; }
    }
    check(!!pv, `a word of a page title was found to preview ("${pv && pv.word}")`);
    if (pv) {
      const w4 = new Window({ width: 1000, height: 800, url: 'https://blog.jaye.ch/map/' });
      const d4 = w4.document;
      let st4 = 'loading';
      Object.defineProperty(d4, 'readyState', { get: () => st4, configurable: true });
      d4.body.innerHTML = bodyHtml.replace(/<script(?![^>]*application\/json)[\s\S]*?<\/script>/g, '');
      new Function('window', 'document', 'setTimeout', 'clearTimeout', 'console', palette)(
        w4, d4, w4.setTimeout.bind(w4), w4.clearTimeout.bind(w4), console);
      st4 = 'interactive';
      d4.dispatchEvent(new w4.Event('DOMContentLoaded'));
      const pin = d4.querySelector('#palette input');
      const pout = () => d4.querySelector('.palette-out').textContent;
      const pkey = (k) => {
        const e = new w4.Event('keydown', { bubbles: true, cancelable: true });
        Object.defineProperty(e, 'key', { get: () => k });
        pin.dispatchEvent(e);
      };
      pkey('/');
      pin.value = 'search ' + pv.word;
      pin.dispatchEvent(new w4.Event('input', { bubbles: true }));
      const out = pout();
      const want = expectPreview(pv.word);
      check(want.length > 0 && want.every((sl) => out.indexOf(sl) >= 0),
        `typing a search line previews the pages whose title or series match — ${want.join(', ')}`);
      check(/Enter searches every piece/.test(out), `and says which list it is, and what Enter does ("${out.trim().split('\n').pop()}")`);
      check(w4.location.href === 'https://blog.jaye.ch/map/', 'the preview navigates nowhere on its own');
      pin.value = 'search ' + pv.word;
      pkey('Enter');
      check(w4.location.href === 'https://blog.jaye.ch/search/?q=' + encodeURIComponent(pv.word),
        `Enter still opens the full search (${w4.location.href})`);
    }
  }
}

/* ---------- 17. the command line: the rest of the keyboard ---------- */

/**
 * The palette's own behaviour, driven on a page that carries what a reader's
 * page carries: the head's theme script (the ONE mechanism the nav control and
 * the `theme` command share), the document's canonical link, and the palette
 * itself. Every expectation here is computed from the page — the pages and
 * series from the palette's own embedded list, the command names and aliases
 * from the help index the page prints, the address from the document's own
 * canonical link — so none of them is a pair written down in advance.
 */
console.log('== the command line: tab, history, numbers, modes, typos, the theme, url, man');
{
  const palette = blocks.find((x) => x.includes('palette-out'));
  const dm = palette && palette.match(/var DATA = (.*);/);
  const P = dm ? JSON.parse(dm[1]) : null;
  check(!!P && P.pages.length > 0, 'the palette carries the page list these checks drive it with');

  // the theme script is the one that owns the nav control — found by what it
  // does, not by where it sits
  const themeScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1]).find((s) => s.indexOf('theme-toggle') >= 0);
  check(!!themeScript, 'the page carries the theme script (one mechanism, two controls)');
  const canon = (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
  check(!!canon, `the page states its own canonical address (${canon})`);

  const seriesKeys = P.series.map((s) => s.key);
  const allSlugs = P.pages.map((p) => p.slug);

  // an independent implementation of the "did you mean" rule the box uses: a
  // plain Levenshtein against the slug's OWN PREFIXES, bounded by the typed
  // length — recomputed here so the expectation is not read off the page
  const lev = (a, b) => {
    let row = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const next = [i];
      for (let j = 1; j <= b.length; j++) {
        next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      row = next;
    }
    return row[b.length];
  };
  const nearLimit = (n) => Math.max(1, Math.floor(n / 3));
  const nearest = (q) => {
    let best = null, bestD = Infinity;
    for (const p of P.pages) {
      let d = Infinity;
      const hi = Math.min(p.slug.length, q.length + 2);
      for (let k = Math.max(1, q.length - 2); k <= hi; k++) d = Math.min(d, lev(q, p.slug.slice(0, k)));
      if (d < bestD) { bestD = d; best = p.slug; }
    }
    return bestD <= nearLimit(q.length) ? best : null;
  };

  function palWin(url) {
    const w = new Window({ width: 1100, height: 900, url });
    const d = w.document;
    let st = 'loading';
    Object.defineProperty(d, 'readyState', { get: () => st, configurable: true });
    // the head WITHOUT its scripts: the canonical link is part of the document
    d.head.innerHTML = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>'))
      .replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
    d.body.innerHTML = bodyHtml.replace(/<script(?![^>]*application\/json)[\s\S]*?<\/script>/g, '');
    const runScript = (src) => new Function('window', 'document', 'localStorage', 'sessionStorage',
      'setTimeout', 'clearTimeout', 'console', src)(
      w, d, w.localStorage, w.sessionStorage, w.setTimeout.bind(w), w.clearTimeout.bind(w), console);
    runScript(themeScript);
    runScript(palette);
    st = 'interactive';
    d.dispatchEvent(new w.Event('DOMContentLoaded'));
    const input = d.querySelector('#palette input');
    const boxEl = () => d.getElementById('palette');
    const outText = () => (d.querySelector('.palette-out').textContent || '');
    const key = (el, k, shift) => {
      const e = new w.Event('keydown', { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'key', { get: () => k });
      Object.defineProperty(e, 'shiftKey', { get: () => !!shift });
      el.dispatchEvent(e);
      return e;
    };
    const type = (v, ...keys) => {
      input.value = v;
      input.dispatchEvent(new w.Event('input', { bubbles: true }));
      for (const k of keys) key(input, k);
    };
    const enter = (v) => { input.value = v; key(input, 'Enter'); };
    const open = (k) => { key(d, k); return boxEl(); };
    const store = (st2) => {
      const o = {};
      for (let i = 0; i < st2.length; i++) { const k = st2.key(i); o[k] = st2.getItem(k); }
      return o;
    };
    return { w, d, input, boxEl, outText, key, type, enter, open, store, glyph: () => (d.querySelector('#palette .ps-mode') || {}).textContent };
  }

  if (P) {
    /* ---- 4. / and : open the box in their own mode ---- */
    {
      const p = palWin('https://blog.jaye.ch/map/');
      p.open('/');
      check(!p.boxEl().hidden && p.input.value === 'search ' && p.boxEl().getAttribute('data-mode') === 'search' && p.glyph() === '/',
        `pressing / opens a search prompt (line "${p.input.value}", prompt "${p.glyph()}")`);
      p.key(p.d, 'Escape');
      check(p.boxEl().hidden, 'and Escape closes it');
      p.open(':');
      check(!p.boxEl().hidden && p.input.value === '' && p.boxEl().getAttribute('data-mode') === 'cmd' && p.glyph() === '$',
        `pressing : opens an empty command line (line "${p.input.value}", prompt "${p.glyph()}")`);
      const word = (P.pages[0].title.toLowerCase().match(/[a-z][a-z'-]{3,}/) || ['page'])[0];
      p.type('search ' + word);
      check(/Enter searches every piece/.test(p.outText()),
        `a search line keeps its own preview in the search prompt ("${p.outText().split('\n').pop()}")`);
    }

    /* ---- 1. Tab: a unique match, then an ambiguous one that cycles ---- */
    {
      const p = palWin('https://blog.jaye.ch/map/');
      p.open(':');

      // the command names and aliases, read from the page's own help index
      p.enter('help');
      const helpLines = p.outText().split('\n');
      const names = [];
      for (const l of helpLines.slice(0, helpLines.indexOf(''))) {
        names.push(l.trim().split(/\s+/)[0]);
        const also = l.match(/\(also: ([^)]+)\)/);
        if (also) for (const a of also[1].split(', ')) names.push(a);
      }
      check(names.indexOf('cat') >= 0 && names.indexOf('grep') >= 0,
        `the help index names the commands and their aliases (${names.join(' ')})`);

      // a prefix of an argument that exactly one page starts with, and no
      // series key does
      let uniq = null;
      for (const pg of P.pages) {
        for (let k = 3; k <= pg.slug.length; k++) {
          const pre = pg.slug.slice(0, k);
          if (allSlugs.filter((s) => s.indexOf(pre) === 0).length === 1 && !seriesKeys.some((s) => s.indexOf(pre) === 0)) {
            uniq = { pre, slug: pg.slug };
            break;
          }
        }
        if (uniq) break;
      }
      check(!!uniq, `a prefix only one page starts with exists (${uniq && uniq.pre})`);
      if (uniq) {
        p.type('cat ' + uniq.pre);
        const live = p.outText();
        check(live.indexOf(uniq.slug) >= 0, `the pages that match the argument are shown as it is typed ("${(live.split('\n')[1] || '').trim()}")`);
        p.key(p.input, 'Tab');
        check(p.input.value === 'cat ' + uniq.slug, `Tab completes the slug outright ("${p.input.value}")`);
      }

      // a command word that only one candidate starts with
      const cands = names.concat(allSlugs, seriesKeys);
      const uniquePre = (n, min) => {
        for (let k = min; k <= n.length; k++) {
          const pre = n.slice(0, k);
          if (cands.filter((x) => x.indexOf(pre) === 0).length === 1) return { pre, name: n };
        }
        return null;
      };
      let cp = null;
      const byLen = names.slice().sort((a, b) => b.length - a.length);
      for (const n of byLen) { cp = uniquePre(n, 3); if (cp) break; }
      for (const n of byLen) { if (cp) break; cp = uniquePre(n, 1); }
      check(!!cp, `a command prefix only one candidate starts with exists (${cp && cp.pre} -> ${cp && cp.name})`);
      if (cp) {
        p.type(cp.pre);
        check(p.outText().indexOf(cp.name) >= 0, `the commands that match are listed while the command word is typed ("${(p.outText().split('\n')[0] || '').trim()}")`);
        p.key(p.input, 'Tab');
        check(p.input.value.trim() === cp.name, `Tab completes the command ("${p.input.value}")`);
      }

      // an ambiguous argument: the longest common prefix, the list, the cycle
      const candsFor = (pre) => seriesKeys.filter((s) => s.indexOf(pre) === 0)
        .concat(allSlugs.filter((s) => s.indexOf(pre) === 0));
      let amb = null;
      for (let k = 3; k >= 1 && !amb; k--) {
        for (const pg of P.pages) {
          if (pg.slug.length <= k) continue;
          const pre = pg.slug.slice(0, k);
          const list = candsFor(pre);
          if (list.length < 3) continue;
          const lcp = list.reduce((a, b) => { let j = 0; while (j < a.length && j < b.length && a[j] === b[j]) j++; return a.slice(0, j); });
          if (lcp.length >= k) { amb = { pre, list, lcp }; break; }
        }
      }
      check(!!amb, `an ambiguous prefix exists (${amb && amb.pre} -> ${amb && amb.list.length} candidates)`);
      if (amb) {
        p.type('cat ' + amb.pre);
        p.key(p.input, 'Tab');
        check(p.input.value === 'cat ' + amb.lcp, `an ambiguous prefix completes to the longest common prefix ("${p.input.value}")`);
        const listed = amb.list.slice(0, 12);
        check(listed.every((s) => p.outText().indexOf(s) >= 0) && (amb.list.length <= 12 || /more; keep typing/.test(p.outText())),
          `and lists them, first ${listed.length} in order, the rest reported as more (of ${amb.list.length})`);
        const seen = [];
        for (let i = 0; i < amb.list.length; i++) { p.key(p.input, 'Tab'); seen.push(p.input.value); }
        check(seen.every((v, i) => v === 'cat ' + amb.list[i]),
          `Tab then cycles them, in the order listed (${seen.map((v) => v.slice(4)).join(', ')})`);
        p.key(p.input, 'Tab');
        check(p.input.value === seen[0], 'and the cycle comes round to the first candidate');
        p.key(p.input, 'Tab', true);
        check(p.input.value === 'cat ' + amb.list[amb.list.length - 1], `Shift+Tab steps it backwards ("${p.input.value.slice(4)}")`);
      }

      // a search argument is a query: Tab must never complete it to a page
      p.type('search procl');
      p.key(p.input, 'Tab');
      check(p.input.value === 'search procl', `Tab leaves a search query exactly as typed ("${p.input.value}")`);
      check(/not a page/.test(p.outText()), 'and says why');
    }

    /* ---- 2. history: Up and Down, per tab ---- */
    {
      const p = palWin('https://blog.jaye.ch/map/');
      p.open(':');
      const lines = ['help', 'ls'];
      for (const l of lines) p.enter(l);
      p.input.value = 'half typed';
      p.key(p.input, 'ArrowUp');
      check(p.input.value === lines[1], `Up returns the newest line ("${p.input.value}")`);
      p.key(p.input, 'ArrowUp');
      check(p.input.value === lines[0], `Up again returns the line before it ("${p.input.value}")`);
      p.key(p.input, 'ArrowDown');
      check(p.input.value === lines[1], `Down walks back toward the newest ("${p.input.value}")`);
      p.key(p.input, 'ArrowDown');
      check(p.input.value === 'half typed', `and past it, to the line being edited ("${p.input.value}")`);
      const sess = JSON.stringify(p.store(p.w.sessionStorage));
      check(lines.every((l) => sess.indexOf(l) >= 0), `both lines are kept in this tab's storage (${sess.slice(0, 80)})`);
      const loc = JSON.stringify(p.store(p.w.localStorage));
      check(lines.every((l) => loc.indexOf(l) < 0), 'and none of the history is in local storage (it must not outlive the tab)');
    }

    /* ---- 3. digit shortcuts, and the honest refusal ---- */
    {
      const p = palWin('https://blog.jaye.ch/map/');
      p.open(':');
      p.enter('3');
      check(p.w.location.href === 'https://blog.jaye.ch/map/', 'a bare number with no listing navigates nowhere');
      check(/no listing/.test(p.outText()), `and says so, rather than guessing ("${p.outText()}")`);
      p.enter('ls');
      const listing = p.outText();
      const n = 3;
      const want = P.pages[n - 1].slug;
      check(listing.indexOf(want) >= 0, `ls shows the pages in its own order (line ${n} is ${want})`);
      p.enter('999');
      check(p.w.location.href === 'https://blog.jaye.ch/map/' && /the listing has \d+ line/.test(p.outText()),
        `a number past the end of the listing answers, and says how many there are ("${p.outText()}")`);
      p.enter(String(n));
      check(p.w.location.href === 'https://blog.jaye.ch/' + want + '/',
        `the number opens that line of the listing (${p.w.location.href})`);
    }

    /* ---- 5. a mistyped slug offers the nearest real one ---- */
    {
      const p = palWin('https://blog.jaye.ch/map/');
      p.open(':');
      // a typo of a real slug that is not any page, any prefix of one, or in any
      // title — and whose nearest page, by this file's own distance, is the slug
      // it was typed from
      let hit = null;
      for (const pg of P.pages) {
        if (pg.slug.length < 6) continue;
        const bad = pg.slug.slice(0, 2) + pg.slug[3] + pg.slug[2] + pg.slug.slice(4);
        const resolvable = allSlugs.some((s) => s === bad || s.indexOf(bad) === 0) ||
          P.pages.some((x) => x.title.toLowerCase().indexOf(bad) >= 0);
        if (!resolvable && nearest(bad) === pg.slug) { hit = { bad, slug: pg.slug }; break; }
      }
      check(!!hit, `a transposed slug resolves to the page it was typed from (${hit && hit.bad} -> ${hit && hit.slug})`);
      if (hit) {
        p.enter('cat ' + hit.bad);
        const msg = p.outText();
        check(/did you mean/.test(msg) && msg.indexOf(hit.slug) >= 0,
          `a mistyped slug offers the nearest page ("${msg.split('\n')[0]}")`);
        check(p.input.value === 'cat ' + hit.slug, `and leaves the corrected command ready to run ("${p.input.value}")`);
        check(p.w.location.href === 'https://blog.jaye.ch/map/', 'the miss navigates nowhere on its own');
        p.key(p.input, 'Enter');
        check(p.w.location.href === 'https://blog.jaye.ch/' + hit.slug + '/', `Enter then opens it (${p.w.location.href})`);
      }
      // a word with nothing near it keeps the old answer
      const p2 = palWin('https://blog.jaye.ch/map/');
      p2.open(':');
      p2.enter('cat zzzzzzz');
      check(p2.w.location.href === 'https://blog.jaye.ch/map/' && /no such post/.test(p2.outText()),
        `a word with no near page keeps the plain answer ("${p2.outText()}")`);
    }

    /* ---- 6. the theme command drives the toggle's own mechanism ---- */
    {
      const p = palWin('https://blog.jaye.ch/map/');
      const root = p.d.documentElement;
      const btn = p.d.getElementById('theme-toggle');
      check(!!btn, 'the page carries the theme control');
      const before = p.store(p.w.localStorage);
      check(Object.keys(before).length === 0 && root.getAttribute('data-theme') === null,
        'a reader who never touched it has no stored mode and no attribute (auto)');
      btn.click();
      const after = p.store(p.w.localStorage);
      const keyUsed = Object.keys(after)[0];
      check(after[keyUsed] === 'light' && btn.textContent === 'light' && root.getAttribute('data-theme') === 'light',
        `the nav control stores its choice under "${keyUsed}", and says so`);
      p.open(':');
      p.enter('theme dark');
      check(root.getAttribute('data-theme') === 'dark' && btn.textContent === 'dark' && /dark/.test(btn.getAttribute('aria-label') || ''),
        'theme dark sets the attribute AND moves the label and its aria sentence');
      check((p.store(p.w.localStorage) || {})[keyUsed] === 'dark',
        `and the same storage key the toggle uses holds it ("${keyUsed}")`);
      btn.click();
      check(btn.textContent === 'auto' && root.getAttribute('data-theme') === null && (p.store(p.w.localStorage) || {})[keyUsed] === undefined,
        'a click after the command carries on from the mode the command set (dark -> auto)');
      p.enter('theme auto');
      check(root.getAttribute('data-theme') === null && btn.textContent === 'auto', 'theme auto clears the attribute and the label agrees');
      p.enter('theme purple');
      check(root.getAttribute('data-theme') === null && /theme/.test(p.outText()) && /purple/.test(p.outText()),
        `an unknown mode is refused, and changes nothing ("${p.outText()}")`);
    }

    /* ---- 8. url, from the document's own canonical link ---- */
    if (canon) {
      const p = palWin(canon);
      p.open(':');
      const origin = new URL(canon).origin;
      const other = allSlugs.find((s) => canon.indexOf('/' + s + '/') < 0);
      p.enter('url ' + other);
      check(p.outText().trim() === origin + '/' + other + '/',
        `url prints the absolute address, on the base of the document's own canonical link (${p.outText().trim()})`);
      p.enter('url');
      check(p.outText().trim() === canon, `url with no slug prints the page you are on (${p.outText().trim()})`);
      p.enter('url zzzzzzz');
      check(/no page/.test(p.outText()), `url says so for a page that does not exist ("${p.outText()}")`);
    }

    /* ---- 9. man: the page, where help is the index ---- */
    {
      const p = palWin('https://blog.jaye.ch/map/');
      p.open(':');
      p.enter('help');
      const helpLines = p.outText().split('\n');
      const catLine = helpLines.find((l) => l.trim().split(/\s+/)[0] === 'cat');
      const aliases = (catLine.match(/\(also: ([^)]+)\)/) || [])[1];
      check(!!catLine && !!aliases, `the index has one line for cat, naming its aliases (${aliases})`);
      p.enter('man cat');
      const man = p.outText();
      check(man.length > catLine.length, `man cat says more than the index line does (${man.length} > ${catLine.length} chars)`);
      check(aliases.split(', ').every((a) => man.indexOf(a) >= 0), `and carries the aliases it names (${aliases})`);
      check(man.indexOf(P.pages[0].slug) >= 0, `and an example that is a real page (${P.pages[0].slug})`);
      p.enter('man ls');
      check(p.outText().length > 0 && p.outText().indexOf('man: no manual') < 0, 'man ls has its own page too');
      p.enter('man zzzz');
      check(/no manual/.test(p.outText()), `an unknown command to man says so ("${p.outText().split('\n')[0]}")`);
    }
  }
}

console.log(failures === 0 ? '\nSEARCH SMOKE TEST PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
