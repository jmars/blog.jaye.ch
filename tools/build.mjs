#!/usr/bin/env node
/**
 * tools/build.mjs — renders content/ Markdown into the self-contained pages of
 * dist/. Design CSS comes from design/blog.css (generated from the
 * jmars/blog-design Elm package — the vendor/blog-design submodule — by
 * tools/extract-css.mjs) and is inlined into every page's <head>. The fork
 * carries the full reading layer (.prose serif typography, blockquotes,
 * tables, footnotes) inside the design system itself; the site-local PAGE_CSS
 * below sits on top of it (masthead motion, nav menus, the contents block,
 * series prev/next, the dose meter, the command line, footnote sidenotes, dark
 * and print), and tools/viz/viz.css styles the figures. No external runtime
 * deps; links are absolute (/…).
 *
 * Every page runs two scripts, both inlined and self-contained: the command
 * line (a terminal-idiom palette — press `/` or `:`), and, on a page whose
 * rendered body carries a [data-viz] slot, ONE more <script> holding the figure
 * engine plus exactly the widgets that page uses, with viz.css inlined next to
 * its CSS. No external src, no import map, no fetch, so a page stays one file
 * and nothing is ever requested from a third party.
 *
 * What gets built is governed by posts.json (repo root) — the release
 * manifest: it lists the home file and the posts, each with its nav label and
 * `published` state. Published posts build to dist/<slug>/; unpublished ones are
 * staged drafts — not written to dist at all and absent from every nav, from the
 * feed/sitemap, and from the command line. Flipping `"published": true` is the
 * whole release step, and it goes with appending the entry to the END of the
 * list: the manifest is in PUBLICATION ORDER, newest last. Two things read that
 * order and they read it in opposite directions, so the convention matters: a
 * series' nav lists its posts in manifest order (a new post appears last in its
 * series), while the timeline reverses the whole list so the newest is first. A
 * post inserted MID-manifest therefore sorts as if it were old — append, don't
 * insert. The manifest also carries each post's `date` — the calendar day it
 * first went live, written by hand (it was recovered from the commit that first
 * published each post, and is now a manifest field rather than something derived
 * at build time). The build renders that date; it never invents one. A published
 * post with no date fails the build: the timeline, the feed and the sitemap all
 * rest on it. Only a day is known, never a time, so posts published the same day
 * are ordered by manifest position — which is why that position must be the
 * publication order — and the feed's pubDate carries midnight UTC as the
 * conventional stand-in for "this day" while the sitemap's lastmod is a date.
 *
 *   node tools/build.mjs            (run from the repo root)
 *   PREVIEW=1 node tools/build.mjs  build drafts too — LOCAL PREVIEW ONLY,
 *                                   never deploy a preview build
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
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

/** Canonical origin. Every absolute URL the build emits (og:url, canonical,
 * feed, sitemap, robots) is derived from this one constant. */
const BASE = 'https://blog.jaye.ch';

/** The series the posts are grouped into, in nav order. Labels match the home
 * page's section names exactly; a series with nothing published contributes
 * nothing anywhere (a draft never appears). 'cases' is the documented tier —
 * case studies, distinct from the measured mechanism and the argued
 * implications. 'frames' is the largest scale — the cosmology itself. */
const SERIES = [
  { key: 'mechanism', label: 'the mechanism' },
  { key: 'implications', label: 'the implications' },
  { key: 'frames', label: 'the frames' },
  { key: 'cases', label: 'the case studies' },
  { key: 'readings', label: 'the readings' },
];
const seriesLabel = (key) => (SERIES.find((s) => s.key === key) || { label: key }).label;

/** Spelled counts, for the prose the build writes ("two series", "three series"). */
const NUM_WORD = ['zero', 'one', 'two', 'three', 'four', 'five'];

const log = (msg) => console.log(`[build] ${new Date().toISOString()} ${msg}`);
const warn = (msg) => console.warn(`[build] WARNING: ${msg}`);

/** Attribute-safe: any page value that reaches an attribute or an XML text
 * node goes through this, so a quote or an ampersand in a title or a summary
 * can never produce malformed markup. */
const esc = (s) =>
  String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** XML text/attribute escaping — esc plus the apostrophe (RSS descriptions
 * are quoted text, so every literal must be accounted for). */
const xesc = (s) => esc(s).replaceAll("'", '&apos;');

/** A manifest `date` (YYYY-MM-DD) as an RFC 822 stamp for RSS. Only the day is
 * known; midnight UTC is the conventional stand-in, not a measured time. */
const rfc822 = (date) => new Date(`${date}T00:00:00Z`).toUTCString();

/** Every PUBLISHED post must carry a valid `date` (YYYY-MM-DD): the timeline,
 * the feed and the sitemap are all built from it, so its absence is a release
 * gate, not a warning. A staged draft need not have one yet. */
function checkDates(manifest) {
  const isDay = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
  const bad = manifest.posts.filter((p) => p.published && !isDay(p.date));
  if (bad.length) {
    throw new Error(
      `posts.json: published post(s) with no valid 'date' (YYYY-MM-DD): ${bad.map((p) => p.slug).join(', ')}`,
    );
  }
  for (const p of manifest.posts.filter((p) => !p.published && p.date && !isDay(p.date))) {
    warn(`draft '${p.slug}' has a malformed date '${p.date}' — it will not appear on the timeline`);
  }
}

/** The manifest's optional `featured` must name a real post (or a list of
 * them), and in a deployable build a PUBLISHED one — a stale slug or a draft
 * pointer fails the build rather than rendering a home page that silently drops
 * the top slot. */
function checkFeatured(manifest) {
  const slugs = Array.isArray(manifest.featured)
    ? manifest.featured
    : manifest.featured
      ? [manifest.featured]
      : [];
  for (const slug of slugs) {
    const post = manifest.posts.find((p) => p.slug === slug);
    if (!post) throw new Error(`posts.json: featured '${slug}' is not a post`);
    if (!post.published && !PREVIEW) {
      throw new Error(`posts.json: featured '${slug}' is not published (do not feature a draft)`);
    }
  }
}

/* ---------- chrome (blog-design markup) ---------- */

/** Sticky top nav, driven by the release manifest: home, then each published
 * post in manifest order (a draft never appears here). `current` highlights
 * the current page's link (a.home). */
function nav(current, navPosts) {
  const link = (url, cls, label) =>
    `<a${cls ? ` class="${cls}"` : ''} href="${url}">${label}</a>`;
  const here = (url, label) =>
    link(url, current === url ? 'home' : '', label);

  // Series, grouped so the measured work and the arguments are never a
  // flat list (SERIES, above). A series with nothing published contributes
  // nothing (a draft never appears here).
  const dropdown = (s) => {
    const items = navPosts.filter((p) => p.series === s.key);
    if (items.length === 0) return '';
    const menu = items
      .map((p) => link(`/${p.slug}/`, current === `/${p.slug}/` ? 'home' : '', p.navLabel))
      .join('');
    // Honest, CSS-only disclosure. The old markup put aria-haspopup="true" and
    // role="menu" on a <button> with no menu behaviour and no way to open by
    // keyboard (.menu was display:none until :hover, and a display:none link
    // cannot be focused, so the series were mouse-only). The menu is now always
    // in the DOM — PAGE_CSS keeps it out of sight with opacity + pointer-events
    // rather than display:none, which is what makes its links focusable — and it
    // opens on :hover and on :focus-within. A <details> would have been the
    // obvious native disclosure, but Chromium makes the content of a CLOSED
    // details unfocusable and unrendered whatever the author CSS says (measured:
    // checkVisibility() is false and Tab skips the links), so it cannot serve
    // the hover-and-focus pattern. The label stays plain text: no state is
    // claimed that the markup cannot keep.
    return (
      `<span class="dropdown"><span class="toggle">${s.label} ▾</span>` +
      `<span class="menu">${menu}</span></span>`
    );
  };

  return (
    `<nav><div class="wrap">` +
    `<span class="brand">blog.<span class="fx">jaye</span>.ch</span>` +
    `<span class="links">` +
    here('/', 'home') +
    here('/timeline/', "what's new") +
    SERIES.map(dropdown).join('') +
    `</span></div></nav>`
  );
}

/** Split a hero fragment into per-word stagger spans.
 *
 * Each TOP-LEVEL word becomes `<span class="w" style="--i:N">…</span>` so the
 * masthead CSS (PAGE_CSS) can delay it; `start` continues the numbering across
 * containers, so the title's words run into the tagline's. Inner markup is
 * preserved verbatim — the home h1 keeps its red `<span class="fx">`, taglines
 * keep their `<b>` — and whitespace is copied through untouched, so no text or
 * spacing changes. Markup whose content spans words (e.g.
 * `<span class="fx">Failure Mode</span>`) is one reveal unit.
 */
function revealWords(html, start = 0) {
  let out = '';
  let word = '';
  let depth = 0;
  let i = 0;
  const flush = () => {
    if (word === '') return;
    out += `<span class="w" style="--i:${start++}">${word}</span>`;
    word = '';
  };
  while (i < html.length) {
    const ch = html[i];
    if (ch === '<') {
      const end = html.indexOf('>', i);
      if (end === -1) throw new Error(`hero text has an unterminated tag: ${html.slice(i, i + 40)}`);
      const tag = html.slice(i, end + 1);
      if (tag.startsWith('</')) depth--;
      else if (!tag.endsWith('/>')) depth++;
      if (depth < 0) throw new Error(`hero text has an unbalanced ${tag} in: ${html.slice(0, 60)}`);
      word += tag;
      i = end + 1;
    } else if (depth === 0 && /\s/.test(ch)) {
      flush();
      let j = i;
      while (j < html.length && /\s/.test(html[j])) j++;
      out += html.slice(i, j); // whitespace stays outside the spans
      i = j;
    } else {
      word += ch;
      i++;
    }
  }
  flush();
  return { html: out, next: start };
}

/** Hero header: terminal prompt line, title, tagline.
 *
 * The title and tagline are word-wrapped for the masthead reveal; the prompt
 * line reveals as a whole (its caret keeps blinking on its own). */
function hero({ prompt, title, tagline }) {
  const t = revealWords(title);
  const g = revealWords(tagline, t.next);
  return (
    `<header><div class="wrap">` +
    `<div class="prompt">` +
    `<span class="hash">#</span> blog.jaye.ch ` +
    `<span class="dollar">$</span> ${prompt}<span class="blink">▊</span>` +
    `</div>` +
    `<h1>${t.html}</h1>` +
    `<div class="tagline">${g.html}</div>` +
    `</div></header>`
  );
}

/** A prose section. `before`/`after` are chrome that belongs inside the same
 * wrap but outside the reading column — the post's contents block and its
 * series prev/next, both of which must not join the .prose flow. */
function section(h2, hint, body, { before = '', after = '' } = {}) {
  return (
    `<section><div class="wrap">` +
    `<h2>${h2}</h2>` +
    `<div class="hint">${hint}</div>` +
    before +
    `<div class="prose">${body}</div>` +
    after +
    `</div></section>`
  );
}

function footer() {
  return (
    `<footer><div class="wrap">` +
    `<a href="/">blog.jaye.ch</a><span class="sep"> · </span>` +
    `self-contained · no trackers<span class="sep"> · </span>` +
    // the command line is keyboard-first (press / or :); this is the mouse and
    // touch way in, and the only place the shortcut is advertised
    `<button type="button" class="palette-open">press / for the command line</button>` +
    `</div></footer>`
  );
}

/** Page-level CSS layered AFTER the design system.
 *
 * Reading styles (.prose serif typography, blockquotes, tables, footnotes) live
 * in the blog-design package itself — the design system is the single source of
 * truth for the entire look; do not re-add design rules here.
 *
 * What does belong here is everything site-specific: the masthead motion layer
 * (kinetic typography is not a design-system concern, and design/blog.css is
 * generated from the shared jmars/blog-design package that sibling sites
 * consume), the accessibility fix for the nav disclosure, the reading chrome
 * this build adds (contents, series prev/next, the dose meter, the command
 * line), the footnote sidenotes, and the two alternative renderings — warm dark
 * (prefers-color-scheme) and print. page() emits this block LAST, after the
 * figure CSS, so these rules can override the things they have to (hiding a
 * figure's controls in print, re-tokening the palette for dark).
 */
const PAGE_CSS = `/* ---------- masthead reveal ---------- */
/* build.mjs hero() wraps each hero word in <span class="w" style="--i:N">.
   Default state: fully visible and static — the hidden start and the animation
   exist only for readers who have NOT asked for reduced motion, so a
   reduced-motion reader (or any renderer without CSS animations) sees the whole
   masthead immediately. Only opacity and transform animate: the layout is never
   touched, in either state, and .prose is not involved.
   The hidden start is the animation's BACKWARDS fill alone, never a base
   opacity: a renderer that ignores or never runs the animation leaves the
   masthead fully readable rather than blank. There is no forwards fill either,
   so once the reveal ends nothing is still animating the hero — the finished
   state is the plain, static masthead again.
   display:inline-block is what makes transform apply at all (it is ignored on
   non-replaced inline boxes); it is set inside the media query so the default
   state is exactly the pre-reveal layout. */
@media (prefers-reduced-motion: no-preference) {
  header .prompt,
  header h1 .w,
  header .tagline .w {
    animation: masthead-reveal 420ms cubic-bezier(0.2, 0.7, 0.25, 1) backwards;
  }
  header .prompt { animation-delay: 0ms; }
  header h1 .w,
  header .tagline .w {
    display: inline-block;
    animation-delay: calc(60ms + var(--i, 0) * 40ms);
  }
  @keyframes masthead-reveal {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }
}

/* ---------- nav disclosure: keyboard operable, honest state ----------
   nav() emits <span class="dropdown"> (see its comment). The design package
   opens .menu on :hover alone, and .menu is display:none until then — a
   display:none link cannot be focused, so a keyboard reader could never reach the
   series. The menu is therefore kept in the DOM and out of sight with opacity and
   pointer-events instead, and opens on :hover or on :focus-within. Tabbing
   through the nav reveals each menu as focus enters it and hides it again on the
   way out; nothing is claimed that CSS cannot deliver. */
.dropdown > .menu { display: block; opacity: 0; pointer-events: none; }
.dropdown:hover > .menu,
.dropdown:focus-within > .menu { opacity: 1; pointer-events: auto; }
@media (prefers-reduced-motion: no-preference) {
  .dropdown > .menu { transition: opacity 120ms ease-out; }
}

/* ---------- contents (long posts) ----------
   Built by toc() from the rendered body's own <h2 id> headings, so every link
   points at an anchor that already exists in the page. Native <details>: no
   script, and the collapsed state is the default. */
.toc { margin: 0 0 22px; font-family: var(--mono); font-size: 13px; }
.toc > summary { cursor: pointer; color: var(--accent2); }
.toc > summary:hover { color: var(--accent); }
.toc .toc-n { color: var(--dim); }
/* the headings number themselves ("3. The step: …"), so the list adds no marker */
.toc ol { list-style: none; margin: 12px 0 0; padding-left: 0; color: var(--dim); }
.toc li { margin-bottom: 5px; }
.toc a { color: var(--dim); }
.toc a:hover { color: var(--accent); }

/* ---------- series prev/next ----------
   postNav() emits a link only for a published neighbour inside the same series,
   so the ends of a series simply have one slot empty. */
.postnav {
  display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap;
  margin-top: 2.4em; padding-top: 18px; border-top: 1px solid var(--line);
  font-family: var(--mono); font-size: 13px;
  /* the last margin sidenote (see the sidenote block) floats, and a float may
     extend past the element that contains it — so the series nav, which follows
     the prose in the same wrap, clears it. Without this a note on the final
     paragraph overhangs the footer and the page box. */
  clear: both;
}
.postnav a { display: block; max-width: 46%; color: var(--accent2); }
.postnav a.next { margin-left: auto; text-align: right; }
.postnav a:hover { color: var(--accent); }
.postnav .dir { display: block; font-size: 12px; color: var(--dim); }
.postnav .t { display: block; margin-top: 3px; }

/* ---------- timeline (the "what's new" page) ----------
   One row per day: the date in a fixed mono column, the day's pieces beside it.
   The design system's .timeline is a pre-formatted terminal block (white-space:
   pre); a list of titled links must wrap, so this is a plain list grid and the
   date column collapses to a stacked line on a narrow screen. */
.tl { list-style: none; margin: 8px 0 0; padding: 0; }
.tl > li { display: grid; grid-template-columns: 118px 1fr; gap: 6px 20px; padding: 20px 0; border-top: 1px solid var(--line); }
.tl .d { font-family: var(--mono); font-size: 13px; color: var(--accent); }
.tl ul { list-style: none; margin: 0; padding: 0; }
.tl ul li { margin-bottom: 14px; }
.tl ul li:last-child { margin-bottom: 0; }
.tl ul a { font-size: 16.5px; font-weight: 600; letter-spacing: -0.01em; }
.tl .m { display: block; font-family: var(--mono); font-size: 12px; color: var(--dim); margin-top: 3px; }
@media (max-width: 560px) {
  .tl > li { grid-template-columns: 1fr; gap: 8px; }
}

/* the home page's mini-timeline: the same list, one compact row per piece
   (short date, title, series), where the full page groups by day */
.tl-mini { list-style: none; margin: 8px 0 0; padding: 0; }
.tl-mini li { display: grid; grid-template-columns: 54px 1fr auto; gap: 12px; align-items: baseline; padding: 9px 0; border-top: 1px solid var(--line); }
.tl-mini .d { font-family: var(--mono); font-size: 12px; color: var(--accent); }
.tl-mini a { font-size: 15.5px; font-weight: 600; letter-spacing: -0.01em; }
.tl-mini .m { font-family: var(--mono); font-size: 11.5px; color: var(--dim); text-align: right; }
@media (max-width: 560px) {
  .tl-mini li { grid-template-columns: 46px 1fr; }
  .tl-mini .m { display: none; }
}

/* ---------- the featured piece (the top slot on the home page) ----------
   One deliberate highlight above the series: an accent-ruled card carrying the
   featured post's title, kind, summary and a link. One or a pair — a pair sits
   side by side as one block on a wide screen and stacks on a narrow one.
   Deliberately not cards in the .grid — the feature is its own thing. */
.feature-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 18px; }
.feature {
  background: var(--bg2); border: 1px solid var(--line); border-left: 4px solid var(--accent);
  border-radius: 10px; padding: 22px 24px 20px;
}
.feature .eyebrow {
  display: block; font-family: var(--mono); font-size: 12px; letter-spacing: 0.06em;
  text-transform: uppercase; color: var(--accent); margin-bottom: 10px;
}
.feature h2 { margin-bottom: 8px; }
.feature h2 a { color: var(--fg); }
.feature h2 a:hover { color: var(--accent); text-decoration: none; }
.feature .f-sum { font-size: 15px; color: var(--dim); margin-bottom: 14px; max-width: 60ch; }
.feature .f-more { font-family: var(--mono); font-size: 13px; color: var(--accent); }
.feature .f-more:hover { color: var(--accent2); }

/* ---------- dose meter: reading progress, as accumulated dose ----------
   Decorative chrome (aria-hidden), and deliberately script-free: a scroll-driven
   animation reads the document's scroll progress with no listener at all, and
   a browser without scroll-driven animations shows no meter rather than a stuck
   one. The read is drawn as accumulated dose, so Θ_eff is marked on it: the
   tick sits at 68.6% — the measured position of the switch in the published
   dose sweep, 214 healthy / 98 collapsed with nothing in between — and the fill
   changes state, and the label appears, once the read passes it. */
.dose { display: none; }
@supports (animation-timeline: scroll()) {
  .dose {
    display: block; position: fixed; top: 0; left: 0; right: 0; height: 2px;
    z-index: 60; pointer-events: none; background: var(--line);
  }
  .dose-fill {
    display: block; height: 100%; background: var(--accent2);
    transform: scaleX(0); transform-origin: 0 50%;
    animation: dose-read linear both; animation-timeline: scroll(root block);
  }
  .dose-mark { position: absolute; top: -1px; bottom: -1px; left: 68.6%; width: 1px; background: var(--dim); }
  .dose-label {
    position: absolute; left: 68.6%; top: 4px; margin-left: -1.6em; width: 3.2em;
    text-align: center; font-family: var(--mono); font-size: 10px; letter-spacing: 0.04em;
    color: var(--accent); opacity: 0;
    animation: dose-label linear both; animation-timeline: scroll(root block);
  }
  @keyframes dose-read {
    0% { transform: scaleX(0); background: var(--accent2); }
    68.6% { transform: scaleX(0.686); background: var(--accent2); }
    68.7% { transform: scaleX(0.687); background: var(--accent); }
    100% { transform: scaleX(1); background: var(--accent); }
  }
  @keyframes dose-label {
    0%, 62% { opacity: 0; }
    68%, 100% { opacity: 0.85; }
  }
}

/* ---------- the command line ----------
   The palette markup is emitted by page() on every page; the script that drives
   it is inlined (see PALETTE_JS). Styled in the hero prompt's idiom. */
.palette { position: fixed; inset: 0; z-index: 100; display: flex; align-items: flex-start;
  justify-content: center; padding: 14vh 16px 16px; background: rgba(20, 18, 16, 0.45); }
.palette[hidden] { display: none; }
.palette-box { width: min(680px, 100%); padding: 14px 16px 12px; background: var(--bg2);
  border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
  font-family: var(--mono); font-size: 13.5px; color: var(--fg); }
.palette-line { display: flex; align-items: baseline; gap: 8px; }
.palette-line .ps { color: var(--accent2); }
.palette input { flex: 1 1 auto; min-width: 0; font: inherit; color: var(--fg);
  background: none; border: none; outline: none; padding: 0; }
.palette-out { margin-top: 12px; max-height: 52vh; overflow: auto; white-space: pre-wrap;
  color: var(--dim); }
.palette-open { font: inherit; font-family: var(--mono); font-size: 13px; color: var(--dim);
  background: none; border: none; padding: 0; cursor: pointer; }
.palette-open:hover { color: var(--accent); }

/* ---------- footnote sidenotes (wide viewports only) ----------
   buildPost() copies each footnote inline, right after its reference, as
   .sidenote (aria-hidden: assistive tech keeps hearing the note once, in the
   endnotes, exactly as before). Below the breakpoint the copy stays hidden and
   the endnotes block is untouched. At wide viewports the copy floats into the
   margin beside the passage it annotates — the note is never abandoned, and the
   endnotes block stays in place below it, so the reference anchors and the
   back-references keep resolving at every width. */
.sidenote { display: none; }
@media (min-width: 1200px) {
  /* Chromium counts a float's margin box in the scrollable overflow region, and
     this float's right margin is deliberately negative — so without this the
     notes would add ~88px of phantom horizontal scroll at every width where they
     are shown. clip (not hidden) is what keeps the fix safe: it removes the
     scrollability without making the page a scroll container, so the sticky nav
     is untouched and the notes, which sit inside the viewport, are not clipped. */
  html, body { overflow-x: clip; }
  .prose .sidenote {
    display: block; float: right; clear: right; width: 13rem; margin: 0.35rem -15rem 0 0;
    font-size: 12.5px; line-height: 1.42; color: var(--dim);
  }
  .prose .sidenote a { color: var(--accent2); }
}

/* ---------- warm dark reading mode ----------
   Light stays the default; this is the same paper palette turned down, warm
   rather than blue. Tokens first (everything the design package and the figure
   engine read comes from them), then the handful of literals the design package
   hard-codes. All text keeps AA: --fg 12.5:1, --dim 7.0:1, --accent 7.2:1,
   --accent2 8.5:1 against --bg, and the callouts ≥ 8.9:1. Scoped to screen, so
   a printed page is black on white whatever the reader's system preference. */
@media screen and (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --bg: #1a1816;
    --bg2: #232120;
    --fg: #efeae2;
    --dim: #a9a29a;
    --accent: #e88b86;
    --accent2: #8ab4f8;
    --line: #3a3733;
  }
  nav { background: rgba(26, 24, 22, 0.90); }
  p, .stack td.desc, ul.checks li { color: #ddd7cd; }
  .prose code { color: #f0a8a2; }
  .prose a { text-decoration-color: rgba(138, 180, 248, 0.40); }
  .dropdown .menu a:hover { background: rgba(232, 139, 134, 0.12); }
  .cta-btn, .cta-btn:hover { color: #1a1816; }
  .note { background: #2e2120; color: #f0b6b0; }
  .warn { background: #2b2619; border-left-color: #c79a3c; color: #e8cd93; }
  .palette { background: rgba(0, 0, 0, 0.55); }
}

/* ---------- print ----------
   A paper copy of the essay: the chrome and every control go, the prose runs
   the full measure in black on white. The figure canvas keeps its last drawn
   frame (the engine draws one at mount), so a printed figure still shows the
   curve — only its sliders and buttons are removed. */
@media print {
  @page { margin: 16mm 18mm; }
  nav, footer, .palette, .dose, .toc, .postnav, .prompt, .blink,
  .viz-controls, .sidenote { display: none !important; }
  html, body { background: #fff; color: #000; }
  .wrap { max-width: none; padding: 0; }
  header { padding: 0 0 12pt; border-bottom: 1px solid #999; }
  header h1 .w { display: inline !important; opacity: 1 !important; transform: none !important; }
  section { padding: 12pt 0; border-bottom: none; }
  .prose { max-width: none; font-size: 11.5pt; line-height: 1.5; color: #000; }
  .prose p, .prose li, .prose blockquote, .prose table { color: #000; }
  .prose a { color: #000; text-decoration: none; }
  /* a printed page has no links: show where an absolute or site link went */
  .prose a[href^="http"]::after,
  .prose a[href^="/"]::after {
    content: " (" attr(href) ")"; font-size: 0.82em; color: #444; word-break: break-all;
  }
  .prose .footnotes, .prose .footnotes p, .prose .footnotes li { color: #333; }
  .prose .footnotes { display: block; }
  .prose pre, .prose table, .prose blockquote, .viz, .card { break-inside: avoid; }
  h2, h3, .prose h2, .prose h3 { break-after: avoid; }
  .viz, .viz .viz-readout, .viz .viz-caption { color: #333; }
  .viz .viz-caption::before { color: #333; }
}`;

/* ---------- interactive figures (tools/viz/) ---------- */

const VIZ_DIR = join(ROOT, 'tools', 'viz');
const VIZ_ENGINE = join(VIZ_DIR, 'engine.js');
const VIZ_CSS = join(VIZ_DIR, 'viz.css');

/** Widget names a rendered body asks for, in first-use order. */
function vizSlots(body) {
  const names = [];
  // both quote styles: an author writing data-viz='runaway' must not be
  // silently shipped an empty box with no script and no viz.css
  for (const m of body.matchAll(/data-viz=(["'])([a-z0-9-]+)\1/g)) {
    if (!names.includes(m[2])) names.push(m[2]);
  }
  return names;
}

/**
 * The figure assets a page needs — or null, so a page with no [data-viz] slot
 * is built exactly as it was before this feature existed.
 *
 * The engine and the page's widgets are concatenated into one IIFE: the page
 * carries only the code it uses (tree-shaken by concatenation, the build is
 * the bundler) and nothing is fetched at runtime.
 */
function vizAssets(body) {
  const slots = vizSlots(body);
  if (slots.length === 0) return null;
  const widgets = slots.map((name) => {
    const file = join(VIZ_DIR, `${name}.js`);
    if (!existsSync(file)) throw new Error(`data-viz="${name}" has no widget at tools/viz/${name}.js`);
    return stripJsComments(readFileSync(file, 'utf8'));
  });
  const js = ['(function () {', "'use strict';", stripJsComments(readFileSync(VIZ_ENGINE, 'utf8')), ...widgets, '})();'].join('\n');
  return { slots, css: stripComments(readFileSync(VIZ_CSS, 'utf8')), script: `<script>\n${js}\n</script>\n` };
}

/* ---------- the command line (C4) ---------- */

/** Decorative reading chrome: the dose meter. Emitted on every page; hidden
 * unless the browser can drive it from scroll (see the PAGE_CSS block), and
 * hidden in print. aria-hidden — it is ornament; the page itself carries the
 * reading position. */
const DOSE = `<div class="dose" aria-hidden="true"><span class="dose-fill"></span><span class="dose-mark"></span><span class="dose-label">Θ_eff</span></div>`;

/**
 * The command line, in the site's own terminal idiom: press `/` or `:` for a
 * prompt that can list, search and open the blog (`ls`, `cat <slug>`,
 * `open <series>`, `home`).
 *
 * The page list is embedded in the page, not fetched: the palette must never
 * make a request, and it is built from navPosts — the same published-only list
 * the nav uses — so a draft cannot be reached by typing its slug on a
 * deployable page.
 *
 * The script is deliberately small and defensive: it is now on every page, so
 * anything that is not there yet (no palette markup, no button) has to be
 * tolerated rather than throw.
 */
const PALETTE_JS = (data) => `(function () {
  'use strict';
  function init() {
  var DATA = ${JSON.stringify(data).replaceAll('<', '\\u003c')};
  var PAGES = DATA.pages, SERIES = DATA.series;
  var box = document.getElementById('palette');
  if (!box) return;
  var input = box.querySelector('input');
  var out = box.querySelector('.palette-out');
  var prev = null;

  function show(text) { out.textContent = text; }
  function seriesLabel(key) {
    for (var i = 0; i < SERIES.length; i++) if (SERIES[i].key === key) return SERIES[i].label;
    return key;
  }
  function pad(s, n) { while (s.length < n) s += ' '; return s; }
  function pageFor(slug) {
    for (var i = 0; i < PAGES.length; i++) if (PAGES[i].slug === slug) return PAGES[i];
    return null;
  }
  function find(q) {
    if (!q) return null;
    var exact = pageFor(q);
    if (exact) return exact;
    for (var i = 0; i < PAGES.length; i++) if (PAGES[i].slug.indexOf(q) === 0) return PAGES[i];
    for (var j = 0; j < PAGES.length; j++) if (PAGES[j].title.toLowerCase().indexOf(q) >= 0) return PAGES[j];
    return null;
  }
  function seriesKey(q) {
    for (var i = 0; i < SERIES.length; i++) {
      if (SERIES[i].key === q || SERIES[i].label.toLowerCase() === q) return SERIES[i].key;
    }
    return null;
  }
  function firstIn(key) {
    for (var i = 0; i < PAGES.length; i++) if (PAGES[i].series === key) return PAGES[i];
    return null;
  }
  function listing(filter) {
    var lines = [], last = null, hit = 0;
    for (var i = 0; i < PAGES.length; i++) {
      var p = PAGES[i];
      if (filter && p.series !== filter) continue;
      hit++;
      if (p.series !== last) { lines.push(p.series ? seriesLabel(p.series) : 'unfiled'); last = p.series; }
      lines.push('  ' + pad(p.slug, 26) + p.title);
    }
    return hit ? lines.join('\\n') : 'ls: ' + filter + ': no such series';
  }
  function go(slug) { window.location.href = '/' + slug + '/'; }
  function goHome() { window.location.href = '/'; }
  function run(line) {
    var parts = line.split(/\\s+/);
    var cmd = parts[0].toLowerCase();
    var arg = parts.slice(1).join(' ').toLowerCase();
    if (cmd === 'help' || cmd === '?') return show(HELP);
    if (cmd === 'ls') return show(listing(arg ? seriesKey(arg) || arg : null));
    if (cmd === 'home' || (cmd === 'cd' && !arg)) return goHome();
    if (cmd === 'series') return show(listing(seriesKey(arg)));
    if (cmd === 'cat' || cmd === 'open' || cmd === 'cd') {
      var key = arg ? seriesKey(arg) : null;
      var hit = find(arg);
      if (hit) return go(hit.slug);
      if (key) {
        var first = firstIn(key);
        return first ? go(first.slug) : show('open: ' + arg + ': nothing published yet');
      }
      return show(cmd + ': ' + (arg || '') + ': no such post. try ls');
    }
    var bare = find(cmd);
    if (bare) return go(bare.slug);
    return show('sh: ' + cmd + ': command not found. try help');
  }
  var HELP = [
    'ls [series]     the published posts, in nav order',
    'cat <slug>      open a post        (also: open, cd)',
    'open <series>   the first post in a series',
    'series <key>    list one series    (' + SERIES.map(function (s) { return s.key; }).join(', ') + ')',
    'home            the front page',
    'help            this list',
  ].join('\\n');

  function open() {
    prev = document.activeElement;
    box.hidden = false;
    input.value = '';
    show(HELP);
    input.focus();
  }
  function close() {
    box.hidden = true;
    // the input must not keep focus inside a hidden box: it would swallow the
    // next '/' or ':' as ordinary typing, and the palette could not be reopened
    input.blur();
    if (prev && prev !== document.body && prev.focus) prev.focus();
  }
  function isTyping(el) {
    if (!el || !el.tagName) return false;
    if (el.isContentEditable) return true;
    var tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag !== 'INPUT') return false;
    // a focused slider or checkbox is not a text field: / and : stay available
    return ['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'color'].indexOf(el.type) < 0;
  }

  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!box.hidden) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      return;
    }
    if (e.key !== '/' && e.key !== ':') return;
    // a text field swallows the shortcut; a slider or a checkbox does not. Focus
    // left inside the (hidden) palette is not typing either — it is where the
    // shortcut would otherwise die.
    if (isTyping(e.target) && !box.contains(e.target)) return;
    e.preventDefault();
    open();
  });

  input.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var line = input.value.trim();
    if (!line) return;
    input.value = '';
    run(line);
  });

  box.addEventListener('click', function (e) {
    if (e.target === box) close();
  });
  for (var b = document.querySelectorAll('.palette-open'), i = 0; i < b.length; i++) {
    b[i].addEventListener('click', open);
  }
  }
  // the script is inlined on every page; do not depend on where the markup sits
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
`;

/** The palette markup plus its script, built once per run (every page carries
 * the same list). */
let paletteCache = null;
function paletteAssets(navPosts) {
  if (paletteCache) return paletteCache;
  const series = [];
  const pages = [];
  for (const p of navPosts) {
    if (p.series && !series.includes(p.series)) series.push(p.series);
    pages.push({ slug: p.slug, title: titleOf(p), series: p.series || '', kind: p.kind || '' });
  }
  const data = { pages, series: series.map((key) => ({ key, label: seriesLabel(key) })) };
  // the timeline is a page like any other but it is not a post, so the palette
  // is told about it explicitly; 'unfiled' is the listing's own group for it.
  data.pages.push({ slug: 'timeline', title: "What's new", series: '', kind: 'page' });
  const html =
    `<div class="palette" id="palette" role="dialog" aria-label="command line" hidden>` +
    `<div class="palette-box">` +
    `<div class="palette-line"><span class="ps">#</span> blog.jaye.ch ` +
    `<span class="ps">$</span> <input type="text" aria-label="command" autocomplete="off" ` +
    `autocapitalize="off" spellcheck="false"></div>` +
    `<div class="palette-out" role="status"></div>` +
    `</div></div>`;
  paletteCache = { html, script: `<script>\n${stripJsComments(PALETTE_JS(data))}</script>\n` };
  return paletteCache;
}

/** Full self-contained document. */
function page({ title, description, prompt, heroTitle, tagline, body, navCurrent, type = 'article', shareTitle, noindex = false }, navPosts) {
  const designCss = stripComments(readFileSync(CSS, 'utf8'));
  const viz = vizAssets(body);
  const palette = paletteAssets(navPosts);

  // Share metadata. The URL is derived from navCurrent (the same value that
  // drives the nav highlight), so a page cannot advertise a canonical URL that
  // is not its own. og:title strips markup — the home h1 carries a <span>.
  // An index-excluded page (the 404) has no URL of its own to advertise, so
  // it carries no canonical and no og:url.
  const url = navCurrent === '/' ? `${BASE}/` : `${BASE}${navCurrent}`;
  const share = (shareTitle || title).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const meta =
    `<title>${esc(title)}</title>\n` +
    `<meta name="description" content="${esc(description)}">\n` +
    (noindex ? `<meta name="robots" content="noindex">\n` : `<link rel="canonical" href="${url}">\n`) +
    `<meta property="og:type" content="${type}">\n` +
    `<meta property="og:site_name" content="blog.jaye.ch">\n` +
    `<meta property="og:title" content="${esc(share)}">\n` +
    `<meta property="og:description" content="${esc(description)}">\n` +
    (noindex ? `` : `<meta property="og:url" content="${url}">\n`) +
    `<meta name="twitter:card" content="summary">\n` +
    `<meta name="twitter:title" content="${esc(share)}">\n` +
    `<meta name="twitter:description" content="${esc(description)}">`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${meta}
<style>
${designCss}</style>
${viz ? `<style>\n${viz.css}</style>\n` : ''}<style>${stripComments(PAGE_CSS)}</style>
</head>
<body>
${DOSE}
${nav(navCurrent, navPosts)}
${hero({ prompt, title: heroTitle, tagline })}
${body}
${footer()}
${viz ? viz.script : ''}${palette.html}${palette.script}</body>
</html>
`;

  // A widget or post that writes '\\u2014' where it meant '\u2014' escapes the
  // escape: the page renders a literal backslash-u sequence. Only a rendered page
  // can show it (the string usually lives in an inlined widget script), so gate
  // the assembled document — an invisible defect other checks cannot see.
  const escaped = html.match(/\\\\u[0-9a-fA-F]{4}/);
  if (escaped) {
    throw new Error(
      `literal escape sequence ${escaped[0]} in the rendered page ('${heroTitle.slice(0, 40)}…') — ` +
        `a backslash was doubled somewhere, usually in a widget string.`,
    );
  }
  return html;
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

/** Strip `/* … *\/` comments from text on its way into a page.
 *
 * The source comments in PAGE_CSS, design/viz.css and the widgets name internal
 * files (build.mjs, tools/viz/<name>.js) and describe the build. They are for
 * whoever maintains this, not for the reader, and the build inlines the CSS and
 * the widget scripts verbatim into every page — so without this the public HTML
 * carried the workshop's own filenames. Comments are kept in the source files;
 * only the emitted copy is stripped. (CSS has no nested comments and nothing in
 * these files holds a comment delimiter inside a string, so the strip is safe.) */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

/** The same for the widget scripts, where `//` line comments also occur.
 * The `[^:]` guard keeps a `://` inside a URL intact; nothing in tools/viz/*
 * holds a `//` inside a string or a regex literal. (Note: build.mjs's own hint
 * strings — '// a measured model…' — are page content, not comments, and are
 * not run through this.) */
const stripJsComments = (s) => stripComments(s).replace(/(^|[^:\/])\/\/[^\n]*/g, '$1');

/** Split a pandoc body at its leading <h1>: returns the body without it and
 * the h1's inner HTML (whitespace-normalized — pandoc keeps the source's
 * line wrap inside <h1>). `what` names the source for the error message. */
function splitH1(body, what) {
  const h1 = /^<h1[^>]*>([\s\S]*?)<\/h1>\n?/.exec(body);
  if (!h1) throw new Error(`${what}: no leading <h1> found`);
  return { rest: body.slice(h1[0].length), titleHtml: h1[1].replace(/\s+/g, ' ').trim() };
}

/* ---------- pages ---------- */

/** A post's title, read from its own file's leading <h1> (as plain text).
 * Cached: the title is needed by the home cards, the command-line index and the
 * series prev/next, and each miss is a pandoc run. */
const titleCache = new Map();
function titleOf(post) {
  if (!titleCache.has(post.slug)) {
    titleCache.set(
      post.slug,
      splitH1(mdToHtml(read('content', post.file)), post.slug)
        .titleHtml.replace(/<[^>]+>/g, '')
        .trim(),
    );
  }
  return titleCache.get(post.slug);
}

/* ---------- reading chrome built from the rendered body ---------- */

/** A post's contents block, when it has enough sections to be worth one.
 *
 * Built from the RENDERED body's own <h2 id="…"> headings, so every entry links
 * to an anchor that already exists in the page (the anchors are pandoc's and are
 * never rewritten — external links point at them). <details> is native, so the
 * block collapses and expands with no script. */
const TOC_MIN = 5;
function toc(body) {
  // pandoc wraps a long heading's attributes across lines, so the tag must be
  // matched loosely and the id read out of it (same reason as the footnote refs)
  const headings = [...body.matchAll(/<h2\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/g)];
  if (headings.length < TOC_MIN) return '';
  const items = headings
    .map(([, id, text]) => `<li><a href="#${id}">${text.replace(/\s+/g, ' ').trim()}</a></li>`)
    .join('');
  return (
    `<details class="toc"><summary>Contents <span class="toc-n">${headings.length} sections</span></summary>` +
    `<ol>${items}</ol></details>`
  );
}

/** pandoc 3.x emits one notes-list entry per REFERENCE, so a footnote referenced
 * several times is duplicated verbatim — one post rendered the same Lifton note
 * seven times. Merge entries that differ only in their back-reference, keep a
 * single back-reference to the first marker, and renumber the surviving notes
 * sequentially so a merged note leaves no gap in the numbering. Runs on the post
 * body after pandoc and before inlineSidenotes (which reads the merged list). */
function dedupeFootnotes(body) {
  const sect = body.match(/(<section class="footnotes" role="doc-endnotes">\s*<ol>)([\s\S]*?)(<\/ol>\s*<\/section>)/);
  if (!sect) return body;
  const lis = [...sect[2].matchAll(/<li id="(fn[^"]+)">([\s\S]*?)<\/li>/g)];
  if (lis.length < 2) return body;

  const BACK = /<a\s[^>]*class="footnote-back"[^>]*>[\s\S]*?<\/a>/g;
  const sig = (h) => h.replace(BACK, '').replace(/\s+/g, ' ').trim();

  const groups = [];         // { sig, content } in first-appearance order
  const groupOf = new Map(); // old note id -> group index
  for (const [, id, raw] of lis) {
    const s = sig(raw);
    let gi = groups.findIndex((g) => g.sig === s);
    if (gi < 0) { gi = groups.length; groups.push({ sig: s, content: raw.replace(BACK, '').trim() }); }
    groupOf.set(id, gi);
  }
  if (groups.length === lis.length) return body; // nothing was duplicated

  // inline markers, in document order: number each group by its first reference,
  // and remember that marker's id so the merged note has somewhere to return to
  const refs = [...body.matchAll(/<a\b[^>]*class="footnote-ref"[^>]*>[\s\S]*?<\/a>/g)];
  const num = new Map();
  const firstMarker = new Map();
  for (const r of refs) {
    const href = /href="#(fn[^"]+)"/.exec(r[0]);
    const rid = /id="(fnref[^"]+)"/.exec(r[0]);
    if (!href) continue;
    const gi = groupOf.get(href[1]);
    if (gi == null) continue;
    if (!num.has(gi)) { num.set(gi, num.size + 1); if (rid) firstMarker.set(gi, rid[1]); }
  }

  // point every marker at the merged note and renumber its visible numeral
  const renumbered = body.replace(/<a\b[^>]*class="footnote-ref"[^>]*>[\s\S]*?<\/a>/g, (a) => {
    const href = /href="#(fn[^"]+)"/.exec(a);
    const gi = href && groupOf.get(href[1]);
    if (gi == null) return a;
    const n = num.get(gi);
    return a.replace(/href="#fn[^"]+"/, `href="#fn${n}"`).replace(/<sup>[\s\S]*?<\/sup>/, `<sup>${n}</sup>`);
  });

  const items = groups.map((g, gi) => {
    const n = num.get(gi);
    if (n == null || !g.content) return '';
    const marker = firstMarker.get(gi);
    const back = marker ? `<a href="#${marker}" class="footnote-back" role="doc-backlink">↩︎</a>` : '';
    const withBack = back && /<\/p>\s*$/.test(g.content)
      ? g.content.replace(/<\/p>\s*$/, `${back}</p>`)
      : g.content + back;
    return `<li id="fn${n}">${withBack}</li>`;
  }).filter(Boolean);

  const list = `${sect[1]}\n${items.join('\n')}\n${sect[3]}`;
  return renumbered.replace(/<section class="footnotes" role="doc-endnotes">\s*<ol>[\s\S]*?<\/ol>\s*<\/section>/, list);
}

/** Each footnote, copied inline right after its reference, as .sidenote (PAGE_CSS
 * floats the copies into the margin at wide viewports — see there).
 *
 * The copy is phrasing content only: the note's <p> wrapper is dropped and the
 * back-link removed, because inserting a block into the middle of a paragraph
 * would make the HTML parser close that paragraph and split the prose. The copy
 * is aria-hidden: the endnotes stay the canonical text for assistive tech, so a
 * note is never announced twice. */
function inlineSidenotes(body) {
  // pandoc wraps a long anchor's attributes across lines, in no fixed order —
  // match the tag wholesale and read the note id out of it.
  const notes = new Map();
  for (const m of body.matchAll(/<li id="(fn[^"]+)">([\s\S]*?)<\/li>/g)) {
    const inner = m[2]
      .replace(/<\/p>\s*<p>/g, ' ') // several paragraphs become one line
      .replace(/<\/?p>/g, '')
      .replace(/<a\s[^>]*class="footnote-back"[^>]*>[\s\S]*?<\/a>/g, '')
      .trim();
    if (inner) notes.set(m[1], inner);
  }
  let placed = 0;
  const out = body.replace(/<a\s[^>]*class="footnote-ref"[^>]*>[\s\S]*?<\/a>/g, (ref) => {
    const id = /href="#([^"]+)"/.exec(ref);
    const note = id && notes.get(id[1]);
    if (!note) return ref;
    placed++;
    return `${ref}<span class="sidenote" aria-hidden="true">${note}</span>`;
  });
  return { body: out, placed };
}

/** Series prev/next. Both neighbours come from navPosts — the published list the
 * nav is built from — so a draft is never linked, and a series end simply has an
 * empty slot. */
function postNav(post, navPosts) {
  if (!post.series) return '';
  const inSeries = navPosts.filter((p) => p.series === post.series);
  const i = inSeries.findIndex((p) => p.slug === post.slug);
  if (i === -1) return '';
  const prev = i > 0 ? inSeries[i - 1] : null;
  const next = i < inSeries.length - 1 ? inSeries[i + 1] : null;
  if (!prev && !next) return '';
  const label = seriesLabel(post.series);
  const card = (p, dir) =>
    `<a class="${dir}" href="/${p.slug}/"><span class="dir">` +
    (dir === 'prev' ? `← previous in ${label}` : `next in ${label} →`) +
    `</span><span class="t">${titleOf(p)}</span></a>`;
  return `<div class="postnav">${prev ? card(prev, 'prev') : '<span></span>'}${next ? card(next, 'next') : '<span></span>'}</div>`;
}

function buildHome(manifest) {
  const md = read('content', manifest.home.file);
  // the summary's own H1 becomes the hero title, so it must not repeat in
  // the body
  const body = splitH1(mdToHtml(md), 'summary').rest;

  // The posts form series, split by epistemic status — the boundary the
  // posts themselves draw (as many as have published posts; the constants
  // are SERIES, above). "mechanism" is a measured model + a falsifiable
  // prediction; "implications" are arguments built on cited literature;
  // "frames" are arguments about the largest frame of all; "cases" are
  // documented case studies. They are indexed separately so the arguments and
  // the case narratives cannot be read as part of the result (the reason for
  // the split), and numbered within their own series. "readings" is a different
  // axis again: one book, one post — a close reading held at the source's own
  // scale, the citable bedrock the arguments rest on.
  const SERIES = [
    {
      key: 'mechanism',
      name: 'The mechanism',
      hint: '// a measured model, then a falsifiable prediction',
      status: 'measured',
    },
    {
      key: 'implications',
      name: 'The implications',
      hint: '// arguments built on cited literature — not measurements',
      status: 'arguments',
    },
    {
      key: 'frames',
      name: 'The frames',
      hint: '// arguments about the largest frame of all — the cosmology a culture is inside',
      status: 'arguments',
    },
    {
      key: 'cases',
      name: 'The case studies',
      hint: '// documented case studies — how an environment enables predation, read through the mechanism',
      status: 'documented',
    },
    {
      key: 'readings',
      name: 'The readings',
      hint: '// close readings of the source texts the arguments rest on — one book, one post',
      status: 'readings',
    },
  ];

  const cardFor = (p, ordinal) =>
    `<div class="card">` +
    `<span class="n">${String(ordinal).padStart(2, '0')}</span>` +
    `<h3><a href="/${p.slug}/">${titleOf(p)}</a></h3>` +
    `<p><strong>${p.kind}</strong> · ${p.summary}</p>` +
    `</div>`;

  const sections = SERIES.map((s) => {
    const inSeries = manifest.posts.filter((p) => p.series === s.key);
    const listed = inSeries.filter((p) => PREVIEW || p.published);
    if (listed.length === 0) return '';
    return (
      `<section><div class="wrap">` +
      `<h2>${s.name}</h2>` +
      `<div class="hint">${s.hint} · ${listed.length} of ${inSeries.length} published</div>` +
      `<div class="grid">${listed.map((p) => cardFor(p, inSeries.indexOf(p) + 1)).join('')}</div>` +
      `</div></section>`
    );
  })
    .filter(Boolean)
    .join('\n');

  // The tagline names the series that actually have published posts, in nav
  // order — derived, so it stays true as series are added and never counts a
  // series with nothing published (under PREVIEW, staged posts count). With the
  // two published series it renders exactly as it always has:
  // "two series: the <b>mechanism</b> (measured), and the <b>implications</b> (arguments)."
  const shown = SERIES.filter((s) =>
    manifest.posts.some((p) => p.series === s.key && (PREVIEW || p.published))
  );
  const tagline =
    `${NUM_WORD[shown.length] || shown.length} series: ` +
    shown
      .map((s) => `the <b>${s.key}</b> (${s.status})`)
      .join(', ')
      .replace(/, ([^,]*)$/, ', and $1') +
    '.';

  // A featured piece — or a PAIR — if the manifest names one (`"featured":
  // "<slug>"` or `"featured": ["<slug>", ...]`), shown above everything else at
  // the top of the home page. Every slug must resolve to a published post
  // (checkFeatured), so a stale or draft reference fails the build rather than
  // silently rendering nothing. Two are rendered side by side as one block,
  // because a pair can be a single operation described from both ends.
  const featSlugs = Array.isArray(manifest.featured)
    ? manifest.featured
    : manifest.featured
      ? [manifest.featured]
      : [];
  const featPosts = featSlugs
    .map((s) => manifest.posts.find((p) => p.slug === s))
    .filter(Boolean);
  const featureBlock = featPosts.length
    ? `<section><div class="wrap">` +
      (featPosts.length > 1
        ? `<div class="hint"># one operation, described from both ends</div>`
        : '') +
      `<div class="feature-grid">` +
      featPosts
        .map(
          (p) =>
            `<div class="feature">` +
            `<span class="eyebrow">\u2605 featured \u00b7 ${p.kind}</span>` +
            `<h2><a href="/${p.slug}/">${titleOf(p)}</a></h2>` +
            `<p class="f-sum">${p.summary}</p>` +
            `<a class="f-more" href="/${p.slug}/">read it \u2192</a>` +
            `</div>`,
        )
        .join('') +
      `</div></div></section>`
    : '';

  // A mini-timeline of the most recent pieces, so the home page shows what is
  // new without leaving for /timeline/. It is the first MINI rows of that same
  // day-grouped list, so the two pages can never disagree about what is recent
  // (and a post added mid-manifest still shows as new — the order is the dates').
  const MINI = 8;
  const recentAll = dayGroups(manifest.posts.filter((p) => PREVIEW || p.published)).flatMap((g) => g.posts);
  const recent = recentAll.slice(0, MINI);
  const miniTimeline =
    `<section><div class="wrap">` +
    `<h2>What's new</h2>` +
    `<div class="hint"># the last ${recent.length} of ${recentAll.length} · ` +
    `<a href="/timeline/">all of it, newest first →</a></div>` +
    `<ol class="tl-mini">` +
    recent
      .map(
        (p) =>
          `<li><span class="d">${(p.date || '').slice(5)}</span>` +
          `<a href="/${p.slug}/">${titleOf(p)}</a>` +
          `<span class="m">${seriesLabel(p.series)}</span></li>`,
      )
      .join('') +
    `</ol></div></section>`;

  const html =
    `${featureBlock}\n` +
    `${miniTimeline}\n` +
    sections +
    `\n<section><div class="wrap">` +
    `<h2>Where to start</h2>` +
    `<div class="hint">$ cat start-here.md</div>` +
    `<div class="prose">${body}</div>\n` +
    `</div></section>`;

  return {
    title: 'A mechanism that hides itself — blog.jaye.ch',
    shareTitle: 'A mechanism that hides itself — in minds, in groups, in the frames they live inside',
    type: 'website',
    description:
      'A measured mechanism of a collapse that cannot see itself — in minds, in groups, in the frames they live inside — and what it takes to name a structure without sorting people into a verdict.',
    prompt: 'cat start-here.md',
    heroTitle: 'A mechanism that <span class="fx">hides itself</span> — in minds, in groups, in the frames they live inside',
    tagline,
    body: html,
    navCurrent: '/',
  };
}

/** The not-found page. Served by Caddy's handle_errors with a real 404 status
 * (see the Caddy site block) — the build only produces the document, and styled
 * like every other page: nav, a hero in the site's own idiom, and links that are
 * actually useful (home, and the first post of each series). noindex: it must
 * never be indexed as a page of its own, and it declares no canonical URL
 * because it has none. */
function build404(navPosts) {
  const firstOf = (key) => navPosts.find((p) => p.series === key);
  // How many series the site actually has — derived, so the copy stays true as
  // series are added (and never counts one with nothing published).
  const seriesCount = new Set(navPosts.map((p) => p.series).filter(Boolean)).size;
  const links = navPosts.length
    ? SERIES.map((s) => firstOf(s.key))
        .filter(Boolean)
        .map((p) => `<li><a href="/${p.slug}/">${titleOf(p)}</a></li>`)
        .join('')
    : '';
  const body =
    `<section><div class="wrap">` +
    `<h2>Nothing here</h2>` +
    `<div class="hint"># the path you asked for is not one of the pages</div>` +
    `<div class="prose">` +
    `<p>Every address on this site is one of the pages below — the summary, ` +
    `<a href="/timeline/">what's new</a>, or a post in one of its ${NUM_WORD[seriesCount] || seriesCount} series. ` +
    `There is no other content, and nothing was ` +
    `deleted to hide it.</p>` +
    `<ul><li><a href="/">Home — where to start</a></li><li><a href="/timeline/">What's new — every piece, newest first</a></li>${links}</ul>` +
    `<p>If you followed a link from somewhere else, the link is stale; the pieces ` +
    `above are current.</p>` +
    `</div></div></section>`;
  return {
    title: 'Not found — blog.jaye.ch',
    shareTitle: 'Not found — blog.jaye.ch',
    type: 'website',
    noindex: true,
    description: 'No page at this address. The published pages are listed here.',
    prompt: 'cat "$REQUEST_URI"',
    heroTitle: '404 — no such <span class="fx">page</span>',
    tagline: 'the terminal is still here: <b>press /</b> and type <b>ls</b>.',
    body,
    navCurrent: '/404.html',
  };
}

/** The publishing days, newest first, each day's posts newest-first (manifest
 * order is append order within a day, so a day's list is reversed). Shared by
 * the timeline page and the home page's mini-timeline so the two can never
 * disagree about what is recent — and it is DATE-ordered, not manifest-ordered,
 * so adding a post mid-manifest still shows it as new. `navPosts` is the
 * published list (or the preview list) and only dated posts take part. */
function dayGroups(navPosts) {
  const dated = navPosts.filter((p) => p.date);
  return [...new Set(dated.map((p) => p.date))]
    .sort()
    .reverse()
    .map((day) => ({ day, posts: dated.filter((p) => p.date === day).reverse() }));
}

/** The timeline — every published piece, newest first, grouped by the day it
 * went live. This is why the manifest gained a `date` at all: without one this
 * page could not exist, and the manifest is the only honest source for it (the
 * build renders the field, it never derives or invents one).
 *
 * A real page, not a discovery file: it is written to dist and it is in the
 * sitemap. It is built from navPosts so a PREVIEW build shows a staged post in
 * place; in a deployable build navPosts is the published list alone. */
function buildTimeline(navPosts) {
  const groups = dayGroups(navPosts);
  const item = (p) =>
    `<li><a href="/${p.slug}/">${titleOf(p)}</a>` +
    `<span class="m">${seriesLabel(p.series)} · ${p.kind}</span></li>`;
  const body = groups
    .map((g) => `<li class="day"><span class="d">${g.day}</span><ul>${g.posts.map(item).join('')}</ul></li>`)
    .join('');
  const count = groups.reduce((n, g) => n + g.posts.length, 0);
  const days = groups.length;
  return {
    title: "What's new — blog.jaye.ch",
    shareTitle: "What's new — blog.jaye.ch",
    type: 'website',
    description: `Every published piece on blog.jaye.ch, newest first — ${count} pieces over ${days} day${days === 1 ? '' : 's'}.`,
    prompt: 'ls -lt',
    heroTitle: `What's <span class="fx">new</span>`,
    tagline: 'every published piece, newest first — with the day it went live.',
    body:
      `<section><div class="wrap">` +
      `<div class="hint"># every published piece, newest first · ${count} over ${days} day${days === 1 ? '' : 's'}</div>` +
      `<ol class="tl">${body}</ol>` +
      `</div></section>`,
    navCurrent: '/timeline/',
  };
}

/* ---------- discovery files: feed, sitemap, robots ---------- */

/** The published posts, in manifest order. Every generated file uses this list
 * (and never manifest.posts), so no draft can leak into the feed, the sitemap or
 * the command line — in a PREVIEW build too, where the nav deliberately shows
 * the drafts. */
function published(manifest) {
  return manifest.posts.filter((p) => p.published);
}

/** RSS 2.0. Each item carries the post's manifest `date` as its pubDate — the
 * day it went live, and nothing more precise. Only a calendar day is known, so
 * the stamp is midnight UTC (rfc822's conventional stand-in for a date); no
 * lastBuildDate is emitted, because a build time is not a property of the
 * content and would make the feed differ between two identical builds. */
function feedXml(posts) {
  const items = posts
    .map((p) => {
      const url = `${BASE}/${p.slug}/`;
      return (
        `    <item>\n` +
        `      <title>${xesc(titleOf(p))}</title>\n` +
        `      <link>${url}</link>\n` +
        `      <guid isPermaLink="true">${url}</guid>\n` +
        `      <pubDate>${rfc822(p.date)}</pubDate>\n` +
        `      <description>${xesc(p.summary)}</description>\n` +
        (p.series ? `      <category>${xesc(seriesLabel(p.series))}</category>\n` : '') +
        (p.kind ? `      <category>${xesc(p.kind)}</category>\n` : '') +
        `    </item>`
      );
    })
    .join('\n');
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n` +
    `  <channel>\n` +
    `    <title>blog.jaye.ch</title>\n` +
    `    <link>${BASE}/</link>\n` +
    `    <description>A mechanism that hides itself — in minds, in groups, in the frames they live inside: a measured account of a collapse that cannot report itself, the frames that decide what it means, and the discipline of describing structures without diagnosing people.</description>\n` +
    `    <language>en</language>\n` +
    `    <atom:link href="${BASE}/feed.xml" rel="self" type="application/rss+xml"/>\n` +
    `${items}\n` +
    `  </channel>\n` +
    `</rss>\n`
  );
}

/** Absolute URLs for the home page, the timeline, and every published post.
 * `lastmod` carries the post's day (date-only, per the sitemap spec), from the
 * same manifest field the feed uses. */
function sitemapXml(posts) {
  const urls = [
    { loc: BASE + '/', lastmod: null },
    { loc: `${BASE}/timeline/`, lastmod: posts.map((p) => p.date).sort().pop() || null },
    ...posts.map((p) => ({ loc: `${BASE}/${p.slug}/`, lastmod: p.date })),
  ]
    .map(
      (u) =>
        `  <url>\n    <loc>${u.loc}</loc>\n` +
        (u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>\n` : '') +
        `  </url>`,
    )
    .join('\n');
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${urls}\n` +
    `</urlset>\n`
  );
}

function robotsTxt() {
  return (
    `# blog.jaye.ch — every published page is public; there is nothing to disallow.\n` +
    `User-agent: *\n` +
    `Allow: /\n` +
    `\n` +
    `Sitemap: ${BASE}/sitemap.xml\n`
  );
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
  'manufacturing-the-collapse': {
    prompt: 'cat manufacturing-the-collapse.md',
    tagline: 'the <b>inversion</b>: how coercive groups run the collapse on purpose.',
    hint: '<a href="/">← home</a> · the procedure, and the inversion, with notes',
    description:
      'Coercive groups induce the same collapse deliberately and hold you on the far side of it — the same three guardrails the traditions supply, with two of them flipped.',
    accent: 'Collapse',
  },
  'sacred-science': {
    prompt: 'cat sacred-science.md',
    tagline: 'the <b>metaphysics</b>: the frame that decides what the collapse means.',
    hint: '<a href="/">← home</a> · the frame, and the inversion, with notes',
    description:
      'Why "the observer collapses reality" and "union with God" are the same move — quantum mysticism as the modern warrant that steers the collapse toward an owned destination.',
    accent: 'Sacred Science',
  },
  'empty-leader': {
    prompt: 'cat empty-leader.md',
    tagline: 'the <b>leader</b>: same dissociation, opposite direction.',
    hint: '<a href="/">← home</a> · the leader, and the inversion, with notes',
    description:
      'The one who induces the collapse and the one who is collapsed share the same dissociation — intact cognition, absent affective self — and the difference is which way the emptiness points.',
    accent: 'Empty Leader',
  },
  'the-label': {
    prompt: 'cat the-label.md',
    tagline: 'the <b>word</b>: what a label does that a mechanism does not.',
    hint: '<a href="/">← home</a> · the label, and the debt, with notes',
    description:
      '"Cult" is a category that harms the people it is meant to protect — and the sources this series leans on helped justify deprogramming. Why it names mechanisms instead.',
    accent: 'Label',
  },
  'what-actually-works': {
    prompt: 'cat what-actually-works.md',
    tagline: 'the <b>rescue</b>: what gets someone out — and what breaks the rescue.',
    hint: '<a href="/">← home</a> · the rescue result, with notes',
    description:
      'The measured rescue result: a cheap fixed floor beats an elaborate one, and continuously re-checking your support is what destroys it.',
    accent: 'Works',
  },
  'recovery-is-not-immunity': {
    prompt: 'cat recovery-is-not-immunity.md',
    tagline: 'the <b>sequel</b>: a full rescue buys nothing against the next trigger.',
    hint: '<a href="/">← home</a> · the relapse result, with notes',
    description:
      'A full rescue buys the recovered state nothing against the next trigger — the threshold that recovery restores is the threshold the next episode drains.',
    accent: 'Immunity',
  },
  'what-the-traditions-knew': {
    prompt: 'cat what-the-traditions-knew.md',
    tagline: 'the <b>evidence</b>: seven traditions named it, before any mechanism.',
    hint: '<a href="/">← home</a> · the primary sources, with citations',
    description:
      'Seven contemplative traditions, with no contact with each other, independently named this failure, described its features, and prescribed the same safeguards — primary-source passages.',
    accent: 'Knew',
  },
  'safeguards': {
    prompt: 'cat safeguards.md',
    tagline: 'the <b>countermeasures</b>: what the traditions wrote down, and why it works.',
    hint: '<a href="/">← home</a> · the safeguards, with notes',
    description:
      'The sixth and last post: the safeguards the traditions encoded — and the clinical field is re-deriving — against every failure mode the series documents.',
    accent: 'Safeguards',
  },
  // --- the case studies (staged; published:false in the manifest until released)
  'the-environment': {
    prompt: 'cat the-environment.md',
    tagline: 'the <b>method</b>: what a predator never has to build, because the culture already built it.',
    hint: '<a href="/">← home</a> · the method, with notes',
    description:
      'What an environment pre-supplies — hidden agency, a ranked inner state, a sanctioned dissociation, a host-certified warrant — and the discipline that keeps reading a culture from becoming a verdict on a people.',
    accent: 'Work',
  },
  'the-witch-and-the-debt': {
    prompt: 'cat the-witch-and-the-debt.md',
    tagline: 'the <b>hidden cause</b>: harm you cannot see, and a debt that silences the complaint.',
    hint: '<a href="/">← home</a> · hidden agency, with notes',
    description:
      'A cosmology in which harm is real but invisible and suffering is owed — the unfalsifiable slot the environment supplies, and the reason a victim has no standing to complain.',
    accent: 'Debt',
  },
  'the-ladder-of-light': {
    prompt: 'cat the-ladder-of-light.md',
    tagline: 'the <b>ranked state</b>: an authority nobody can check — and why wanting the next rung is obedience.',
    hint: '<a href="/">← home</a> · ranked enlightenment, with notes',
    description:
      'Enlightenment as a hierarchy of inner state — spiritual materialism, the fallacy of ranking an unobservable, and the ladder as a control surface the seeker climbs for the predator.',
    accent: 'Light',
  },
  'the-sanctioned-trance': {
    prompt: 'cat the-sanctioned-trance.md',
    tagline: 'the <b>sanctioned state</b>: where the trance is already holy, the damage arrives pre-legitimised.',
    hint: '<a href="/">← home</a> · the sanctioned state, with notes',
    description:
      'Where dissociation is the practice, the collapse arrives pre-legitimised and the alarm is off — and the check that would notice is the tolerance the culture is right to keep.',
    accent: 'Trance',
  },
  'the-certified-frame': {
    prompt: 'cat the-certified-frame.md',
    tagline: 'the <b>borrowed warrant</b>: the destination certifies the teacher — and the check on him reads as bigotry.',
    hint: '<a href="/">← home</a> · the borrowed warrant, with notes',
    description:
      'When a host culture grants authority to a teacher it has not scrutinised, scrutiny becomes socially costly — and the protections of the home country do not travel with the frame.',
    accent: 'Frame',
  },
  'the-empty-vessel': {
    prompt: 'cat the-empty-vessel.md',
    tagline: 'the <b>owned frame</b>: a guru who said empty yourself and be filled with me — in a country that had already named the danger.',
    hint: '<a href="/">← home</a> · the same mechanism, a different country, with notes',
    description:
      'Aum Shinrikyo: the mechanism outside Brazil — a guru who taught emptying the self and being filled with him, in a tradition that had already named the state (makyō, meditation sickness) and called it not the goal.',
    accent: 'Vessel',
  },
  'the-new-jerusalem': {
    prompt: 'cat the-new-jerusalem.md',
    tagline: 'the <b>vacuum</b>: after an ideology fell, a country without a frame — and the group that supplied one, and claimed the nation as the world\u2019s sacred centre.',
    hint: '<a href="/">← home</a> · three environments, one mechanism, with notes',
    description:
      'Post-Soviet Ukraine: an environment that supplies nothing, and the group that filled the vacuum — the same mechanism as Brazil and Japan, at a different price.',
    accent: 'Jerusalem',
  },
  'the-designed-method': {
    prompt: 'cat the-designed-method.md',
    tagline: 'the <b>designed method</b>: a technique written to produce the state on schedule — then read as the goal.',
    hint: '<a href="/">← home</a> · the method as lever, with notes',
    description:
      'Osho\u2019s Dynamic Meditation: the one case where the group did not find a dissociation but designed one — and the West certified it.',
    accent: 'Method',
  },
  'the-same-move': {
    prompt: 'cat the-same-move.md',
    tagline: 'the <b>pattern</b>: one mechanism in four environments — and the environment sets the price, not the choice.',
    hint: '<a href="/">← home</a> · read this first, with notes',
    description:
      'The case studies, opening: one mechanism run through Brazil, Japan, Ukraine and India-to-the-West — and the finding that the environment decides the price, not whether the move is used.',
    accent: 'Move',
  },
  'the-costume': {
    prompt: 'cat the-costume.md',
    tagline: 'the <b>costume</b>: strip the mysticism off the levers and they still work — which tells us what a lever is.',
    hint: '<a href="/">← home</a> · the levers, undressed, with notes',
    description:
      'The levers without the mysticism: a masonic lodge and a false-bottomed suitcase run the same structure as the mystics — so the lever is a position, not a belief.',
    accent: 'Costume',
  },
  'the-breakthrough': {
    prompt: 'cat the-breakthrough.md',
    tagline: 'the <b>other side of the coin</b>: the same manufactured collapse, with no mysticism at all — run for money, at scale.',
    hint: '<a href="/">← home</a> · the procedure without a cosmology, with notes',
    description:
      'est and the Landmark Forum: the coercion post’s procedure with the cosmology removed — fatigue, confrontation, the collapse, and the appraisal sold as "Transformation."',
    accent: 'Breakthrough',
  },
  'the-machine-said-so': {
    prompt: 'cat the-machine-said-so.md',
    tagline: 'the <b>oracle without a person</b>: the unfalsifiable authority needs no guru — and the remedy is still the same.',
    hint: '<a href="/">\u2190 home</a> · the machine in the slot, with notes',
    description:
      'Horizon, Robodebt and the Dutch childcare affair: the unfalsifiable slot staffed by a machine — and the finding that measurement is not a safeguard, auditable measurement is.',
    accent: 'Machine',
  },
  'set-and-setting': {
    prompt: 'cat set-and-setting.md',
    tagline: 'the <b>third route</b>: the mechanism by molecule — and the field that named the appraisal as the variable.',
    hint: '<a href="/">\u2190 home</a> · the appraisal, measured, with notes',
    description:
      'Psychedelics as the mechanism\u2019s third induction route: the same state appraised as breakthrough or bad trip \u2014 and \u201cset and setting\u201d is the frame lever, named as a risk factor.',
    accent: 'Setting',
  },
  'the-differential': {
    prompt: 'cat the-differential.md',
    tagline: 'the <b>clinic</b>: the state is ambiguous by construction, so what the clinician can measure is what it costs.',
    hint: '<a href="/">\u2190 home</a> · the clinic in the model, with notes',
    description:
      'What a clinician can and cannot know: the state is appraised, the instruments false-positive, and the honest measure is impairment, duration \u2014 and a holder.',
    accent: 'Differential',
  },
  'after-the-room': {
    prompt: 'cat after-the-room.md',
    tagline: 'the <b>exit</b>: the model\u2019s clearest prediction, the history of getting it wrong, and what leaving costs.',
    hint: '<a href="/">\u2190 home</a> · leaving, and the boundary, with notes',
    description:
      'The state cannot initiate its own exit \u2014 so an outside relationship is necessary, and a verdict is the harm. Deprogramming, exit counselling, and the in-between time.',
    accent: 'Room',
  },
  'the-follower': {
    prompt: 'cat the-follower.md',
    tagline: 'the <b>follower</b>: a position, not a personality \u2014 and the instrument that would sort people is the one that fails.',
    hint: '<a href="/">\u2190 home</a> · the other end of the relation, with notes',
    description:
      'Seventy years of research tried to name the follower as a personality type and dissolved the type instead: expression is conditional, the position is relational, and the instrument failed at .20.',
    accent: 'Follower',
  },
  'the-container': {
    prompt: 'cat the-container.md',
    tagline: 'the <b>first-person account</b>: a practitioner describes the environment that supplies the frame — and contradicts this series where it matters most.',
    hint: '<a href="/">\u2190 home</a> · the account from inside, with notes',
    description:
      'A pseudonymous practitioner\u2019s own account of being recruited, waking up and getting out — independently describing frame-supply, rationalisation, the holder move, and a confirming-miracles lever this series had not named.',
    accent: 'Container',
  },
  'the-western-column': {
    prompt: 'cat the-western-column.md',
    tagline: 'the <b>Western column</b>: the same failure, graded into a curriculum \u2014 and a tradition that wrote its own safeguards down.',
    hint: '<a href="/">\u2190 home</a> · the third column, with notes',
    description:
      'The Western esoteric tradition ran the same induction, named the same failure and built the same safeguards into a syllabus \u2014 and published its own predation account.',
    accent: 'Column',
  },
  'the-frame-is-a-variable': {
    prompt: 'cat the-frame-is-a-variable.md',
    tagline: 'the <b>largest frame</b>: a cosmology is a frame too \u2014 and the same three questions apply to it.',
    hint: '<a href="/">\u2190 home</a> · the series opener, with notes',
    description:
      'One scale up: what a culture takes reality to be is a frame like any other \u2014 it supplies a reading, it can be checked or not, and someone benefits from the naming.',
    accent: 'Variable',
  },
  'the-machine-has-no-reading': {
    prompt: 'cat the-machine-has-no-reading.md',
    tagline: 'the <b>blind spot</b>: a frame with no category for the collapse cannot see it \u2014 and so cedes the reading to whoever supplies one.',
    hint: '<a href="/">\u2190 home</a> · what the machine frame can and cannot see, with notes',
    description:
      'Why a materialist cosmology cannot measure the collapse: no category means misfiling, not absence — and an unfilled category is a vacancy a coercive frame can occupy.',
    accent: 'Reading',
  },
  'a-cosmos-of-persons': {
    prompt: 'cat a-cosmos-of-persons.md',
    tagline: 'the <b>frame with a reading</b>: more dangerous than one without \u2014 because a reading can be owned.',
    hint: '<a href="/">\u2190 home</a> · the other frame, and its safeguard, with notes',
    description:
      'The living cosmos has a reading for the collapse, and that is its danger: the safeguard is structural \u2014 a plane of many participants, and a practitioner who does not stand above it.',
    accent: 'Persons',
  },
  'the-owned-cosmos': {
    prompt: 'cat the-owned-cosmos.md',
    tagline: 'the <b>seat</b>: a cosmology that names the endpoint and stations someone at it \u2014 the form every case study shares.',
    hint: '<a href="/">\u2190 home</a> · the occupied frame, with notes',
    description:
      'The third possibility: a frame with a reading, a purpose, and a seat. The cosmological form of every case study in this series \u2014 and the reason the traditions refused to name the endpoint.',
    accent: 'Owned',
  },
  'the-cosmos-that-refuses': {
    prompt: 'cat the-cosmos-that-refuses.md',
    tagline: 'the <b>refusal</b>: a correspondence with no endpoint \u2014 the oldest countermeasure, and why it is not enough.',
    hint: '<a href="/">\u2190 home</a> · the fourth frame, with notes',
    description:
      'Apophatic cosmology: a frame with a correspondence and no nameable endpoint. The architectural countermeasure to the seat \u2014 and, because it can be claimed, not self-enforcing.',
    accent: 'Refuses',
  },
  'the-deep-inheritance': {
    prompt: 'cat the-deep-inheritance.md',
    tagline: 'the <b>inherited frame</b>: two mythic families, one without a telos and one with \u2014 the oldest form of the series\u2019 question.',
    hint: '<a href="/">\u2190 home</a> · the series closer, with notes',
    description:
      'Witzel\u2019s deep-mythology finding as the fourth convergence: the frames a person is inside were inherited tens of millennia ago \u2014 and the oldest disagreement is about whether reality has an endpoint.',
    accent: 'Inheritance',
  },
  'the-holy-daimon': {
    prompt: 'cat the-holy-daimon.md',
    tagline: 'a <b>reading</b>: the guide that is met, not mediated \u2014 and the one safeguard the book never writes down.',
    hint: '<a href="/">\u2190 home</a> · a reading of one book, with notes',
    description:
      'A close reading of Frater Acher\u2019s Holy Daimon: systasis as a meeting between two parties, a guide that is unowned, and a practice whose stated direction runs outward \u2014 against the seat, and with one gap the book leaves open.',
    accent: 'The Holy Daimon',
  },
  'the-operative-master': {
    prompt: 'cat the-operative-master.md',
    tagline: 'the <b>matching operation</b>: the operator brings no frame \u2014 he finds the position yours already leaves open, and occupies it.',
    hint: '<a href="/">\u2190 home</a> · the position, and the boundary, with notes',
    description:
      'The one-to-one case of the levers-as-positions: a reading of a person\u2019s own frame that fits it, so the frame does the installing \u2014 experienced as recognition, and therefore unreportable from inside.',
    accent: 'Operative Master',
  },
  'the-holy-heretics': {
    prompt: 'cat the-holy-heretics.md',
    tagline: 'a <b>reading</b>: the path of unknowing as a practice \u2014 and a practitioner\u2019s charge that the orthodoxy, not the heretic, is the poison.',
    hint: '<a href="/">\u2190 home</a> \u00b7 a reading of one book, with notes',
    description:
      'A close reading of Frater Acher\u2019s Holy Heretics: apophatic mysticism as metered practice, and the book\u2019s own argument that the antagonism runs between unmediated experience and organised orthodoxy \u2014 which the blog reads back into the Western column.',
    accent: 'The Holy Heretics',
  },
  'undreaming-wetiko': {
    prompt: 'cat undreaming-wetiko.md',
    tagline: 'a <b>reading</b>: the collapse named as a contagion \u2014 a mind-virus with no existence of its own that can still kill, and a cure the blog already wrote down.',
    hint: '<a href="/">\u2190 home</a> \u00b7 a reading of one book, with notes',
    description:
      'A close reading of Paul Levy\u2019s Undreaming Wetiko: the self-content collapse named as a transmissible mind-virus \u2014 a frame with \u201cno intrinsic, independent existence\u201d that can nevertheless kill \u2014 whose own remedy is legibility, and whose own trap is the detector move the blog forbids.',
    accent: 'Undreaming Wetiko',
  },
  'memories-dreams-reflections': {
    prompt: 'cat memories-dreams-reflections.md',
    tagline: 'a <b>reading</b>: the descent into the unconscious as a controlled collapse \u2014 held by a task, and by a myth the book then says we no longer have.',
    hint: '<a href="/">\u2190 home</a> \u00b7 a reading of one book, with notes',
    description:
      'A close reading of Jung\u2019s Memories, Dreams, Reflections: the confrontation with the unconscious read as a controlled collapse \u2014 the descent, the task that held it, the frame question stated as \u201cwhat myth do you live in?\u201d, and the authorship the book admits is a fusion.',
    accent: 'Memories, Dreams, Reflections',
  },
  'ani-mystic': {
    prompt: 'cat ani-mystic.md',
    tagline: 'a <b>reading</b>: a cosmology of a living cosmos \u2014 read as the frame it argues for, held and examined, never adopted.',
    hint: '<a href="/">\u2190 home</a> \u00b7 a reading of one book, with notes',
    description:
      'A close reading of Gordon White\u2019s Ani.Mystic: the argument for an animated cosmos read as a frame \u2014 what it claims, what it can and cannot check, and why the frames series holds it as a source about frames rather than as the frame.',
    accent: 'Ani.Mystic',
  },
  'star-ships': {
    prompt: 'cat star-ships.md',
    tagline: 'a <b>reading</b>: the spirits before the ships \u2014 a deep-prehistory argument read at its own scale, and against what the frames series took from it.',
    hint: '<a href="/">\u2190 home</a> \u00b7 a reading of one book, with notes',
    description:
      'A close reading of Gordon White\u2019s Star.Ships: the case that the spirits came first and the evidence it rests on \u2014 where it is strong, where it is contested, and how the blog\u2019s inherited-frame finding relates to it.',
    accent: 'Star.Ships',
  },
  'two-esoteric-tarots': {
    prompt: 'cat two-esoteric-tarots.md',
    tagline: 'a <b>reading</b>: a frame built by named hands \u2014 the tarot, the lineage claimed for it, and the authority over what the cards are, which is a dispute you can check from outside.',
    hint: '<a href="/">\u2190 home</a> \u00b7 a reading of one book, with notes',
    description:
      'A close reading of Adams & Poncet\u2019s Two Esoteric Tarots: the tarot read as a frame made portable and instrumental \u2014 a fixed correspondence system, a spread of positions, and a reader \u2014 and the Dummett-Yates controversy as the checkable-from-outside dispute the blog asks of any frame.',
    accent: 'Two Esoteric Tarots',
  },
  'egregores': {
    prompt: 'cat egregores.md',
    tagline: 'a <b>reading</b>: the group-made mind read whole \u2014 an entity claim from an initiate, a neutral structure the blog had only used for its worst case, and the exit chapter the blog never cited.',
    hint: '<a href="/">\u2190 home</a> \u00b7 a reading of one book, with notes',
    description:
      'A close reading of Mark Stavish\u2019s Egregores: the shared thought-form as a normative structure (a church has one too), the entity claim held without adopting it, and the deprogramming countermeasure the blog cited only for the diagnosis.',
    accent: 'Egregores',
  },
  'the-lucifer-effect': {
    prompt: 'cat the-lucifer-effect.md',
    tagline: 'a <b>reading</b>: the situation thesis at book length \u2014 and the certified frame whose record has since collapsed under the archive.',
    hint: '<a href="/">\u2190 home</a> \u00b7 a reading of one book, with notes',
    description:
      'A close reading of Zimbardo\u2019s The Lucifer Effect: disposition, situation, system \u2014 the blog\u2019s own structural thesis in the secular register \u2014 against the now-contested record of the Stanford Prison Experiment it is built on, and the shadow where \u201cthe situation made me do it\u201d becomes a recoding of responsibility.',
    accent: 'The Lucifer Effect',
  },
  'thought-reform': {
    prompt: 'cat thought-reform.md',
    tagline: 'a <b>reading</b>: the eight criteria at source \u2014 the framework the blog has quoted all along, read whole, and the checklist it became.',
    hint: '<a href="/">\u2190 home</a> \u00b7 a reading of one book, with notes',
    description:
      'A close reading of Robert Jay Lifton\u2019s Thought Reform and the Psychology of Totalism: the totalism framework at source, its eight criteria read whole rather than through summaries \u2014 and the certified checklist the anti-cult movement made of it.',
    accent: 'Thought Reform',
  },
  'eichmann-in-jerusalem': {
    prompt: 'cat eichmann-in-jerusalem.md',
    tagline: 'a <b>reading</b>: the banality of evil at source \u2014 the phrase the blog has used all along through Zimbardo, and the thoughtlessness it actually names.',
    hint: '<a href="/">\u2190 home</a> \u00b7 a reading of one book, with notes',
    description:
      'A close reading of Hannah Arendt\u2019s Eichmann in Jerusalem: thoughtlessness rather than monstrousness, the phrase read at source rather than through its later uses, and the controversy over what she meant and what misuse has made of it.',
    accent: 'Eichmann in Jerusalem',
  },
  'the-anatomy-of-destructiveness': {
    prompt: 'cat the-anatomy-of-destructiveness.md',
    tagline: 'a <b>reading</b>: the necrophilous character read whole \u2014 destruction as a structure of character, and the biophilia that answers it.',
    hint: '<a href="/">\u2190 home</a> \u00b7 a reading of one book, with notes',
    description:
      'A close reading of Erich Fromm\u2019s The Anatomy of Human Destructiveness: the necrophilous and biophilous orientations read as structures rather than dispositions, and what the blog owes a framework it has never cited.',
    accent: 'The Anatomy of Destructiveness',
  },
  'geosophia': {
    prompt: 'cat geosophia.md',
    tagline: 'a <b>reading</b>: the underworld tradition read whole \u2014 the practice beneath the Western column\u2019s theory.',
    hint: '<a href="/">\u2190 home</a> \u00b7 a reading of two volumes, with notes',
    description:
      'A close reading of Jake Stratton-Kent\u2019s Geosophia I and II: the chthonic and goetic tradition reconstructed as the practical root the blog\u2019s Western column keeps gesturing at, read at its own scale.',
    accent: 'Geosophia',
  },
  'quareia': {
    prompt: 'cat quareia.md',
    tagline: 'a <b>reading</b>: the curriculum read end to end \u2014 the practice the blog has been quoting module by module.',
    hint: '<a href="/">\u2190 home</a> \u00b7 a reading of a curriculum, with notes',
    description:
      'A close reading of the Quareia curriculum as a whole: the modern magical training the blog has cited in extracts, read for its structure, its pace, and where it puts the check.',
    accent: 'Quareia',
  },
  'ahead-of-the-story': {
    prompt: 'cat ahead-of-the-story.md',
    tagline: 'the <b>fit that fails</b>: getting ahead of the account \u2014 the rejection recoded as the target\u2019s symptom, the pivot to the network, and the accurate report made self-indicting.',
    hint: '<a href="/">\u2190 home</a> \u00b7 the damage control, and the boundary, with notes',
    description:
      'The sequel to The Operative Master: what happens when the position is refused \u2014 the operator gets ahead of the story, recoding the rejection as a symptom, pivoting from the target to the surrounding support structures, and turning the target\u2019s own accurate report into the evidence against them.',
    accent: 'Ahead of the Story',
  },
};

function buildPost(post, navPosts) {
  const meta = POST_META[post.slug];
  if (!meta) throw new Error(`no POST_META entry for slug '${post.slug}'`);
  const md = read('content', post.file);

  // the post's own H1 becomes the hero title, so it must not repeat in the body
  let { titleHtml, rest: body } = splitH1(mdToHtml(md), post.slug);
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

  // pandoc duplicates a note once per reference — merge and renumber before the
  // sidenote copies are made from the list
  const notesBefore = (body.match(/<li id="fn/g) || []).length;
  body = dedupeFootnotes(body);
  const notesAfter = (body.match(/<li id="fn/g) || []).length;
  if (notesAfter < notesBefore) log(`${post.slug}: merged ${notesBefore - notesAfter} duplicate footnote entr(ies)`);

  // the section hint already links back to the summary — no extra back-link
  const notes = inlineSidenotes(body);
  if (notes.placed) log(`${post.slug}: ${notes.placed} footnote(s) also copied inline for wide-viewport sidenotes`);
  const html = section('The full post', meta.hint, notes.body, {
    before: toc(notes.body),
    after: postNav(post, navPosts),
  });

  return {
    title: `${titleHtml} — blog.jaye.ch`,
    shareTitle: titleHtml,
    type: 'article',
    description: meta.description,
    prompt: meta.prompt,
    heroTitle: fxTitle,
    tagline: meta.tagline,
    body: html,
    navCurrent: `/${post.slug}/`,
  };
}

/* ---------- release safety: a built page must not link a draft ---------- */

/** Scan every written page for any reference to an UNPUBLISHED slug — a
 * deployable page must never expose a draft's URL, whether as a link
 * (href="/slug/") or as data the page's script can navigate to (the command
 * line embeds its page list). (In a PREVIEW build the nav itself links drafts,
 * which is expected and reported as such.) */
function checkLinks(pages, manifest) {
  const drafts = manifest.posts.filter((p) => !p.published);
  const problems = [];
  for (const { rel, html } of pages) {
    for (const d of drafts) {
      const needle = `/${d.slug}/`;
      if (html.includes(needle)) problems.push(`${rel} references ${needle}`);
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
  const slots = vizSlots(html);
  if (slots.length) log(`  ↳ inlined figures: ${slots.join(', ')}`);
  return html;
}

/** A generated non-page file (feed, sitemap, robots). Written like a page, but
 * it is not scanned for draft links — it is built from the published list. */
function writeFile(rel, text) {
  const out = join(DIST, rel);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  log(`wrote ${rel} (${Buffer.byteLength(text)} bytes)`);
}

log('building dist/');
if (!existsSync(CSS)) {
  throw new Error(`missing ${CSS} — run tools/extract-css.mjs (or ./build.sh) first`);
}

/* ---------- preflight ---------- */

/**
 * Footnote integrity: every `[^key]` marker must have a matching `[^key]:`
 * definition, and every definition must be used. Pandoc silently emits no
 * footnotes section when markers are missing — the page then fails the
 * "footnotes section not found" check in buildPost — and unused definitions
 * are silently dropped. Catching it here, before anything is written, makes
 * both failures impossible to ship.
 */
function checkFootnotes() {
  const dir = join(ROOT, 'content');
  const problems = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const src = readFileSync(join(dir, name), 'utf8');
    const defs = new Set();
    const refs = new Set();
    for (const m of src.matchAll(/\[\^([A-Za-z0-9]+)\]/g)) {
      // A DEFINITION is a marker followed by ':' AT THE START OF A LINE. A marker
      // followed by ':' anywhere else is ordinary prose — "…ended on a claim[^x]:
      // text" — and must count as a reference, or a legitimate sentence reads as
      // an unused note. (The old regex misfired on exactly that three times.)
      const before = src.slice(Math.max(0, m.index - 60), m.index);
      const atLineStart = /(^|\n)[ \t]*$/.test(before);
      const isDef = atLineStart && src[m.index + m[0].length] === ':';
      (isDef ? defs : refs).add(m[1]);
    }
    const unused = [...defs].filter((k) => !refs.has(k));
    const undefined_ = [...refs].filter((k) => !defs.has(k));
    if (unused.length) problems.push(`  ${name}: definition without an inline marker: ${unused.join(', ')}`);
    if (undefined_.length) problems.push(`  ${name}: inline marker without a definition: ${undefined_.join(', ')}`);
  }
  if (problems.length) {
    throw new Error('footnote integrity failed:\n' + problems.join('\n'));
  }
  log('footnote integrity ok (every marker has a definition, every definition is used)');
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

checkFootnotes();
checkDates(manifest);
checkFeatured(manifest);

rmSync(DIST, { recursive: true, force: true });
// The feed, the sitemap and robots are built from the PUBLISHED posts even in a
// PREVIEW build: a preview is a local approximation of the site, and the
// discovery files describe the public one.
const livePosts = published(manifest);
const written = [];
written.push({ rel: 'index.html', html: writePage('index.html', buildHome(manifest), navPosts) });
for (const post of postsToBuild) {
  written.push({
    rel: `${post.slug}/index.html`,
    html: writePage(`${post.slug}/index.html`, buildPost(post, navPosts), navPosts),
  });
}
written.push({ rel: '404.html', html: writePage('404.html', build404(navPosts), navPosts) });
written.push({
  rel: 'timeline/index.html',
  html: writePage('timeline/index.html', buildTimeline(navPosts), navPosts),
});

const writtenFiles = [];
const writeDiscovery = (rel, text) => { writeFile(rel, text); writtenFiles.push({ rel, text }); };
writeDiscovery('feed.xml', feedXml(livePosts));
writeDiscovery('sitemap.xml', sitemapXml(livePosts));
writeDiscovery('robots.txt', robotsTxt());
log(
  `discovery files list ${livePosts.length} published post(s)` +
    (PREVIEW && livePosts.length !== manifest.posts.length
      ? ` — the ${manifest.posts.length - livePosts.length} draft(s) are excluded`
      : ''),
);

/** The workshop-leak gate: a page must not tell the reader how the blog is
 * built. Two whole audits were needed to find leaks that had reached the public
 * HTML — internal filenames and paths, file sizes, extraction mechanics — and
 * the second found two that the first fix had missed, so this runs on every
 * build rather than when someone remembers to look.
 *
 * It scans the RENDERED output (the same text a reader gets, including inlined
 * widget scripts and CSS), not the sources: a leak can enter through an inlined
 * asset even when the prose is clean, which is exactly how the build.mjs and
 * tools/viz comments got out. Patterns are deliberately tight — a file path, a
 * size claim, a comment delimiter in emitted code — because the posts
 * legitimately contain words like "characters", "the file" in a quotation, or
 * "scan". Where a legitimate use exists it is named in `allowed` or the pattern
 * is narrowed until it cannot match it. Fail loudly rather than warn: a leak
 * that ships is not recoverable by later noticing it. */
function checkWorkshop(html) {
  const patterns = [
    // internal filenames and paths (a reader has none of these)
    [/\b(?:build|check-scope|extract-css|viz-smoke|viz-shots)\.(?:mjs|sh)\b/, 'internal script name'],
    [/\btools\/(?:build|viz|check-scope)[\w./-]*/, 'internal path'],
    [/\bposts\.json\b|\bcontinuity\.md\b|\bblog\.css\b/, 'internal file name'],
    [/(?:^|["'\s(])(?:~|\/home\/[a-z])\/[\w./-]+/, 'local filesystem path'],
    [/\b[\w.-]+\.(?:txt|mjs|json)\b(?=[\s"',.)]|$)/, 'source-file name'],
    // file-size / extraction-mechanics claims
    [/\b\d[\d,]{2,}\s*(?:bytes|KB|MB)\b/i, 'file size'],
    [/\b\d[\d,]{3,}\s+characters\b/, 'character count'],
    [/\bno newline\b|\bwhitespace[- ]collaps|\bjumbled page order\b|\bwatermark-delimited\b/i, 'extraction mechanics'],
    // authoring references
    [/\bthe brief\b|\bthe reading list\b|\bthe manifest\b|\bthe plumbing\b|\bthe build\b(?!\s+in\b)/i, 'authoring reference'],
    // a comment delimiter that reached emitted code
    [/\/\*\s*[-=]*\s*[a-z]/i, 'source comment in emitted code'],
    [/^\s*\/\/\s/m, 'source comment in emitted code'],
  ];
  // Legitimate uses the tight patterns above could still catch, by exact text.
  const allowed = [
    'the build in', 'the build of', // ordinary prose, not the build process
  ];
  const problems = [];
  for (const [re, what] of patterns) {
    for (const m of html.matchAll(new RegExp(re, re.flags.includes('g') ? re.flags : re.flags + 'g'))) {
      const at = m.index;
      const window = html.slice(Math.max(0, at - 60), at + 60).replace(/\s+/g, ' ');
      if (allowed.some((a) => window.toLowerCase().includes(a))) continue;
      problems.push(`  ${what}: ${JSON.stringify(window.trim())}`);
    }
  }
  return problems;
}

/** Run checkWorkshop over every written page and file, and fail the build. */
function checkWorkshopAll(written, files) {
  const problems = [];
  for (const { rel, html } of written) {
    for (const p of checkWorkshop(html)) problems.push(`${rel}:${p}`);
  }
  for (const { rel, text } of files) {
    for (const p of checkWorkshop(text)) problems.push(`${rel}:${p}`);
  }
  if (problems.length) {
    throw new Error(
      `workshop leak(s) in the rendered output — a reader must never see how the blog is built:\n` +
        problems.join('\n'),
    );
  }
}

checkLinks(written, manifest);
checkWorkshopAll(written, writtenFiles);
if (PREVIEW) {
  console.log(
    '***********************************************************************\n' +
    '*  PREVIEW BUILD — includes UNPUBLISHED drafts (not for deployment)  *\n' +
    '***********************************************************************',
  );
}
log('done');
