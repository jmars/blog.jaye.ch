# blog.jaye.ch

Static source of record for **blog.jaye.ch**. Built on **blog-design** — the
light "paper" fork of the [fixpoint-linux](https://fixpointlinux.org) design
system — consumed as a git submodule. The design CSS is extracted from the
fork's Elm package (the single source of truth — never copied by hand) and
inlined into each page, so every page is fully self-contained: **no external
requests, no iframes, no trackers.**

Interactive figures are the blog's interactive layer, and they keep that
property: each one is authored as a component (`tools/viz/*.js` — the MFE
`{ mount, unmount, update }` shape) and the build inlines exactly the engine and
the widgets a page uses, next to its CSS. No import map, no `/vendor` path, no
fetch — a page with a figure is still one file.

Two scripts run on the site, both inlined and neither fetching anything:

- the **command line** — every page carries a small terminal-idiom palette in
  the site's own idiom (press `/` or `:`, or the footer button: `ls`,
  `cat <slug>`, `open <series>`, `home`). It is the one thing on every page,
  including the ones with no figure;
- the **figures** — a page whose body carries a `[data-viz]` slot gets one more
  inline `<script>`, holding the engine plus exactly the widgets that page uses.

The fork carries the whole look, including the long-form reading layer
(`.prose` serif typography, blockquotes, tables, footnotes). Two site-local
layers sit on top of it, neither of them in the shared design package —
`tools/viz/viz.css` (figure styling) and `PAGE_CSS` in `tools/build.mjs`: the
masthead motion, the keyboard-accessible nav menus, the post contents block, the
series prev/next, the dose meter, the command line, the wide-viewport footnote
sidenotes, and the dark and print renderings.

Two figure behaviours live in the shared engine, so every figure has them:

- **the frame is in the URL** — a widget declares its state with
  `VIZ.share(ctx, { get, set })` and the engine writes `#viz=<widget>&a=0.72` as
  the reader moves it (`history.replaceState`, never `pushState`, so dragging
  does not fill the history). The key is namespaced, so a heading anchor or a
  footnote backref (`#fn3`) is left exactly where the browser put it; with
  several figures on a page, the one named in `viz=` owns the bare keys and the
  others prefix theirs (`runaway.hold=66.3`). Opening a copied URL restores the
  frame, and a value no slider can hold exactly — an off-grid paste — is snapped
  and written back once, so the URL never describes a frame the figure is not
  showing.
- **the figure exports as a PNG** — a `⬇ PNG` control per figure composes its
  canvas(es) and downloads them (`canvas.toBlob` → a `data:` URL), plus a
  `copy image` where the browser can put an image on the clipboard. All of it is
  in-page: no upload, no service, no request.

## Licensing

Split by content type, and consistent with the paper bundle (the Zenodo deposit),
which uses the same division:

| what | licence | file |
|---|---|---|
| the writing — `content/`, the home page text, and the rendered pages in `dist/` | **CC-BY-4.0** | `LICENSE-content` |
| the build tooling — `build.sh`, `tools/`, `elm/` | **MIT** | `LICENSE` |
| the design fork (`vendor/blog-design`, a submodule) | MIT | its own repo |

**Quotation with attribution is welcome** — CC-BY-4.0 asks only for credit, a link to
the licence, and an indication of changes. Attribution text and the terms for
third-party material quoted inside posts (notably Source Library's CC-BY-SA-4.0
translations in *What the Traditions Knew*) are in `LICENSE-content`.

---

## Scope — what belongs in this repo, and what does not

**This repo is the blog. Only the blog.** It holds the words of the posts
(`content/`), the build tooling, and the design package pin. Nothing else.

The **model, the paper, and every experiment live in a separate paper project**
and are *referenced* from here, never copied in: the posts describe measured
results and cite the published paper, but no model code, no caches, no figures,
no drafts, and no raw or personal material belong in this repo.

**The posts are authored here, in `content/`.** That is the source of record for
the blog's words — there is no second copy elsewhere.

Two guards enforce the boundary, so it does not depend on anyone remembering:

1. `tools/check-scope.sh` — fails the build if an artifact file (result dumps,
   generated documents, numbered experiment outputs) is tracked, if a forbidden
   string appears (a raw-transcript reference, or an ORCID-style identifier), if
   `content/` holds anything the manifest does not list, or if a post the
   manifest lists is missing. `build.sh` runs it first. **The checks are generic
   by design**; the project-specific names it should also reject live in a
   **local, untracked** file, `.scope-local`, which the guard sources if present.
   That keeps this script publishable without listing another project's private
   filenames. (Copy `.scope-local` from a private backup if you need the extra
   checks on a fresh clone.)
2. `.gitignore` — belt-and-braces entries for generated output and artifact
   types, so an accidental `git add .` cannot stage them. Local-only ignore
   rules for private material live in `.git/info/exclude`, which is never
   committed.

    ./tools/check-scope.sh        # run the guard alone

## Layout

    build.sh                  one-shot build: design CSS (when the Elm
                              toolchain is present; else the committed CSS)
                              + pages
    tools/extract-css.mjs     renders design/blog.css from the blog-design
                              Elm package (Platform.worker + happy-dom boot,
                              mirroring the fixpointlinux.org SSG)
    tools/build.mjs           content/*.md → pandoc → design chrome → dist/
                              (pages, plus the not-found page and the
                              discovery files: feed.xml, sitemap.xml,
                              robots.txt — all built from the manifest's
                              PUBLISHED posts, and none of them carrying a
                              date, because the manifest has none)
    tools/check-scope.sh      scope guard: this repo is the blog only (run
                              first by build.sh; see "Scope" above)
    tools/viz/                interactive figures, inlined per page by
                              tools/build.mjs
      engine.js                   the shared engine: the viz registry, boot(),
                                  the hiDPI canvas/plot/animation helpers
      <widget>.js                 one MFE-shaped widget per figure
      viz.css                     figure styling (design tokens; inlined only
                                  into pages that carry a [data-viz] slot)
    tools/viz-shots.sh        visual check for the figures: renders each one
                              headlessly via podman (rootless) into .viz-shots/,
                              so a human — or the vision skill — can look at what
                              the runtime test cannot see (invisible, clipped or
                              overlapping text). Needs podman; pulls the browser
                              image on first run.
    tools/viz-smoke.mjs       runtime test for the figures (happy-dom): mounts
                              each built page's figures, drives every control,
                              checks labels stay inside their canvas, tears down.
                              Discovers pages from posts.json. Run it against a
                              PREVIEW build to cover the staged drafts:
                                PREVIEW=1 SKIP_CSS=1 ./build.sh && node tools/viz-smoke.mjs
    elm/                      tiny Elm program exposing Fixpoint.Style.css
    vendor/blog-design/       git submodule: github.com/jmars/blog-design
                              (light paper fork of fixpoint-linux/design)
    design/blog.css           generated — do not edit (regenerated by build;
                              committed so the fork's CSS is visible in-repo)
    posts.json                release manifest: nav order, nav labels, and
                              which posts are published (see "Releases" below)
    content/                  Markdown, the actual words
      meditation-harm.md          the full post      → /meditation-harm/
      meditation-harm-summary.md  the home page (start here)  → /
      the-*.md                    the case studies  → /the-<slug>/
      anxiety-damping.md          the second post    → /anxiety-damping/
    dist/                     generated site, deploy as-is (absolute paths)
      <slug>/index.html           a published post
      index.html                  the home page
      404.html                    the not-found page (served by Caddy's
                                  handle_errors with a real 404 status)
      headers/<slug>.webp         the og:image card, one per post that has a
                                  header render (the only non-page asset
                                  dist/ carries; see "Header art" below)
      headers/banner/<slug>.webp  the 1024x1024 banner, copied only for
                                  HEADERS_INLINE=0 builds (see below)
      feed.xml / sitemap.xml / robots.txt
                                  discovery files, published posts only

## Releases — publishing one post at a time

`posts.json` (repo root) is the single source of truth for what the public
site contains. It lists the home file and the posts in nav order, each with
its nav label and its `published` state:

    { "slug": "anxiety-damping", "file": "anxiety-damping.md",
      "navLabel": "the damping dial", "published": false }

- A post with `"published": false` is a staged draft: it is **not written to
  `dist/` at all** and appears in **no nav**.
- Publishing a post is a one-line change — flip `"published": true`, rebuild,
  deploy. It appears in every nav (in manifest order) under its `navLabel`.
- A draft can still be previewed locally:
  `PREVIEW=1 ./build.sh` builds **all** posts regardless of `published` and
  prints a prominent notice. **Never deploy a `PREVIEW=1` build.**
- The build scans every written page for links to unpublished slugs and warns
  loudly if a published page would expose a draft's URL (a `PREVIEW=1` build
  legitimately contains such links, since drafts link each other).

## Build

The build has two modes:

- **Full** (default): regenerate `design/blog.css` from the blog-design Elm
  package, then render the pages. Needs the Elm toolchain: an `elm` 0.19.2
  binary plus the `happy-dom` module. They are discovered in place — `elm`
  via `$ELM`, then `./node_modules/.bin/elm`, then the sibling
  `../fixpoint-linux/fixpointlinux.org/node_modules`; `happy-dom` via
  `./node_modules`, then the sibling checkout's `node_modules`. Nothing is
  installed by the build.
- **Fallback**: skip CSS regeneration and build from the committed
  `design/blog.css`. Chosen automatically when the Elm toolchain cannot be
  found, or forced with `SKIP_CSS=1`. If the committed `design/blog.css` is
  missing, the build fails with instructions (restore it with
  `git checkout -- design/blog.css`).

Dependency matrix:

| dependency | required            | used for                          |
|------------|---------------------|-----------------------------------|
| `pandoc`   | hard (both modes)   | Markdown → HTML                   |
| `node`     | hard (both modes)   | `tools/build.mjs` (+ extraction)  |
| `elm`      | full mode only      | compiling the design package      |
| `happy-dom`| full mode only      | booting the compiled Elm worker   |

    ./build.sh

`SKIP_CSS=1 ./build.sh` forces the fallback (pandoc-only) path — what a
fresh clone without the Elm toolchain runs. `PANDOC=/path/to/pandoc
./build.sh` overrides the pandoc binary.

When the full mode regenerates a `design/blog.css` that differs from the
committed one, the build prints a prominent warning: **commit the regenerated
CSS** so clones without the toolchain keep building the same site.

### The design package

The fork is consumed as a git submodule at `vendor/blog-design`
(github.com/jmars/blog-design — light "paper" fork of fixpoint-linux/design):

    git clone --recurse-submodules <repo>
    # or, in an existing clone:
    git submodule update --init --recursive

`elm/elm.json` lists `../vendor/blog-design/src` as a source directory, so
`elm` compiles the package in place — it is never copied or edited. The
generated `design/blog.css` is committed, which is what makes the fallback
mode (and therefore a toolchain-free clone) possible.

To update the design fork: `git -C vendor/blog-design fetch && git -C
vendor/blog-design checkout <ref>` (or `git submodule update --remote`), then
rebuild in full mode and commit the new submodule pin + `design/blog.css`.

## Header art — the one carve-out from the one-file rule

Every page is one self-contained file: the design CSS, the command line, the
figures — all inlined. The header emblems keep that property for the reader: the
banner a post shows in its masthead is inlined as a `data:` URI (they run 54–
238KB, averaging 139KB), so a page with its emblem is still one file making no
external request.

The og:image **cannot** be inlined — a social-card scraper fetches the image
server-side, where a data URI is silently dropped and the card renders with no
image at all. So each post's card is written to `dist/headers/<slug>.webp` (the
1200×630 crop), and the og:image points at `${BASE}/headers/<slug>.webp` — the
one non-page asset dist/ carries.

A post whose header render doesn't exist yet (a newly added post) simply builds
without one: no `<img>`, no og:image, `twitter:card` stays `summary`.

`HEADERS_INLINE=0 node tools/build.mjs` links the banner instead
(`headers/banner/<slug>.webp`, also copied) for a deployment that would rather
not pay that weight per page — trading away the one-file property, which is why
it is not the default. The source PNGs never ship.

## Pages

`posts.json` lists every published post; each builds to `/<slug>/`, and `/` is the
home page — the framework-level **start here**, which routes into the series. All
prose is verbatim from `content/`: no content edits at build time.

- `/` — the home page (start here), the series grids, and the route into the series.
- `/meditation-harm/` — the mechanism post, footnotes rendered as a notes section.
- `/anxiety-damping/` — the prediction.

Posts are grouped into three series by **epistemic status** — `mechanism`
(measured), `implications` (arguments), `cases` (documented). The home-page
tagline, the section counts and the 404 copy are all derived from the manifest, so
they follow whatever is published. A post carrying a `[data-viz]` slot gets the
figure engine inlined; run `node tools/viz-smoke.mjs` after a build to check the
figures mount, draw, respond and tear down.
