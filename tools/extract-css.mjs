#!/usr/bin/env node
/**
 * tools/extract-css.mjs — renders design/blog.css from the
 * jmars/blog-design Elm package (the submodule at vendor/blog-design; a
 * light "paper" fork of the fixpoint-linux design system) and writes it to
 * design/blog.css.
 *
 * Mirrors the happy-dom boot in fixpointlinux.org/scripts/ssg.mjs: install
 * happy-dom globals onto globalThis, load a compiled Elm bundle with an
 * indirect eval (the IIFE binds `this` to globalThis), init the program, and
 * read back what it emits. Here the program is a Platform.worker that pushes
 * `Fixpoint.Style.css` out through a port — no DOM rendering needed.
 *
 * The design package sources are read in place (never copied or edited):
 * see elm/elm.json `source-directories` (the vendor/blog-design submodule).
 *
 *   node tools/extract-css.mjs            (run from the repo root)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BUNDLE = join(ROOT, 'elm', 'ExtractCss.js');
const OUT = join(ROOT, 'design', 'blog.css');

// happy-dom discovery: prefer ./node_modules (a plain `npm i` here), else the
// sibling fixpoint-linux checkout's node_modules (unchanged fallback). elm
// itself is resolved by build.sh (which guards this script).
const LOCAL = join(ROOT, 'node_modules');
const SITE = join(ROOT, '..', 'fixpoint-linux', 'fixpointlinux.org');
const BASE = existsSync(join(LOCAL, 'happy-dom'))
  ? LOCAL
  : existsSync(join(SITE, 'node_modules', 'happy-dom'))
    ? SITE
    : null;
if (!BASE) {
  console.error(
    '[extract-css] happy-dom not found: run `npm i elm@0.19.2 happy-dom` here, or provide the sibling ../fixpoint-linux/fixpointlinux.org checkout.'
  );
  process.exit(1);
}
const require = createRequire(join(BASE, 'package.json'));
const { Window } = require('happy-dom');

const log = (msg) => console.log(`[extract-css] ${msg}`);

function installGlobals(window) {
  const globals = [
    'window',
    'document',
    'navigator',
    'location',
    'history',
    'customElements',
    'performance',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'HTMLElement',
    'HTMLDivElement',
    'HTMLSpanElement',
    'HTMLAnchorElement',
    'HTMLButtonElement',
    'HTMLTableElement',
    'Element',
    'Node',
    'Document',
    'DocumentFragment',
    'Text',
    'Comment',
    'NodeList',
    'HTMLCollection',
    'Event',
    'CustomEvent',
    'MouseEvent',
    'KeyboardEvent',
    'UIEvent',
    'EventTarget',
    'MutationObserver',
    'getComputedStyle',
    'matchMedia',
  ];
  for (const name of globals) {
    const value = window[name];
    if (value === undefined) continue;
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
    });
  }
}

async function main() {
  const window = new Window();
  installGlobals(window);

  const code = readFileSync(BUNDLE, 'utf8');
  // eslint-disable-next-line no-eval -- indirect eval runs in global scope so
  // the bundle's IIFE `(this)` binds to globalThis and defines globalThis.Elm.
  (0, eval)(code);

  const Elm = globalThis.Elm;
  if (!Elm || !Elm.ExtractCss || typeof Elm.ExtractCss.init !== 'function') {
    throw new Error('elm/ExtractCss.js did not expose Elm.ExtractCss.init');
  }

  const css = await new Promise((resolve, reject) => {
    const app = Elm.ExtractCss.init();
    app.ports.cssOut.subscribe((value) => resolve(value));
    setTimeout(() => reject(new Error('port timed out')), 10_000);
  });

  if (!css.startsWith('/* blog.css')) {
    throw new Error(`rendered CSS looks wrong (first 80 chars: ${JSON.stringify(css.slice(0, 80))})`);
  }

  mkdirSync(join(ROOT, 'design'), { recursive: true });
  // byte-faithful: the string already ends in a newline (final list item "")
  writeFileSync(OUT, css);
  log(`wrote ${OUT} (${css.length} bytes)`);
}

main().catch((err) => {
  console.error('[extract-css] failed:', err);
  process.exit(1);
});
