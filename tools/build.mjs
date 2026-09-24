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
 * What gets built is governed by posts.json (repo root) — the release
 * manifest: it lists the home file and the posts IN NAV ORDER, each with its
 * nav label and `published` state. Published posts build to dist/<slug>/;
 * unpublished ones are staged drafts — not written to dist at all and absent
 * from every nav. Flipping `"published": true` is the whole release step.
 *
 *   node tools/build.mjs            (run from the repo root)
 *   PREVIEW=1 node tools/build.mjs  build drafts too — LOCAL PREVIEW ONLY,
 *                                   never deploy a preview build
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const CSS = join(ROOT, 'design', 'blog.css');
const MANIFEST = join(ROOT, 'posts.json');
const PANDOC = process.env.PANDOC || 'pandoc';
const PREVIEW = process.env.PREVIEW === '1';

const log = (msg) => console.log(`[build] ${new Date().toISOString()} ${msg}`);
const warn = (msg) => console.warn(`[build] WARNING: ${msg}`);

/* ---------- chrome (fixpoint-linux design markup) ---------- */

/** Sticky top nav, driven by the release manifest: home, then each published
 * post in manifest order (a draft never appears here). `current` highlights
 * the current page's link (a.home). */
function nav(current, navPosts) {
  const link = (url, cls, label) =>
    `<a${cls ? ` class="${cls}"` : ''} href="${url}">${label}</a>`;
  const here = (url, label) =>
    link(url, current === url ? 'home' : '', label);
  const posts = navPosts
    .map((p) => here(`/${p.slug}/`, p.navLabel))
    .join('');
  return (
    `<nav><div class="wrap">` +
    `<span class="brand"><span><span class="fx">fx</span>://blog</span></span>` +
    `<span class="links">` +
    here('/', 'home') +
    posts +
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
function page({ title, description, prompt, heroTitle, tagline, body, navCurrent }, navPosts) {
  const designCss = readFileSync(CSS, 'utf8');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description.replaceAll('"', '&quot;')}">
<style>
${designCss}</style>
<style>${PAGE_CSS}</style>
</head>
<body>
${nav(navCurrent, navPosts)}
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

function buildHome(manifest) {
  const md = read('content', manifest.home.file);
  let body = mdToHtml(md);

  // the summary's own H1 becomes the hero title, so it must not repeat in the
  // body; relocate its inner HTML verbatim (normalize the source's line wrap)
  const h1 = /^<h1[^>]*>([\s\S]*?)<\/h1>\n?/.exec(body);
  if (!h1) throw new Error('summary: no leading <h1> found');
  body = body.slice(h1[0].length);
  const titleHtml = h1[1].replace(/\s+/g, ' ').trim();

  // CTA banner: link to the first published post, in manifest order
  const first = manifest.posts.find((p) => p.published);
  const cta = first
    ? `<div class="cta-banner">` +
      `<span><strong>Read the full post</strong> — evidence, mechanism, and why it hides.</span>` +
      `<a class="cta-btn" href="/${first.slug}/">the long version →</a></div>`
    : '';

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
    tagline: 'the <b>summary</b>: the evidence-first version, minus the machinery.',
    body: html,
    navCurrent: '/',
  };
}

/** Per-post page metadata (hero prompt/title/tagline stay code-side, not in
 * the manifest — the manifest governs order, nav label, published only). */
const POST_META = {
  'meditation-harm': {
    prompt: 'cat meditation-harm.md',
    tagline: 'the <b>full mechanism</b>: the evidence, the model, the notes.',
    hint: '<a href="/">← home</a> · the full mechanism, with notes',
    description:
      'The full post: why meditation harm is under-counted — a measured control-theoretic model of the runaway, the border-collision fold, and why the failure hides itself.',
    accent: 'Failure Mode',
  },
  'anxiety-damping': {
    prompt: 'cat anxiety-damping.md',
    tagline: 'the <b>prediction</b>: one variable, two readings, and the test that settles it.',
    hint: '<a href="/">← home</a> · the prediction, with notes',
    description:
      'A prediction, not a result: anxiety-proneness read as low damping — two readings of one variable — and the cheap settling/tolerance test that would settle it.',
    accent: 'Damping',
  },
  'manufacturing-the-crossing': {
    prompt: 'cat manufacturing-the-crossing.md',
    tagline: 'the <b>inversion</b>: how coercive groups run the collapse on purpose.',
    hint: '<a href="/">← home</a> · the procedure, and the inversion, with notes',
    description:
      'Coercive groups induce the same collapse deliberately and hold you on the far side of it — the same three guardrails the traditions supply, with two of them flipped.',
    accent: 'Crossing',
  },
  'sacred-science': {
    prompt: 'cat sacred-science.md',
    tagline: 'the <b>metaphysics</b>: the frame that decides what the collapse means.',
    hint: '<a href="/">← home</a> · the frame, and the inversion, with notes',
    description:
      'Why "the observer collapses reality" and "union with God" are the same move — quantum mysticism as the modern warrant that steers the collapse toward an owned destination.',
    accent: 'Sacred Science',
  },
};

function buildPost(post) {
  const meta = POST_META[post.slug];
  if (!meta) throw new Error(`no POST_META entry for slug '${post.slug}'`);
  const md = read('content', post.file);
  let body = mdToHtml(md);

  // the post's own H1 becomes the hero title, so it must not repeat in the
  // body; relocate its inner HTML verbatim (pandoc keeps the source's line
  // wrap inside <h1>, so normalize whitespace runs to single spaces)
  const h1 = /^<h1[^>]*>([\s\S]*?)<\/h1>\n?/.exec(body);
  if (!h1) throw new Error(`${post.slug}: no leading <h1> found`);
  body = body.slice(h1[0].length);
  const titleHtml = h1[1].replace(/\s+/g, ' ').trim();
  const fxTitle = titleHtml.replace(meta.accent, `<span class="fx">${meta.accent}</span>`);

  // readable notes: keep pandoc's footnote <section> but canonicalize it to
  // class="footnotes" role="doc-endnotes" and drop its bare <hr> — the '## Notes'
  // heading in the source already separates it. (Current pandoc emits
  // '<section id="footnotes" class="footnotes footnotes-end-of-document"\nrole=…>'
  // with the attributes split over two lines, so match the tag loosely.)
  body = body.replace(
    /<section\b[^>]*class="footnotes[^"]*"[^>]*>\s*<hr\s*\/?>/,
    '<section class="footnotes" role="doc-endnotes">',
  );
  if (!body.includes('<section class="footnotes" role="doc-endnotes">')) {
    throw new Error(`${post.slug}: footnotes section not found/converted`);
  }

  // the section hint already links back to the summary — no extra back-link
  const html = section('The full post', meta.hint, body);

  return {
    title: `${titleHtml} — blog.jaye.ch`,
    description: meta.description,
    prompt: meta.prompt,
    heroTitle: fxTitle,
    tagline: meta.tagline,
    body: html,
    navCurrent: `/${post.slug}/`,
  };
}

/* ---------- release safety: a built page must not link a draft ---------- */

/** Scan every written page for href="/<slug>/" pointing at an UNPUBLISHED
 * slug — a deployable page must never expose a draft's URL. (In a PREVIEW
 * build the nav itself links drafts, which is expected and reported as such.) */
function checkLinks(pages, manifest) {
  const drafts = manifest.posts.filter((p) => !p.published);
  const problems = [];
  for (const { rel, html } of pages) {
    for (const d of drafts) {
      const needle = `href="/${d.slug}/"`;
      if (html.includes(needle)) problems.push(`${rel} links ${needle}`);
    }
  }
  if (problems.length === 0) {
    log(`link check ok — no page references an unpublished slug (${drafts.length} draft(s) staged)`);
  } else if (PREVIEW) {
    log(`link check: ${problems.length} reference(s) to unpublished slugs — expected in a PREVIEW build (the nav includes drafts); never deploy a preview build`);
  } else {
    warn('built pages link UNPUBLISHED posts — do not deploy this build:');
    for (const p of problems) warn(`  ${p}`);
  }
  return problems;
}

/* ---------- main ---------- */

function writePage(rel, pageDef, navPosts) {
  const out = join(DIST, rel);
  mkdirSync(dirname(out), { recursive: true });
  const html = page(pageDef, navPosts);
  writeFileSync(out, html);
  log(`wrote ${rel} (${Buffer.byteLength(html)} bytes)`);
  return html;
}

log('building dist/');
if (!existsSync(CSS)) {
  throw new Error(`missing ${CSS} — run tools/extract-css.mjs (or ./build.sh) first`);
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
// In a PREVIEW build drafts appear in the nav too — that is what makes the
// preview navigable; a deployable build's nav carries published posts only.
const navPosts = PREVIEW ? manifest.posts : manifest.posts.filter((p) => p.published);

if (PREVIEW) {
  console.log(
    '\n' +
    '***********************************************************************\n' +
    '*  PREVIEW BUILD — includes UNPUBLISHED drafts (not for deployment)  *\n' +
    '***********************************************************************\n',
  );
  for (const p of manifest.posts.filter((p) => !p.published)) {
    log(`PREVIEW: including unpublished draft '/${p.slug}/'`);
  }
}
const postsToBuild = PREVIEW ? manifest.posts : navPosts;

rmSync(DIST, { recursive: true, force: true });
const written = [];
written.push({ rel: 'index.html', html: writePage('index.html', buildHome(manifest), navPosts) });
for (const post of postsToBuild) {
  written.push({
    rel: `${post.slug}/index.html`,
    html: writePage(`${post.slug}/index.html`, buildPost(post), navPosts),
  });
}

checkLinks(written, manifest);
if (PREVIEW) {
  console.log(
    '***********************************************************************\n' +
    '*  PREVIEW BUILD — includes UNPUBLISHED drafts (not for deployment)  *\n' +
    '***********************************************************************',
  );
}
log('done');
