#!/usr/bin/env node
/**
 * tools/build.mjs — renders content/ Markdown into the self-contained pages of
 * dist/. Design CSS comes from design/blog.css (generated from the
 * jmars/blog-design Elm package — the vendor/blog-design submodule — by
 * tools/extract-css.mjs) and is inlined into every page's <head>. The fork
 * carries the full reading layer (.prose serif typography, blockquotes,
 * tables, footnotes) inside the design system itself, so no page-level CSS
 * is needed any more. No JS, no iframes, no external runtime deps; links are
 * absolute (/…).
 *
 *   node tools/build.mjs            (run from the repo root)
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const CSS = join(ROOT, 'design', 'blog.css');
const PANDOC = process.env.PANDOC || 'pandoc';

const log = (msg) => console.log(`[build] ${new Date().toISOString()} ${msg}`);

/* ---------- chrome (fixpoint-linux design markup) ---------- */

/** Sticky top nav. `home` highlights the current page's link (a.home). */
function nav(current) {
  const link = (url, cls, label) =>
    `<a${cls ? ` class="${cls}"` : ''} href="${url}">${label}</a>`;
  const here = (url, label) =>
    link(url, current === url ? 'home' : '', label);
  return (
    `<nav><div class="wrap">` +
    `<span class="brand"><span><span class="fx">fx</span>://blog</span></span>` +
    `<span class="links">` +
    here('/', 'short cut') +
    here('/meditation-harm/', 'full post') +
    link('https://fixpointlinux.org', '', 'fixpoint-linux') +
    `</span></div></nav>`
  );
}

/** Hero header: terminal prompt line, title, tagline. */
function hero({ prompt, title, tagline }) {
  return (
    `<header><div class="wrap">` +
    `<div class="prompt">` +
    `<span class="hash">#</span> blog.jaye.ch ` +
    `<span class="dollar">$</span> ${prompt}<span class="blink">▊</span>` +
    `</div>` +
    `<h1>${title}</h1>` +
    `<div class="tagline">${tagline}</div>` +
    `</div></header>`
  );
}

function section(h2, hint, body) {
  return (
    `<section><div class="wrap">` +
    `<h2>${h2}</h2>` +
    `<div class="hint">${hint}</div>` +
    `<div class="prose">${body}</div>` +
    `</div></section>`
  );
}

function footer() {
  return (
    `<footer><div class="wrap">` +
    `<a href="/">blog.jaye.ch</a><span class="sep"> · </span>` +
    `design by <a href="https://fixpointlinux.org">fixpoint-linux</a>` +
    `<span class="sep"> · </span>no JS, no trackers` +
    `</div></footer>`
  );
}

/** Page-level CSS layered AFTER the design system.
 *
 * Empty: reading styles (.prose serif typography, blockquotes, tables,
 * footnotes) now live in the blog-design package itself — the design system
 * is the single source of truth for the entire look. Keep this hook for any
 * genuinely page-local one-off rule; do not re-add design rules here.
 */
const PAGE_CSS = ``;

/** Full self-contained document. */
function page({ title, description, prompt, heroTitle, tagline, body, navCurrent }) {
  const designCss = readFileSync(CSS, 'utf8');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<style>
${designCss}</style>
<style>${PAGE_CSS}</style>
</head>
<body>
${nav(navCurrent)}
${hero({ prompt, title: heroTitle, tagline })}
${body}
${footer()}
</body>
</html>
`;
}

/* ---------- markdown → html ---------- */

function mdToHtml(md) {
  return execFileSync(PANDOC, ['-f', 'markdown+footnotes+pipe_tables', '-t', 'html'], {
    input: md,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

/* ---------- pages ---------- */

function buildHome() {
  const md = read('content', 'meditation-harm-summary.md');
  let body = mdToHtml(md);

  // the summary's own H1 becomes the hero title, so it must not repeat in the
  // body; relocate its inner HTML verbatim (normalize the source's line wrap)
  const h1 = /^<h1[^>]*>([\s\S]*?)<\/h1>\n?/.exec(body);
  if (!h1) throw new Error('summary: no leading <h1> found');
  body = body.slice(h1[0].length);
  const titleHtml = h1[1].replace(/\s+/g, ' ').trim();

  const cta =
    `<div class="cta-banner">` +
    `<span><strong>Read the full post</strong> — evidence, mechanism, and why it hides.</span>` +
    `<a class="cta-btn" href="/meditation-harm/">the long version →</a></div>`;

  const html =
    `<section><div class="wrap">` +
    `<h2>Summary</h2>` +
    `<div class="hint">$ cat summary.md</div>` +
    `<div class="prose">${body}</div>\n` +
    cta +
    `</div></section>`;

  return {
    title: 'Meditation can harm — and it does so invisibly — blog.jaye.ch',
    description:
      'Meditation-related harm is common and systematically under-reported: the evidence, and a measured control-theoretic account of why it hides.',
    prompt: 'cat summary.md',
    heroTitle: 'Meditation can harm — and it does so <span class="fx">invisibly</span>',
    tagline: 'the <b>short cut</b>: the evidence-first summary, minus the machinery.',
    body: html,
    navCurrent: '/',
  };
}

function buildPost() {
  const md = read('content', 'meditation-harm.md');
  let body = mdToHtml(md);

  // the long post's own H1 becomes the hero title, so it must not repeat in
  // the body; relocate its inner HTML verbatim (pandoc keeps the source's
  // line wrap inside <h1>, so normalize whitespace runs to single spaces)
  const h1 = /^<h1[^>]*>([\s\S]*?)<\/h1>\n?/.exec(body);
  if (!h1) throw new Error('long post: no leading <h1> found');
  body = body.slice(h1[0].length);
  const titleHtml = h1[1].replace(/\s+/g, ' ').trim();
  const fxTitle = titleHtml.replace(/Failure Mode/, '<span class="fx">Failure Mode</span>');

  // readable notes: keep pandoc's footnote <section>, swap its bare <hr> for
  // the '## Notes' heading already in the source (pandoc 3.x emits
  // class="footnotes footnotes-end" without an epigraph)
  body = body.replace(
    /<section class="footnotes[^"]*">\s*<hr\s*\/?>/,
    '<section class="footnotes" role="doc-endnotes">',
  );

  // the section hint already links back to the summary — no extra back-link
  const html =
    section('The full post', '<a href="/">← short cut</a> · the full mechanism, with notes', body);

  return {
    title: `${titleHtml} — blog.jaye.ch`,
    description:
      'The full post: why meditation harm is under-counted — a measured control-theoretic model of the runaway, the border-collision fold, and why the failure hides itself.',
    prompt: 'cat meditation-harm.md',
    heroTitle: fxTitle,
    tagline: 'the <b>full mechanism</b>: the evidence, the model, the notes.',
    body: html,
    navCurrent: '/meditation-harm/',
  };
}

/* ---------- main ---------- */

function writePage(rel, pageDef) {
  const out = join(DIST, rel);
  mkdirSync(dirname(out), { recursive: true });
  const html = page(pageDef);
  writeFileSync(out, html);
  log(`wrote ${rel} (${Buffer.byteLength(html)} bytes)`);
}

log('building dist/');
if (!existsSync(CSS)) {
  throw new Error(`missing ${CSS} — run tools/extract-css.mjs (or ./build.sh) first`);
}
rmSync(DIST, { recursive: true, force: true });
writePage('index.html', buildHome());
writePage('meditation-harm/index.html', buildPost());
log('done');
