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
 * at build time). The build renders that date; it never invents one. The day is
 * the AUTHOR'S LOCAL day, not UTC — work finished after 22:00 UTC is the next day
 * in Paris, and the first dates derived here were a day off for exactly that
 * reason. A published post with no date fails the build: the timeline, the feed
 * and the sitemap all rest on it. Only a day is known, never a time, so posts
 * published the same day are ordered by manifest position — which is why that
 * position must be the publication order — and the feed's pubDate carries
 * midnight UTC as the conventional stand-in for "this day" while the sitemap's
 * lastmod is a date.
 *
 *   node tools/build.mjs            (run from the repo root)
 *   PREVIEW=1 node tools/build.mjs  build drafts too — LOCAL PREVIEW ONLY,
 *                                   never deploy a preview build
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
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
// The default inlines the banner into the page (a page stays the one file the
// README promises); HEADERS_INLINE=0 links it from dist/headers/ instead, for
// deployments that would rather not pay ~150KB of base64 per page. One switch,
// because a half-linked page — metadata pointing at a file the build did not
// copy — would make every social card a broken image.
const HEADERS_INLINE = process.env.HEADERS_INLINE !== '0';

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
    here('/map/', 'the map') +
    here('/search/', 'search') +
    SERIES.map(dropdown).join('') +
    // The reader-facing theme control. Its visible word IS the current mode
    // (auto → light → dark → auto), so the state is never carried by colour
    // alone; the sentence — what the mode means and what a click does — lives in
    // aria-label/title, which THEME_JS keeps in step. The static text below is
    // the auto default: every page ships it, and the head script rewrites it
    // only when the reader stored a choice.
    `<button class="theme-toggle" id="theme-toggle" type="button"` +
    ` aria-label="theme: auto — click for light" title="theme: auto — click for light">auto</button>` +
    // The command line, surfaced. The palette has always been reachable by
    // pressing "/", but nothing on the page said so — an affordance a reader has
    // to be told about in a hint is one they mostly never find. This button is
    // the same control with a handle: it opens the palette, and its title names
    // the keystroke, so the shortcut is discoverable from the thing it opens.
    `<button class="term-toggle palette-open" id="term-toggle" type="button"` +
    ` aria-label="the command line — press / to open it" ` +
    `title="the command line — press / to open it">&#8250;_</button>` +
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
 * line reveals as a whole (its caret keeps blinking on its own). `header` (see
 * buildPost) carries the post's emblem, emitted after the tagline — the masthead
 * reads top to bottom exactly as it does without one, and a post with no emblem
 * builds markup identical to before. */
function hero({ prompt, title, tagline, header }) {
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
    (header
      ? `<img class="header-art" src="${header.src}" alt="${esc(header.alt)}" width="1024" height="1024" decoding="async">`
      : '') +
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

/** The warm dark palette's declarations, scoped to `root`.
 *
 * Written ONCE and emitted under both root selectors (see the dark block in
 * PAGE_CSS): `:root:not([data-theme="light"])` inside the prefers-color-scheme
 * media query — the OS-following default — and `:root[data-theme="dark"]`
 * inside `@media screen` — the reader's explicit choice, which has to win over
 * the OS. The parameter is the root selector only; every declaration lives here,
 * so the two renderings cannot drift.
 *
 * Each rule carries the root prefix rather than the whole block sitting inside
 * `:root { … }`: the component overrides (`nav`, `.prose code`, …) are rules for
 * other elements, and nesting them in the `:root` block would be invalid CSS
 * that every browser drops on the floor.
 *
 * The component rules take the prefix inside `:where(…)`, which contributes NO
 * specificity — so `:where(:root[data-theme="dark"]) p` weighs exactly what the
 * bare `p` weighed, and the rest of the cascade is untouched. This is load-
 * bearing: the dark literals deliberately LOSE to some class rules in the design
 * system (the home page's `.tl-mini .m` keeps `--dim` rather than taking the
 * `#ddd7cd` a `p` receives), and an ordinary prefixed selector — specificity
 * (0,2,1) — would silently win those arguments instead and re-colour text that
 * the palette had left alone. The token re-declaration keeps the plain selector:
 * it has to out-rank the design system's own `:root`, and custom properties have
 * no competing declaration inside this block to protect.
 */
const DARK_DECLS = (root) => {
  const w = `:where(${root})`;
  return `  ${root} { color-scheme: dark;
    --bg: #1a1816;
    --bg2: #232120;
    --fg: #efeae2;
    --dim: #a9a29a;
    --accent: #e88b86;
    --accent2: #8ab4f8;
    --line: #3a3733; }
  ${w} nav { background: rgba(26, 24, 22, 0.90); }
  ${w} p, ${w} .stack td.desc, ${w} ul.checks li { color: #ddd7cd; }
  ${w} .prose code { color: #f0a8a2; }
  ${w} .prose a { text-decoration-color: rgba(138, 180, 248, 0.40); }
  ${w} .dropdown .menu a:hover { background: rgba(232, 139, 134, 0.12); }
  ${w} .cta-btn, ${w} .cta-btn:hover { color: #1a1816; }
  ${w} .note { background: #2e2120; color: #f0b6b0; }
  ${w} .warn { background: #2b2619; border-left-color: #c79a3c; color: #e8cd93; }
  ${w} .palette { background: rgba(0, 0, 0, 0.55); }
  ${w} .sres .sr-s mark, ${w} .sres .sr-t mark { background: rgba(232, 139, 134, 0.42); }
`;
};

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

/* ---------- the masthead emblem ----------
   Emitted by hero() when the post has a header render. width/height are on the
   <img> itself (1024x1024, the render's true aspect), which is what reserves the
   layout box before the image decodes — without them the masthead reflows once
   the bytes land, on every visit. The height auto here does not undo that: the
   attribute pair sets the box's ASPECT RATIO, auto only stops the width from
   distorting it. The plate is square and centred, not a full-bleed strip: at
   the old 2.4:1 canvas SDXL filled the width with a ROW of objects, measurably
   defeating style.json's one-emblem composition (tools/headers/ar.py) — the
   render moved to 1024x1024, so the frame here follows it. display:block keeps
   the baseline's stray descender gap out; the margin stays well under the
   section gap (56px): the hero's own bottom padding (48px) adds to it before
   the border, so a hero-sized margin would open a hole between the emblem and
   the title above it. auto side margins centre the 480px plate in .wrap's 732px
   column; 480 against the 1024 source is 2.13x at DPR 2. */
.header-art {
  display: block;
  width: 100%;
  max-width: 480px;
  height: auto;
  margin: 26px auto 0;
  border: 1px solid var(--line);
  border-radius: 10px;
}
/* The 620px wrap already carries 24px side padding; width:100% under the
   480px cap already shrinks with the column, so there is nothing to reflow —
   this only relaxes the frame's corner radius the way the cards do. */
@media (max-width: 620px) {
  .header-art { border-radius: 8px; }
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

/* ---------- the theme control ----------
   nav() emits it; THEME_JS (see THEME_JS above) cycles auto → light → dark and
   keeps the label honest. It reads as a control rather than one more nav link —
   a hairline box, the same dim weight as its neighbours — and every colour is a
   token, so it adapts with the palette it switches. The visible word is the
   mode; the sentence is in aria-label/title, never in colour alone. It is NOT
   .viz: the figure smoke test drives .viz button, and this is not a figure
   control. */
.theme-toggle {
  font-family: var(--mono); font-size: 12px; line-height: 1.2;
  color: var(--dim); background: none; cursor: pointer;
  border: 1px solid var(--line); border-radius: 6px; padding: 2px 7px;
}
.theme-toggle:hover { color: var(--fg); border-color: var(--dim); }
.theme-toggle:focus-visible { outline: 2px solid var(--accent2); outline-offset: 2px; }

/* The command line's handle — the same control as /. Sized and styled like the
   theme toggle beside it so the nav's two controls read as one pair. */
.term-toggle {
  font-family: var(--mono); font-size: 12px; line-height: 1.2;
  color: var(--dim); background: none; cursor: pointer;
  border: 1px solid var(--line); border-radius: 6px; padding: 2px 7px;
  letter-spacing: 0.04em;
}
.term-toggle:hover { color: var(--accent); border-color: var(--accent); }
.term-toggle:focus-visible { outline: 2px solid var(--accent2); outline-offset: 2px; }

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
/* The way into the search from inside a series: a small line after the series
   nav, not a second navigation. It is the series facet the search page already
   carries, offered where the reader already is. */
.series-search { margin: 14px 0 0; font-family: var(--mono); font-size: 12px; color: var(--dim); }
.series-search a { color: var(--accent2); }
.series-search a:hover { color: var(--accent); }

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

/* ---------- the map page ---------- */
/* Five series across is one table a phone cannot fit (it needs ~640px). Like a
   code block, it scrolls sideways on its own rather than widening the page. */
.mapt { overflow-x: auto; }
.mapt table { min-width: 620px; }

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

/* ---------- search ----------
   The box and its results. The index and the pipeline are in the page
   (buildSearch); this is the chrome that shows what they returned: a line per
   result — the piece, its series, kind and date and the score it fused to, the
   snippet with the query's own words marked, and the reasons as badges. Tokens
   throughout, so dark mode inherits; the one literal is the mark, whose dark
   value is declared in DARK_DECLS beside this. */
.sform { margin: 1.5rem 0 0; }
.sq-wrap { position: relative; }
.srow { display: flex; align-items: center; gap: 10px; padding: 8px 12px;
  border: 1px solid var(--line); background: var(--bg2); border-radius: 3px; font-family: var(--mono); }
.srow:focus-within { border-color: var(--accent); }
.srow .s-lab { color: var(--accent); font-size: 13px; }
.srow input[type="search"] { flex: 1; min-width: 0; border: 0; background: none; color: var(--fg); font: inherit; }
.srow input[type="search"]:focus { outline: none; }
.sfacet { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; margin-top: 10px;
  font-family: var(--mono); font-size: 12px; color: var(--dim); }
.sfacet select { font: inherit; font-family: var(--mono); color: var(--fg); background: var(--bg2);
  border: 1px solid var(--line); border-radius: 3px; padding: 3px 6px; }
/* The words that begin with what is being typed. It hangs under the box rather
   than pushing the facets down, and it carries its own bound: the note at its
   foot is where the cap is reported, so a stopped list never reads as a short
   one. Tokens throughout, so dark mode inherits. */
.scomp { position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 30;
  background: var(--bg2); border: 1px solid var(--line); border-radius: 3px;
  max-height: 15rem; overflow: auto; }
.scomp-list { list-style: none; margin: 0; padding: 4px 0; }
.scomp-list .sc { padding: 4px 12px; font-family: var(--mono); font-size: 13px; color: var(--dim); cursor: pointer; }
.scomp-list .sc-on { background: rgba(138, 180, 248, 0.16); color: var(--accent); box-shadow: inset 3px 0 0 var(--accent); }
.scomp-cap { padding: 5px 12px; border-top: 1px solid var(--line);
  font-family: var(--mono); font-size: 11px; color: var(--dim); }
.sstatus { min-height: 1.2em; margin: 16px 0 4px; font-family: var(--mono); font-size: 12px; color: var(--dim); }
.sres { list-style: none; margin: 0; padding: 0; }
.sres .sr { padding: 14px 0; border-top: 1px solid var(--line); }
/* The result the arrow keys are on: a rule drawn INSIDE the row's left edge —
   a change of shape, not only of colour, and nothing shifts as the selection
   moves — with the title taking the accent. */
.sres .sr-on { box-shadow: inset 3px 0 0 var(--accent); }
.sres .sr-on .sr-t { color: var(--accent); }
.sres .sr-t { font-family: var(--mono); font-size: 15px; color: var(--accent2); }
.sres .sr-t:hover { color: var(--accent); }
.sres .sr-m { margin: 3px 0 7px; font-family: var(--mono); font-size: 11.5px; color: var(--dim); }
.sres .sr-sc { float: right; }
.sres .sr-s { font-family: var(--serif); font-size: 15.5px; line-height: 1.5; }
.sres .sr-s mark, .sres .sr-t mark { background: rgba(164, 38, 44, 0.16); color: var(--accent); padding: 0 1px; border-radius: 2px; }
.sres .sr-w { display: flex; flex-wrap: wrap; gap: 6px; list-style: none; margin: 9px 0 0; padding: 0; }
.sres .sr-w li { padding: 2px 8px; border: 1px solid var(--line); border-radius: 999px;
  background: var(--bg2); font-family: var(--mono); font-size: 11.5px; color: var(--dim); }
.sres .sr-none, .sres .sr-hint { padding: 14px 0; font-family: var(--serif); color: var(--dim); }
/* the offer button is styled where it lands as well as in the list: the
   "did you mean" one is in the status line above the results, not in .sres */
.sres .sr-go, .sstatus .sr-go { font: inherit; font-family: var(--mono); font-size: 12px; color: var(--accent2);
  background: none; border: 1px solid var(--line); border-radius: 3px; padding: 2px 8px; cursor: pointer; }
.sres .sr-go:hover, .sstatus .sr-go:hover { color: var(--accent); border-color: var(--accent); }
.s-noscript { font-family: var(--serif); color: var(--dim); }
@media (max-width: 560px) { .sres .sr-sc { float: none; margin-left: 8px; } }

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
   a printed page is black on white whatever the reader's system preference.

   The declarations themselves are NOT written here: they come from DARK_DECLS
   (above), emitted under both selectors — the OS-following default and the
   reader's explicit choice — so the two renderings cannot drift apart. */
:root { color-scheme: light dark; }
@media screen and (prefers-color-scheme: dark) {
${DARK_DECLS(':root:not([data-theme="light"])')}}
@media screen {
  /* an explicit light choice on a dark-OS machine: the tokens stay light, and
     the form controls and scrollbars have to be told, or the UA keeps painting
     them dark. */
  :root[data-theme="light"] { color-scheme: light; }
${DARK_DECLS(':root[data-theme="dark"]')}}

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

/** The command line, in the site's own terminal idiom: press `/` or `:` for a
 * prompt that can list, search and open the blog (`ls`, `cat <slug>`,
 * `open <series>`, `search <words>`), print a page's address (`url`), read about
 * a command (`man`) and drive the theme (`theme`).
 *
 * The page list is embedded in the page, not fetched: the palette must never
 * make a request, and it is built from navPosts — the same published-only list
 * the nav uses — so a draft cannot be reached by typing its slug on a
 * deployable page.
 *
 * The script is deliberately small and defensive: it is now on every page, so
 * anything that is not there yet (no palette markup, no button, no theme
 * control) has to be tolerated rather than throw.
 *
 * ONE TABLE drives the three places a command is described. CMDS holds, per
 * command: `n` the name, `u` the usage line, `a` its aliases (comma-separated,
 * also completing as commands of their own), `d` the one line the help index
 * prints, `k` the kind of argument it takes — 'slug' (pages and series keys),
 * 'page' (pages only), 'series' (keys only), 'query' (a search: NEVER completed
 * to a page), 'mode' (the theme modes), 'command' (a command name) or '' (no
 * argument) — and `m` the manual paragraph. `help` is generated from it, `man`
 * reads it, and the live filter and Tab completion both take their candidates
 * from `k`, so the three cannot drift; the examples `man` prints are in EX, and
 * the ones that name a page or a series are read from the page's own data.
 *
 * The keyboard: Enter runs the line; Up/Down walk this session's history (kept
 * in sessionStorage — per tab, and gone with it); Tab completes the word at the
 * cursor against the commands, the slugs and the series keys, listing an
 * ambiguous set and then cycling it, the other way on Shift+Tab; a bare number
 * opens that line of the last listing. `/` opens the palette as a search prompt,
 * `:` as an empty command line, with the prompt glyph saying which.
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
  var glyph = box.querySelector('.ps-mode');
  var prev = null;
  var listed = [];
  var tab = null;
  var HIST_KEY = 'palette-history', HIST_MAX = 50, hist = [], hi = -1, stash = '';

  function show(text) { out.textContent = text; }
  function pad(s, n) { while (s.length < n) s += ' '; return s; }
  function starts(s, w) { return !w || s.indexOf(w) === 0; }
  function seriesLabel(key) {
    for (var i = 0; i < SERIES.length; i++) if (SERIES[i].key === key) return SERIES[i].label;
    return key;
  }
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
  var CMDS = [
    { n: 'ls', u: 'ls [series]', a: 'll, dir', d: 'the published posts, in nav order', k: 'series',
      m: 'the published posts, in nav order, grouped by series.' },
    { n: 'cat', u: 'cat <slug>', a: 'open, less, cd', d: 'open a post', k: 'slug',
      m: 'a page by slug, or the first page of a series. a slug that matches nothing offers the nearest one.' },
    { n: 'series', u: 'series <key>', a: '', d: 'list one series', k: 'series',
      m: 'one series, in nav order, by its key.' },
    { n: 'search', u: 'search <words>', a: 'find, grep, rg', d: 'search every piece', k: 'query',
      m: 'every published piece, at the search page, for those words.' },
    { n: 'map', u: 'map', a: 'netstat', d: 'the map', k: '',
      m: 'the map of the whole collection.' },
    { n: 'home', u: 'home', a: 'start-here', d: 'the front page', k: '',
      m: 'the front page.' },
    { n: 'url', u: 'url [slug]', a: '', d: 'a page address on the web', k: 'page',
      m: 'the absolute address of a page, read from the canonical link of the page you are on.' },
    { n: 'theme', u: 'theme <mode>', a: '', d: 'dark, light or auto', k: 'mode',
      m: 'dark, light, or auto to follow the system; the control the nav button drives.' },
    { n: 'man', u: 'man <command>', a: '', d: 'one command, in more detail', k: 'command',
      m: 'the manual for a command: what it does, its aliases, and an example.' },
    { n: 'help', u: 'help', a: '?', d: 'this list', k: '',
      m: 'this list of commands, with their aliases.' }
  ];
  var COMMANDS = {}, allNames = [];
  for (var ci = 0; ci < CMDS.length; ci++) {
    CMDS[ci].names = [CMDS[ci].n].concat(CMDS[ci].a ? CMDS[ci].a.split(', ') : []);
    for (var ni = 0; ni < CMDS[ci].names.length; ni++) {
      var nm = CMDS[ci].names[ni];
      if (nm && !COMMANDS[nm]) { COMMANDS[nm] = 1; allNames.push(nm); }
    }
  }
  function cmdEntry(name) {
    for (var i = 0; i < CMDS.length; i++) if (CMDS[i].names.indexOf(name) >= 0) return CMDS[i];
    return null;
  }
  var firstSeries = SERIES.length ? SERIES[0].key : '';
  var EX = {
    ls: ('ls ' + firstSeries).trim(),
    cat: 'cat ' + PAGES[0].slug,
    series: ('series ' + firstSeries).trim(),
    search: ('search ' + firstSeries).trim(),
    url: 'url ' + PAGES[0].slug,
    theme: 'theme dark',
    man: 'man cat'
  };
  /* The slug column, from the page list itself: the four longest slugs here run
   * past 26 characters, and a title set flush against them is one word. */
  var SLUG_W = (function () {
    var n = 24;
    for (var i = 0; i < PAGES.length; i++) if (PAGES[i].slug.length > n) n = PAGES[i].slug.length;
    return n + 2;
  })();
  var HELP = (function () {
    var lines = [];
    for (var i = 0; i < CMDS.length; i++) {
      var c = CMDS[i], line = pad(c.u, 16) + c.d;
      if (c.a) line = pad(line, 44) + '  (also: ' + c.a + ')';
      lines.push(line);
    }
    lines.push('');
    lines.push('options are ignored, so the command a page prints works as printed.');
    lines.push('tab completes a word; a bare number opens that line of the last ls.');
    return lines.join('\\n');
  })();
  function listing(filter) {
    var lines = [], last = null, hit = 0;
    listed = [];
    for (var i = 0; i < PAGES.length; i++) {
      var p = PAGES[i];
      if (filter && p.series !== filter) continue;
      hit++;
      if (p.series !== last) { lines.push(p.series ? seriesLabel(p.series) : 'unfiled'); last = p.series; }
      lines.push('  ' + pad(p.slug, SLUG_W) + p.title);
      listed.push(p.slug);
    }
    return hit ? lines.join('\\n') : 'ls: ' + filter + ': no such series';
  }
  function go(slug) { window.location.href = '/' + slug + '/'; }
  function goHome() { window.location.href = '/'; }
  function goSearch(q) { window.location.href = '/search/' + (q ? '?q=' + encodeURIComponent(q) : ''); }
  function goMap() { window.location.href = '/map/'; }
  /** The commands the pages themselves display, made to RUN as shown.
   *
   * Every page's masthead prints a command (cat <slug>.md, ls -lt, netstat -a,
   * grep -r). Typed into this box those used to fail or mislead: the palette wanted
   * the bare slug, not <slug>.md, and it read "-lt"/"-r" as an argument, so ls -lt
   * answered "no such series" and grep -r searched for the literal string "-r".
   * A command line that prints a command that does not work is worse than no command
   * line, so the argument is normalised here instead of the prompts being changed. */
  function normalizeArg(a) {
    var out = [];
    var parts = (a || '').split(/\\s+/);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!p) continue;
      if (p.charAt(0) === '-') continue;
      out.push(p);
    }
    var s = out.join(' ');
    s = s.replace(/\\.md$/, '');
    var quote = s.match(/^["'](.*)["']$/);
    if (quote) s = quote[1];
    return s;
  }
  function goNumber(n) {
    if (!listed.length) return show('sh: ' + n + ': no listing on screen — run ls first');
    var i = parseInt(n, 10);
    if (i < 1 || i > listed.length) return show('sh: ' + n + ': the listing has ' + listed.length + ' line(s)');
    return go(listed[i - 1]);
  }
  function themeCmd(m) {
    if (m !== 'dark' && m !== 'light' && m !== 'auto') {
      return show('theme: ' + (m || 'which mode?') + ' — try: theme dark, theme light, theme auto');
    }
    if (typeof window.setTheme !== 'function') return show('theme: this page carries no theme control');
    window.setTheme(m);
    return show('theme: ' + m);
  }
  function siteBase() {
    var l = document.querySelector('link[rel="canonical"]');
    var href = l ? l.getAttribute('href') : '';
    var m = href ? String(href).match(/^[a-z][a-z0-9+.-]*:\\/\\/[^\\/]+/i) : null;
    return m ? m[0] : window.location.origin;
  }
  function currentSlug() {
    var m = String(window.location.pathname).match(/\\/([a-z0-9-]+)\\/?$/i);
    return m && pageFor(m[1]) ? m[1] : '';
  }
  function urlLine(arg) {
    var s = arg || currentSlug();
    if (!s) return 'url: which page? give its slug, as in ' + EX.url;
    var p = pageFor(s);
    if (p) return siteBase() + '/' + p.slug + '/';
    var near = nearSlug(s);
    return 'url: no page "' + s + '"' + (near ? ' — did you mean ' + near.slug + '?' : '');
  }
  /** Levenshtein distance between two short strings, the whole matrix kept in
   * two rows. The page list is small, so this is the honest way to answer "did
   * you mean" without the search page's index (which this box must not fetch). */
  function editDistance(a, b) {
    var row = [], i, j;
    for (j = 0; j <= b.length; j++) row[j] = j;
    for (i = 1; i <= a.length; i++) {
      var next = [i];
      for (j = 1; j <= b.length; j++) {
        next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
      }
      row = next;
    }
    return row[b.length];
  }
  function limit(n) { return Math.max(1, Math.floor(n / 3)); }
  /** The nearest slug to a mistyped one, or null when nothing is near.
   *
   * Distance is measured against the SLUG'S OWN PREFIXES of about the typed
   * length, not the whole slug: a reader who types a page's first word
   * ("proculs") is one edit from the slug's opening ("proclus"), and twenty from
   * its tail. The bound grows with the word, so a short typo has to be close. */
  function nearSlug(q) {
    if (!q || q.length < 3) return null;
    var best = null, bestD = 1 / 0;
    for (var i = 0; i < PAGES.length; i++) {
      var s = PAGES[i].slug, d = 1 / 0;
      var hi = Math.min(s.length, q.length + 2);
      for (var k = Math.max(1, q.length - 2); k <= hi; k++) {
        var t = editDistance(q, s.slice(0, k));
        if (t < d) d = t;
      }
      if (d < bestD) { bestD = d; best = PAGES[i]; }
    }
    return bestD <= limit(q.length) ? best : null;
  }
  function nearName(q) {
    if (!q || q.length < 3) return null;
    var best = null, bestD = 1 / 0;
    for (var i = 0; i < allNames.length; i++) {
      var d = editDistance(q, allNames[i]);
      if (d < bestD) { bestD = d; best = allNames[i]; }
    }
    return bestD <= limit(q.length) ? best : null;
  }
  function manPage(a) {
    if (!a) return 'man: which command?\\n' + HELP;
    var c = cmdEntry(a);
    if (!c) {
      var near = nearName(a);
      return 'man: no manual for "' + a + '"' + (near ? ' — did you mean ' + near + '?' : '') + '\\n' + HELP;
    }
    return c.u + '\\n  ' + c.m + '\\n  aliases: ' + (c.a || 'none') + '\\n  example: ' + (EX[c.n] || c.u);
  }
  function run(line) {
    var parts = line.split(/\\s+/);
    var cmd = parts[0].toLowerCase();
    var raw = parts.slice(1).join(' ').toLowerCase();
    var arg = normalizeArg(raw);
    if (/^[0-9]+$/.test(cmd)) return goNumber(cmd);
    if (cmd === 'help' || cmd === '?') return show(HELP);
    if (cmd === 'ls' || cmd === 'll' || cmd === 'dir') return show(listing(arg ? seriesKey(arg) || arg : null));
    if (cmd === 'home' || cmd === 'start-here' || (cmd === 'cd' && !arg)) return goHome();
    if (cmd === 'map' || cmd === 'netstat') return goMap();
    if (cmd === 'series') return show(listing(seriesKey(arg)));
    if (cmd === 'search' || cmd === 'grep' || cmd === 'find' || cmd === 'rg') return goSearch(arg);
    if (cmd === 'theme') return themeCmd(arg);
    if (cmd === 'url') return show(urlLine(arg));
    if (cmd === 'man') return show(manPage(arg));
    if (cmd === 'cat' || cmd === 'open' || cmd === 'cd' || cmd === 'less') {
      // the front page is not a post, so the command its own masthead prints
      // (cat start-here.md) has to resolve to it explicitly
      if (arg === 'start-here' || arg === 'index' || arg === '') return goHome();
      var key = arg ? seriesKey(arg) : null;
      var hit = find(arg);
      if (hit) return go(hit.slug);
      if (key) {
        var first = firstIn(key);
        return first ? go(first.slug) : show('open: ' + arg + ': nothing published yet');
      }
      var near = nearSlug(arg);
      if (near) {
        input.value = cmd + ' ' + near.slug;
        return show(cmd + ': no page "' + arg + '" — did you mean ' + near.slug +
          '?\\nthe line is ready: press Enter to open it.');
      }
      return show(cmd + ': ' + (arg || '') + ': no such post. try ls');
    }
    var bare = find(cmd);
    if (bare) return go(bare.slug);
    // A line the command line does not know, and that is more than one word, is
    // a search: 'search' is the command, and anything else multi-word falls
    // through to the search page rather than dying on 'command not found'. A
    // single unknown word keeps the old answer — it may be a typo of a slug.
    if (line.indexOf(' ') > 0) return goSearch(line);
    return show('sh: ' + cmd + ': command not found. try help');
  }
  /* What a line typed here WOULD do, shown before Enter, for the lines that are
   * searches. The command line carries no word index and must not fetch one, so
   * the preview is what it can honestly answer without: the pages whose TITLE or
   * SERIES the query's words appear in. That is a real subset of the search and
   * a small one, and the line under it says which one it is, so a title match is
   * never read as the whole answer. Enter still opens the search over every
   * piece, exactly as it did before. */
  function searchLine(line) {
    var parts = line.split(/\\s+/);
    var cmd = parts[0].toLowerCase();
    if (cmd === 'search' || cmd === 'grep' || cmd === 'find' || cmd === 'rg') return parts.slice(1).join(' ');
    if (parts.length > 1 && !COMMANDS[cmd] && !pageFor(cmd)) return line;
    return null;
  }
  function previewHits(q) {
    var words = (q.toLowerCase().match(/[a-z][a-z'-]+/g) || []).filter(
      function (w) { return w.length >= 3; });
    if (!words.length) return [];
    var hits = [];
    for (var i = 0; i < PAGES.length; i++) {
      var p = PAGES[i];
      var hay = p.title.toLowerCase() + ' ' + (seriesLabel(p.series) || '') + ' ' + (p.series || '') + ' ' + (p.kind || '');
      var n = 0;
      for (var j = 0; j < words.length; j++) if (hay.indexOf(words[j]) >= 0) n++;
      if (n) hits.push([p, n]);
    }
    hits.sort(function (a, b) { return b[1] - a[1]; });
    return hits;
  }
  function showSearchPreview(line) {
    var q = searchLine(line);
    if (q === null) return false;
    if (!q) { show('search: type the words, then Enter searches every piece.'); return true; }
    var hits = previewHits(q);
    if (!hits.length) {
      show('no page title or series matches that here — Enter searches every piece.');
      return true;
    }
    var lines = ['titles and series that match' + (hits.length > 3 ? ' (3 of ' + hits.length + ')' : '') + ':'];
    for (var i = 0; i < hits.length && i < 3; i++) {
      var p = hits[i][0];
      lines.push('  ' + pad(p.slug, SLUG_W) + p.title + (p.series ? ' — ' + seriesLabel(p.series) : ''));
    }
    lines.push('Enter searches every piece; this line only matches the titles and series above.');
    show(lines.join('\\n'));
    return true;
  }
  /** The word being completed: the text after the last space, so the completion
   * always replaces one word and never the line. */
  function lastWord(v) {
    var i = v.length;
    while (i > 0 && !/\\s/.test(v.charAt(i - 1))) i--;
    return { start: i, text: v.slice(i) };
  }
  function cmdLabel(name) { var c = cmdEntry(name); return pad(name, 14) + (c ? c.d : ''); }
  function pageLabel(s) { var p = pageFor(s); return pad(s, SLUG_W) + (p ? p.title : seriesLabel(s)); }
  /** What a Tab here could complete to, grouped for display: the command word
   * (commands, then pages and series), or — once a command that takes one has
   * been typed — its argument. A search argument has no candidates at all: it is
   * a query, and completing it to a page is exactly the wrong answer. */
  function candidates(line) {
    var lw = lastWord(line);
    var head = line.slice(0, lw.start);
    var word = lw.text;
    var before = head.trim();
    var groups = [], i;
    if (!before) {
      var cs = [], ps = [], ss = [];
      for (i = 0; i < allNames.length; i++) if (starts(allNames[i], word)) cs.push(allNames[i]);
      for (i = 0; i < PAGES.length; i++) if (starts(PAGES[i].slug, word)) ps.push(PAGES[i].slug);
      for (i = 0; i < SERIES.length; i++) if (starts(SERIES[i].key, word)) ss.push(SERIES[i].key);
      if (cs.length) groups.push({ t: 'commands', items: cs, f: cmdLabel });
      if (ps.length || ss.length) groups.push({ t: 'pages', items: ps.concat(ss), f: pageLabel });
      return { head: head, word: word, kind: 'command', groups: groups };
    }
    var entry = cmdEntry(before.split(/\\s+/)[0].toLowerCase());
    var kind = entry ? entry.k : '';
    if (!kind) return null;
    if (kind === 'query') return { head: head, word: word, query: true, groups: [] };
    var items = [], p;
    if (kind === 'mode') items = ['auto', 'light', 'dark'];
    else if (kind === 'command') items = allNames.slice();
    else if (kind === 'series') items = SERIES.map(function (s) { return s.key; });
    else if (kind === 'page') items = PAGES.map(function (x) { return x.slug; });
    else items = SERIES.map(function (s) { return s.key; }).concat(PAGES.map(function (x) { return x.slug; }));
    var hit = [];
    for (i = 0; i < items.length; i++) if (starts(items[i], word)) hit.push(items[i]);
    var f = kind === 'mode' ? function (m) { return m; } : (kind === 'command' ? cmdLabel : pageLabel);
    var title = { mode: 'modes', command: 'commands', series: 'series' }[kind] || 'pages';
    groups.push({ t: title, items: hit, f: f });
    return { head: head, word: word, kind: kind, groups: groups };
  }
  /** The candidate groups as bounded text: the cap is stated, so a stopped list
   * is never read as a short one. */
  function groupLines(c, cap) {
    var lines = [];
    for (var g = 0; g < c.groups.length; g++) {
      var items = c.groups[g].items;
      lines.push(c.groups[g].t + ' (' + items.length + (items.length > cap ? ', first ' + cap : '') + '):');
      for (var i = 0; i < items.length && i < cap; i++) lines.push('  ' + c.groups[g].f(items[i]));
      if (items.length > cap) lines.push('  — ' + (items.length - cap) + ' more; keep typing.');
    }
    return lines;
  }
  function commonPrefix(list) {
    var p = list[0];
    for (var i = 1; i < list.length && p; i++) {
      var s = list[i], j = 0;
      while (j < p.length && j < s.length && p.charAt(j) === s.charAt(j)) j++;
      p = p.slice(0, j);
    }
    return p;
  }
  /** Tab. A unique match completes outright; several complete to their longest
   * common prefix and are listed; pressing Tab again cycles through them in the
   * input, Shift+Tab the other way, as a readline prompt does. */
  function doTab(back) {
    // A continuation is the line EXACTLY as the last Tab left it: the word then
    // equals a whole candidate, and recomputing the candidates from it would
    // find that one candidate alone and stop cycling.
    if (!tab || tab.set !== input.value) {
      var c = candidates(input.value);
      if (!c || !c.word) return;
      if (c.query) return show('search takes words, not a page — there is nothing to complete.');
      var flat = [];
      for (var g = 0; g < c.groups.length; g++) flat = flat.concat(c.groups[g].items);
      if (!flat.length) return show('nothing here starts with "' + c.word + '"');
      tab = { head: c.head, list: flat, i: -1, listed: false, set: input.value, lines: groupLines(c, 12) };
    }
    if (!tab.listed) {
      tab.listed = true;
      if (tab.list.length === 1) {
        var one = tab.list[0];
        input.value = tab.head + one + (tab.head === '' && COMMANDS[one] ? ' ' : '');
        tab = null;
        return show('completed: ' + one);
      }
      input.value = tab.head + commonPrefix(tab.list);
      tab.set = input.value;
      return show(tab.lines.join('\\n'));
    }
    tab.i = back ? (tab.i <= 0 ? tab.list.length - 1 : tab.i - 1) : (tab.i + 1) % tab.list.length;
    input.value = tab.head + tab.list[tab.i];
    tab.set = input.value;
    var lines = tab.lines.slice();
    lines.push('tab cycles: ' + (tab.i + 1) + ' of ' + tab.list.length + '.');
    show(lines.join('\\n'));
  }
  /** What the line could still become, shown as it is typed — the command word
   * until the first space, its argument after that. Bounded and in the page
   * order, so the list never reorders under the reader. */
  function showCompletion(line) {
    var c = candidates(line);
    if (!c || c.query) return false;
    if (!c.groups.length) { show('nothing here starts with "' + c.word + '" — try help'); return true; }
    var lines = groupLines(c, 8);
    if (c.kind === 'command') lines.push('tab completes the word; Enter runs the line.');
    show(lines.join('\\n'));
    return true;
  }
  function readHist() {
    try {
      var raw = sessionStorage.getItem(HIST_KEY);
      var a = raw ? JSON.parse(raw) : [];
      return a && a.length ? a.slice(-HIST_MAX) : [];
    } catch (e) { return []; }
  }
  function saveHist() {
    try { sessionStorage.setItem(HIST_KEY, JSON.stringify(hist.slice(-HIST_MAX))); } catch (e) {}
  }
  function remember(line) {
    hist.push(line);
    while (hist.length > HIST_MAX) hist.shift();
    hi = -1;
    stash = '';
    saveHist();
  }
  function histMove(back) {
    if (!hist.length) return false;
    if (back) {
      if (hi === -1) { stash = input.value; hi = hist.length; }
      if (hi > 0) hi--;
      input.value = hist[hi];
      return true;
    }
    if (hi === -1) return false;
    hi++;
    if (hi >= hist.length) { hi = -1; input.value = stash; }
    else input.value = hist[hi];
    return true;
  }
  function filter() {
    tab = null;
    var line = input.value.trim();
    if (!line) return show(HELP);
    if (showSearchPreview(line)) return;
    if (showCompletion(input.value)) return;
    show(HELP);
  }
  function open(mode) {
    prev = document.activeElement;
    box.hidden = false;
    box.setAttribute('data-mode', mode === 'search' ? 'search' : 'cmd');
    if (glyph) glyph.textContent = mode === 'search' ? '/' : '$';
    input.value = mode === 'search' ? 'search ' : '';
    hi = -1;
    stash = '';
    tab = null;
    input.focus();
    show(mode === 'search' ? 'search: type the words, then Enter searches every piece.' : HELP);
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

  hist = readHist();
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
    open(e.key === '/' ? 'search' : 'cmd');
  });

  input.addEventListener('input', filter);

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      var line = input.value.trim();
      if (!line) return;
      input.value = '';
      remember(line);
      run(line);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      doTab(!!e.shiftKey);
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (histMove(e.key === 'ArrowUp')) filter();
    }
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
  // the timeline and the map are pages like any other but they are not posts, so
  // the palette is told about them explicitly; 'unfiled' is the listing's own
  // group for them.
  data.pages.push({ slug: 'timeline', title: "What's new", series: '', kind: 'page' });
  data.pages.push({ slug: 'map', title: 'The map', series: '', kind: 'page' });
  data.pages.push({ slug: 'search', title: 'Search', series: '', kind: 'page' });
  const html =
    `<div class="palette" id="palette" role="dialog" aria-label="command line" ` +
    `data-mode="cmd" hidden>` +
    `<div class="palette-box">` +
    `<div class="palette-line"><span class="ps">#</span> blog.jaye.ch ` +
    `<span class="ps ps-mode">$</span> <input type="text" aria-label="command" autocomplete="off" ` +
    `autocapitalize="off" spellcheck="false"></div>` +
    `<div class="palette-out" role="status"></div>` +
    `</div></div>`;
  paletteCache = { html, script: `<script>\n${stripJsComments(PALETTE_JS(data))}</script>\n` };
  return paletteCache;
}

/** The theme control's script — the ONE script in <head>.
 *
 * Two jobs, in two halves, because a page can only have one pre-paint moment:
 *
 *  - The top runs SYNCHRONOUSLY in <head>, before the first paint: if the reader
 *    stored a choice, `data-theme` is on <html> before any style is resolved, so
 *    there is no flash of the other palette. No stored choice leaves the
 *    attribute off, which IS auto (the prefers-color-scheme default) — a reader
 *    who never touches the control sees exactly the site as it was.
 *  - The rest waits for DOMContentLoaded, because the head runs before the
 *    button exists: it adopts the current mode (fixing the label the static
 *    markup shipped as "auto") and cycles auto → light → dark → auto on click.
 *
 * Storage is wrapped in try/catch: a reader with storage disabled gets a working
 * toggle for the session instead of a thrown error and a dead control.
 *
 * THE CHANGE ITSELF lives in one function, `set`, and the script publishes it as
 * window.setTheme: the button's click handler is a call to it, and the command
 * line's `theme dark|light|auto` calls the same one. Two controls, one state —
 * a second implementation in the palette could disagree with the toggle's own
 * mode (the next click would then cycle from the wrong place), so there is none.
 * A page with no toggle leaves window.setTheme undefined, which the palette
 * reports rather than pretending.
 *
 * NO COMMENTS in this string, and none in the markup it touches: the emitted
 * page is gated (checkWorkshop) on a comment delimiter in emitted code, so a
 * comment here — or in the control's markup — fails the build. The prose belongs
 * on this comment, in the source, where the build strips it.
 */
const THEME_JS = `(function () {
  'use strict';
  var KEY = 'theme';
  var MODES = ['auto', 'light', 'dark'];
  var NEXT = { auto: 'light', light: 'dark', dark: 'auto' };
  var root = document.documentElement;
  function read() {
    try {
      var v = localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : 'auto';
    } catch (e) {
      return 'auto';
    }
  }
  function write(mode) {
    try {
      if (mode === 'auto') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, mode);
    } catch (e) {}
  }
  function label(mode) {
    return 'theme: ' + mode + ' — click for ' + NEXT[mode];
  }
  function apply(mode, btn) {
    if (mode === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);
    if (!btn) return;
    btn.textContent = mode;
    btn.setAttribute('aria-label', label(mode));
    btn.setAttribute('title', label(mode));
  }
  var mode = read();
  apply(mode, null);
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    var set = function (m) {
      mode = MODES.indexOf(m) < 0 ? 'auto' : m;
      apply(mode, btn);
      write(mode);
      return mode;
    };
    window.setTheme = set;
    apply(mode, btn);
    btn.addEventListener('click', function () { set(NEXT[mode] || 'auto'); });
  });
})();`;

/** The pre-paint half of THEME_JS, as it is emitted into <head>.
 *
 * Deliberately `<script>` with no newline after it: tools/viz-smoke.mjs finds a
 * page's figure script with `/<script>\\n([\\s\\S]*?)\\n<\\/script>/`, so a head
 * script that opened with a newline would be lifted out of the page in place of
 * the engine and the figures would never be tested. */
const THEME_HEAD = `<script>${THEME_JS}</script>`;

/** Full self-contained document. */
function page({ title, description, prompt, heroTitle, tagline, body, navCurrent, type = 'article', shareTitle, noindex = false, header }, navPosts) {
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
  // The og image is an absolute URL to a real copied file, never a data URI:
  // a card scraper fetches it server-side, and a data URI there is silently
  // dropped — the card renders with no image at all rather than an error.
  // summary_large_image is emitted only when there is something to show;
  // an image-less card that promises a large image renders a grey box.
  const meta =
    `<title>${esc(title)}</title>\n` +
    `<meta name="description" content="${esc(description)}">\n` +
    (noindex ? `<meta name="robots" content="noindex">\n` : `<link rel="canonical" href="${url}">\n`) +
    `<meta property="og:type" content="${type}">\n` +
    `<meta property="og:site_name" content="blog.jaye.ch">\n` +
    `<meta property="og:title" content="${esc(share)}">\n` +
    `<meta property="og:description" content="${esc(description)}">\n` +
    (noindex ? `` : `<meta property="og:url" content="${url}">\n`) +
    (header
      ? `<meta property="og:image" content="${header.og}">\n` +
        `<meta name="twitter:card" content="summary_large_image">\n` +
        `<meta name="twitter:image" content="${header.og}">\n`
      : `<meta name="twitter:card" content="summary">\n`) +
    `<meta name="twitter:title" content="${esc(share)}">\n` +
    `<meta name="twitter:description" content="${esc(description)}">`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${THEME_HEAD}
${meta}
<style>
${designCss}</style>
${viz ? `<style>\n${viz.css}</style>\n` : ''}<style>${stripComments(PAGE_CSS)}</style>
</head>
<body>
${DOSE}
${nav(navCurrent, navPosts)}
${hero({ prompt, title: heroTitle, tagline, header })}
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
  // A sidenote is a float whose containing block must be the prose column, so
  // that the -15rem right margin puts it in the page margin BESIDE its passage.
  // Inside a <table> the reference is in a table cell, whose containing block is
  // the cell — the float has no margin to reach and lands on the cell's own text
  // and its neighbour's. So a reference inside a table keeps the endnote only:
  // the note is never abandoned, since the endnotes block carries every one.
  const tables = [...body.matchAll(/<table\b[\s\S]*?<\/table>/g)].map((m) => [
    m.index,
    m.index + m[0].length,
  ]);
  const inTable = (at) => tables.some(([a, b]) => at >= a && at < b);
  const out = body.replace(/<a\s[^>]*class="footnote-ref"[^>]*>[\s\S]*?<\/a>/g, (ref, at) => {
    const id = /href="#([^"]+)"/.exec(ref);
    const note = id && notes.get(id[1]);
    if (!note || inTable(at)) return ref;
    placed++;
    return `${ref}<span class="sidenote" aria-hidden="true">${note}</span>`;
  });
  return { body: out, placed };
}

/** Series prev/next, and the way into the search from where the reader is. Both
 * neighbours come from navPosts — the published list the nav is built from — so
 * a draft is never linked, and a series end simply has an empty slot. The
 * "search this series" link is the same facet the search page already carries,
 * offered at the point a reader is inside a series rather than at the box. */
function postNav(post, navPosts) {
  if (!post.series) return '';
  const inSeries = navPosts.filter((p) => p.series === post.series);
  const i = inSeries.findIndex((p) => p.slug === post.slug);
  if (i === -1) return '';
  const prev = i > 0 ? inSeries[i - 1] : null;
  const next = i < inSeries.length - 1 ? inSeries[i + 1] : null;
  const label = seriesLabel(post.series);
  const search =
    `<p class="series-search"><a href="/search/?q=&amp;series=${esc(post.series)}">` +
    `search this series</a> — every piece in ${esc(label)}, by words, vectors and links</p>`;
  if (!prev && !next) return search;
  const card = (p, dir) =>
    `<a class="${dir}" href="/${p.slug}/"><span class="dir">` +
    (dir === 'prev' ? `← previous in ${label}` : `next in ${label} →`) +
    `</span><span class="t">${titleOf(p)}</span></a>`;
  return `<div class="postnav">${prev ? card(prev, 'prev') : '<span></span>'}${next ? card(next, 'next') : '<span></span>'}</div>` + search;
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
        ? `<div class="hint"># the oldest question in the record, and the most careful answer to it</div>`
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
    title: 'Instruments, not verdicts — blog.jaye.ch',
    shareTitle: 'Instruments, not verdicts — in minds, in groups, in the frames they live inside',
    type: 'website',
    description:
      'Instruments, not verdicts — in minds, in groups, in the frames they live inside: what it takes to name a structure without sorting people into a verdict.',
    prompt: 'cat start-here.md',
    heroTitle: 'Instruments, not <span class="fx">verdicts</span> — in minds, in groups, in the frames they live inside',
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
    `<a href="/timeline/">what's new</a>, <a href="/map/">the map</a>, ` +
    `<a href="/search/">the search</a>, or a post in one of its ${NUM_WORD[seriesCount] || seriesCount} series. ` +
    `There is no other content, and nothing was ` +
    `deleted to hide it.</p>` +
    `<ul><li><a href="/">Home — where to start</a></li><li><a href="/timeline/">What's new — every piece, newest first</a></li><li><a href="/map/">The map — every piece, and the links between them</a></li><li><a href="/search/">The search — every piece, by words, vectors and links</a></li>${links}</ul>` +
    `<p>If you followed a link from somewhere else, the link is stale; the pieces ` +
    `above are current.</p>` +
    `</div></div></section>`;
  return {
    title: 'Not found — blog.jaye.ch',
    shareTitle: 'Not found — blog.jaye.ch',
    type: 'website',
    noindex: true,
    description: 'No page at this address. The published pages are listed here.',
    prompt: 'ls',
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

/* ---------- the catalogue of cited works, and the citations ---------- */

/** The curated list of published works the pieces cite — one entry per work,
 * with the rule that recognises it in a piece's notes. Read, never rebuilt. */
function catalogue() {
  const file = join(ROOT, 'tools', 'catalogue.json');
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, 'utf8')).sources || [];
}

/** One piece's footnote DEFINITIONS, each joined into a single string.
 *
 * A definition is a line beginning `[^key]:` plus every following line up to a
 * blank line or the next definition. Joining them is required, not tidiness: a
 * title wraps across two lines in these files (`*The Authoritarian\nPersonality*`),
 * and a matcher working line by line silently loses seven of the works. */
function footnoteDefs(src) {
  const out = [];
  let cur = null;
  for (const line of src.split('\n')) {
    const m = /^[ \t]*\[\^[^\]]+\]:/.exec(line);
    if (m) {
      if (cur !== null) out.push(cur);
      cur = line.slice(m[0].length);
      continue;
    }
    if (cur === null) continue;
    if (!line.trim()) {
      out.push(cur);
      cur = null;
      continue;
    }
    cur += ' ' + line.trim();
  }
  if (cur !== null) out.push(cur);
  return out.map((d) => d.replace(/\s+/g, ' ').trim());
}

/** Which pieces cite which works — the citation edges, derived from the notes.
 *
 * An edge exists when a work's match rule tests true against one of a piece's
 * footnote definitions, so an edge is only ever read out of the text.
 *
 * CACHED, and the cache is the point: the map and the search page rest on the
 * SAME derivation, and two copies of it could disagree about what the pieces
 * cite. `citing[k]` is the list of piece indices that cite work k, `hits[i]` the
 * works piece i names — the raw edges, before either page decides what to draw
 * or query with them. */
let citationCache = null;
function citations(navPosts, nodes) {
  if (citationCache && citationCache.posts === navPosts) return citationCache.c;
  const works = catalogue();
  const at = new Map(nodes.map((n, i) => [n.slug, i]));
  const matchers = works.map((s) => {
    try {
      return new RegExp(s.match, 'i');
    } catch {
      return null;
    }
  });
  const citing = works.map(() => []);
  const hits = nodes.map(() => []);
  let citations = 0;
  for (const p of navPosts) {
    const i = at.get(p.slug);
    const file = join(ROOT, 'content', p.file);
    if (i == null || !p.file || !existsSync(file)) continue;
    const defs = footnoteDefs(readFileSync(file, 'utf8'));
    for (let k = 0; k < works.length; k++) {
      const re = matchers[k];
      if (!re) continue;
      // one citation per piece and work however many notes name it: the figure
      // draws a connection, not a mention count
      for (const d of defs) {
        if (re.test(d)) {
          citing[k].push(i);
          hits[i].push(k);
          citations++;
          break;
        }
      }
    }
  }
  const c = { works, citing, hits, citations };
  citationCache = { posts: navPosts, c };
  return c;
}

/** The map's own view of the citation graph.
 *
 * A work cited by TWO OR MORE pieces is the one that matters to the map: it is
 * the work, not the piece, that joins two pieces to each other. The rest are
 * named by a single piece each — a name inside that piece, not a connection
 * between two — and are counted, never drawn. */
function sourceGraph(navPosts, nodes) {
  const { works, citing, hits, citations: citationCount } = citations(navPosts, nodes);
  // the works that join pieces, the largest first, then by name so two builds
  // of the same text draw the same figure
  const order = [];
  let single = 0;
  let uncited = 0;
  for (let k = 0; k < works.length; k++) {
    if (citing[k].length >= 2) order.push(k);
    else if (citing[k].length === 1) single++;
    else uncited++;
  }
  order.sort((a, b) => citing[b].length - citing[a].length || works[a].short.localeCompare(works[b].short));
  const seenAt = new Map(order.map((k, i) => [k, i]));
  const drawn = nodes.map(() => []);
  const alone = nodes.map(() => 0);
  for (let i = 0; i < nodes.length; i++) {
    for (const k of hits[i]) {
      if (seenAt.has(k)) drawn[i].push(seenAt.get(k));
      else alone[i]++;
    }
  }
  const kinds = {};
  for (const w of works) kinds[w.kind] = (kinds[w.kind] || 0) + 1;
  return {
    drawn: order.map((k) => ({
      id: works[k].id,
      short: works[k].short,
      title: works[k].title,
      kind: works[k].kind,
      author: works[k].author,
      count: citing[k].length,
      nodes: citing[k],
    })),
    perNode: drawn,
    alone,
    totals: { works: works.length, citations: citationCount, single, uncited, kinds },
  };
}

/* ---------- the map: the links the pieces make to one another ---------- */

/** The blog's own cross-references, read out of the prose.
 *
 * A node is a piece in nav order; an edge is one link from one piece to another
 * — the absolute in-site link form the posts are written in, `](/<slug>/)` —
 * de-duplicated per pair, because a piece that points at the same piece five
 * times still makes one link. Edges are READ, never inferred: a resemblance
 * between a piece and a book it never links to is not a citation, and this page
 * does not draw a guess as though it were one.
 *
 * CACHED, for the same reason as the citation edges: the map draws it and the
 * search page queries it, and one derivation cannot disagree with itself. */
let mapGraphCache = null;
function mapGraph(navPosts) {
  if (mapGraphCache && mapGraphCache.posts === navPosts) return mapGraphCache.g;
  const nodes = navPosts.map((p) => ({
    slug: p.slug,
    title: titleOf(p),
    series: p.series || '',
    // the blog's own rule: one book, one piece — every reading IS a book
    book: p.series === 'readings',
  }));
  const known = new Set(nodes.map((n) => n.slug));
  const seen = new Set();
  const edges = [];
  for (const p of navPosts) {
    const file = join(ROOT, 'content', p.file);
    // a staged draft can reach the nav before its text lands: that is a node
    // with nothing to read yet, not a reason to stop
    if (!existsSync(file)) continue;
    for (const m of readFileSync(file, 'utf8').matchAll(/\]\(\/([a-z0-9-]+)\//g)) {
      const to = m[1];
      const key = `${p.slug}>${to}`;
      if (to === p.slug || !known.has(to) || seen.has(key)) continue;
      seen.add(key);
      edges.push([p.slug, to]);
    }
  }
  const g = { nodes, edges };
  mapGraphCache = { posts: navPosts, g };
  return g;
}

/** The map — every piece on a ring, every link between them a curve.
 *
 * Modelled on buildTimeline: a real page, written to dist and listed in the
 * sitemap. The graph is derived from the pieces themselves (mapGraph) and the
 * table under the prose is the same edge list aggregated by series, so the
 * figure and the table cannot disagree about how many links there are. Where a
 * point sits is a layout; the counts are not. */
function buildMap(navPosts) {
  const { nodes, edges } = mapGraph(navPosts);
  const at = new Map(nodes.map((n, i) => [n.slug, i]));
  const groups = SERIES
    .map((s) => ({
      key: s.key,
      label: s.label,
      nodes: nodes.map((n, i) => (n.series === s.key ? i : -1)).filter((i) => i >= 0),
    }))
    .filter((g) => g.nodes.length);
  // A piece whose series the site does not know — including none at all — has no
  // column of its own, and a table that quietly dropped it would stop summing to
  // the links the figure draws. The rest of the build already calls such a piece
  // unfiled (see the terminal's listing); the map gives it the group it is due,
  // so every edge has a row and a column to land in.
  const known = new Set(SERIES.map((s) => s.key));
  const strays = nodes.map((n, i) => (known.has(n.series) ? -1 : i)).filter((i) => i >= 0);
  if (strays.length) groups.push({ key: 'unfiled', label: 'unfiled', nodes: strays });
  const groupOf = new Map();
  for (const g of groups) for (const i of g.nodes) groupOf.set(nodes[i].slug, g.key);
  // the table is keyed by the GROUP each end sits in, not by the raw series
  // string, so it counts exactly the edges the figure draws
  const seriesOf = nodes.map((n) => groupOf.get(n.slug));
  const count = (from, to) =>
    edges.filter(([a, b]) => seriesOf[at.get(a)] === from && seriesOf[at.get(b)] === to).length;
  const books = nodes.filter((n) => n.book).length;

  const table =
    `<div class="mapt"><table>` +
    `<caption>The links the series make to one another — counted from the pieces' own links, not from any ` +
    `resemblance between them, and one link per pair of pieces however often one names the other. Each row ` +
    `is where a link starts, each column where it ends.</caption>` +
    `<thead><tr><th scope="col">from ↓ to →</th>` +
    groups.map((g) => `<th scope="col">${esc(g.key)}</th>`).join('') +
    `</tr></thead><tbody>` +
    groups
      .map(
        (g) =>
          `<tr><th scope="row">${esc(g.key)}</th>` +
          groups.map((h) => `<td>${count(g.key, h.key)}</td>`).join('') +
          `</tr>`,
      )
      .join('') +
    `</tbody></table></div>`;

  // The works the pieces cite, and the pieces that cite them. The edges are
  // derived at build time from the notes themselves (sourceGraph); this is
  // where they become page content and figure data.
  const src = sourceGraph(navPosts, nodes);
  const t = src.totals;
  const hasWorks = t.works > 0;
  const kindLabel = (k) => (k === 'primary-text' ? 'primary text' : k);
  const kindCounts = (kinds) =>
    ['book', 'paper', 'primary-text']
      .filter((k) => kinds[k])
      .map((k) => `${kinds[k]} ${kindLabel(k)}${kinds[k] === 1 ? '' : 's'}`)
      .join(', ');

  // The most-cited works, read from the derivation: the table the figure's own
  // marks are ranked by, so the two cannot disagree about what is a hub.
  const top = src.drawn.slice(0, 10);
  const worksTable = !hasWorks
    ? ''
    : `<div class="mapt"><table>` +
    `<caption>The works the most pieces cite — the largest of the ${src.drawn.length} the figure draws ` +
    `inside the ring, counted from the pieces' own footnotes.</caption>` +
    `<thead><tr><th scope="col">work</th><th scope="col">kind</th><th scope="col">pieces citing it</th>` +
    `</tr></thead><tbody>` +
    top
      .map(
        (s) =>
          `<tr><th scope="row">${esc(s.title)}</th><td>${esc(kindLabel(s.kind))}</td>` +
          `<td>${s.count}</td></tr>`,
      )
      .join('') +
    `</tbody></table></div>`;

  const worksProse = !hasWorks
    ? ''
    : `<p>Most of the work a piece rests on is not other pieces: it is books, scholarly papers and primary ` +
    `texts — the ${t.works} published works the pieces cite. That catalogue is curated by hand, but every ` +
    `citation in it is measured: a work is counted when the piece's own footnote names it, matched against ` +
    `the notes as written and never against a resemblance between a piece and a book. The notes hold ` +
    `${t.citations} such citations. Journalism, case law, statutes, government reports and websites were ` +
    `deliberately left out — the notes name them, but they are not the works this catalogue is scoped to, ` +
    `and a catalogue that mixed them would count a news report as a source.</p>` +
    `<p>${src.drawn.length} of those works are named by two or more pieces, and they are the ones drawn in the ` +
    `figure: a mark inside the ring, joined to each piece that cites it, because it is the work — not the ` +
    `piece — that connects pieces to one another. The other ${t.single} are cited by a single piece each: ` +
    `they add a name to that piece and no connection between two, so they are counted here and left out of ` +
    `the figure. ${kindCounts(t.kinds)}.` +
    (t.uncited === 0 ? ` Every work in it is named by at least one piece.` : '') +
    `</p>` +
    `<p>The shape is worth reading honestly. Most of what any one piece stands on is its alone — ${t.single} ` +
    `of ${t.works} works are cited by a single piece — and a shared source is not an agreement: it is one ` +
    `reader returning to the same book from more than one place. What the inner ring shows is not a body ` +
    `of literature that agrees with itself, and it is not evidence for anything. It is the record of a ` +
    `method: take a question to the material that bears on it, whether that material is a clinical survey, ` +
    `a canon text, a grimoire or a study of authoritarianism, and use the same few books to carry the ` +
    `question across domains that do not normally cite one another. Where a work sits on the inner ring, ` +
    `that is what has happened to it.</p>` +
    worksTable;

  const prose =
    `<p>Every piece on the blog is a point on this ring and every link one piece makes to another is a curve ` +
    `across it: ${nodes.length} pieces, and ${edges.length} links between different pairs of them. That ` +
    `count is of pairs, not of mentions — a piece that points at another five times still draws one line. ` +
    `The ring is grouped by series — ` +
    `${groups.map((g) => g.label).join(', ')} — and inside a group the pieces run in the order they were ` +
    `published, with a gap between the groups.</p>` +
    `<p>An edge is a link, and nothing more. If a piece points at another, there is a curve from the first ` +
    `to the second. It is not agreement, not a citation, and not a claim that the two are about the same ` +
    `thing — only that one of them points at the other, which is the one thing that can be counted here ` +
    `without guessing.</p>` +
    `<p>The ${books} pieces that are close readings of a book are drawn as squares: on this blog one book is ` +
    `one piece, every time. The rest are circles.</p>` +
    `<p>Where a point sits is a layout choice, made so that the curves can be told apart; the counts are not a ` +
    `layout. Hover or focus a point to see what it links to and what links back to it — the line under the ` +
    `figure says which — and click it to read it.</p>`;

  // the figure's data, handed to the widget the way the palette gets its list:
  // in the page body, as JSON, with `<` escaped so nothing in it can close the
  // script element early. The works ride here too: only the ones that connect
  // pieces (two or more citations), the drawn works each piece names, and a
  // count of the rest — enough for the readout without shipping the whole list.
  const data = {
    nodes: nodes.map((n) => ({ slug: n.slug, title: n.title, series: n.series, book: n.book })),
    groups: groups.map((g) => ({ key: g.key, label: g.label, nodes: g.nodes })),
    edges: edges.map(([a, b]) => [at.get(a), at.get(b)]),
  };
  if (hasWorks) {
    data.sources = src.drawn.map((s) => ({
      id: s.id,
      short: s.short,
      // the short name is the catalogue's own canvas-sized form and 12 of them
      // are clipped ('The Anatomy of…'); the readout and the page's table name
      // the work in full, because a clipped name is one a reader cannot look up
      title: s.title,
      kind: s.kind,
      author: s.author,
      count: s.count,
      nodes: s.nodes,
    }));
    data.cites = src.perNode;
    data.alone = src.alone;
  }
  const json = JSON.stringify(data).replaceAll('<', '\\u003c');

  return {
    title: 'The map — blog.jaye.ch',
    shareTitle: 'The map — blog.jaye.ch',
    type: 'website',
    description:
      `Every piece on the blog as a point on a ring, and every link between them as a curve — ` +
      `${edges.length} links between different pairs of ${nodes.length} pieces, derived from the links the ` +
      `pieces themselves make` +
      (hasWorks ? `, with the ${src.drawn.length} cited works that join two or more pieces drawn inside it` : '') +
      `.`,
    prompt: 'netstat -a',
    heroTitle: `The <span class="fx">map</span>`,
    tagline:
      `every piece, and the links between them — <b>${edges.length}</b> links between different pairs of ` +
      `<b>${nodes.length}</b> pieces.`,
    body:
      `<section><div class="wrap">` +
      `<div class="hint"># ${nodes.length} pieces · ${edges.length} links between different pairs of them — one link per pair, however often a piece names another</div>` +
      `<div class="viz" data-viz="map">\n` +
      `  <noscript><p class="viz-note">JavaScript is off, so the figure is not drawn. It shows the blog as a ` +
      `ring: every piece is a point, a piece that is a close reading is a square, and a curve joins two ` +
      `pieces when one of them links to the other. Inside the ring sit the works named by two or more pieces, ` +
      `a mark each, joined to the pieces that cite them. The tables below give the same links and the same ` +
      `works as counts.</p></noscript>\n` +
      `  <p class="viz-caption">Schematic — a map of the links between the pieces and of the works that join ` +
      `them, not a measurement of anything else. A position on the ring is a layout; the number of links is a ` +
      `count of links.</p>\n` +
      `</div>\n` +
      `<script type="application/json" id="viz-data-map">${json}</script>` +
      `<div class="prose">${prose}${table}${worksProse}</div>` +
      `</div></section>`,
    navCurrent: '/map/',
  };
}

/* ---------- the search page: the words, the vectors, the links ---------- */

/** 32-bit FNV-1a over a term's UTF-16 code units.
 *
 * tools/search/search.js holds THIS FUNCTION VERBATIM. The shipped vectors and
 * the query's own projection have to agree on the dimension and the sign of
 * every term, and no projector is shipped to make them: the client recomputes
 * the projection from this hash alone, so a change here without a matching
 * change there would silently return unrelated pieces. The smoke test asserts
 * the agreement (tools/search-smoke.mjs), not merely the syntax. */
function fnv1a(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** The vector space's width. 160 dimensions is small enough that the page stays
 * a page and wide enough that two unrelated pieces rarely collide; the count is
 * a choice, and the hash's modulus is where it is enforced. */
const SEARCH_DIM = 160;

/** Words a search ignores. ONE list: it is shipped in the page's own data, so a
 * query is tokenised by the rule the index was built with — two lists that could
 * drift would put the query off its own index. */
const STOPWORDS = new Set(
  (
    'a an and are as at be been but by can could did do does for from had has have he her him his how ' +
    'if in into is it its just like may might more most no not of on one only or other our out over own ' +
    'said same she should so some such than that the their them then there these they this those to too ' +
    'two under up very was we were what when where which while who why will with without would you your'
  ).split(' '),
);

const SEARCH_WORD = /[a-z][a-z'-]+/g;

/** The index's token rule: lowercased, three or more characters, stopwords
 * dropped — and NOT de-duplicated, because the vectors weight a term by how
 * often the piece uses it. The client's rule is the same one minus the repeats. */
function searchTerms(text) {
  const out = [];
  for (const w of String(text).toLowerCase().match(SEARCH_WORD) || []) {
    if (w.length >= 3 && !STOPWORDS.has(w)) out.push(w);
  }
  return out;
}

/** A piece's text with the markup taken off: the link targets, the emphasis,
 * the heading marks and the footnote markers all go. Used for the index and for
 * the snippets, so the two read the same words.
 *
 * Every mark is replaced by a SPACE, never deleted: deleting `*` in
 * `**word**'s` welds two words into one that is in no piece's prose
 * ("word's" stays one token by luck, "right-wing*authoritarianism*" does not),
 * and an index of words the pieces do not contain is worse than an index that
 * misses a compound. */
function mdText(src) {
  return String(src)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\^[^\]]+\]/g, ' ')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/[*_`|]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A piece's headings, the title's own subordinates. A hit in one of these
 * weighs more than a hit in the body (the client's lexical provider), and they
 * are the first thing a snippet is drawn from. */
function headingsOf(src) {
  const out = [];
  for (const m of String(src).matchAll(/^\s{0,3}(#{2,3})\s+(.+)$/gm)) {
    const text = mdText(m[2]);
    if (text && !out.includes(text)) out.push(text);
  }
  return out.slice(0, 12);
}

/** The characters of a piece's own opening a snippet may draw on. */
const LEDE_MAX = 420;

/** A piece's opening passage: the prose after its Status line, with the notes
 * left out. The full text of fifty-eight pieces is not in the page, so snippets
 * come from here, from the headings and from the summary — the page says so, and
 * the smoke test measures which pieces a query reaches rather than where in them
 * a word sits. */
function ledeOf(src) {
  const keep = [];
  for (const line of String(src).split('\n')) {
    if (/^\s{0,3}#{1,6}\s/.test(line)) continue;
    if (/^\s*\[\^/.test(line)) continue;
    if (/^\s*\|/.test(line)) continue;
    if (/^\s*>/.test(line)) continue;
    keep.push(line);
  }
  const text = mdText(keep.join('\n'));
  const at = text.indexOf('Status.');
  const body = (at >= 0 ? text.slice(at + 7) : text).trim();
  if (body.length <= LEDE_MAX) return body;
  const cut = body.slice(0, LEDE_MAX);
  const space = cut.lastIndexOf(' ');
  return (space > LEDE_MAX * 0.6 ? cut.slice(0, space) : cut) + '…';
}

/* ---------- the automaton the words are held in ---------- */

/** The sixty-four characters the automaton is written in: digits, letters, `_`
 * and `~`. Deliberately NOT the printable range — no quote or backslash (the
 * block is a JSON string), no `<` (the block escapes it, which would inflate
 * the data), no `/` or `*` (the workshop gate reads a comment delimiter
 * anywhere it reaches emitted text, and an opaque encoding is exactly where one
 * would hide by accident). Its low thirty-two values carry five bits at a time. */
const DAFSA_ENC = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_~';

/** A number in the encoding above, five bits per character, high bit set while
 * more follow. State ids reach the tens of thousands, so most edges cost one
 * character and the far edges cost three or four. */
function dafsaVarint(v) {
  let s = '';
  while (v >= 32) {
    s += DAFSA_ENC[(v & 31) | 32];
    v = Math.floor(v / 32);
  }
  return s + DAFSA_ENC[v];
}

/**
 * The vocabulary as a MINIMAL ACYCLIC FINITE-STATE AUTOMATON (Daciuk et al.):
 * a trie minimised bottom-up through a register of states, so two states with
 * the same behaviour — the same final flag and the same labelled transitions —
 * are one state. The words of a language share their endings, and merging them
 * is what makes the automaton smaller than the list it holds.
 *
 * A final state carries NO index. It cannot: the index IS the term's row in the
 * postings, and the client gets it by walking — transitions are kept in label
 * order, so a depth-first walk enumerates the terms in exactly the sorted order
 * the rows are indexed by. Storing the index instead would block the merge of
 * every terminal leaf into one state (they would all differ), and measured, it
 * costs 3x the states for a number the walk reproduces for free.
 *
 * The serialised form is three streams, because gzip is what the page is sent
 * as and separated streams compress where interleaved records do not (94,481
 * bytes raw this way, 226,809 interleaved):
 *   s  one character per state: (out-degree) + 32 when the state is final, so
 *      the flag rides in the fifth bit and no separate array is needed;
 *   l  one character per transition, the label, in state and then label order;
 *   t  one varint per transition: the state's own id MINUS its target's. Ids are
 *      assigned in post-order, so a target is always an already-made state and
 *      the difference is positive; it is small for the common case (a state's
 *      own children were made immediately before it).
 * The client decodes it back (tools/search/search.js) and walks the terms out.
 */
function dafsaOf(vocab) {
  const root = { kids: new Map(), fin: false };
  for (const term of vocab) {
    let node = root;
    for (const ch of term) {
      let kid = node.kids.get(ch);
      if (!kid) {
        kid = { kids: new Map(), fin: false };
        node.kids.set(ch, kid);
      }
      node = kid;
    }
    node.fin = true;
  }
  const register = new Map();
  const states = [];
  const canon = (node) => {
    const next = [];
    for (const ch of [...node.kids.keys()].sort()) next.push([ch, canon(node.kids.get(ch))]);
    const key = (node.fin ? '1' : '0') + '|' + next.map(([ch, id]) => ch + id).join(',');
    let id = register.get(key);
    if (id === undefined) {
      id = states.length;
      states.push({ fin: node.fin, next });
      register.set(key, id);
    }
    return id;
  };
  const rootId = canon(root); // post-order: the root is the last state made
  let s = '';
  let l = '';
  let t = '';
  for (let i = 0; i < states.length; i++) {
    const st = states[i];
    // The label alphabet is [a-z'-], so a state cannot have 32 transitions; the
    // encoding would silently truncate a degree it could not hold, so it fails
    // the build instead.
    if (st.next.length > 30) throw new Error(`dafsa: a state has ${st.next.length} transitions`);
    s += DAFSA_ENC[st.next.length + (st.fin ? 32 : 0)];
    for (const [ch, to] of st.next) {
      l += ch;
      t += dafsaVarint(i - to);
    }
  }
  return {
    dafsa: { s, l, t },
    stats: { states: states.length, edges: l.length, root: rootId, bytes: s.length + l.length + t.length },
  };
}

/**
 * The whole index, derived once and emitted into the page.
 *
 * Emitted rather than fetched (the site makes no external requests and the page
 * is one file). The vocabulary is emitted as the AUTOMATON above rather than as
 * the words themselves: it is the same list, walked back out in the same order,
 * and it is the shape the client's pattern walker needs — a pattern is answered
 * by walking the automaton, which is how a query can match the middle of a word
 * (no posting list can answer that: the terms are keys, not text to scan).
 */
function searchIndex(navPosts) {
  const { nodes, edges } = mapGraph(navPosts);
  const { works, citing, citations: citationCount } = citations(navPosts, nodes);
  const at = new Map(nodes.map((n, i) => [n.slug, i]));
  const docs = [];
  const tokens = [];
  for (let i = 0; i < navPosts.length; i++) {
    const p = navPosts[i];
    const file = join(ROOT, 'content', p.file);
    const src = p.file && existsSync(file) ? readFileSync(file, 'utf8') : '';
    const heads = headingsOf(src);
    const title = titleOf(p);
    tokens.push(searchTerms(mdText(src)));
    docs.push({
      i,
      slug: p.slug,
      title,
      series: p.series || '',
      kind: p.kind || '',
      date: p.date || '',
      summary: p.summary || '',
      heads,
      lede: ledeOf(src),
    });
  }
  // document frequency over the pieces, then the vocabulary: EVERY term the
  // prose uses (three or more characters, stopwords aside), a term seen in one
  // piece included — a name a single piece mentions once is exactly the kind of
  // rare word a search is asked for, and a word list that dropped it would
  // answer "nothing" to the one query it should answer. The earlier idea of
  // keeping only the terms two or more pieces use is measurably wrong here: it
  // saved about a fifth of the index and lost the rarest fifth of the words.
  const df = new Map();
  for (const toks of tokens) {
    for (const t of new Set(toks)) df.set(t, (df.get(t) || 0) + 1);
  }
  let singleton = 0;
  const vocab = [];
  for (const [t, c] of df) {
    vocab.push(t);
    if (c === 1) singleton++;
  }
  vocab.sort();
  const termAt = new Map(vocab.map((t, i) => [t, i]));
  const { dafsa, stats: dafsaStats } = dafsaOf(vocab);
  const postings = vocab.map(() => []);
  const strongAt = new Map();
  for (let i = 0; i < tokens.length; i++) {
    for (const t of new Set(tokens[i])) {
      const ti = termAt.get(t);
      if (ti !== undefined) postings[ti].push(i);
    }
    for (const t of new Set(searchTerms(docs[i].title + ' ' + docs[i].heads.join(' ')))) {
      if (!termAt.has(t)) continue;
      if (!strongAt.has(t)) strongAt.set(t, []);
      strongAt.get(t).push(i);
    }
  }
  const strong = [...strongAt.entries()]
    .map(([t, list]) => [termAt.get(t), ...list])
    .sort((a, b) => a[0] - b[0]);
  // the document frequency a QUERY word will see: the posting list's length,
  // which is the document frequency itself — the vectors and the query's
  // weights therefore rest on one number, and the client reads it the same way
  const idf = (t) => {
    const ti = termAt.get(t);
    return Math.log(1 + docs.length / Math.max(1, ti === undefined ? 1 : postings[ti].length));
  };
  const vec = tokens.map((toks) => {
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    const v = new Float64Array(SEARCH_DIM);
    for (const [t, c] of tf) {
      const h = fnv1a(t);
      v[h % SEARCH_DIM] += (((h >>> 31) & 1) ? -1 : 1) * (1 + Math.log(c)) * idf(t);
    }
    let norm = 0;
    for (let d = 0; d < SEARCH_DIM; d++) norm += v[d] * v[d];
    norm = Math.sqrt(norm) || 1;
    const out = new Array(SEARCH_DIM);
    for (let d = 0; d < SEARCH_DIM; d++) {
      out[d] = Math.max(-127, Math.min(127, Math.round((v[d] / norm) * 127)));
    }
    return out;
  });
  // the fact tables the datalog rules read: the pieces, the links between them,
  // the works each piece cites, and the works themselves
  const cited = [];
  const cites = [];
  for (let k = 0; k < works.length; k++) {
    if (!citing[k].length) continue;
    cited.push([works[k].id, works[k].short, works[k].kind]);
    for (const i of citing[k]) cites.push([i, works[k].id]);
  }
  const data = {
    dim: SEARCH_DIM,
    stop: [...STOPWORDS].join(' '),
    docs,
    lex: { postings, strong, dafsa },
    vec,
    graph: {
      post: docs.map((d) => [d.i, d.slug, d.series, d.kind, d.date]),
      link: edges
        .map(([a, b]) => [at.get(a), at.get(b)])
        .filter(([a, b]) => a !== undefined && b !== undefined),
      cites,
      source: cited,
    },
    // the terms the empty box offers: they have to BE in the vocabulary, or the
    // page would offer a search it cannot answer
    hints: SEARCH_HINTS.filter((h) => termAt.has(h)),
  };
  return {
    data,
    totals: {
      docs: docs.length,
      vocab: vocab.length,
      singleton,
      postings: postings.reduce((n, p) => n + p.length, 0),
      strong: strong.length,
      links: data.graph.link.length,
      cites: cites.length,
      works: cited.length,
      catalogued: works.length,
      citations: citationCount,
      dafsaStates: dafsaStats.states,
      dafsaEdges: dafsaStats.edges,
      dafsaBytes: dafsaStats.bytes,
      vocabBytes: vocab.join(' ').length,
    },
  };
}

/** Words the empty search box offers, each one checked against the vocabulary
 * before it is offered. */
const SEARCH_HINTS = ['proclus', 'wetiko', 'picatrix', 'theurgy'];

/** The search page — a real page, written to dist and listed in the sitemap.
 *
 * Modelled on buildMap: the page carries its own index in a JSON block (with
 * `<` escaped so nothing in it can close the script element early) and the
 * pipeline in an inlined script, so the search runs in the reader's browser and
 * nothing is requested from anywhere. */
function buildSearch(navPosts) {
  const { data, totals } = searchIndex(navPosts);
  const json = JSON.stringify(data).replaceAll('<', '\\u003c');
  const client = stripJsComments(readFileSync(join(ROOT, 'tools', 'search', 'search.js'), 'utf8'));
  const seriesOf = [];
  for (const d of data.docs) if (d.series && !seriesOf.includes(d.series)) seriesOf.push(d.series);
  const kindsOf = [];
  for (const d of data.docs) if (d.kind && !kindsOf.includes(d.kind)) kindsOf.push(d.kind);
  kindsOf.sort();
  const option = (v, label) => `<option value="${esc(v)}">${esc(label)}</option>`;
  const seriesOpts = seriesOf.map((s) => option(s, seriesLabel(s) || s)).join('');
  const kindOpts = kindsOf.map((k) => option(k, k)).join('');

  const prose =
    `<p>This page searches all ${totals.docs} published pieces at once and tells you <i>which of three ` +
    `signals</i> put each result in front of you. The first is the <b>words</b>: the terms the pieces ` +
    `actually use, three characters and longer, each with the pieces it occurs in — looked up as a whole ` +
    `word and as the beginning of one, where a hit in a piece's title or a section heading counts for more ` +
    `than a hit in its body. The commonest words are left out (they are in every piece, so they name none); ` +
    `everything else is here, <b>including a name used by a single piece and only once in it</b>.</p>` +
    `<p>The same list takes a <b>pattern</b>: put one between slashes and it is matched against the words ` +
    `themselves rather than looked up — <code>/wetiko.*/</code>, <code>/^procl/</code>, ` +
    `<code>/(gno|the)sis/</code>, <code>/urgy$/</code>. With nothing anchoring it, a pattern matches ` +
    `<b>anywhere inside</b> a word, which is how a half-remembered word is found: <code>/theurg/</code> ` +
    `reaches it wherever it sits. The syntax is <code>.</code> for any character, <code>*</code> ` +
    `<code>+</code> and <code>?</code> for repetition, <code>[abc]</code>, <code>[a-z]</code> and ` +
    `<code>[^abc]</code> for a set of characters, <code>|</code> to alternate between expressions, ` +
    `<code>()</code> to group them, and <code>^</code> and <code>$</code> for the start and the end of a ` +
    `word. A pattern that cannot be read is refused in the line above the results rather than guessed at, ` +
    `and a pattern reaching more words than the page will match is cut off there and says so.</p>` +
    `<p>Put a <code>~</code> in front of a word and it is matched <b>approximately</b> instead of looked up: ` +
    `<code>~proculs</code> finds <code>proclus</code>, because one tilde allows one edit — a wrong letter, a ` +
    `letter too many or too few, or two letters the wrong way round, which is what most typos are. ` +
    `<code>~~proculs</code> allows two edits, and reaches several times as many words for it. A word found ` +
    `this way is not a word you asked for, so it always ranks below a word you did type, and the reason ` +
    `under the result says which word it was and how far away.</p>` +
    `<p>The box also finishes words as you type them: three letters or more and the words of the list that ` +
    `begin that way are offered beneath it, up to eight, and the list says so when it stopped there. The ` +
    `arrow keys move through them and Enter takes the one you are on; Escape puts the list away and leaves ` +
    `what you typed. When a query finds almost nothing and one of its words sits one edit from a word the ` +
    `list holds, the line above the results offers that word with the misspelling left in place — the page ` +
    `suggests, it never rewrites. The results take the same arrow keys once no list is open, Enter opens ` +
    `the piece the selection is on, and Home and End go to the first and the last. A word the query ` +
    `reached is marked in the result's <b>title</b> as well as in its snippet, and the order can be ` +
    `switched from relevance to <b>newest first</b> — the mode travels in the link, so a sorted search is ` +
    `one you can send.</p>` +
    `<p>The second is a <b>vector space</b> — ${SEARCH_DIM} dimensions per piece, built by hashing each term ` +
    `to a dimension and a sign. It is a tf-idf projection and <b>not a neural embedding</b>: there is no ` +
    `model here, and no projector either — this page recomputes your query's projection with the same hash ` +
    `and takes the cosine. That is how a piece that argues in different words still surfaces. Only words the ` +
    `pieces really use are projected, because a word none of them uses would land in dimensions the pieces' ` +
    `own terms have already filled and would answer with noise; a query of such words returns nothing, and ` +
    `the page says so rather than padding the list.</p>` +
    `<p>The third is the blog's <b>own graph</b>. Every piece is a node, every link one piece makes to ` +
    `another is an edge, and the ${totals.works} works the pieces cite — the books, papers and primary texts ` +
    `named in their notes — join pieces that never mention each other. Those facts are read by a small ` +
    `<b>datalog</b> evaluator running in this page, with its rules declared as data: the reasons under each ` +
    `result are the rules that fired, and a result can be here on the strength of the graph alone. The ` +
    `expansion is capped (the strongest few hits seed it and the derived facts are bounded), so an unusual ` +
    `query cannot make the page wait.</p>` +
    `<p>Nothing is fetched and nothing is sent anywhere: the index is in this page and the search runs in ` +
    `your browser. Snippets come from each piece's own headings, summary and opening passage, so a piece ` +
    `matched deep inside shows its opening rather than the matched line. Scores are relative to the query ` +
    `and are not a judgement of the piece.</p>`;

  const body =
    `<section><div class="wrap">` +
    `<div class="hint"># ${totals.docs} pieces · ${totals.vocab} words in the list · ${totals.citations} ` +
    `citations from ${totals.works} works · three signals: the words, the vectors, the links</div>` +
    `<form class="sform" id="sf" role="search">` +
    `<div class="sq-wrap">` +
    `<div class="srow"><span class="s-lab" aria-hidden="true">$</span>` +
    `<input type="search" id="sq" name="q" role="combobox" aria-expanded="false" ` +
    `aria-controls="scomp-list" aria-autocomplete="list" ` +
    `aria-label="search the pieces" autocomplete="off" ` +
    `autocapitalize="off" spellcheck="false" placeholder="a word, a name, a phrase, /a pattern/, ~a typo">` +
    `</div>` +
    `<div class="scomp" id="scomp" hidden>` +
    `<ul class="scomp-list" id="scomp-list" role="listbox" aria-label="words that begin with it"></ul>` +
    `<div class="scomp-cap" id="scomp-cap" hidden></div>` +
    `</div>` +
    `</div>` +
    `<div class="sfacet"><label for="sf-series">series</label>` +
    `<select id="sf-series" name="series"><option value="">any</option>${seriesOpts}</select>` +
    `<label for="sf-kind">kind</label>` +
    `<select id="sf-kind" name="kind"><option value="">any</option>${kindOpts}</select>` +
    `<label for="sf-sort">order</label>` +
    `<select id="sf-sort" name="sort"><option value="">relevance</option>` +
    `<option value="new">newest first</option></select>` +
    `</div>` +
    `</form>` +
    `<div class="sstatus" id="sstatus" role="status" aria-live="polite"></div>` +
    `<ol class="sres" id="sres"><li class="sr-none">Type a word — the pieces are searched by their words, ` +
    `their vectors and their links.</li></ol>` +
    `<noscript><p class="s-noscript">JavaScript is off, so the search does not run: the whole index and the ` +
    `pipeline that reads it are in this page, and without a script they are only text. Every piece is ` +
    `reachable from <a href="/timeline/">what's new</a>, <a href="/map/">the map</a> and the command line ` +
    `(press <b>/</b>).</p></noscript>` +
    `<div class="prose">${prose}</div>` +
    `<script type="application/json" id="search-data">${json}</script>` +
    `<script>\n${client}\n</script>` +
    `</div></section>`;

  log(
    `search index: ${totals.docs} pieces, ${totals.vocab} terms (${totals.singleton} of them in exactly one piece), ` +
      `${totals.postings} term-to-piece pairs, ${totals.strong} terms in titles and headings, ` +
      `${totals.links} links, ${totals.citations} citations over ${totals.works} works, ${totals.catalogued} ` +
      `catalogued; data block ${Buffer.byteLength(json)} bytes`,
  );
  log(
    `search automaton: ${totals.dafsaStates} states, ${totals.dafsaEdges} transitions over ${totals.vocab} terms ` +
      `— ${totals.dafsaBytes} bytes serialised against ${totals.vocabBytes} bytes as one string of words`,
  );

  return {
    title: 'Search — blog.jaye.ch',
    shareTitle: 'Search — blog.jaye.ch',
    type: 'website',
    description:
      `Search all ${totals.docs} pieces of blog.jaye.ch by three signals at once — a word index, a tf-idf ` +
      `vector space, and a datalog query over the blog's own citation graph — with the reason each result ` +
      `matched.`,
    prompt: 'grep -r',
    heroTitle: 'The <span class="fx">search</span>',
    tagline:
      `every published piece, by <b>three signals</b> at once — the words, the vectors, and the links between ` +
      `them.`,
    body,
    navCurrent: '/search/',
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
    `    <description>Instruments, not verdicts — in minds, in groups, in the frames they live inside: a measured account of a collapse that cannot report itself, the frames that decide what it means, and the discipline of describing structures without diagnosing people.</description>\n` +
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
    { loc: `${BASE}/map/`, lastmod: posts.map((p) => p.date).sort().pop() || null },
    { loc: `${BASE}/search/`, lastmod: posts.map((p) => p.date).sort().pop() || null },
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
  'black-abbot-white-magic': {
    prompt: 'cat black-abbot-white-magic.md',
    tagline: 'a <b>reading</b>: the abbot and the angelic mind \u2014 Trithemius read whole, and the Steganographia held in plain sight.',
    hint: '<a href="/">\u2190 home</a> \u00b7 a reading of one book, with notes',
    description:
      'A close reading of Frater Acher\u2019s Black Abbot White Magic: Johannes Trithemius, the angelic mind, and a text the tradition could never decide was angel magic or cryptography \u2014 the hidden frame the blog\u2019s own readings keep circling.',
    accent: 'Black Abbot, White Magic',
  },
  'the-blood-of-the-earth': {
    prompt: 'cat the-blood-of-the-earth.md',
    tagline: 'a <b>reading</b>: magic and peak oil \u2014 a collapse with no holder, and a frame that cannot imagine its own end.',
    hint: '<a href="/">\u2190 home</a> \u00b7 a reading of one book, with notes',
    description:
      'A close reading of John Michael Greer\u2019s The Blood of the Earth: the industrial frame that can only imagine more of the same, a material collapse with no one standing on the far side of it, and what magic is asked to do about a crisis it cannot overturn.',
    accent: 'The Blood of the Earth',
  },
  'picatrix': {
    prompt: 'cat picatrix.md',
    tagline: 'a <b>reading</b>: the operable cosmology at source \u2014 a world where everything corresponds, and a grimoire that states the seat without ever arguing for it.',
    hint: '<a href="/">\u2190 home</a> \u00b7 a reading of one book, with notes',
    description:
      'A close reading of the Picatrix: the astrological-magic manual the blog has cited six times and never read \u2014 a frame that is entirely operable, and a seat that is simply assumed rather than claimed.',
    accent: 'Picatrix',
  },
  'the-chaldean-oracles': {
    prompt: 'cat the-chaldean-oracles.md',
    tagline: 'a <b>reading</b>: the theurgic root \u2014 fire, the flower of mind, and a cosmos that supplies the ascent rather than a person who mediates it.',
    hint: '<a href="/">\u2190 home</a> \u00b7 a reading of a text, with notes',
    description:
      'A close reading of the Chaldean Oracles, in Majercik\u2019s text and translation: the theurgic root of the Western lineage, read whole \u2014 the fire, the flower of mind, Hecate, and the ascent the framework runs on.',
    accent: 'The Chaldean Oracles',
  },
  'the-orphic-hymns': {
    prompt: 'cat the-orphic-hymns.md',
    tagline: 'a <b>reading</b>: the frame enacted \u2014 a hymnal with no doctrine, and a cosmos named into presence by invocation.',
    hint: '<a href="/">\u2190 home</a> \u00b7 a reading of a hymnal, with notes',
    description:
      'A close reading of the Orphic Hymns in Athanassakis and Wolkow\u2019s edition: a liturgical frame with no thesis, where the epithets are the theology and the incense is the correspondence \u2014 read against the two books the blog just finished, which both rest on it.',
    accent: 'The Orphic Hymns',
  },
  'proclus-theology-of-plato': {
    prompt: 'cat proclus-theology-of-plato.md',
    tagline: 'a <b>reading</b>: the frame that argues \u2014 a hierarchy of mediation, an explicit claim on how things are, and an ascent the system says is safe.',
    hint: '<a href="/">\u2190 home</a> \u00b7 a reading of a system, with notes',
    description:
      'A close reading of Proclus\u2019 Theology of Plato in Thomas Taylor\u2019s translation: the Neoplatonist frame at full length \u2014 the One, the negations that name it, the ladder of the gods, and the one thing the blog has been asking of every frame it reads.',
    accent: 'On the Theology of Plato',
  },
  'proclus-elements-of-theology': {
    prompt: 'cat proclus-elements-of-theology.md',
    tagline: 'a <b>reading</b>: the frame as a proof \u2014 two hundred and eleven propositions, derived rather than argued, with no ritual and no one acting anywhere in it.',
    hint: '<a href="/">\u2190 home</a> \u00b7 a reading of a system of propositions, with notes',
    description:
      'A close reading of Proclus\u2019 Elements of Theology: the same frame as a deduction \u2014 propositions from a first principle to the soul\u2019s ascent, with the theurgy stripped out, and what a claim does when nothing in the system performs it.',
    accent: 'The Elements of Theology',
  },
  'iamblichus-on-the-mysteries': {
    prompt: 'cat iamblichus-on-the-mysteries.md',
    tagline: 'a <b>reading</b>: the answer to the last book \u2014 not thought but the acts unite, and the efficacy is put in the rite, outside whoever performs it.',
    hint: '<a href="/">\u2190 home</a> \u00b7 a reading of a reply, with notes',
    description:
      'A close reading of Iamblichus\u2019 On the Mysteries: the counter-text to the Elements of Theology \u2014 why intellection cannot unite, what the unutterable symbols are said to do by themselves, and where a frame puts its efficacy when it takes it out of the person.',
    accent: 'On the Mysteries',
  },
  'plotinus-collected-writings': {
    prompt: 'cat plotinus-collected-writings.md',
    tagline: 'a <b>reading</b>: the founder of the line \u2014 an ascent by turning inward, and a successor who refused it because nothing is performed.',
    hint: '<a href="/">\u2190 home</a> \u00b7 a reading of the Enneads, with notes',
    description:
      'A close reading of Plotinus in Thomas Taylor\u2019s translations: the Enneads read whole \u2014 the One, Intellect and Soul, the emanation and the ascent, and the route by turning inward that the tradition\u2019s next two thinkers moved out of the person.',
    accent: 'The Enneads',
  },
  'porphyry-cave-of-the-nymphs': {
    prompt: 'cat porphyry-cave-of-the-nymphs.md',
    tagline: 'a <b>reading</b>: the ascent given a place \u2014 a cave in the Odyssey read as the cosmos, with two gates and the soul\u2019s descent drawn as geography.',
    hint: '<a href="/">\u2190 home</a> \u00b7 a reading of a treatise on a poem, with notes',
    description:
      'A close reading of Porphyry\u2019s On the Cave of the Nymphs in Thomas Taylor\u2019s translation: the cave at Ithaca read as the whole cosmos \u2014 two gates, the nymphs who preside over generation, and Odysseus as the soul that descends and returns.',
    accent: 'On the Cave of the Nymphs',
  },
  'ahead-of-the-story': {
    prompt: 'cat ahead-of-the-story.md',
    tagline: 'the <b>fit that fails</b>: getting ahead of the account \u2014 the rejection recoded as the target\u2019s symptom, the pivot to the network, and the accurate report made self-indicting.',
    hint: '<a href="/">\u2190 home</a> \u00b7 the damage control, and the boundary, with notes',
    description:
      'The sequel to The Operative Master: what happens when the position is refused \u2014 the operator gets ahead of the story, recoding the rejection as a symptom, pivoting from the target to the surrounding support structures, and turning the target\u2019s own accurate report into the evidence against them.',
    accent: 'Ahead of the Story',
  },
  'the-assumed-seat': {
    prompt: 'cat the-assumed-seat.md',
    tagline: 'the <b>undefended position</b>: authority taken by assumption rather than claim, and the objection made to cost more than it is worth.',
    hint: '<a href="/">\u2190 home</a> \u00b7 the occupancy, and the boundary, with notes',
    description:
      'The other companion to The Operative Master: a position occupied without a claim \u2014 so there is nothing to contest \u2014 held by making every objection cost more than the objection is worth, and by letting the room read reaction rather than cause.',
    accent: 'The Assumed Seat',
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

  // The masthead emblem. Only a post whose header was rendered carries one;
  // a post without the file builds exactly as before — no <img>, no og:image —
  // which is the honest default, not a dead branch: a newly added post will
  // not have one yet. The og:image points at the copied 1200x630 crop (a card
  // scraper fetches it, so the URL must be absolute); the alt text is the
  // post's title as plain text — the same stripping the share metadata
  // applies — because a screen reader announcing the slug is noise.
  const headerPath = join(ROOT, 'content', 'headers', 'webp', `${post.slug}.webp`);
  const header = existsSync(headerPath)
    ? {
        // Inlined by default (the README's self-containment promise); built as
        // a plain link under HEADERS_INLINE=0, which also copies the banner —
        // under headers/banner/, because headers/<slug>.webp is the og crop's
        // name and its 1.9:1 aspect would stretch in this square box.
        src: HEADERS_INLINE
          ? `data:image/webp;base64,${readFileSync(headerPath).toString('base64')}`
          : `${BASE}/headers/banner/${post.slug}.webp`,
        og: `${BASE}/headers/${post.slug}.webp`,
        alt: titleHtml.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
      }
    : undefined;

  return {
    title: `${titleHtml} — blog.jaye.ch`,
    shareTitle: titleHtml,
    type: 'article',
    description: meta.description,
    prompt: meta.prompt,
    heroTitle: fxTitle,
    tagline: meta.tagline,
    header,
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
written.push({ rel: 'map/index.html', html: writePage('map/index.html', buildMap(navPosts), navPosts) });
written.push({ rel: 'search/index.html', html: writePage('search/index.html', buildSearch(navPosts), navPosts) });

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

/* ---------- header art: the one asset family dist/ carries ----------
 * Every page is still one self-contained file — the banner a post shows is
 * INLINED into it (see HEADERS_INLINE) — but the og:image cannot be: a card
 * scraper fetches it server-side, so it must be a real file at a stable URL.
 * That file, and nothing else here, ships by default. The 1024x1024 banner webp
 * is copied ONLY in link mode, under headers/banner/, because the og crop owns
 * headers/<slug>.webp and letting either name shadow the other would have the
 * cards silently show the wrong crop. The source PNGs never ship. */
{
  const ogSrc = join(ROOT, 'content', 'headers', 'og');
  const destDir = join(DIST, 'headers');
  mkdirSync(destDir, { recursive: true });
  const webps = readdirSync(ogSrc).filter((f) => f.endsWith('.webp'));
  for (const f of webps) copyFileSync(join(ogSrc, f), join(destDir, f));
  log(`copied ${webps.length} og card(s) -> dist/headers/`);
  if (!HEADERS_INLINE) {
    const bannerSrc = join(ROOT, 'content', 'headers', 'webp');
    const banners = readdirSync(bannerSrc).filter((f) => f.endsWith('.webp'));
    mkdirSync(join(destDir, 'banner'), { recursive: true });
    for (const f of banners) copyFileSync(join(bannerSrc, f), join(destDir, 'banner', f));
    log(`HEADERS_INLINE=0: copied ${banners.length} banner(s) -> dist/headers/banner/`);
  }
}

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
    [/\bno newline\b|\bwhitespace[- ]collaps|\bjumbled page order\b|\bwatermark-delimited\b|\bthe scan\b|\bthe extract\b/i, 'extraction mechanics'],
    // authoring references
    [/\bthe brief\b|\bthe reading list\b|\bthe manifest\b|\bthe plumbing\b|\bthe build\b(?!\s+in\b)|\bthe corpus\b/i, 'authoring reference'],
    // a comment delimiter that reached emitted code
    [/\/\*\s*[-=]*\s*[a-z]/i, 'source comment in emitted code'],
    [/^\s*\/\/\s/m, 'source comment in emitted code'],
  ];
  // Legitimate uses the tight patterns above could still catch, by exact text.
  const allowed = [
    'the build in', 'the build of', // ordinary prose, not the build process
  ];
  // A base64 data: URI is INLINED BINARY — a reader sees an image, not text, and
  // the payload is not something anyone reads. Its alphabet can contain anything,
  // including a string that matches a pattern below (a header image whose base64
  // happened to contain "615Kb" tripped the file-size rule). Scanning it is
  // scanning noise, and the result was a build that failed or passed depending on
  // which image was inlined. The payload is blanked first; everything readable on
  // the page is still scanned exactly as before, so the check is not weakened —
  // a leak cannot hide in binary, because a reader cannot read binary.
  const scanned = html.replace(/(data:[\w.+-]+\/[\w.+-]+;base64,)[A-Za-z0-9+/=]+/g, '$1<binary>');
  const problems = [];
  for (const [re, what] of patterns) {
    for (const m of scanned.matchAll(new RegExp(re, re.flags.includes('g') ? re.flags : re.flags + 'g'))) {
      const at = m.index;
      const window = scanned.slice(Math.max(0, at - 60), at + 60).replace(/\s+/g, ' ');
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
