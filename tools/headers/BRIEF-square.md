# Brief: present the header as a centred square plate

Repo `~/enlighten`. The header render is **square now** (1024×1024), not the
1536×640 banner you integrated earlier. This is a measured change, not a taste
one: at 2.4:1 SDXL fills the width with a *row* of objects, so the one-emblem
rule was being defeated by the canvas. Details in `tools/headers/style.json`
(`composition._ratio`).

Only the **presentation in the masthead** changes. Everything else you built
stays: the `og:image` contract, the asset copy, `HEADERS_INLINE`, the alt text.

## Change in `tools/build.mjs`

1. **`hero()`** — the `<img>` changes from `width="1536" height="640"` to
   `width="1024" height="1024"`. (Reserve-space attributes must match the asset,
   or the masthead reflows when the image decodes.)

2. **`.header-art` in `PAGE_CSS`** (currently `tools/build.mjs:418`) — the plate
   is now a **centred plate at less than full width**, not a full-bleed strip:

   ```css
   .header-art {
     display: block;
     width: 100%;
     max-width: 480px;
     height: auto;
     margin: 26px auto 0;
     border: 1px solid var(--line);
     border-radius: 10px;
   }
   ```

   `margin-inline: auto` is what centres it — `.wrap` is a block container, so
   the `auto` margins centre the 480px plate inside the 732px column.
   480px against a 1024px source is 2.13× retina at DPR 2.

3. **The 620px media query** (`tools/build.mjs:429`) — `max-width: min(100%, 480px)`
   is unnecessary because `width:100%` already shrinks with the column; keep the
   existing corner-radius relaxation. Update the comment above it: it currently
   says "the emblem is full-width inside it", which is no longer true.

4. **The comment on `.header-art`** should say *why* the plate is square and
   centred — the wide frame was measurably defeating the one-emblem composition.
   Match the file's commenting voice (it explains why, and cites measured
   failures). Do not strip existing comments.

## What must NOT change

- The `og:image` / `twitter:image` URLs and the `dist/headers/` copy. The card
  under `dist/headers/<slug>.webp` is still 1200×630 — the pipeline makes it by
  setting the square plate on a 1200×630 field and extending its own paper out
  to the sides (`tools/headers/postprocess.py`). Nothing for you to do there.
- `HEADERS_INLINE` behaviour.
- The alt text (tag-stripped post title).

## Verify — paste real command output

```
node --check tools/build.mjs
./build.sh                                   # exit 0
grep -o 'width="1024" height="1024"' dist/a-cosmos-of-persons/index.html | wc -l   # 1
grep -o 'max-width: 480px' dist/a-cosmos-of-persons/index.html | wc -l             # 1
grep -o 'margin: 26px auto 0' dist/a-cosmos-of-persons/index.html | wc -l          # 1
grep -c 'og:image' dist/a-cosmos-of-persons/index.html                             # 1
```

Then confirm `HEADERS_INLINE=0` still builds and still emits no data URI.

## Scope

- **Yours:** `tools/build.mjs`, `README.md` if it describes the plate's shape.
- **NOT yours:** `tools/headers/*`, `content/headers/*`, `design/*`. Note the
  images themselves are being re-rendered right now — do not touch them, and do
  not re-run the headers pipeline.
- **No commit.**
- Never `find /`. Scope search to `~/enlighten`, prefer `rg`.

## Report

Append `stage=implement:` observations to `handoff-headerimg-square-result`
(create it first) via `fx-agent-memory add-obs` — content as ONE quoted
argument, not a `--flag`.
