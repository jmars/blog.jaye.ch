#!/usr/bin/env node
/**
 * tools/library-app-smoke.mjs — the reader app, run as a browser runs it.
 *
 * static checks and the build's leak gate prove the shell is valid and leaks
 * nothing; none of them prove the app BOOTS, resolves a citation, opens a note or
 * comes back to where the reader was. This loads the BUILT shell into a real DOM
 * (happy-dom), evaluates the page's scripts in document order exactly as a
 * browser would — the inlined, stripped bundle and the boot script that mounts it
 * — and drives the reader the way a reader does: by fragment, by click, by key.
 *
 * Every assertion below is paired with what would break it, and each is scoped to
 * `#reader-app` (the app's own output) rather than the page: the shell also
 * server-renders the contents list and the first section for readers without
 * scripts, so an assertion run over the whole page would pass even if the app
 * rendered nothing at all.
 *
 * Run against a built tree:
 *
 *     LIBRARY=1 SKIP_CSS=1 ./build.sh && node tools/library-app-smoke.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SLUG = 'porphyry-on-the-cave-of-the-nymphs-taylor-1917';
const SHELL = join(ROOT, 'dist', 'library', SLUG, 'index.html');
const DOC = join(ROOT, 'dist', 'library', SLUG, 't');

function happyDom() {
  const require = createRequire(import.meta.url);
  const candidates = [
    process.env.HAPPY_DOM,
    join(ROOT, 'node_modules', 'happy-dom'),
    join(ROOT, '..', 'fixpoint-linux', 'fixpointlinux.org', 'node_modules', 'happy-dom'),
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return require(c).Window;
  throw new Error(`happy-dom not found (looked in ${candidates.join(', ')}; set HAPPY_DOM=...)`);
}

let failures = 0;
const check = (cond, msg) => {
  console.log((cond ? '  OK   ' : '  FAIL ') + msg);
  if (!cond) failures += 1;
};
const section = (name) => console.log(`\n${name}`);
/** How many PASSAGES the served document holds a query in, recomputed here from
 * the document rather than read off the app — an expectation copied from the
 * thing under test asserts only that the app is self-consistent. The reading
 * view's rules are applied first, because that is the text the app searches. */
function occurrenceCounts(q = 'mithra') {
  const SLUGDOC = JSON.parse(readFileSync(DOC, 'utf8'));
  const rules = SLUGDOC.corrections || [];
  const apply = (s) => rules.reduce((acc, r) => acc.split(r.find).join(r.repl), s);
  let region = '';
  let hits = 0;
  for (const b of SLUGDOC.blocks) {
    if (b.t === 'region') region = b.kind;
    if (region !== 'body' && region !== 'notes') continue;
    const text = b.x ? apply(b.x) : '';
    if (text.toLowerCase().includes(q)) hits += 1;
  }
  return { hits };
}

const pctOf = (ctx) => {
  const el = ctx.w.document.querySelector('#reader-app [data-progress]');
  return el ? Number(el.getAttribute('data-progress')) : -1;
};

if (!existsSync(SHELL) || !existsSync(DOC)) {
  console.error(
    `library-app-smoke: ${SHELL.slice(ROOT.length + 1)} is not built.\n` +
      '  Build it first: LIBRARY=1 SKIP_CSS=1 ./build.sh',
  );
  process.exit(1);
}

const Window = happyDom();
const html = readFileSync(SHELL, 'utf8');
const docText = readFileSync(DOC, 'utf8');
const headInner = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>'));
const bodyInner = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));

/** A stub's own globals, installed the way a classic script reads them. The
 * compiled bundle captures `document` and `requestAnimationFrame` once, at
 * evaluation, so the DOM has to be on the global object BEFORE the code runs. */
function installGlobals(w, fetchImpl) {
  const names = [
    'window', 'document', 'navigator', 'location', 'history', 'customElements', 'performance',
    'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'sessionStorage',
    'getComputedStyle', 'matchMedia', 'IntersectionObserver', 'HTMLElement', 'HTMLDivElement',
    'HTMLSpanElement', 'HTMLAnchorElement', 'HTMLButtonElement', 'HTMLInputElement',
    'HTMLParagraphElement', 'Element', 'Node', 'Document', 'DocumentFragment', 'Text', 'Comment',
    'NodeList', 'HTMLCollection', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'UIEvent',
    'EventTarget', 'MutationObserver',
  ];
  const bound = new Set(['requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'matchMedia']);
  for (const name of names) {
    const value = w[name];
    if (value === undefined) continue;
    Object.defineProperty(globalThis, name, {
      value: bound.has(name) && typeof value === 'function' ? value.bind(w) : value,
      configurable: true,
      writable: true,
    });
  }
  globalThis.fetch = fetchImpl;
  globalThis.setTimeout = w.setTimeout.bind(w);
  globalThis.clearTimeout = w.clearTimeout.bind(w);
}

const settle = async () => {
  // the fetch is a promise chain, then Elm renders on an animation frame (and
  // happy-dom's frames are real time). Node's own timers are used rather than the
  // window's: the window's timer is one of the globals a boot installs, and a
  // test must not measure itself.
  for (let i = 0; i < 8; i += 1) await sleep(12);
};

/** Boot the built shell the way a browser does: parse it, then run its scripts
 * in document order, skipping the data block (which is not a script). */
async function boot({ hash = '', stored = null } = {}) {
  const w = new Window({ url: `http://localhost/library/${SLUG}/${hash}` });
  installGlobals(w, () => Promise.resolve({ ok: true, text: () => Promise.resolve(docText) }));

  const scrolled = [];
  const focused = [];
  w.HTMLElement.prototype.scrollIntoView = function () {
    scrolled.push(this.id);
  };
  const realFocus = w.HTMLElement.prototype.focus;
  w.HTMLElement.prototype.focus = function () {
    focused.push(this.id);
    if (realFocus) realFocus.call(this);
  };

  w.document.head.innerHTML = headInner;
  w.document.body.innerHTML = bodyInner;
  if (stored !== null) {
    w.localStorage.setItem(`library:${SLUG}`, JSON.stringify(stored));
  }

  const scripts = [...w.document.querySelectorAll('script')].filter((s) => {
    const t = s.getAttribute('type');
    return !t || /javascript|module/i.test(t);
  });
  // a fresh page has a fresh Elm: the compiled bundle refuses to export a module
  // name that is already on the global object, which is exactly what a second
  // boot in one process would look like
  try {
    delete globalThis.Elm;
  } catch (e) {
    globalThis.Elm = undefined;
  }
  for (const s of scripts) {
    // eslint-disable-next-line no-eval -- an indirect eval is how a classic
    // script runs: in the global scope, which is where Elm binds itself
    (0, eval)(s.textContent);
  }
  await settle();

  return {
    w,
    scrolled,
    focused,
    app: () => w.document.getElementById('reader-app'),
    text: () => (w.document.getElementById('reader-app') || { innerHTML: '' }).innerHTML,
    click(el) {
      el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
    },
    byText(sel, needle) {
      return [...w.document.querySelectorAll(sel)].find((e) => e.textContent.includes(needle));
    },
  };
}


/* ---------- 1. it boots, renders, and puts the server copy away ---------- */

section('the app boots (the served document, rendered)');
{
  const ctx = await boot();
  const out = ctx.text();
  if (!out.includes('What does Homer obscurely signify')) console.log(`       (rendered: ${JSON.stringify(out.slice(0, 300))})`);
  check(out.includes('What does Homer obscurely signify'), 'section 1 of the served document is in the DOM');
  // FAILS IF: the bundle does not boot, the fetch is not wired, the document
  // decoder rejects it, or the render never happens.
  check(out.includes('rd-sec') && out.includes('id="s18"'), 'all 18 divisions are rendered (s1…s18)');
  // FAILS IF: the flow is truncated, or a block type is dropped by the decoder.
  check(out.includes('id="p58"'), 'the printed pages are rendered to the last one (p58)');
  // FAILS IF: page markers are parsed but not rendered, or the last marker is lost.
  const fallback = ctx.w.document.getElementById('reader-fallback');
  check(fallback === null, 'the server-rendered copy is taken out of the document once the app is up');
  // FAILS IF: the boot script leaves it — the reader would see the whole book
  // twice, and every anchor id would exist twice.
  check(out.includes('rd-fb-toc') === false, 'and the app does not duplicate the contents list');
  // the ids are the citation grammar, so each must exist exactly once in the
  // document the reader is looking at
  const dupes = ['s4', 'p15', 'r1', 's1-1'].filter((aid) => ctx.w.document.querySelectorAll('#' + aid).length !== 1);
  check(dupes.length === 0, `every citation anchor exists exactly once${dupes.length ? ` (duplicated: ${dupes.join(', ')})` : ''}`);
  // FAILS IF: the server-rendered copy is left in place — MEASURED, it did: it
  // came first in the document, so #s4 resolved to the hidden copy and a
  // citation link scrolled nowhere.
  const mine = ctx.w.document.getElementById('s4');
  check(!!mine && !!(mine.closest && mine.closest('#reader-app')), 'and #s4 resolves inside the app, not to a hidden copy');
  // FAILS IF: the document order is inverted again, or the copy is not removed.
}

/* ---------- 2. #s4 resolves ---------- */

section('#s4 — a section citation');
{
  const ctx = await boot({ hash: '#s4' });
  check(ctx.scrolled.includes('s4'), 'the app scrolled to s4');
  // FAILS IF: the hash is not read at load, the anchor map has no s4, or the
  // scroll port is not wired.
  const sec = ctx.w.document.querySelector('#reader-app #s4');
  check(!!sec, 'the section element carries the anchor s4');
  // FAILS IF: sections render without their own ids.
  const first = ctx.w.document.querySelector('#reader-app #s4-1');
  check(!!first && /theologists/i.test(first.textContent), 'and section 4’s first paragraph is rendered under it');
  // FAILS IF: the divisions are rendered but their paragraphs are not, or the
  // paragraph anchor (the reserved #s4-3 grammar) is not materialised.
  const out = ctx.text();
  check(out.includes('rd-cur'), 'the contents list highlights the section the reader is in');
  // FAILS IF: the current-section derivation ignores the position.
}

/* ---------- 3. #p15 resolves ---------- */

section('#p15 — a citation by printed page');
{
  const ctx = await boot({ hash: '#p15' });
  check(ctx.scrolled.includes('p15'), 'the app scrolled to the page marker p15');
  // FAILS IF: page anchors are not rendered, or #p… is not in the anchor map.
  const p15 = ctx.w.document.querySelector('#reader-app #p15');
  check(!!p15 && p15.textContent.trim() === '15', 'the marker says 15');
  // FAILS IF: the marker prints a fabricated or shifted number.
  check(p15 && p15.getAttribute('data-page') === '15', 'and it is the printed page 15 of the volume');
}

/* ---------- 4. a note reference opens, and returns ---------- */

section('a note: the reference opens it, and coming back');
{
  const ctx = await boot();
  const ref = ctx.w.document.querySelector('#reader-app #r1');
  check(!!ref, 'note 1 has a reference control');
  // FAILS IF: references render as plain text, or the return anchor is missing.
  ctx.click(ref);
  await settle();
  const pop = ctx.w.document.querySelector('#reader-app #rd-pop');
  check(!!pop, 'clicking it opens the note');
  // FAILS IF: the click is not wired to the model, or the popover renders nothing.
  check(!!pop && /Cronius/.test(pop.textContent), 'the note’s own words are in it');
  // FAILS IF: the popover shows the number without the note text (a link, not a note).
  check(ctx.focused.includes('rd-pop'), 'and focus moved into it');
  // FAILS IF: the open leaves focus behind, which a keyboard reader notices at once.
  const back = pop && ctx.byText('#reader-app #rd-pop button', 'return');
  check(!!back, 'the note offers a way back to the reference');
  if (back) {
    ctx.click(back);
    await settle();
    check(!ctx.w.document.querySelector('#reader-app #rd-pop'), 'and taking it closes the note');
    // FAILS IF: the return control does not close, or closes into a dead end.
    check(ctx.scrolled.includes('r1'), 'and puts the reader back at the reference');
    // FAILS IF: the return anchor is not the reference's own id.
  }
}

/* ---------- 5. jump to a printed page ---------- */

section('jump to page');
{
  const ctx = await boot();
  const input = ctx.w.document.getElementById('rd-jump');
  const go = ctx.w.document.querySelector('#reader-app .rd-pager button:not([disabled])');
  check(!!input && !!go, 'the jump control is there');
  // FAILS IF: the pager is not rendered.
  input.value = '15';
  input.dispatchEvent(new ctx.w.Event('input', { bubbles: true }));
  await settle();
  // the "go" button is the one whose text is exactly that
  const goBtn = [...ctx.w.document.querySelectorAll('#reader-app .rd-pager button')].find(
    (b) => b.textContent.trim() === 'go',
  );
  check(!!goBtn, 'the go button is there');
  if (goBtn) {
    ctx.click(goBtn);
    await settle();
    check(ctx.scrolled.includes('p15'), 'it lands on the page marker p15');
    // FAILS IF: the number is not read, the page index is wrong, or the anchor
    // it lands on belongs to a different leaf.
    const here = ctx.w.document.querySelector('#reader-app .rd-here');
    check(!!here && /p\. 15/.test(here.textContent), 'and the reader’s position now says p. 15');
    // FAILS IF: the position readout is derived from something other than the jump.
  }
}

/* ---------- 6. resume ---------- */

section('resume');
{
  const ctx = await boot({ stored: { position: 's4', page: 14, section: 's4', bookmarks: [], view: 'reading', scale: 3 } });
  check(ctx.scrolled.includes('s4'), 'a stored position is restored on load');
  // FAILS IF: the page does not hand the stored record to the app, the position
  // is not consulted, or the scroll port is dead.
  const ctx2 = await boot({ hash: '#p15', stored: { position: 's10', bookmarks: [], view: 'reading', scale: 3 } });
  check(ctx2.scrolled.includes('p15') && !ctx2.scrolled.includes('s10'), 'a fragment wins over the stored position');
  // FAILS IF: a citation link opens at last week's reading position instead.
}

/* ---------- 7. the two views differ, and only one is repaired ---------- */

section('reading and transcription');
{
  const ctx = await boot();
  const reading = ctx.text();
  check(reading.includes('1. What does Homer'), 'the reading view carries the repaired section opener');
  // FAILS IF: the correction rules are not applied client-side.
  check(!reading.includes('I i. What does Homer'), 'and not the transcription’s damaged numeral');
  // FAILS IF: the reading view serves the verbatim blocks.
  const toggle = ctx.byText('#reader-app .rd-views button', 'transcription');
  check(!!toggle, 'the transcription view is offered');
  if (toggle) {
    ctx.click(toggle);
    await settle();
    const transcription = ctx.text();
    check(transcription.includes('I i. What does Homer'), 'the transcription view carries the verbatim block');
    // FAILS IF: repairs were baked into the served text — the transcription view
    // is the whole reason they are not.
    check(!transcription.includes('1. What does Homer'), 'and not the repair');
    check(reading !== transcription, 'the same block reads two ways');
    // FAILS IF: the two views are the same text with a different label.
  }
}

/* ---------- 7b. the contents list, and the titles that could not be repaired ---------- */

section('the contents list: a damaged title is stated, not shipped');
{
  const DOCJSON = JSON.parse(docText);
  const marked = DOCJSON.toc.filter((t) => t.damaged);
  // recomputed from the served document, not read off the app
  const DAMAGED = '[the opening words are damaged in this transcription]';
  const ctx = await boot();
  const toc = ctx.w.document.querySelector('#reader-app .rd-toc');
  check(!!toc, 'the contents list is rendered');
  const labels = [...toc.querySelectorAll('a')].map((a) => a.textContent);
  const raw = marked.map((t) => t.raw);
  check(
    marked.length > 0 && raw.every((r) => r.includes('^') || r.includes('_')),
    `the document marks ${marked.length} title(s) damaged, and each carries the transcription's damaged words ` +
      `(${marked.map((t) => `§${t.n}`).join(', ')})`,
  );
  // the LABELS are the titles: the damaged words may stand beside an entry as its
  // evidence, but they must never BE the entry
  check(
    labels.every((l) => !raw.some((r) => l.includes(r))),
    `no damaged title is offered as a title in the reading view (${JSON.stringify(raw.map((r) => r.slice(0, 24)))})`,
  );
  check(
    labels.filter((l) => l.includes(DAMAGED)).length === marked.length,
    `and each marked division's entry states the gap instead (${labels.filter((l) => l.includes(DAMAGED)).length} of ${marked.length})`,
  );
  check(
    raw.every((r) => toc.textContent.includes(`the transcription reads “${r}”`)),
    'and each entry carries those words beside the statement, so nothing is hidden',
  );
  // §11 is the counter-case: its damage is repaired by a READING rule (the
  // opener states the print's number), so its title must be shown, not flagged
  const s11 = DOCJSON.toc.find((t) => t.n === 11);
  check(
    !s11.damaged && toc.textContent.includes(s11.title) && toc.textContent.includes(DAMAGED),
    `§11's title is shown (its opener rule reads the print's own words) while the flagged entries state the gap ` +
      `(${JSON.stringify(s11.title)})`,
  );
  // the transcription view shows the transcription's own title words, and keeps
  // the flag: neither view offers damaged words as a title
  const toggle = ctx.byText('#reader-app .rd-views button', 'transcription');
  ctx.click(toggle);
  await settle();
  const toc2 = ctx.w.document.querySelector('#reader-app .rd-toc');
  const clean = DOCJSON.toc.filter((t) => !t.damaged);
  check(
    clean.every((t) => toc2.textContent.includes(t.raw)),
    `the transcription view derives every undamaged title from the transcription's own words ` +
      `(${clean.length} checked)`,
  );
  check(
    [...toc2.querySelectorAll('a')].filter((a) => a.textContent.includes(DAMAGED)).length === marked.length,
    `and the flagged entries state the gap in the transcription view too (${marked.length})`,
  );
  // FAILS IF: the title is derived from the raw words in the reading view (the
  // defect this section exists for), or a damaged title is quietly shipped.
}

/* ---------- 7c. the repairs list, with the measured hit counts ---------- */

section('the repairs list is the rule list, with its measured hits');
{
  const DOCJSON = JSON.parse(docText);
  const ctx = await boot();
  const btn = ctx.byText('#reader-app .rd-bar button', 'repairs');
  check(!!btn, 'the repairs control is there');
  if (btn) {
    ctx.click(btn);
    await settle();
    const panel = ctx.w.document.querySelector('#reader-app .rd-diff');
    check(!!panel, 'and it opens the rule list');
    // FAILS IF: the panel is not rendered, or the toggle is not wired.
    const rows = [...panel.querySelectorAll('tbody tr')];
    check(
      rows.length === DOCJSON.corrections.length,
      `every rule is listed, and no others (${rows.length} of ${DOCJSON.corrections.length})`,
    );
    // FAILS IF: the list is filtered, truncated or derived from something else.
    const tbl = rows.map((tr) => {
      const td = tr.querySelectorAll('td');
      return { cls: td[0].textContent.trim(), find: td[1].textContent, repl: td[2].textContent, hits: td[3].textContent.trim(), why: td[4].textContent };
    });
    check(
      tbl.every((r, i) => r.find === DOCJSON.corrections[i].find && r.repl === DOCJSON.corrections[i].repl && r.cls === DOCJSON.corrections[i].cls),
      'each row is the document\'s own rule, in the document\'s order',
    );
    // the hit count is the DOCUMENT's measurement, recomputed here from the
    // document: a rule applied in order to every block, counting what it changes
    const mine = DOCJSON.corrections.map(() => 0);
    for (const b of DOCJSON.blocks) {
      if (typeof b.x !== 'string') continue;
      let text = b.x;
      DOCJSON.corrections.forEach((r, i) => {
        const parts = text.split(r.find);
        if (parts.length > 1) {
          mine[i] += parts.length - 1;
          text = parts.join(r.repl);
        }
      });
    }
    check(
      tbl.every((r, i) => r.hits === String(mine[i])) && rows.length > 0,
      `and each row's count is the number of times that rule fires, recomputed from the served document ` +
        `(${tbl.filter((r, i) => r.hits === String(mine[i])).length} of ${tbl.length}; max ${Math.max(...mine)})`,
    );
    // FAILS IF: the count is re-derived in the view from the wrong text (a rule
    // shown as firing twice when it fires once), or any rule shows 0 — which the
    // build would not have let through.
    check(
      tbl.every((r) => r.hits !== '0'),
      `no rule is listed as firing zero times (the build refuses that)`,
    );
    check(
      tbl.filter((r) => r.hits !== '1').length === DOCJSON.correctionsMeta.repeated.length,
      `the rules that fire more than once are the ${DOCJSON.correctionsMeta.repeated.length} the document names ` +
        `(${DOCJSON.correctionsMeta.repeated.map((r) => `${JSON.stringify(r.find)} ×${r.hits}`).join(', ')})`,
    );
    check(
      tbl.every((r) => r.why.length > 0),
      'and every rule says why it is there — a rule with no reason is not reviewable',
    );
  }
}

/* ---------- 8. the keys ---------- */

section('keyboard');
{
  const ctx = await boot();
  const main = ctx.w.document.getElementById('rd-main');
  main.dispatchEvent(new ctx.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await settle();
  check(ctx.scrolled.includes('p5'), 'an arrow key from the front matter steps into the text');
  // FAILS IF: the key handler is not bound, needs a click first, or a step from
  // the front matter (which has no printed page) is a no-op.
  const page = await boot({ hash: '#s4' });
  const mainPage = page.w.document.getElementById('rd-main');
  mainPage.dispatchEvent(new page.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await settle();
  check(page.scrolled.includes('p15'), 'the arrow key from section 4 moves one PRINTED PAGE (p15)');
  // FAILS IF: the page grain is not the page index, or s4 does not sit on p14.
  const sec = await boot({ hash: '#s4' });
  const mainSec = sec.w.document.getElementById('rd-main');
  mainSec.dispatchEvent(new sec.w.KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
  await settle();
  check(sec.scrolled.includes('s5'), 'shift plus the arrow moves one SECTION (s5)');
  // FAILS IF: the two grains are not distinguished, or shift is ignored.
  check(!sec.scrolled.includes('p15'), 'and the section grain does not take the page grain’s target');
}

section('the running heads, the citation and the progress');
{
  const ctx = await boot({ hash: '#p16' });
  check(ctx.w.document.querySelectorAll('#reader-app .rd-rh').length === 0, 'the reading view shows no running heads');
  // FAILS IF: the furniture is not suppressed — the page numbers inside the
  // heads then read as prose ("6 ON THE CAVE OF THE NYMPHS" mid-sentence).
  const t = ctx.byText('#reader-app .rd-views button', 'transcription');
  ctx.click(t);
  await settle();
  const heads = ctx.w.document.querySelectorAll('#reader-app .rd-rh').length;
  check(heads > 0, `the transcription view shows them (${heads} running heads)`);
  // FAILS IF: the two views are the same rendering — the transcription is the
  // verbatim blocks, furniture included.

  const cite = await boot({ hash: '#p15' });
  const citeBtn = ctx.byText('#reader-app .rd-bar-right button', 'cite');
  check(!!citeBtn, 'the citation control is there');
  // FAILS IF: the panel has no way in.
}
{
  const ctx = await boot({ hash: '#p15' });
  ctx.click(ctx.byText('#reader-app .rd-bar-right button', 'cite'));
  await settle();
  const line = ctx.w.document.querySelector('#reader-app [data-cite="line"]');
  check(!!line, 'the citation panel opens and carries a citation line');
  // FAILS IF: the panel is not rendered, or the line has no seat.
  const want =
    'Porphyry, On the Cave of the Nymphs, trans. Thomas Taylor (London: John M. Watkins, 1917), p. 15';
  const got = line ? line.textContent.replace(/\s+/g, ' ').trim() : '';
  check(got === want, `and it reads exactly the edition's line (${JSON.stringify(got)})`);
  // FAILS IF: the citation is built from anything but the document's own edition
  // metadata — the plan's string, character for character, with p. 15 because the
  // reader is on #p15.
  const url = ctx.w.document.querySelector('#reader-app .rd-cite-url');
  check(!!url && url.getAttribute('href').endsWith(`/library/${SLUG}/#p15`), 'and it names the URL a citation needs');
  // FAILS IF: the URL is missing or points somewhere the page does not resolve.
}

{
  // the progress meter excludes the front matter and the advertisements: the
  // region marks exist for exactly this, and a reader who has finished the notes
  // has finished the book whatever the publisher's catalogue after it says.
  //
  // Driven by JUMPS, not by scrolling: happy-dom has no layout, so every
  // element's rect is zero and a scroll-derived position would report whatever
  // the instrument happens to compute rather than what the page does. The
  // scroll path is checked in a real browser instead (the render pass).
  const atFront = await boot();
  const frontPct = pctOf(atFront);
  check(frontPct === 0, `a reader in the front matter has read 0% (${frontPct}%)`);
  // FAILS IF: the front matter is counted — the book then opens part-read.
  const atNotes = await boot({ hash: '#n25' });
  const notesPct = pctOf(atNotes);
  check(notesPct === 100, `a reader at the last note has read the whole text (${notesPct}%)`);
  // FAILS IF: the advertisements are counted — the last note then reads well
  // below 100%, which is the bug the region marks exist to prevent.
  const atAds = await boot({ hash: '#s9' });
  const midPct = pctOf(atAds);
  check(midPct > 20 && midPct < 70, `and a reader in section 9 is part-way through (${midPct}%)`);
  // FAILS IF: the meter is not derived from the position at all, or the region
  // marks are misattributed (every entry reading as the same region).
}

{
  // a page the extraction REFUSED to number: the transcription's own characters
  // are shown and the marker says they are not a number. Two of this volume's
  // pages are refused (pp. 22, 42-43 region), and they must not be silent.
  const ctx = await boot();
  const refused = ctx.w.document.querySelectorAll('#reader-app [data-page="refused"]');
  check(refused.length === 2, `the two refused page markers are rendered (${refused.length})`);
  // FAILS IF: a refused page is dropped from the rendering (a reader then cannot
  // see that the volume has a gap), or a number is invented for it.
  const texts = [...refused].map((r) => r.textContent);
  check(
    texts.every((t) => !/^\s*\d+\s*$/.test(t)) && texts.some((t) => t.includes('could not be read')),
    `and they say what they are, not a number (${JSON.stringify(texts)})`,
  );
  // FAILS IF: the marker prints a plausible number — the fabrication the plan's
  // refusal rule exists to prevent.
  check(
    [...refused].every((r) => /\[\s*(?:3|43)\s/.test(r.textContent)),
    `and each carries the transcription's own characters (${JSON.stringify(texts)})`,
  );
  // FAILS IF: the marker is drawn from the page number rather than the source.
}

{
  // search runs over the text proper only: the front matter is the title page,
  // and the advertisements are the publisher's catalogue
  const ctx = await boot();
  const q = ctx.w.document.getElementById('rd-q');
  q.value = 'Watkins';
  q.dispatchEvent(new ctx.w.Event('input', { bubbles: true }));
  await settle();
  const count = ctx.w.document.querySelector('#reader-app .rd-count').textContent.trim();
  check(count === 'no match', `a word in the advertisements is not found (${JSON.stringify(count)})`);
  // FAILS IF: the ads region is searched — "Watkins" is on the title page, in the
  // advertisements, and nowhere in the text.
  q.value = 'Mithra';
  q.dispatchEvent(new ctx.w.Event('input', { bubbles: true }));
  await settle();
  const hits = ctx.w.document.querySelector('#reader-app .rd-count').textContent.trim();
  // the count is the number of PASSAGES holding the query, which is what the
  // next/prev controls step between — labelled as such, so the number cannot be
  // read as something it is not
  const { hits: occurrences } = occurrenceCounts();
  check(hits === `1 of ${occurrences} passages`, `a word in the text is found, with its count (${JSON.stringify(hits)})`);
  // FAILS IF: the search is inert, or the count is not what the text holds —
  // recomputed here from the served document, never from the app.
  // FAILS IF: the search is inert, or finds nothing in a word the text holds.
  const next = ctx.byText('#reader-app .rd-search button', '↓');
  check(!!next && !next.disabled, 'and next/prev are enabled once there is a match');
  // FAILS IF: the controls are not wired to the hit list.
}

console.log(
  failures === 0
    ? `\nAPP SMOKE PASSED (${html.length} B shell, ${docText.length} B document)`
    : `\n${failures} FAILURE(S)`,
);
process.exit(failures === 0 ? 0 : 1);
