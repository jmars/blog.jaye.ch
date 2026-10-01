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
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

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
console.log(`  page ${Buffer.byteLength(html)} bytes, gzip ${gzipSync(html, { level: 9 }).length}`);
console.log(`  data block ${Buffer.byteLength(dataMatch[1])} bytes, gzip ${gzipSync(dataMatch[1], { level: 9 }).length}`);
console.log(`  pipeline script ${Buffer.byteLength(client)} bytes`);
console.log(`  ${data.docs.length} pieces · ${lex.terms.split(' ').length} terms · ${lex.postings.reduce((n, p) => n + p.length, 0)} term-to-piece pairs · ${lex.strong.length} title/heading terms`);
console.log(`  ${data.vec.length} vectors of ${data.vec[0].length} int8 dims · ${data.graph.link.length} links · ${data.graph.cites.length} citations over ${data.graph.source.length} works`);

/* ---------- 2. the shared hash ---------- */

const sample = lex.terms.split(' ').filter((_, i) => i % 97 === 0).concat(['dafsa', 'wetiko', 'proclus']);
const badHash = sample.filter((t) => S.fnv1a(t) !== fnvRef(t));
check(badHash.length === 0, `the shipped FNV-1a matches an independent implementation (${sample.length} terms sampled)` +
  (badHash.length ? ` — first disagreement: ${badHash[0]}` : ''));
check(S.DIM === data.dim, `the client's dimension is the page's (${S.DIM})`);

/* ---------- 3. the shipped vectors, rebuilt from the prose ---------- */

/**
 * Every vector, recomputed here from content/ — its own tokenisation, its own
 * FNV-1a, the page's own idf rule — and compared with what the page shipped.
 * This is the test that the BUILD and the CLIENT project a term into the same
 * dimension with the same sign and weight; a disagreement in either,
 * quantisation included, shows up here as a difference and nowhere else.
 */
console.log('== the vectors, rebuilt from the prose');
const vocab = lex.terms.split(' ');
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

/* ---------- 4. rare exact terms: the answer IS what the prose says ---------- */

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

/* ---------- 5. a prefix ---------- */

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

/* ---------- 6. garbage ---------- */

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

/* ---------- 7. the datalog rules actually fire ---------- */

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

/* ---------- 7b. the graph-only cap reports what it dropped ---------- */

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

/* ---------- 8. the box, the URL, the rendering ---------- */

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
check(/^\/[a-z0-9-]+\/$/.test(firstLink.getAttribute('href')), `a result links to a piece (${firstLink.getAttribute('href')})`);
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

/* ---------- 9. the command line reaches the search page ---------- */

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

/* ---------- 10. the latency ---------- */

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

console.log(failures === 0 ? '\nSEARCH SMOKE TEST PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
