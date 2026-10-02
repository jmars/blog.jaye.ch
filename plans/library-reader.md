# The library reader — a plan

Status: PLAN (nothing implemented). Written for `HANDOFF=reader-plan`.
Everything marked MEASURED was measured on this host during planning; everything
marked GIVEN comes from the brief and was not re-derived. Where the plan is
unsure, it says so and names what would settle it.

---

## 0. The two defects, restated so the plan can't blur them

1. **Architecture** — today a library text is one self-contained HTML page with
   the whole transcription inlined (GIVEN: 37.6 MB over 48 pages, largest
   1.88 MiB). A reader replaces this: a small shell page plus *fetched* text.
2. **The text itself** — the transcriptions are raw archive.org `_djvu.txt`.
   MEASURED on the 38 shelf sources (33.5 MB of text this plan actually serves):

   | damage class | worst offenders (slug: count) | what it is |
   |---|---|---|
   | folio-as-heading | iamblichus…1895: **348 of its 522 headings are bare page numbers**; trithemius: 511; kalama-sutta: 163; proclus…1816: 789 | a page number OCR'd as its own block, read as a heading |
   | running heads read as headings | proclus…1816: **244 repeated `BOOK I.`-style blocks + 261 `CHAP. n.`**; plato vol 1: 542 ALL-CAPS short lines | the page-header line of the *printed* page, standing as a block |
   | negation signs | proclus…1816: **2,704 `¬`**; granum-sinapis: 24 | OCR debris where the print has none |
   | long-s → f | plato vol 1 (1804): **4,662 words mixing f…t** (`injuftice`, `firft` ×215 while `first` ×211 also occurs); plato vol 2: 1,781 | the edition's long s taken for f |
   | alphabet damage | orphic-hymns-1827 (unreadable, already a stated gap); evagrius + symeon (Greek flattened, already stated) | already measured and stated by `assess()` |

   A reader cannot fix class 2. It needs a cleaning pipeline (§5), and every
   cleaned text is a **new edition**, which the library's own provenance rules
   already commit us to declaring (`provenanceHtml` in `tools/build.mjs:3119`).

The order below is: architecture first (it is easy and unblocks everything),
cleaning second (it is the long pole and the actual reason the library is held
back).

---

## 1. Decision — the architecture

**One static shell page per text + fetched text "windows". No server runtime.
Section deep links by URL fragment.**

### 1.1 What is emitted

```
dist/library/index.html                    the shelf index (unchanged shape)
dist/library/<slug>/index.html             SHELL: title, provenance, division
                                           index, the app inlined  (~120 KB raw)
dist/library/<slug>/t/<n>                  WINDOWS: JSON, extensionless,
                                           one per ~≤96 KB of raw text
```

* **The shell** is a real server-rendered page in the site's `page()` chrome:
  edition, what was done to the text, measured defects, where it is cited —
  all the existing `provenanceHtml` content — plus the text's **division index**
  (every detected division with its id and title) and the reader app inlined.
* **Windows** are the fetch unit: the text's own divisions (level-2 headings —
  exactly what `partition()` in `tools/library/reader.mjs:245` already splits
  on), grouped into consecutive runs capped at ~96 KB raw, never split
  mid-paragraph. MEASURED on Plato vol 2: hierarchical division split gives a
  median division of ~2 KB, p90 ~5 KB, with a few monsters (~785 KB for a whole
  book) — hence the grouping cap and the sub-split. A whole 1.9 MB volume
  becomes ~20–25 windows of ≤96 KB raw ≈ ≤35 KB gzipped each.
* **Format**: JSON arrays of typed blocks — `[["h2","BOOK I."],["p","…"],
  ["f","124"],["rh","THE REPUBLIC"]]` — with `<` escaped to `\u003c`, exactly
  the trick the search page already uses for its inlined index
  (`tools/build.mjs:2872`). MEASURED: JSON at this shape costs ~+1% over the
  raw text (Plato vol 1: 1,642,024 B JSON vs 1,627,041 B source) and gzips to
  ~36% (598 KB for the whole 1.6 MB volume). New block *types* (`f` folio,
  `rh` running head) are how cleaning marks damage without dropping it (§5).
* **Why fetched is precedented, not novel**: `/search/deep` is already a 2.6 MB
  raw / 912 KB gz extensionless JSON file the search page fetches once and
  degrades without (`tools/search/index-deep.mjs`, prose at
  `tools/build.mjs:2944`). The library is the same move at per-text grain. The
  one-file-per-page property the README states is already broken *for data*,
  once, deliberately; this is the second, same-shaped exception. The app code
  itself stays **inlined** per page (no external scripts ever).

### 1.2 Routing and deep links

* The reader owns `/library/<slug>/` — same URL the static pages had, so
  nothing already printed rots.
* A link to a section is `/library/<slug>/#<division-id>` — the ids
  `preprocess()` already mints (`slugify`, `tools/library/reader.mjs:93`), with
  the existing `-N` dedupe. The app maps fragment → division → window → fetch →
  scroll-to-anchor. Fragment routing needs **zero** server configuration, which
  matters: the host is plain `file_server` Caddy and the repo does not own the
  Caddyfile. Path-based section URLs (`/library/<slug>/<section>/`) would need
  rewrite rules we cannot ship — rejected for that reason, not on looks.
* **Id stability is a release gate**: once a text's windows are published, the
  build records a hash of its division-id list; a later regeneration that
  changes any id FAILS the build with instructions to migrate. House rule: a
  citation a reader cannot follow is not a citation — this is that rule made
  mechanical.
* Paragraph-level citation: v1 links divisions only. Paragraph anchoring
  (`#<id>/p<N>`) is a later addition; the app highlights the paragraph when the
  fragment carries it. Not promised in phase 1.

### 1.3 What the reader does with a 2 MB treatise

It never holds one. The manifest (inlined in the shell, ~2–15 KB per text)
names every division and its window; the app fetches on demand, caches windows
for the visit, and appends the next window when the reader approaches the end
of the last rendered one. DOM stays at division scale (MEASURED: ~200–800
paragraphs per window) — that *is* the virtualisation strategy; no windowing
library needed. The TOC is a `<details>` drawer built from the manifest, so a
jump is one fetch away at all times.

### 1.4 JS off — the honest fallback

The shell is server-rendered and carries, without script: the full provenance,
the complete division index (every division named, in order, each linking to
its fragment), and **the first division of the text as real HTML**. A
`<noscript>` note says the rest is read by the page's own reader, and — phase 3,
once the cleaner produces it — links **the whole text as one plain file**,
which the cleaning pipeline emits anyway (it is the record of what was done).
That is the honest statement of the trade: without JS you get the catalogue,
the opening, the provenance, and (from phase 3) the full text as a file — but
not the reading experience. The alternative (keeping static part-pages as a
shadow layer) is the architecture this task retires, at 37.6 MB.

---

## 2. Decision — Elm, and the toolchain is real

**Yes, the app is Elm. The toolchain question is settled by proof, and the
contract with the static build is the CSS precedent copied exactly.**

### 2.1 Proof the toolchain works here (all MEASURED this session)

* `elm 0.19.2` runs: `~/fixpoint-linux/fixpointlinux.org/node_modules/.bin/elm`
  (the sibling checkout `build.sh` already documents as its last fallback).
* A `Browser.element` app with `elm/browser 1.0.2` + core/html/json/url
  **compiles offline** with `ELM_HOME=~/fx-ui/elm-compiler/.elm-cache`
  (and `elm/browser` is also present in the default `~/.elm` cache). A trivial
  app compiles to 109 KB raw.
* **The leak gate is satisfiable**: the raw `elm make` bundle trips
  `checkWorkshop`'s comment-delimiter patterns **211 times** (the Elm runtime's
  own `/*EQ*/`, `// LOG` markers). Passed through the build's existing
  `stripJsComments()` (`tools/build.mjs:1681`), the bundle is **0 hits** and
  65.8 KB. So the gate does not block Elm — but the bundle MUST go through the
  stripper, and the stripper's own safety comment ("nothing … holds a `//`
  inside a string or a regex literal") has NOT been proven for Elm's output.
  Mitigation is a smoke test, not hope: §7 phase 2 boots the *stripped* bundle
  in happy-dom and drives it. A corrupted regex would fail loudly there.
* Offline-clean-checkout story: `elm install` needs the registry once; both
  known caches are warm on this host, and `podman` + `npm i elm@0.19.2` is the
  cold path (GIVEN, verified earlier). This is exactly the situation the CSS
  flow already solved by **committing the generated artifact**.

### 2.2 Committed vs generated — copy the CSS contract

| thing | path | committed? |
|---|---|---|
| Elm sources | `elm/src/Reader.elm` (+ modules) | **yes** |
| raw compiler output | `elm/Reader.js` | **no** (gitignored, like `elm/ExtractCss.js`) |
| stripped, gate-clean bundle | `tools/library/app.js` | **yes** (like `design/blog.css`) |
| regenerator | `tools/build-reader.mjs` | yes |

`tools/build-reader.mjs` runs `elm make --optimize`, strips comments, asserts
the result is gate-clean, boots it once under happy-dom (the
`tools/extract-css.mjs` boot, reused), asserts `Elm.Reader.init` exists, and
writes `tools/library/app.js`. The default build **inlines the committed
bundle** and never needs Elm — `SKIP_CSS=1` today, `READER=1` to regenerate.
`build.sh` grows one discovery stanza mirroring the elm/happy-dom one. If a
regenerated bundle differs from the committed one, the same loud
commit-it warning the CSS drift guard prints.

### 2.3 Why Elm at all (the honest case, both ways)

* **For**: the app's centre of gravity is state + async (current window, cache,
  fragment, TOC, scroll) — The Elm Architecture's home ground; `Decode` makes
  the window format a typed contract rather than hope; the repo already
  commits to Elm as a build-time tool; and it is the author's stated
  preference, which counts.
* **Against, named**: the site's other interactive layers (search 2,171 lines,
  palette, viz engine, arrive) are all hand-rolled vanilla in one consistent
  idiom; Elm adds a ~65 KB raw / ~25 KB gz runtime inlined into each of 38
  shells (~2.5 MB dist raw, ~800 KB gz total across shells) versus maybe 6 KB
  gz of vanilla; and it is a second idiom on the site.
* **Verdict**: Elm. The runtime tax is bounded and measured, the state-heavy
  app is where Elm pays it back, and the toolchain — the actual risk — is now
  proven end-to-end including the gate. If phase 2 finds the Elm/DOM
  interaction (scroll, anchors, appending) fighting the runtime, the escape
  hatch is a vanilla rewrite of the same *window contract*; the architecture in
  §1 survives that swap untouched, which is deliberate.

---

## 3. Decision — typeset is NOT the tool for this; CSS is

`~/typeset-ref` (read in full: 467 lines TS) is a **magazine** layout engine:
`LayoutManager.layout()` first-fits whole words into polygon-derived spans
(`span.end.x - span.start.x >= item.width`, `LayoutManager.ts:120`), measuring
each word through `opentype.js` (`FontStorage.ts`). Assessment against what a
book reader needs:

| a reader needs | typeset has it? |
|---|---|
| text flowing around arbitrary polygon exclusions | **yes — its whole point** |
| quality line breaking (Knuth-Plass-ish) | **no** — greedy first-fit, no demerits, no hyphenation |
| justification, hyphenation, measure control | no |
| pagination, running heads, TOC | no |
| drop caps | only as a polygon exclusion (its demo use) |
| fonts | requires shipping font binaries for `opentype.js` to measure — the site ships **no** webfonts today (system stacks: `--serif` at `design/blog.css:24`) |

**What transfers**: not the code — the *discipline*. Its `AttributedString`
(styled runs carried with the text, not imposed by the renderer) is the right
shape for the window format's typed blocks; its measure-then-place ethic is
already how the build works. **What does not**: polygon flow (a book has no
exclusions except a drop cap, which CSS does), and `opentype.js` + embedded
fonts, which would add a real dependency, ~200–400 KB per face, and a licensing
surface the site has deliberately never opened.

**Recommendation, unhedged**: typography by the browser's own engine —
`max-width` measure (the site's `.prose` 42rem is already right), ragged right
by default with `text-wrap: pretty` where supported (rivers under browser
justification are worse than ragged edges — a typographic call, stated), a
`lang` attribute per text (`en`/`la`/`grc`/`de`/`pi`) so `hyphens: auto` can
work at all, drop caps via `initial-letter` with a float fallback at chapter
openings only, sticky running heads from the current division, and print CSS so
a citation can be printed decently. No webfonts in v1; the one honest gap is
polytonic Greek on Android (§9 open question).

---

## 4. The build-side splitter (file-level)

Extend, do not replace, `tools/library/reader.mjs`:

* **`tools/library/reader.mjs`** — gains the new *marking* transforms (§5):
  `isFolio()` (a bare-arabic block that fits the volume's monotonic pagination
  sequence — NOT any bare number, because the *Elements of Theology* really does
  number its propositions), `isRunningHead()` (a short ALL-CAPS block whose
  text already occurred within a window, or matches the volume title).
  Everything marked, nothing dropped — the module's existing promise
  ("TEXT IS NEVER DROPPED", `reader.mjs:34`) is kept by introducing block
  *types*, not deletions.
* **`tools/library/split.mjs`** (new, ~150 lines) — `windows(doc, maxBytes)`:
  takes the marked blocks, groups divisions into windows, mints/validates
  division ids, returns `{ manifest, windows }`. `partition()` is retired from
  the page path but its split-on-the-edition's-own-divisions rule is inherited
  verbatim.
* **`tools/build.mjs`** — `libraryTextPages()` becomes `libraryTextShell()`:
  emits the shell (provenance + inlined manifest + inlined `tools/library/app.js`
  + first division server-rendered + noscript) and writes windows via
  `gateSafeText()` (each window is scanned text; today that function runs only
  on page bodies, `build.mjs:3252`). Windows are added to the leak-gate scan
  list (`checkWorkshopAll`) — **and `tools/library-smoke.mjs`'s page walk must
  stop filtering to `index.html` only** (`library-smoke.mjs:110`), or the data
  files are never checked for leaks.

---

## 5. The cleaning pipeline — the harder half

Two layers, never blended:

### 5.1 Layer 1 — mechanical marks (build-time, every text, no judgement)

| transform | rule | measured scale |
|---|---|---|
| folio mark | bare-arabic block that fits a monotonically increasing page sequence → block type `f` | ~4,600 across the shelf (iamblichus 348 alone) |
| running-head mark | short ALL-CAPS block repeating an earlier block, or equal to the volume/division title → `rh` | proclus-1816: 505; plato-vol-1: 542 candidates |
| negation-sign count | `¬` counted (never altered) | proclus-1816: 2,704 |
| de-hyphenation, space collapse | **already done** by `joinLines()` | existing |
| long-s *candidates* | flagged, not fixed, at this layer | plato-vol-1: 4,662 f..t words |

Marks change *presentation*, not *text*: `f` and `rh` blocks are hidden by
default with a "show the page furniture" toggle; the transcription bytes are
untouched. Provenance text is generated from the same measured counts the
existing `measureDamage()` already computes (`build.mjs:3107`) — extended to the
new marks.

### 5.2 Layer 2 — corrections (per-text, human-approved, recorded)

An explicit **corrections file per text**: `tools/library/edits/<slug>.json` —
a list of `{ find, replace, class, note }` rules (word-level, counted at build).
The build applies them to produce the *reading* text; the reader offers two
views — **reading** (corrected) and **transcription** (verbatim) — with the
correction counts and classes shown in the provenance block. The long-s repair
lives here, not in layer 1: MEASURED, a dictionary attack on plato-vol-1
decides only ~500 of ~10,000 f-words from the text's own vocabulary alone, and
a wrong `f→s` ("five" → "sive") is exactly the silent lie the house rules ban.
Every rule is therefore reviewable, and the *pairing* evidence (the same file
contains `firft` ×215 and `first` ×211 — clean pages supply the lexicon) makes
most rules decidable mechanically and provable at review.

**The provenance promise, upgraded**: each text's page states — this is a
transcription of edition X; here are the mechanical marks (counts); here are
the corrections applied (classes, counts, each one inspectable in the reader's
diff view); nothing else was touched. A corrected text is declared **an edition
prepared for this site** — the new edition the existing prose already
acknowledges ("a corrected text is a new edition", `build.mjs:3157`).

**Rollout, cleanest first** (MEASURED zero ¬/long-s damage, folio-heads ≤ 35):
plotinus-select-works-1895, plotinus-five-books-1794, marcus-aurelius-1890,
lucretius-1916, theologia-germanica-1854, porphyry-cave-1917. The two flattened
Greek volumes and the Orphic 1827 stay stated gaps, unchanged.

Footnote separation (Mead/Goodwin's numbered notes) is detected and *marked*
only — a paragraph opening with a note number becomes a `fn` block rendered
smaller, never relocated. Real separation is a later phase; pretending inline
footnotes are body prose is the current defect and the mark fixes the worst of
it.

---

## 6. Sizing and performance budgets

| metric | today (GIVEN/measured) | target | how |
|---|---|---|---|
| bytes on first load of a text | 1.88 MiB (worst page, inlined) | **≤ 150 KB gz total** (shell ~40 KB gz incl. app ~25 KB gz + first window ~35 KB gz) | shell + one fetch |
| time to first text | one huge document parse | 2 round-trips, render after the first window | shell is server-rendered prose + app |
| bytes per subsequent window | n/a | ≤ 35 KB gz (96 KB raw cap) | window cap |
| largest single file under /library | 1.88 MiB | shell ≤ ~150 KB raw; windows ≤ 96 KB raw | enforced by splitter, asserted in smoke |
| dist/library total | 37.6 MB | ~38 MB raw (≈13 MB on-wire gz) — **unchanged in total, transformed in shape** | the point is per-load bytes, not dist bytes; dist is rsynced once and served compressed by Caddy (`encode gzip zstd`, GIVEN) |
| DOM at any moment | whole book | ≤ ~800 paragraphs | window-grain rendering |

The smoke test keeps a budget assertion (it already asserts no page > 2 MB,
`library-smoke.mjs` end) — retargeted at shells and windows.

---

## 7. Phases — smallest useful first, each independently testable

**Phase 1 — the splitter and the windows (no reader yet).**
`split.mjs`, `gateSafeText` on windows, windows in the leak scan, smoke
rework: recompute `preprocess()` over each shelf file here (as the smoke
already does) and assert every paragraph lands in exactly one window, sums
match per text, no window exceeds the cap, id lists are hashed and recorded.
*Proof*: `LIBRARY=1 SKIP_CSS=1 ./build.sh && node tools/library-smoke.mjs`
green with the new assertions; `du` of dist/library reported. Shells at this
phase may still render the old inline form — the two phases are separable.

**Phase 2 — the reader app and the shell.**
`elm/src/Reader.elm` + `tools/build-reader.mjs` (compile, strip, gate-assert,
happy-dom boot-assert, write committed `tools/library/app.js`); shell rewrite
(provenance + division index + first division + noscript); fragment routing,
window fetch/cache/append, TOC drawer. A new **app smoke** (happy-dom, the
viz-smoke shape): boot the stripped bundle, drive it at a real shell, assert a
deep link resolves its division and renders its paragraphs, assert the append
path fetches the next window. *Proof*: that smoke green; leak gate green on all
38 shells; a manual `tools/viz-shots.sh`-style screenshot pass (the harness
lesson of continuity §51 applies: size the window to the content).

**Phase 3 — cleaning layer 1 (marks) + the two views.**
Folios and running heads marked and hidden-by-default, toggle in the reader,
provenance generated from measured counts. *Proof*: unit tests per transform
**proved by asymmetry** (a fixture page with known folios fails before, passes
after); smoke asserts the marks are present in windows and absent from the
rendered default; visual check that iamblichus' TOC no longer lists 348 page
numbers.

**Phase 4 — corrections, cleanest six texts.**
The edits file format, the reader's reading/transcription toggle and diff
pane, provenance upgrade, id-stability gate switched on for published texts.
*Proof*: for each of the six, a build-time report of every rule's hit count
(zero-hit rules are errors — a rule that matches nothing is unreviewed
machinery); a human reads the diff view end to end; the provenance block
states the classes and counts.

**Phase 5 — typography and flip-on.**
`text-wrap: pretty`, per-text `lang` + `hyphens`, drop caps at level-2 division
openings, sticky running heads, print CSS, the whole-text plain file per
cleaned text (falls out of the cleaner; doubles as the JS-off/CLI citation of
record), `LIBRARY=1` becomes the default (the switch inverts to `LIBRARY=0`),
readings' notes begin citing `/library/<slug>/#<id>`. *Proof*: full build +
all three smokes green; deployed and verified on the live host; a reading's
citation followed by hand through the deep link.

Later, explicitly not scheduled: folding library windows into `/search/deep`;
Greek webfont subsets (§9); paragraph-anchored citations; footnote relocation.

---

## 8. Risks — including the ones that could make this not worth doing

1. **The cleaning is the long pole and it is human-sized.** 38 texts at
   layered review is weeks. The reader alone would dress up noise — the
   author's own verdict. Mitigation: phases 1–2 ship the *capability*, phase 4
   ships *readability* for six texts and only those six get flipped on; a
   beautiful reader over unclean text is a failure state the plan refuses.
2. **`stripJsComments` on Elm output is unproven for regex/string literals.**
   The `[^:]` guard protects `://` only. Mitigation is the happy-dom boot in
   `build-reader.mjs` (corruption fails loudly at build, never in a browser).
   If Elm's output cannot be made strip-safe, the fallback is a tiny
   hand-written wrapper that loads the bundle from a `data:`-adjacent inline —
   or the vanilla escape hatch (§2.3).
3. **Folio/running-head heuristics can eat real structure** — the *Elements*
   numbers its propositions; a bare `72.` there is a division, not a page
   number. The monotonic-sequence rule is the guard; the smoke test carries a
   fixture of the *Elements* region asserting its proposition numbers survive.
4. **Id drift rots citations.** Handled by the id-hash gate (§1.2) — but it
   must be in place *before* the first reading cites a section, or it locks in
   whatever phase 2 minted.
5. **Elm runtime × 38 shells** is ~2.5 MB raw dist and ~25 KB gz per visit.
   Bounded, measured, accepted (§2.3). The vanilla escape hatch keeps the
   window contract intact if this is later judged wrong.
6. **Fragment URLs are invisible to sitemaps/crawlers.** Acceptable: shells
   carry title + provenance and are sitemap-listed; sections are for readers,
   which is the stated purpose. If section-indexing ever matters, the plain
   per-text file (phase 5) carries the full text for crawlers.
7. **The shelf is not in the repo** (`~/thework/work-text`, `SHELF` env) — the
   build only runs where the shelf is. Unchanged by this plan, but phase 4's
   edits files being *in* the repo makes the corrected reading text partially
   repo-reconstructible, which quietly reduces the fragility.

## 9. Open questions — with what would settle each

* **Continuous append vs bookish next/prev**: plan assumes append-on-proximity
   + TOC jumps. Settle by building phase 2 both ways behind a reader setting
   and reading it for a sitting; cost is small because both are views over the
   same window cache.
* **Greek webfont**: polytonic Greek on Android's default serif is poor, and
   the Cousin/Migne volumes are the site's hardest texts. A subset OFL font
   (Noto Serif polytonic slice), self-hosted, fetched only for `grc` texts,
   would fix it — but it opens the site's first font dependency. Settle by a
   screenshot pass on Android-class hardware in phase 5; only ship if the
   system rendering actually fails.
* **Per-paragraph citation anchors**: needed once a reading wants to point at
   a sentence. Settle when the first such citation is written; the fragment
   grammar reserves room for it.
* **Whether the plain-text export (§1.4/phase 5) should exist for all texts or
   only cleaned ones**: it is the honest JS-off answer but adds ~13 MB gz of
   fetchable weight (dist, not per-load). Settle by whether anyone ever cites
   from a terminal; default in this plan: cleaned texts only.

## 10. What this plan deliberately does not do

No service worker, no offline book cache, no reader accounts, no annotations,
no pagination-as-book-pages, no webfonts (v1), no port of `~/typeset-ref`, no
new server dependencies of any kind. The library stays what it is — a shelf of
stated editions — with a reader that finally makes the statement checkable at
the passage level.
