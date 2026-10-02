# The library reader, full-featured — a plan for ONE text, done properly

Status: PLAN (nothing implemented). Written for `HANDOFF=reader-plan2`.
**Supersedes `plans/library-reader.md`** (that file keeps its findings; its
scope — shell page + fetched windows + typography by CSS and nothing else — is
discarded, by the author's verdict: *"no table of contents generation? chapters
and page numbers? just chunking up cleaned up text is still WAY too basic… the
LIBRARY needs to be a real, full featured thing."*)

The text: **Porphyry, *On the Cave of the Nymphs*, trans. Thomas Taylor
(John M. Watkins, 1917)** — archive.org item `onthecaveoftheny00porpuoft`,
shelf file `Porphyry-On-the-Cave-of-the-Nymphs-Taylor-1917.txt`. One short
treatise. The whole machinery — re-extraction, TOC, pagination, citation,
notes, search, position, print — is proven on this book end to end. At each
decision the plan says what is specific to this text and what generalises.
The other 37 shelf texts are **not** surveyed and not designed for.

---

## 0. Why the first plan was too small, precisely

The first plan optimised the *delivery* of cleaned text (windows, byte
budgets) and treated the book itself as an undifferentiated stream of
paragraphs. But a scanned printed edition is a **structured object**: it has
printed pages with numbers, divisions with numbers, notes attached to
passages, and page furniture. The `_djvu.txt` derivative throws that structure
away; the first plan inherited the loss and then decorated it. The finding
that changes the scope (GIVEN in the brief, re-verified as far as this host
currently allows — see §1.2): the archive.org item carries
`_djvu.xml` (per-page, per-word, with bounding boxes) and
`_page_numbers.json` (leafNum → printed pageNumber), so **the printed
pagination and the page boundaries are recoverable**, and with them:
real page numbers, citation by printed page ("Taylor 1917, p. 15" — how
scholarship actually cites), a real TOC with page numbers, and mechanical
note linking. None of that was in the first plan. This plan is built around
it.

**What survives from the first plan** (findings, not scope): the Elm decision
and its proven toolchain (§9); the typeset verdict (§10, re-argued at this
scope); the two-layer cleaning design and its honesty rules (§7); the
committed-artifact build contract; the id-stability gate; the smoke-walk bug
(`tools/library-smoke.mjs:104-110,208-211` walks `index.html` only —
MEASURED, still true); the cleanest-six rollout list (irrelevant here but kept
on record).

---

## 1. The evidence, and its two tiers

Everything below was measured on this host in this session unless marked
GIVEN (from the brief / the prior session, not re-derivable now — see §1.2).

### 1.1 The text, measured on the shelf file (`~/thework/work-text/…1917.txt`)

78,072 bytes, 1,988 lines, ~11,563 words, 319 blank-line blocks. Anatomy:

| region | extent (measured) | content |
|---|---|---|
| front matter | ~0.4 KB | library stamp `PA 4397 E5 08 1917`, half-title, title page — whose OCR reads *"From the Greeh of Porphyry"* (the reading `content/porphyry-cave-of-the-nymphs.md` itself cites this defect) |
| **body** | **52.0 KB** | **18 numbered sections**; §1 = `I  i.` (OCR of "1."), §2 opener mangled (`2. Thp_anrt'p'rii'c:…`), §3 = `'3.` (stray quote), §11 mangled as `n.^Tb,eologists` mid-line; 15 of 18 match `^\d{1,2}\.\s` raw |
| **Notes** | **24.0 KB** | **25 endnotes**, markers `(1)`…`(25)`; note 11's marker OCR'd as `(n)`; note (6) quotes Martianus Capella **in Latin** |
| advertisements | ~2.1 KB | the Watkins catalogue; then the Toronto library pocket |

- **Running heads carry the printed page numbers inline**: verso `6  ON  THE  CAVE  OF  THE  NYMPHS`, recto `ON  THE  CAVE  OF  THE  NYMPHS     7`. **49 pages recoverable from the .txt alone**, consecutive 6–57 with gaps at 22, 42–43, 48; plus body-start bare `5`. OCR digit confusions measured: `io`=10, `II`=11.
- **Every note reference is explicit**: all 25 are `(note N)` in the body (note 1 = `(note  i)`). Note linking for this text is fully mechanical — no superscript reconstruction needed.
- **No Greek at all**: 0 Greek-range characters; one Latin transliteration (`morphe`). A Greek font decision is not needed for THIS text (§6).
- **Damage census**: 0 `¬`, 0 long-s `ſ` (clean alphabet — the 1917 is a cheap modern-facing reissue), but **88 distinct damaged words** in the body (`^`, `_`, `#ip gatps-o£` = "the gates of", `was_  sacred  to  soulis`), concentrated in a few badly-scanned leaves (pp. 28–31). 25 line-end hyphenations.
- Verse: ~20 quoted blocks (the Odyssey quotation opens §1), detectable by leading `"` and line length.
- Section sizes: mean ~2.9 KB, max ~6.8 KB (§1, includes the verse). The whole book is 78 KB raw.

### 1.2 The archive.org derivatives — GIVEN, and currently unverifiable

The brief's inventory (measured last session on this very item):
`_djvu.xml` 930 KB with **72 `<OBJECT>` page elements** carrying per-word
`<WORD>` bounding boxes; `_page_numbers.json` 12 KB, **`pages[]` mapping
leafNum → pageNumber** (leaf 13 → "7", leaf 15 → "9" conf 90, leaf 25 → "19"
conf 61; **51 of 72 leaves numbered, consecutive**); `_jp2.zip` 58 MB /
`_jpg.zip` 21 MB page images.

**This session, archive.org is unreachable from this host** — MEASURED:
connection reset / timeout on every archive.org and web.archive.org endpoint,
from this host and two others on different routes, over several minutes;
general egress works (github.com 200). Almost certainly IP-throttled from the
prior session's shelf survey or an IA-side outage. Consequences, stated
plainly:

- The djvu.xml/page_numbers **schema and counts above are GIVEN, not
  re-verified**. Phase 4 (§11) begins by downloading both files and asserting
  the inventory (72 objects; 51 numbered leaves) before anything is built on
  it.
- The plan does not wait on IA: **phases 1–3 run entirely from the shelf
  `.txt`**, whose running heads alone recover 49 of ~57 printed pages
  (§4.2). The re-extraction then *replaces* the txt-mode page model with the
  three-signal reconciliation, and any mismatch is reported, not merged
  silently.

### 1.3 The host, measured

- The library is **built but not published**: `LIBRARY=1` switch
  (`tools/build.mjs:88`), dist/library absent (the last commit is literally
  "hold the library back until the texts are worth reading"). The reader
  inherits that gate; publication becomes **per-text** (§11 phase 5).
- The fetched-static-file precedent is real and large: `dist/search/deep` is
  2,585,916 B raw / **922,888 B gz** MEASURED just now, written through
  `writeFile` so the leak gate scans it (`build.mjs:4281-4298`).
- Caddy on the deploy target (node-infra, `/srv/www/jaye-ch`, 24 MB):
  **`encode gzip zstd` confirmed live** in the Caddyfile.
- Elm 0.19.2 present at `~/fixpoint-linux/fixpointlinux.org/node_modules/.bin/elm`
  (verified this session); happy-dom alongside; `tools/extract-css.mjs` is the
  boot-harness template.
- The reading that cites this text (329 lines) cites it **by section and
  printing** ("Porphyry, section 1; Taylor's translation, 1917 printing") —
  the anchor grammar must make section-level links trivial and page-level
  links possible.

---

## 2. Which blog rules still bind the library, and why

The blog's minimalism is a rule for the blog. For the library:

| rule | binds? | reason |
|---|---|---|
| no external requests (self-contained pages) | **binds** | privacy of the reader; the reader fetches same-origin only; any future font is self-hosted |
| the workshop leak gate | **binds** | the document file and the app bundle pass through `checkWorkshopAll` like every other emitted file |
| honesty/provenance on every page | **binds, upgraded** | a generated TOC is declared as generated; interpolated page numbers are marked; corrections are counted and inspectable (§7) |
| one self-contained HTML file per page | **does not bind** | `/search/deep` already broke it once, deliberately, for data (MEASURED 912 KB gz on the wire). The library reader is the same move |
| no webfonts | **does not bind** | typography minimalism is a blog-scoped choice; this text needs no font anyway (0 Greek glyphs MEASURED). If a later Greek text needs one, it is a self-hosted OFL subset, declared in provenance |
| no page images / facsimile | **binds by author's decision** | `_jp2.zip`/`_jpg.zip` are never downloaded, stored, or served |

---

## 3. Architecture — one static shell, one fetched document, no server

```
dist/library/<slug>/index.html     SHELL: page() chrome, provenance, the full
                                   TOC as real <noscript>-visible HTML, §1
                                   server-rendered, app inlined
dist/library/<slug>/t              THE BOOK: one extensionless JSON document —
                                   typed blocks + page model + TOC + corrections
dist/library/<slug>/plain          the whole text as one plain file (JS-off and
                                   the citation of record)
```

- **One fetch, whole book.** At 78 KB raw the windowing machinery of the
  first plan is unnecessary *for this text*: the document is ~100 KB raw /
  ~35 KB gz and the DOM is ~350 prose nodes — fine without virtualisation.
  Generalisation: the block schema is already window-compatible (plan 1's
  finding on division sizes stands), and if a later text exceeds a cap
  (~256 KB raw), the same schema splits at division boundaries exactly as
  that plan specified. The app implements "fetch the manifest's documents in
  order" from day one (N=1 here), so the second text is additive, not a
  rewrite.
- **URL contract unchanged**: `/library/<slug>/` (nothing already printed
  rots). Fragments, not paths (the repo does not own the Caddyfile):
  - `#s<n>` section anchor (s1…s18, plus `#snotes`, `#sfront`) — the stable
    citation unit, matching how the reading already cites ("section 4");
  - `#p<n>` printed-page anchor (p5…p~58) — "Taylor 1917, p. 15" resolves;
  - `#n<n>` / `#r<n>` note and its return reference;
  - `#s4-3` paragraph within section (grammar reserved, rendered when a
    reading first needs it — plan 1's reservation stands).
- **Id stability is a release gate**: the build hashes the anchor list
  (sections, pages, notes) per text into a committed manifest; a
  regeneration that changes any anchor FAILS with migration instructions.
  Must be in place before the first reading links `#s1`.
- **JS off**: the shell carries provenance + the complete TOC (every section,
  its first printed page, the notes) as real HTML, §1 rendered, and a link to
  `/plain`. That is the honest floor; the reading experience is the app's.
- **No service worker, no accounts, no annotations store** (unchanged from
  plan 1; the whole book is one cacheable fetch, so offline is nearly free
  already).

---

## 4. The document model and the extraction pipeline

New `tools/library/extract.mjs` (build-time, ~300 lines) produces the
document JSON from the shelf sources. Two source modes:

### 4.1 Document model (served, `/t`)

```jsonc
{
  "slug": "porphyry-on-the-cave-of-the-nymphs-taylor-1917",
  "lang": "en",
  "source": { "item": "onthecaveoftheny00porpuoft", "sha256": {…} },  // provenance
  "pages": [ { "leaf": 11, "page": 5 }, … ],   // leaf: null in txt-mode; page: null = unnumbered, honestly
  "toc":   [ { "id": "s1", "n": 1, "title": "What does Homer obscurely signify…", "page": 5 }, … ],
  "blocks": [
    { "t": "region", "kind": "front" },
    { "t": "sec", "n": 1, "id": "s1", "page": 5 },
    { "t": "p",  "x": "…verbatim OCR…" },
    { "t": "verse", "x": "…" },
    { "t": "ref", "n": 1 },                     // (note 1) — rendered as superscript link
    { "t": "pb", "page": 6, "how": "head|interpolated|leaf" },
    { "t": "rh", "x": "…running head…" },       // suppressed furniture, kept in file
    { "t": "notedef", "n": 6, "lang": "la", "x": "…" },
    { "t": "region", "kind": "ads" }
  ],
  "corrections": [ { "find": "…", "repl": "…", "cls": "ocr|opener|digit", "note": "…" } ]
}
```

Two properties worth stating: **the served blocks are the verbatim
transcription** (nothing dropped — `assertShape`'s promise from
`tools/library/reader.mjs:34` carries over, now per-block); and **corrections
travel as rules, not as a second text** — the client applies them to render
the reading view, so the diff view is the rule list itself and the
transcription is always inspectable (§7).

### 4.2 Pagination — three signals, reconciled

1. **`page_numbers.json`** (primary, phase 4): 51 of 72 leaves carry a
   detected printed number (GIVEN). Leaf→page offset is constant where
   numbered (leaf 13→7, 15→9 ⇒ offset 6).
2. **`_djvu.xml` leaf boundaries** (phase 4): every block knows its leaf;
   page breaks are structural, not inferred.
3. **Running heads in the text itself** (available NOW): 49 pages measured
   from the `.txt`; in phase 4 the same rule runs per-leaf on the djvu text
   and should yield ~57.

**Reconciliation rule (testable, failure modes stated):**
- Normalise OCR digit confusions first (`io`→10, `II`→11, `i`/`l`→1, `o`→0,
  `S`→5) — the measured confusions in this item; a normalised candidate is
  accepted only if it preserves the ±1 stride with its neighbours.
- A leaf between two numbered leaves one stride apart gets `prev+1`
  (interpolated, `how: "interpolated"`, shown in a lighter UI weight and
  excluded from "detected" counts in provenance).
- **Refuse** (emit `page: null`, UI shows "leaf 43" — never a fabricated
  number) when: the leaf sequence itself jumps (removed blanks), two signals
  disagree after normalisation, or the stride would exceed 1. A refusal is a
  finding for the corrections file, not an obstacle.
- Bare folio blocks (`5`, `43`) and running-head numbers are consumed by the
  pagination pass **before** heading detection runs — this ordering is what
  structurally kills the folio-as-heading defect that
  `detectHeading`/`isHeading` (`tools/library/reader.mjs:73`) suffers from
  (iamblichus: 348 of 522 headings are folios). A number at a page head is a
  folio by construction, never a heading.

### 4.3 TOC — generated from the edition's own divisions

The 1917 print has **no contents page** (MEASURED: nothing between the title
page and §1) — so the TOC is generated apparatus and provenance says so.

- **Candidates**: section openers `^(\d{1,2})\.\s` at paragraph start (15/18
  raw); `Notes` as a division; region marks for front matter and ads. For
  generalisation keep the keyword rule (`CHAPTER|BOOK|…`, `reader.mjs:45`)
  and roman numerals — this text simply has none.
- **Repair before detection**: the 3 mangled openers (§1 `I  i.`, §3 `'3.`,
  §11 `n.^Tb,eologists`) are fixed by corrections of class `opener`; after
  corrections the detector must find **18 consecutive sections, no gaps, no
  duplicates** — anything else fails the build and names the offender. A
  bad guess is caught by the arithmetic, not by taste.
- **Titles**: the section's opening words verbatim, capped at ~8 words at a
  punctuation boundary, ellipsised. The print's division is the NUMBER; the
  title is honestly derived and displayed as such ("1 · What does Homer
  obscurely signify…").
- **Page numbers in the TOC**: each section's first `pb` anchor — a real book
  TOC has them, and we have them.
- **Presentation**: a drawer (left overlay on small screens, sidebar column
  on wide), always one tap away; current section highlighted; jump = fetch
  (already loaded) + scroll-to-anchor.

### 4.4 Notes

- Detection: note definitions = `(N)` at paragraph start in the notes region;
  references = `(note N)` inline (all 25 measured explicit). The marker
  sequence must be 1…N consecutive; a gap plus a stray marker (`(n)` at
  position 11) is resolved by **sequence fitting** — the measured case, and a
  testable rule.
- Presentation, all three: superscript reference links; **popover on
  click/tap** (the notes are short); **margin notes on wide viewports** (pure
  CSS — a floated margin column; no layout engine needed); the **endnote list
  at the back**, as the print has it, with back-references.
- Cross-page survival: notes attach to `section + paragraph` anchors, never
  to page anchors, so a note and its reference on different pages (measured:
  note (6) spans pp. 43–44) costs nothing. The note list carries its own
  `#p` markers so a citation can point at a note's printed page.
- `lang` per block: note (6) is Latin → `lang="la"` on that block (§6).

### 4.5 Regions

Front matter (stamp, half-title, title page), body, notes, advertisements.
Boundary rules: body starts at §1's opener; notes at the `Notes` division;
ads at the Watkins catalogue head (the last `FROM THE GREEK OF PORPHYRY`
block after the notes). Ads and front matter are **served but marked**
(`region` blocks), excluded from search hits, TOC page-counting, and the
reading position baseline. The library stamp is not text at all.

### 4.6 Phase 4: re-extraction from `_djvu.xml` + `_page_numbers.json`

When IA is reachable: download both (930 KB + 12 KB once), pin sha256s, parse
per-leaf text in reading order (assert monotonic line y-coordinates; the
djvu.xml is normally emitted in order — verify on arrival), rebuild the page
model leaf-accurate, and re-derive every region/section/note decision on the
leaf-anchored text. **Word boxes are kept for two jobs only**: validating
that a `pb` marker lands at a real leaf boundary, and (later, optional)
highlighting a located search range — they are **not** served (the document
would balloon from ~100 KB to ~1 MB) and no page image is ever fetched
(author's decision; the 58 MB jp2 and 21 MB jpg zips are refused). Then:
**diff the phase-4 document against the phase-1 txt-mode document and explain
every difference** — a mismatch is a finding about one of the two sources,
reported, never silently merged.

---

## 5. The feature set — what it needs, costs, and what proves it

| feature | needs (source → extraction) | costs | what proves it works |
|---|---|---|---|
| **TOC** (drawer, jump, page numbers) | section openers + 3 opener-corrections + region marks (§4.3) | extractor rules + ~1 h human on the corrections file | build asserts 18 consecutive sections, distinct titles, stable ids; drawer jump resolves every anchor |
| **Page numbers + jump-to-page** | running heads now; + `page_numbers.json`/djvu leaves in phase 4 (§4.2) | reconciliation ~80 lines + UI | the 3-signal agreement table prints at build; `#p15` exists; jump lands on the page; refusals visible as "leaf N" |
| **Citation by printed page & section** | anchors `#p`/`#s` + stability hash | fragment grammar + gate | a copied citation resolves after a rebuild; hash gate blocks anchor drift |
| **Notes** (popover + margin + endnotes, back-refs) | `(note N)` refs — all 25 mechanical (MEASURED) | link rules + popover UI | 25/25 refs resolve both ways; sequence-fitting fixes `(n)`→11; note (6) carries `lang="la"` |
| **Within-text search** | the fetched document, in memory (11.5k words) | runtime tokenizer, ~0 bytes shipped | query "Mithra" returns the same occurrence count `rg -i mithra` reports on the shelf file |
| **Reading position / resume** | localStorage keyed by slug | ~40 lines + ports | reload resumes at the same block anchor |
| **Bookmarks** | localStorage; anchor + printed page + timestamp | small UI | a bookmark survives reload and resolves after rebuild |
| **Next/prev at grains** | section index (18) + page index (~57) | keys (`←/→` page, `⇧←/→` section) + buttons | boundary behaviour correct at §1-back and ads-end |
| **Progress** | blocks-read / total (regions excluded) | a meter in the drawer | finishing the notes reads 100 %, not 90 % (ads excluded by the region marks) |
| **Reading/transcription two views + diff** | verbatim blocks + corrections-as-rules (§7) | rule format + client-side apply | every rule reports ≥1 hit at build (zero-hit = error); diff view shows exactly those hits |
| **Print a page / a range** | print CSS over the in-memory document | ~100 lines CSS + a range pane | print preview shows page numbers in the margin, notes as endnotes, no app chrome |
| **Export a citation** | anchor + edition metadata (already in `shelf.mjs`) | a "cite this passage" affordance | yields "Porphyry, *On the Cave of the Nymphs*, trans. Thomas Taylor (London: John M. Watkins, 1917), p. 15" + `…/#p15` |
| **Greek/Latin rendering** | per-block `lang`; 0 Greek glyphs here (MEASURED) | extractor lang detect | `lang="la"` on note (6); no font shipped, none needed |
| **Keyboard + a11y** | focus management in Elm | standard | drawer, popovers, jumps all reachable and labelled |

Named in full (feature 8 of the brief): keyboard navigation; focus/ARIA on
the drawer and popovers; the plain-text export (doubles as the JS-off
fallback and the citation of record); persisted reader preferences (measure,
text size) — all small, all in phase 2/5.

---

## 6. Greek, Latin, and fonts — decided for this text

- This text: **no Greek glyphs; one Latin quotation** (note 6). Per-block
  `lang` from the extractor (`en` default, `la` on that note) so `hyphens:
  auto` and screen readers can work. **No font is shipped.**
- The general decision the brief asks for: the reader's schema carries `lang`
  per block and an optional per-text self-hosted font declaration. If a later
  Greek text (Migne) needs polytonic coverage beyond platform serifs, ship a
  self-hosted OFL subset (Noto Serif polytonic slice) for that text only,
  declared in provenance. That keeps the one blog rule that genuinely binds
  (no external requests) while dropping the one that doesn't (no webfonts).
  Settled per text by a rendering check, not in advance.

---

## 7. The cleaning pipeline — unchanged in importance

**A full-featured reader over unclean text is still a failure state.** The
first plan's two layers stand, applied here:

- **Layer 1, mechanical marks** (build-time, no judgement): running heads →
  `rh` blocks; bare folios → consumed by pagination; hyphenation/space
  joining (already in `joinLines`, `tools/library/reader.mjs:102`); damage
  counting (`^`/`_` census: 88 distinct damaged words MEASURED). Marks change
  presentation, never bytes.
- **Layer 2, recorded corrections** (`tools/library/edits/<slug>.json`,
  `{find, replace, class, note}`, human-approved): for THIS text the work is
  bounded and enumerable — 3 opener repairs, the digit-normalisation set, and
  ~88 damaged words concentrated on pp. 28–31. Estimate ~1–2 focused hours.
  Rules ship inside the document; the client applies them for the reading
  view; **every rule must hit ≥1 times at build or the build fails** (a rule
  that matches nothing is unreviewed machinery).
- **The corrections policy has one measured exception worth writing down**:
  the title page's *"From the Greeh of Porphyry"* is cited as evidence by the
  reading itself — the transcription view preserves it by construction, and
  no correction touches the front-matter region.
- **Provenance, upgraded**: this is a transcription of edition X; the
  pagination was recovered from N detected + M interpolated signals; the TOC
  is generated (the print has none); 25/25 notes linked; here are the
  correction classes and counts, each inspectable in the diff view; the
  advertisements are the publisher's, marked and excluded from search.

---

## 8. Assets and size budgets (measured where possible)

| thing | size | where it lives |
|---|---|---|
| `_djvu.xml` + `_page_numbers.json` | 942 KB, downloaded once | **beside the shelf** (`~/thework/work-derivs/<id>/…`), NOT in the repo; sha256-pinned by the fetch script |
| page images | **refused** (58 MB + 21 MB) | never downloaded |
| extractor + app + smoke code | ~1,500 lines total | in the repo |
| `edits/<slug>.json` | ~15–20 KB | in the repo (makes the reading view repo-reconstructible) |
| anchor-stability manifest | ~1 KB | in the repo, committed by the build |
| `/t` document (served) | ~100 KB raw / **~35 KB gz** est. (36 % ratio MEASURED on comparable JSON in plan 1) | dist, static, Caddy gzips |
| shell + inlined app (served) | ~45–55 KB gz est. (app ~25–35 KB gz; trivial-app baseline 65.8 KB raw→25 KB gz MEASURED in plan 1) | dist |
| **first load, whole book** | **≤ 90 KB gz target** (vs 1.88 MB worst inline today) | — |
| marginal cost of any later page/section/note/search/jump | **0 fetches** — the book is in memory | — |
| DOM steady state | ~350 prose nodes | no virtualisation needed |

Budgets are enforced in the smoke test (as today's 2 MB page assertion is):
shell and `/t` each under their cap, `/t` gate-scanned via `writeFile`
(automatic, `build.mjs:4281`), and **the smoke walk widened beyond
`index.html`** (`tools/library-smoke.mjs:104-110,208-211` — MEASURED bug,
kept finding).

---

## 9. Elm — the decision stands, the contract is the CSS one

Same verdict as plan 1, now with more state to justify it (drawer, popovers,
position, search, corrections-apply, print range — all The Elm Architecture's
home ground). Toolchain proven on this host (elm 0.19.2 verified present this
session; offline compile via `ELM_HOME=~/fx-ui/elm-compiler/.elm-cache`;
`stripJsComments` takes the raw bundle from 211 gate hits to 0, MEASURED in
plan 1).

| thing | path | committed? |
|---|---|---|
| Elm sources | `elm/src/Reader.elm` + modules | **yes** |
| raw compiler output | `elm/Reader.js` | no (gitignored) |
| stripped, gate-clean bundle | `tools/library/app.js` | **yes** (the `design/blog.css` contract) |
| regenerator | `tools/build-reader.mjs` (make → strip → gate-assert → happy-dom boot-assert → write) | yes |

The default build inlines the committed bundle and needs no Elm; `READER=1`
regenerates and warns on drift (the CSS flow exactly). The unresolved risk
from plan 1 — `stripJsComments` unproven on Elm regex/string literals — is
met by the happy-dom boot inside the regenerator: corruption fails the build,
never a browser. Vanilla escape hatch: the document contract (§4.1) survives
an app rewrite untouched, deliberately.

## 10. typeset — re-argued at this scope, same verdict

`~/typeset-ref` is a polygon-exclusion magazine flow (greedy first-fit, word
measures via `opentype.js`, no hyphenation, no pagination, no running heads).
The full-feature list adds three candidate roles: **facsimile
text-over-image** (refused — no images are served), **drop caps**
(`initial-letter` + float fallback does it in CSS), **margin notes** (a
floated margin column does it in CSS). None needs polygon exclusion or
shipped font binaries. **Not ported.** What transfers, unchanged from plan 1,
is the `AttributedString` discipline — styled runs carried with the text —
which is exactly the typed-blocks + corrections-as-rules shape of §4.1.

## 11. Phases — each independently testable, smallest useful first

**Phase 0 — the IA gate (minutes).** Try the download; on success assert the
GIVEN inventory (72 objects, 51 numbered leaves) and proceed straight to
phase 4 tooling order if convenient. On failure (today's measured state),
record it and run phases 1–3 in txt-mode. *Proof*: inventory assertion output
or the recorded refusal.

**Phase 1 — the extractor, txt-mode (the document, no reader).**
`tools/library/extract.mjs`: blocks + regions + running-head pagination (49
pages) + TOC (18 sections after the 3 opener corrections are drafted) + notes
linked (25) + corrections format + provenance counts. Emit `/t`, `/plain`,
the anchor manifest. *Proof*: `LIBRARY=1 ./build.sh` green with the document
written and gate-scanned; a new extractor-smoke asserting — recomputed from
the shelf file, never from the build's report — that every source block lands
in exactly one output block or region, 18 consecutive sections, 25 note defs
each referenced, page sequence monotone with refusals only where the rule
says refuse, no anchor drift vs the committed manifest.

**Phase 2 — the reader app and the shell.** `elm/src/Reader.elm`,
`tools/build-reader.mjs`, shell rewrite (provenance + full TOC + §1
server-rendered + noscript + `/plain` link). Fetch, render both views,
drawer, page markers, jump-to-page, note popovers/margin/endnotes,
search-in-text, position/bookmarks/progress, next/prev, fragments
(`#s/#p/#n/#r`), print CSS. *Proof*: happy-dom app smoke — boot the stripped
bundle, `#s4` resolves, `#p15` resolves, a note ref opens and returns,
jump-to-page lands, resume restores; leak gate green; library-smoke walk
widened to `/t` and `/plain`; one manual screenshot pass.

**Phase 3 — corrections for THIS text, both views honest.** The full edits
file (88 damaged words + 3 openers + digit set), reading/transcription
toggle, diff view from the rule list, provenance upgrade with measured
counts. *Proof*: every rule hits ≥1 (build fails otherwise); a human reads
the diff end to end (~1–2 h); provenance states classes and counts.

**Phase 4 — re-extraction from djvu.xml + page_numbers.json** (IA
permitting): leaf-accurate pages, three-signal reconciliation, word-box
validation of `pb` placement, verse detection from coordinates, everything
re-derived; then the explained diff against txt-mode output. *Proof*:
agreement table (detected/interpolated/refused per page); every txt-vs-djvu
difference accounted for in the build log; anchors unchanged (the stability
gate must hold across the source swap — if they can't, that is a finding
about the anchor grammar, surfaced then).

**Phase 5 — citation, print, publication.** "Cite this passage", range
print, `/plain` linked from provenance, the reading's notes gain real
`/library/<slug>/#s…` links (its section citations are already written that
way in prose), and a **per-text `published` field** (the honest replacement
for the global `LIBRARY=1` switch: this text flips on when phases 1–4 are
green; the shelf's held-back state is unchanged for the rest). *Proof*: a
citation copied from the app resolves on the deployed host; print preview
inspected; the reading's link followed by hand.

Not scheduled: the second text (cheap once the shape is proven — the
generalisations are marked throughout); folding library text into
`/search/deep`; Greek webfonts (per-text, §6); paragraph anchors (reserved).

---

## 12. Risks

1. **IA unreachability is the live blocker on phase 4** (MEASURED this
   session, all endpoints, three hosts). Mitigated: phases 1–3 are txt-native
   and the running-head pagination is measured working; phase 4 is gated and
   swappable. If IA never clears from this IP, the download happens from
   another connection once — the derivatives are then pinned and local.
2. **Load-bearing OCR damage** (3 section openers, 88 words, `(n)` note
   marker, `io/II` digits) — every instance is enumerated and each has a
   rule; the arithmetic assertions (18 consecutive, 1…25 consecutive) catch
   what the eye misses.
3. **Interpolated pages can be quietly wrong** if a leaf was skipped in
   scanning. Mitigated by refusing on leaf-sequence breaks and marking
   interpolations in the UI and provenance; the word boxes validate `pb`
   placement in phase 4.
4. **`stripJsComments` on Elm output** — unproven for regex/string literals;
   happy-dom boot gate in the regenerator (plan 1 risk, unchanged).
5. **Anchor drift across the source swap** (phase 4) — the stability gate
   makes it loud; the risk that it forces an anchor migration before any
   citation exists is exactly why the gate ships in phase 1.
6. **Generalisation overclaim** — this is the shelf's cleanest text (0 `¬`, 0
   long-s). What generalises is the *structure* machinery (pagination, TOC,
   notes, regions, anchors); the *damage* machinery (long-s, negation signs)
   is untested here and remains the shelf's real problem. The plan claims
   only what it proves.
7. **One writer per lane**: the extractor touches `tools/library/`, the app
   touches `elm/src/` + `tools/build-reader.mjs`; `tools/build.mjs` changes
   (shell emission, per-text publish flag) should land with the extractor,
   not the app, to keep diffs attributable.

## 13. Open questions — and what settles each

- **Does the item's djvu.xml carry per-LINE elements** (vs flat words) and
  are objects in reading order? — settled by the one download in phase 4/0;
  the parser asserts and reports.
- **The `3` bare block** in the body (digit-only, not obviously a folio:
  body starts at p. 5) — settled by the leaf-anchored page model (which leaf,
  which position); until then it is marked, not guessed.
- **Do the 41/44 and 47/49 page gaps correspond to plates/blanks or to
  mis-numbered leaves?** — settled by `_page_numbers.json` + leaf sequence in
  phase 4; the refusal rule covers the interim.
- **Margin notes at what breakpoint** — settled by using the wide view once
  in phase 2 (CSS-only change).
- **Print range UX** (sections vs pages as the unit) — settled by printing
  one citation range by hand in phase 5.
- **Per-text font need** — settled per text by a rendering check; none here
  (0 Greek glyphs, MEASURED).
