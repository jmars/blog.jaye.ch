/**
 * tools/viz-smoke.mjs — runtime test for the interactive figures.
 *
 * static syntax (`node --check`) proves a widget parses; it does not prove the
 * widget mounts, draws, responds, or tears down. This loads each BUILT page into
 * a real DOM (happy-dom), runs the page's inlined engine+widgets exactly as a
 * browser would, and then:
 *   - mounts every [data-viz] slot on DOMContentLoaded, and only then;
 *   - drives every slider (min/mid/max) and every button, one action at a time,
 *     and checks SOMETHING updated (a coarse before/after misses a toggle pair
 *     that cancels, or a value clamped at its initial setting);
 *   - checks every text label landed inside its canvas (a layout assertion);
 *   - unmounts everything and checks the canvas and controls are gone and the
 *     authored markup (noscript + caption) survives.
 *
 * The page list is discovered from posts.json, so a new post with a figure is
 * covered with no change here. Run it against a normal or a PREVIEW build:
 *
 *     PREVIEW=1 SKIP_CSS=1 ./build.sh && node tools/viz-smoke.mjs
 *
 * happy-dom is discovered the way the build discovers it (the repo's
 * node_modules, then the fixpoint-linux sibling checkout); override with
 * HAPPY_DOM=/path/to/node_modules/happy-dom.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

function loadHappyDom() {
  const candidates = [
    process.env.HAPPY_DOM,
    join(ROOT, 'node_modules', 'happy-dom'),
    join(ROOT, '..', 'fixpoint-linux', 'fixpointlinux.org', 'node_modules', 'happy-dom'),
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c)) return require(c).Window;
  }
  throw new Error(
    'viz-smoke: happy-dom not found. Looked in:\n  ' + candidates.join('\n  ') +
    '\nSet HAPPY_DOM=/path/to/node_modules/happy-dom to point at a copy.'
  );
}
const Window = loadHappyDom();

const CTX_METHODS = ['setTransform','clearRect','save','restore','beginPath','moveTo','lineTo',
  'stroke','fill','fillRect','rect','arc','fillText','closePath','setLineDash','measureText'];

/** slug -> the widgets its built page declares, discovered from the manifest. */
function pages() {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'posts.json'), 'utf8'));
  const out = [];
  for (const p of manifest.posts) {
    const file = join(ROOT, 'dist', p.slug, 'index.html');
    if (!existsSync(file)) continue;
    const html = readFileSync(file, 'utf8');
    const names = [...html.matchAll(/data-viz=(["'])([a-z0-9-]+)\1/g)].map((m) => m[2]);
    if (names.length) out.push([p.slug, names]);
  }
  return out;
}

let failures = 0;
const check = (cond, msg) => {
  console.log((cond ? '  OK   ' : '  FAIL ') + msg);
  if (!cond) failures++;
};

const list = pages();
if (!list.length) {
  console.error('viz-smoke: no built page carries a figure. Build first (see header).');
  process.exit(1);
}

for (const [slug, widgets] of list) {
  const html = readFileSync(join(ROOT, 'dist', slug, 'index.html'), 'utf8');
  const m = html.match(/<script>\n([\s\S]*?)\n<\/script>/);
  if (!m) { check(false, `${slug}: no inline <script> found`); continue; }
  const js = m[1];

  const w = new Window({ width: 1000, height: 800 });
  const d = w.document;
  d.body.innerHTML = html.match(/<body>([\s\S]*)<script>/)[1];
  let state = 'loading';
  Object.defineProperty(d, 'readyState', { get: () => state, configurable: true });

  const calls = new Map();
  const draw = { strokes: 0, texts: 0, fills: 0 };
  const labels = [];
  w.HTMLCanvasElement.prototype.getContext = function () {
    const rec = {};
    for (const mm of CTX_METHODS) rec[mm] = (...a) => {
      calls.set(mm, (calls.get(mm) || 0) + 1);
      if (mm === 'stroke') draw.strokes++;
      if (mm === 'fillText') { draw.texts++; labels.push({ s: String(a[0]), x: a[1], y: a[2] }); }
      if (mm === 'fill') draw.fills++;
      return { width: 20 };
    };
    return rec;
  };
  Object.defineProperty(w.HTMLElement.prototype, 'clientWidth', { get() { return 700; }, configurable: true });

  const injected = js.replace(/\}\)\(\);\s*$/, 'window.__VIZ = VIZ;\n})();');
  if (injected === js) { check(false, `${slug}: could not instrument the inline IIFE`); continue; }
  let VIZ;
  try {
    VIZ = new Function('window','document','setTimeout','clearTimeout','requestAnimationFrame',
      'cancelAnimationFrame','console', injected + '\nreturn window.__VIZ;')(
      w, d, w.setTimeout.bind(w), w.clearTimeout.bind(w),
      w.requestAnimationFrame.bind(w), w.cancelAnimationFrame.bind(w), console);
  } catch (e) {
    check(false, `${slug}: inline script threw on load — ${e.message}`);
    continue;
  }

  console.log(`== ${slug}`);
  check(d.querySelectorAll('[data-viz-mounted]').length === 0, 'nothing mounts while readyState is loading');
  state = 'interactive';
  d.dispatchEvent(new w.Event('DOMContentLoaded'));
  check(d.querySelectorAll('[data-viz-mounted]').length === widgets.length, 'boot() mounted every slot on DOMContentLoaded');
  check(VIZ.names().join(',') === widgets.join(','), `registered ${JSON.stringify(VIZ.names())}`);
  check(draw.strokes > 0 && draw.texts > 0, `the widgets drew (${draw.strokes} strokes, ${draw.texts} labels)`);

  VIZ.boot();
  check(d.querySelectorAll('[data-viz-mounted]').length === widgets.length, 'boot() is idempotent');

  const snap = () => [...d.querySelectorAll('.viz .viz-readout')].map((r) => r.textContent).join('\u0000');
  let prev = snap();
  let changed = false;
  const note = () => { const now = snap(); if (now !== prev) changed = true; prev = now; };
  for (const input of [...d.querySelectorAll('.viz input[type="range"]')]) {
    for (const v of [input.min, String((Number(input.min) + Number(input.max)) / 2), input.max]) {
      input.value = v;
      input.dispatchEvent(new w.Event('input', { bubbles: true }));
      note();
    }
  }
  const buttons = [...d.querySelectorAll('.viz button')];
  for (const b of buttons) { b.dispatchEvent(new w.Event('click', { bubbles: true })); note(); }
  check(true, 'all sliders and buttons driven without throwing');
  check(changed, 'a control changed a readout at some step');

  const maxW = Math.max(0, ...[...d.querySelectorAll('.viz canvas')].map((c) => c.width));
  const maxH = Math.max(0, ...[...d.querySelectorAll('.viz canvas')].map((c) => c.height));
  const bad = labels.filter((l) => l.x < 0 || l.y < 0 || l.x > maxW + 2 || l.y > maxH + 2);
  check(bad.length === 0, `every drawn label is inside its canvas (${labels.length} labels, ${bad.length} out of ${maxW}x${maxH})` +
    (bad.length ? ` e.g. ${JSON.stringify(bad.slice(0, 3))}` : ''));

  for (const b of buttons) b.dispatchEvent(new w.Event('click', { bubbles: true }));

  w.dispatchEvent(new w.Event('resize'));
  check(true, 'resize redraw without throwing');

  const readouts = [...d.querySelectorAll('.viz .viz-readout')];
  check(readouts.length === widgets.length, `${readouts.length} readout line(s)`);
  check(readouts.every((r) => r.textContent.length > 40), 'every readout has content');

  VIZ.unmountAll();
  check(d.querySelectorAll('.viz canvas').length === 0, 'unmountAll removed every canvas');
  check(d.querySelectorAll('.viz .viz-controls').length === 0, 'unmountAll removed every control block');
  check(d.querySelectorAll('[data-viz-mounted]').length === 0, 'the mounted marks are cleared');
  const left = [...d.querySelectorAll('.viz')].map((s) => [...s.children].map((c) => c.tagName).join('+'));
  check(left.every((l) => l === 'NOSCRIPT+P'), `the authored markup survives teardown (${left.join(', ')})`);
}

console.log(failures === 0 ? '\nRUNTIME SMOKE TEST PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
