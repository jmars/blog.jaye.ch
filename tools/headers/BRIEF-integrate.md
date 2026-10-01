# Brief: integrate header emblems into tools/build.mjs

Goal: each post page shows its header emblem in the masthead, and social cards
carry `og:image` pointing at a real file. Repo `~/enlighten`, build entry
`node tools/build.mjs` → `dist/`. Read `README.md` first: it documents the
site's self-containment property (no external requests, no iframes).

## Assets already on disk — do NOT regenerate these

58 published slugs, all present:

| path | what it is |
| --- | --- |
| `content/headers/<slug>.png` | 1536×640 source of record |
| `content/headers/webp/<slug>.webp` | 1536×640 webp q82 (~153KB) — what the **page** inlines |
| `content/headers/og/<slug>.png` | 1200×630 crop |
| `content/headers/og/<slug>.webp` | 1200×630 webp q86 — what **og:image** points at |

A slug with no header file must build exactly as before: no `<img>`, no
`og:image`. (This is the honest default, not a dead branch — a newly added post
will not have one.)

## Required changes in `tools/build.mjs`

1. **`page()`** gains an optional `header` param:
   `{ data: <base64 string>, link: <absolute URL to banner>, og: <absolute URL>, alt: <string> }`
   - when present, emit `og:image` = `og`, `twitter:image` = `og`, and switch
     `twitter:card` to `summary_large_image` (keep `summary` when absent).
   - when present, emit the banner as the **last** element inside `hero()`'s
     `<div class="wrap">`, after `.tagline`:
     `<img class="header-art" src="..." alt="${esc(alt)}" width="1536" height="640" decoding="async">`
     `width`/`height` are required — they reserve layout space so the masthead
     does not reflow when the image decodes.
   - `src` is `data:image/webp;base64,${data}` by default; see the toggle below.
   - alt text: the post's **title as plain text** (strip tags the same way the
     existing `shareTitle` code does). Not the slug.

2. **`buildPost()`** builds and passes `header` when
   `content/headers/webp/<slug>.webp` exists.

3. **Asset copy** — a new step in `main()` copying
   `content/headers/og/*.webp` → `dist/headers/*.webp`. `BASE` is the canonical
   origin constant already in the file; `og:image` =
   `${BASE}headers/<slug>.webp`. Ship **only** the og webp — the source PNGs and
   the banner webp must not be copied in the default inline mode.

4. **CSS** — a `.header-art` rule in `PAGE_CSS`: full width of `.wrap`, height
   auto, `display: block`, a small margin below the tagline. Must not overflow
   at the existing 620px breakpoint. Use the file's existing variable idiom; do
   not invent colours.

5. **The inline/link toggle.** Default = inline data URI (honours the README's
   self-containment rule). Add a one-line switch so the other reading is
   available without a rewrite:
   `const HEADERS_INLINE = process.env.HEADERS_INLINE !== '0';`
   When `'0'`: `src` is `${BASE}headers/<slug>.webp` and the **banner** webp is
   also copied into `dist/headers/`. Comment both modes.

## Constraints — the file enforces these

- Two-space indent, single quotes, semicolons. The file is heavily commented in
  a specific voice: it explains **why**, not what, and cites measured failures.
  Match it. Do not strip existing comments.
- `build.mjs` throws on a literal `\uXXXX` escape in the assembled page. Do not
  introduce such a sequence.
- `build.mjs` scans built pages for references to **unpublished** slugs. Your
  change must not add one.
- There is no existing asset-copy machinery; you are adding the first.

## Verify — paste real command output, do not summarise

```
node --check tools/build.mjs
node tools/build.mjs                      # must exit 0
ls dist/headers/ | wc -l                  # 58
grep -c 'og:image' dist/a-cosmos-of-persons/index.html          # 1
grep -o 'class="header-art"' dist/a-cosmos-of-persons/index.html | wc -l   # 1
# the og:image URL must be absolute:
grep -o 'og:image" content="[^"]*"' dist/a-cosmos-of-persons/index.html
```

Also report the byte size of `dist/a-cosmos-of-persons/index.html` before and
after, and state honestly how you confirmed the **absent-header** branch (there
is currently no published post without a header, so you must either fabricate a
temporary case or say you only read the code).

## Scope

- **Yours:** `tools/build.mjs`, `README.md` (add the og:image /
  self-containment carve-out in the existing voice).
- **NOT yours:** `tools/headers/*`, `content/headers/*`, `design/*`,
  `content/*.md`. Do not touch them.
- **No commit.**
- Never run `find /` — it hangs on NFS mounts. Scope all search to `~/enlighten`
  and prefer `rg`.

## Report

Append `stage=implement:` observations to memory node
`handoff-headerimg-integrate-result` via `fx-agent-memory add-obs`. Include the
verification output above and the page-size delta.
