/**
 * tools/library/extract.mjs — the library's document extractor (plan §4, phase 1;
 * the leaf-accurate page model, phase 4).
 *
 * A scanned printed edition is a STRUCTURED object: it has printed pages with
 * numbers, divisions with numbers, notes attached to passages, and page
 * furniture. The `_djvu.txt` derivative throws that structure away and the
 * reader that renders it inherits the loss. This module RE-DERIVES the
 * structure from the transcription and emits it as a document the reader can
 * navigate, cite and search — from the transcription ALONE when there is nothing
 * else, and with the volume's own leaves behind the page model when the repo
 * stores a derivation of them (decision 6).
 *
 * SIX DECISIONS, and why they are these decisions:
 *
 * 1. PAGINATION COMES FIRST, BEFORE ANYTHING IS READ AS A HEADING (§4.2). A
 *    running head carries the printed page number inline; so does a bare folio
 *    whose head's words were lost. Both are consumed from the LINE stream
 *    before any block is classified, which is what structurally kills the
 *    folio-as-heading defect (`reader.mjs` `detectHeading`/`isHeading` reads a
 *    bare numeral as a heading — 348 of 522 of one volume's headings were a
 *    folio). A number at a page head is a folio BY CONSTRUCTION, never a
 *    heading; nothing below ever asks `isHeading`.
 *
 * 2. A CANDIDATE PAGE NUMBER IS BELIEVED ONLY ON ARITHMETIC. A token that reads
 *    as digits is a reading of the print and is taken as long as the sequence
 *    moves forward. A token that needed an OCR confusion (`io`→10, `II`→11) is
 *    an INTERPRETATION, and so is a bare folio, whose head's words are gone: it
 *    is accepted only if it preserves the ±1 stride with its neighbours
 *    (`value === prev + 1`, or `next − 1` when nothing precedes it). That is
 *    what the plan's reconciliation rule says, and it is checkable: the volume's
 *    measured `5` (body start, next head 6) is accepted; its `3` (between 33 and
 *    34) and its `43` (between 41 and 44) are refused and emitted with
 *    `page: null` — never a fabricated number.
 *
 * 3. NOTES AND SECTIONS ARE CLOSED BY THEIR OWN ARITHMETIC (§4.3, §4.4). The
 *    sections must come out 18 consecutive with no gap and no duplicate; the
 *    note markers 1…N consecutive. Anything else throws and names the offender,
 *    so a bad guess is caught by the count rather than by taste. The measured
 *    `(n)` note marker and the mangled `n.^Tb,eologists` section opener are
 *    resolved by SEQUENCE FITTING — the expected value, because the sequence
 *    requires it — which is a rule, not a special case for those two strings.
 *
 * 4. THE SERVED BLOCKS ARE THE VERBATIM TRANSCRIPTION (§4.1). Nothing is
 *    dropped in the document: page furniture is kept as `rh` blocks, a refused
 *    marker keeps its own text, and a note reference keeps the words the print
 *    has ("(note i)") beside the number it resolves to. Corrections travel as
 *    RULES, never as a second text, so the transcription is always inspectable
 *    and the diff view is the rule list itself. The rules are the REVIEWED list
 *    in `tools/library/edits/<slug>.json` (§7) — the artifact a human reads —
 *    and every one of them must fire at least once in the served text or the
 *    build fails (`checkEdits`, called by the build): a rule that matches
 *    nothing is unreviewed machinery.
 *
 * 5. THE EDITION LIVES IN THE REPO. `content/library/<slug>/source.txt` is the
 *    transcription as imported, once, from the shelf; the build reads that and
 *    never the shelf (the shelf is touched only by `--import`, below, which
 *    refuses to overwrite a changed edition). The library is still held back
 *    from the site by `LIBRARY=1`; storing an edition does not publish it.
 *
 * 6. THE PAGE MODEL RESTS ON THE VOLUME'S OWN LEAVES WHEN THEY CAN BE HAD (§4.6,
 *    phase 4). A running head says what a page number IS; it does not say where
 *    one page ends and the next begins, and it cannot speak for a page whose head
 *    the transcription lost. The leaves do. `tools/library/derive.mjs` reads the
 *    item's own page files ONCE and stores, beside the edition,
 *    `content/library/<slug>/derivs.json`: the leaf table, the line index at which
 *    each leaf begins, and the inventory of the bytes it was derived from. This
 *    module then places every page marker ON a leaf, and reconciles the three
 *    signals about a page — the item's own page-number pass, the leaf a marker
 *    stands on, and the transcription's own heads and folios — REPORTING every
 *    disagreement rather than merging it (the table and the diff print at build).
 *    Two things follow that the text alone cannot do: a number the ±1 stride rule
 *    refused is re-read where the leaf it stands on is that page (`by: "leaf"` on
 *    the marker), and a leaf boundary the transcription carries no marker for at
 *    all is marked with its leaf and NO number (`how: "leaf"`) instead of being
 *    invisible. What is SERVED is still only what a source read: a number nothing
 *    on the leaf reads is never invented for it. The artifact is derived, not
 *    fetched, so the build needs neither the item's files nor the network — and an
 *    extraction that has no model says so instead of quietly reading in txt mode.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  rawBlocks,
  normaliseNumber,
  applyCorrections,
  isFurnitureJunk,
  runningHead,
  bareFolio,
  joinLines,
} from './reader.mjs';
import { TEXTS, SHELF, shelfFiles, shelfFile, textSource } from './shelf.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Where the repo keeps an EDITION of a text, and where the anchors it serves
 * are pinned. Both are in the repo, beside the posts. */
export const LIBRARY_DIR = join(ROOT, 'content', 'library');
export const ANCHOR_DIR = join(ROOT, 'tools', 'library', 'anchors');

export const editionPath = (slug) => join(LIBRARY_DIR, slug, 'source.txt');
export const importPath = (slug) => join(LIBRARY_DIR, slug, 'import.json');
export const derivsPath = (slug) => join(LIBRARY_DIR, slug, 'derivs.json');
export const anchorPath = (slug) => join(ANCHOR_DIR, `${slug}.json`);
export const hasEdition = (slug) => existsSync(editionPath(slug));
export const readEdition = (slug) => readFileSync(editionPath(slug), 'utf8');

/**
 * THE DERIVED PAGE MODEL, if this repo stores one (phase 4, plan §4.6).
 *
 * `content/library/<slug>/derivs.json` is what `tools/library/derive.mjs` writes
 * from the archive item's own `_djvu.xml` and `_page_numbers.json`: the leaf
 * table, the alignment to this edition's line stream, and the inventory of the
 * bytes it was derived from. Those derivatives are 942 KB on a host path; this
 * artifact is the few kilobytes of it a document can be built from, and it is
 * the only one of the two the build is allowed to need (`LIBRARY_DERIVS` is read
 * by the deriving tool, never by the build).
 *
 * A model derived against OTHER BYTES than the edition being extracted is
 * refused rather than used: the leaf boundaries are line positions, and a changed
 * edition moves every one of them. The refusal names the command that makes a new
 * one, because the artifact is derived, not hand-written.
 */
export function loadDerivs(slug, edition = null) {
  const file = derivsPath(slug);
  if (!existsSync(file)) return null;
  let model;
  try {
    model = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`library: ${slug}: the derived page model is not valid JSON — ${e.message}`);
  }
  if (edition != null && model.edition && model.edition.sha256 !== edition) {
    throw new Error(
      `library: ${slug}: the derived page model was built from other bytes than the edition this repo ` +
        `stores (model: ${model.edition.sha256.slice(0, 12)}…, edition: ${edition.slice(0, 12)}…) — every leaf ` +
        `boundary in it is a line position of the edition it was derived against, so it cannot be used here.\n` +
        `  Make a new one deliberately: node tools/library/derive.mjs ${slug}`,
    );
  }
  return model;
}

/**
 * Everything the page pass reads, and the index space a leaf boundary lives in.
 *
 * The LEAF model's coordinates are line indices of the whole file, so the line
 * stream here INCLUDES the library stamp the extractor drops (a leaf boundary is
 * a line of the file whether or not it is text). `markerKeyAt` maps such an index
 * to the key the emission pass uses, so a leaf boundary and a running head name
 * the same line.
 */
export function pageSignals(src, entry) {
  const cfg = TEXT_RULES[entry.slug] || {};
  const all = rawBlocks(src);
  const flat = [];
  for (const block of all) for (const line of block) flat.push(line);

  /* 1. The library's stamp is not text (plan §4.5): recorded, then dropped. */
  let drop = 0;
  const dropped = [];
  for (const want of cfg.stamp || []) {
    const got = all[drop] ? all[drop].join(' ') : null;
    if (got !== want) {
      throw new Error(
        `library: ${entry.slug}: the library stamp is not where it was measured ` +
          `(wanted block ${JSON.stringify(want)}, found ${JSON.stringify(got)}) — ` +
          `the transcription has changed shape and the extraction must be re-read, not patched`,
      );
    }
    dropped.push(all[drop][0]);
    drop++;
  }
  const lines = all.slice(drop);
  const keys = [];
  const base = [];
  let run = 0;
  for (let bi = 0; bi < lines.length; bi++) {
    base.push(drop + run);
    for (let li = 0; li < lines[bi].length; li++) keys.push(`${bi}:${li}`);
    run += lines[bi].length;
  }
  const at = (bi, li) => base[bi] + li;
  const markerKeyAt = (index) => (index >= drop && index - drop < keys.length ? keys[index - drop] : null);

  /* 2. Page furniture, consumed before anything is read as a heading (§4.2). */
  const { markers, junk } = scan(lines, cfg, at);
  reconcile(markers);
  return { cfg, all, lines, drop, dropped, flat, flatLines: flat.length, markers, junk, markerKeyAt, at };
}

/** The sha256 of a text, as the document records it: the served edition is
 * identified by its bytes, so a reader can say which text this document is of. */
export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/**
 * The per-text facts that are not rules. Everything here is a MEASURED property
 * of one edition, not a policy and not a repair: which words the running head
 * carries, which blocks the library's own stamp occupies (the stamp is not text
 * at all — plan §4.5 — so it is recorded and dropped, never served), and where
 * the volume's divisions begin.
 *
 * The REPAIRS are not here. They are in `tools/library/edits/<slug>.json` — the
 * reviewed rule list (plan §7), one file per text, loaded by `loadEdits` and
 * shipped inside the document exactly as the plans says: corrections travel as
 * rules, never as a second text, so the transcription stays inspectable and the
 * diff view is the rule list itself.
 */
const TEXT_RULES = {
  'porphyry-on-the-cave-of-the-nymphs-taylor-1917': {
    head: 'ON THE CAVE OF THE NYMPHS',
    // the University of Toronto ownership stamp, five blocks, before the book
    stamp: ['PA', '4397', 'E5', '08', '1917'],
    // The ads boundary is the COLOPHON — the first block after note (25)'s own
    // paragraph — not the plan's `FROM THE GREEK OF PORPHYRY`, which is vacuous:
    // that phrase occurs exactly once in the edition, on the title page, and the
    // title page OCRs as "From the Greeh of Porphyry", so the rule never fired
    // and the note-continuation swallowed the colophon and the catalogue's
    // opening seven blocks as note (25)'s own text.
    divisions: { notes: 'Notes', ads: 'PRINTED IN GREAT BRITAIN' },
  },
};

/* ---------- the edits: the reviewed rules, and what they do ---------- */

/** Where a text's rules live, and where a review pass leaves its proposals. Both
 * are in the repo: the rules that produce the reading view must be reconstructible
 * from the repository, and a proposal a human has not merged must never be. */
export const EDITS_DIR = join(ROOT, 'tools', 'library', 'edits');
export const editsPath = (slug) => join(EDITS_DIR, `${slug}.json`);
export const proposedPath = (slug) => join(EDITS_DIR, `${slug}.proposed.json`);

/** The classes a rule may carry, IN THE ORDER THE PIPELINE NEEDS THEM. The order
 * is load-bearing, not decorative: `opener` rules repair the division numbers,
 * and the extraction cannot find a section until they are applied; `digit` rules
 * repair printed numbers and note markers, each pinned to the line it was read
 * from; `reading` rules supply the print's word for a damaged run and come last,
 * so they can never consume a number or a division before the pass that needs it
 * has run; `review` rules record a passage whose reading is NOT determinable
 * (action "leave") and change nothing. A file whose classes are not grouped in
 * this order is rejected at load rather than silently applied out of order.
 *
 * THE CLASS THAT IS GONE, AND WHY. The family used to be called `ocr` and its
 * rules DELETED the transcription's damage marker with no reading offered — 104
 * of them, every one a pure deletion, 87 of which glued two printed words
 * together or left a non-word (MEASURED by the review). `reading` replaces it:
 * a rule of this class must record the print's word, and a damaged word whose
 * reading is not known gets no rule at all and stays visible under the base
 * policy (`_base.json`). */
export const EDIT_CLASSES = ['opener', 'digit', 'reading', 'review'];

/** Where the shared POLICY lives — the file every text inherits. It is not a rule
 * list: it states the damage-character set (MEASURED, not guessed), what each
 * class means, the application order, and the rule the pipeline enforces —
 * substitute the reading when it is recorded, otherwise leave the marker in
 * place. A text's own file is DATA under it. */
export const BASE_POLICY = join(EDITS_DIR, '_base.json');

/** The shared policy, read once per process. A missing or malformed base is an
 * error whenever a text carries rules: a per-text file without the policy it
 * claims to be written under is a rule list whose meaning is not stated. */
let baseCache = null;
export function loadBasePolicy() {
  if (baseCache) return baseCache;
  if (!existsSync(BASE_POLICY)) {
    throw new Error(`library: the base policy is missing (${BASE_POLICY}) — every text's rules are written under it`);
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(BASE_POLICY, 'utf8'));
  } catch (e) {
    throw new Error(`library: the base policy is not valid JSON — ${e.message}`);
  }
  if (raw.rule !== 'substitute-if-known-else-leave') {
    throw new Error(
      `library: the base policy states the rule "${raw.rule}" — this pipeline implements ` +
        `"substitute-if-known-else-leave" and will not apply another`,
    );
  }
  if (!Array.isArray(raw.damage) || raw.damage.length === 0 || raw.damage.some((c) => typeof c !== 'string' || c.length !== 1)) {
    throw new Error(`library: the base policy's damage set is not a non-empty list of single characters`);
  }
  for (const c of EDIT_CLASSES) {
    if (!raw.classes || typeof raw.classes[c] !== 'string') {
      throw new Error(`library: the base policy does not define the class "${c}"`);
    }
  }
  baseCache = {
    rule: raw.rule,
    damage: raw.damage.join(''),
    damageList: raw.damage.slice(),
    classes: raw.classes,
    order: Array.isArray(raw.order) ? raw.order : EDIT_CLASSES.slice(),
    measured: raw.damageMeasured || null,
    states: raw.states || '',
  };
  return baseCache;
}
const classRank = (cls) => {
  const i = EDIT_CLASSES.indexOf(cls);
  if (i < 0) throw new Error(`library: the correction class "${cls}" is not one of ${EDIT_CLASSES.join(', ')}`);
  return i;
};

/**
 * The reviewed rules for one text (plan §7). The file is
 * `{find, replace, class, note}` — the plan's shape, and the artifact a human
 * reads — and it is normalised here to the document's own contract
 * (`{find, repl, cls, note}`), which is what the reader app decodes and what the
 * diff view renders. ONE spelling would be simpler; two are what the plan asks
 * for, and the mapping is this one function so the two cannot drift.
 *
 * Validation is deliberately strict: a rule with no `note` is a rule nobody can
 * review, a class outside the pipeline's four is a class nothing applies, two
 * rules that share a `find` are one of them unreachable, and classes out of
 * pipeline order would run a repair before the pass that needs it.
 *
 * A text with no edits file gets no rules, which is what the other 37 texts on
 * the shelf have: their pages are the transcription, and no reading view is
 * claimed for them.
 */
export function loadEdits(slug) {
  const file = editsPath(slug);
  if (!existsSync(file)) return { edits: [], meta: null };
  const base = loadBasePolicy();
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`library: ${slug}: the edits file is not valid JSON — ${e.message}`);
  }
  if (raw.slug !== slug) {
    throw new Error(`library: ${slug}: the edits file names "${raw.slug}" — a rule list that names another text is a rule list for another text`);
  }
  if (raw.base !== '_base.json') {
    throw new Error(
      `library: ${slug}: the edits file does not name the base policy it is written under (expected "base": "_base.json")`,
    );
  }
  if (!Array.isArray(raw.edits) || raw.edits.length === 0) {
    throw new Error(`library: ${slug}: the edits file carries no rules`);
  }
  let rank = -1;
  const seen = new Map();
  const edits = raw.edits.map((e, i) => {
    const where = `the edits file's rule ${i + 1}`;
    if (typeof e.class !== 'string' || !base.classes[e.class]) {
      throw new Error(`library: ${slug}: ${where} has class "${e.class}", which the base policy does not define`);
    }
    const leave = e.action === 'leave';
    if (leave) {
      // A LEAVE records a decision, it does not change text: it needs its find
      // (the damaged run it is a decision about) and a note, and a `replace`
      // would be the reading it says it does not have.
      if (typeof e.find !== 'string' || e.find === '') {
        throw new Error(`library: ${slug}: ${where} carries action "leave" and no find — a leave is a decision about a damaged run`);
      }
      if (e.replace != null) {
        throw new Error(`library: ${slug}: ${where} ("${e.find}") carries action "leave" AND a replace — a leave that states a reading is a reading, not a leave`);
      }
      if (typeof e.note !== 'string' || e.note === '') {
        throw new Error(`library: ${slug}: ${where} ("${e.find}") has no note — a decision nobody can review is not a decision`);
      }
    } else {
      for (const k of ['find', 'replace', 'note']) {
        if (typeof e[k] !== 'string' || e[k] === '') {
          throw new Error(`library: ${slug}: ${where} has no ${k} — a rule without one is not reviewable`);
        }
      }
      if (e.find === e.replace) {
        throw new Error(`library: ${slug}: ${where} ("${e.find}") replaces the text with itself — it is not a correction`);
      }
    }
    const r = classRank(e.class);
    if (r < rank) {
      throw new Error(
        `library: ${slug}: ${where} ("${e.find}") is class "${e.class}", which is out of pipeline order — ` +
          `the classes must be grouped ${EDIT_CLASSES.join(' → ')}, because an opener is what lets the ` +
          `extraction find a section and a reading rule may consume the characters a later class needs`,
      );
    }
    rank = r;
    if (seen.has(e.find)) {
      throw new Error(
        `library: ${slug}: ${where} and rule ${seen.get(e.find)} both match "${e.find}" — the later one ` +
          `can never fire (the earlier already replaced every occurrence), so one of them is unreviewed machinery`,
      );
    }
    seen.set(e.find, i + 1);
    // A leave spends no bytes: it counts its occurrences and replaces nothing.
    // `join` (if present) names the block a rule's find starts in — the extractor
    // merges that block with the next before the rules run, so a find that spans
    // the transcription's paragraph split can fire. The engines ignore it once
    // the merge is done, but it must survive loading for the merge to see it.
    return {
      find: e.find,
      repl: leave ? e.find : e.replace,
      cls: e.class,
      note: e.note,
      action: leave ? 'leave' : 'replace',
      ...(e.join ? { join: e.join } : {}),
    };
  });
  checkReadingPolicy(edits, slug, base);
  return { edits, meta: { classes: raw.classes || {}, order: raw.order || null, base } };
}

/** THE POLICY, AS AN ASSERTION THAT CAN FAIL — and the reason it is a POLICY.
 *
 * A rule that carries a character of the damage set INSIDE a word (between two
 * letters of its find) may not resolve that word by deleting the character: it
 * must record the print's word. Mechanised as: such a rule's `replace` must not
 * be obtainable from its `find` by deletion alone. "the_jMowers" -> "thejMowers"
 * IS obtainable (drop the marker) and fails; "the_jMowers" -> "the powers" is
 * not, and passes. A marker standing at a word's EDGE is not covered here — the
 * review measured 17 such rules whose plain removal is the printed word — so the
 * scope is stated rather than overstated: this catches the glue and the non-word
 * (87 of the 104 the review counted), not every silent deletion. The three the
 * review called BLOCKERs (`_put`->"but", `\he`->"the", `cavern*`->"caverns") are
 * edge cases of this test and are asserted by the extractor's smoke against the
 * parallel's own words.
 */
export function checkReadingPolicy(edits, slug, base) {
  const bad = [];
  for (const e of edits) {
    if (e.action === 'leave') continue;
    const dmg = [...base.damage];
    for (let i = 1; i < e.find.length - 1; i++) {
      if (!dmg.includes(e.find[i])) continue;
      if (/[A-Za-z]/.test(e.find[i - 1]) && /[A-Za-z]/.test(e.find[i + 1])) {
        if (isPureDeletion(e.find, e.repl)) bad.push(e);
        break;
      }
    }
  }
  if (bad.length) {
    throw new Error(
      `library: ${slug}: ${bad.length} rule(s) remove a damage character from INSIDE a word without recording a ` +
        `reading — the reading view would assert a word the edition does not have:\n` +
        bad
          .map((e) => `  ${e.cls}  ${JSON.stringify(e.find)} → ${JSON.stringify(e.repl)}  ${e.note}`)
          .join('\n') +
        `\n  Fix the rules file: record the print's word in \`replace\` (class "reading"), or record a ` +
        `\`{find, action: "leave"}\` (class "review") and let the damage show.`,
    );
  }
}

/** Is `to` obtainable from `from` by deletion alone? A greedy subsequence walk —
 * order preserved, nothing inserted, nothing substituted. */
export function isPureDeletion(from, to) {
  if (to.length >= from.length) return false;
  let j = 0;
  for (let i = 0; i < from.length && j < to.length; i++) if (from[i] === to[j]) j++;
  return j === to.length;
}

/**
 * Apply a rule list to one text, in order, every occurrence — the reader app's
 * own `applyCorrections` (`elm/src/Reader/Document.elm:114`), with the hits
 * counted as they happen.
 *
 * The count is the number of occurrences AT THE MOMENT the rule is applied, and
 * that is the only count that means anything when order decides: a rule whose
 * `find` an earlier rule has already replaced fires zero times, and this is how
 * that is SEEN rather than assumed away — the phase-1 draft carried three such
 * rules (`qreneratioi^and` and `that_jg_the`, subsumed by `^and` and `_the` with
 * an identical result, and `n.^Tb,eologists`, which the opener rule that runs
 * first has already repaired).
 */
export function applyEditsCounted(text, rules, onHit) {
  let out = text;
  for (let i = 0; i < rules.length; i++) {
    const f = rules[i].find;
    if (!f) continue;
    const leave = rules[i].action === 'leave';
    if (!leave && f === rules[i].repl) continue;
    const parts = out.split(f);
    if (parts.length === 1) continue;
    if (onHit) onHit(i, parts.length - 1);
    if (leave) continue; // a leave records its occurrences and spends no bytes
    out = parts.join(rules[i].repl);
  }
  return out;
}

/**
 * The hit table: every rule, and how many times it fires in the document's own
 * text fields, corrected in order, one field at a time.
 *
 * The DOMAIN is the document's own fields — every block's text, in document
 * order — because that is the text the reading view passes to its rule engine
 * (`Doc.applyCorrections` is applied per block and per inline run). Counting over
 * the source file instead would count a rule on a line the document never serves
 * as one string (the extractor joins hard-wrapped lines first), and the whole
 * point of the count is that it is the count the READER's application produces.
 */
export function editReport(blocks, corrections) {
  const rules = corrections.map((c) => ({ find: c.find, repl: c.repl, action: c.action }));
  const hits = rules.map(() => 0);
  const kinds = rules.map(() => new Set());
  for (const b of blocks) {
    if (typeof b.x !== 'string') continue;
    applyEditsCounted(b.x, rules, (i, n) => {
      hits[i] += n;
      kinds[i].add(b.t);
    });
  }
  return corrections.map((c, i) => ({ ...c, hits: hits[i], kinds: [...kinds[i]] }));
}

/**
 * THE ACCEPTANCE RULE (plan §7): every rule must fire at least once, or the build
 * fails and names it. "A rule that matches nothing is unreviewed machinery" — it
 * is either dead (an earlier rule already did its work, or its `find` was never
 * in the text) or wrong (a rule written for something the transcription does not
 * have), and either way it claims a repair that does not happen.
 *
 * The build calls this (tools/build.mjs); it is not asserted inside `extract`,
 * because `extract` is also run over MUTATED fixtures by the extractor's smoke —
 * a fixture that removes the text a rule matches must be free to test something
 * else without the rule gate firing first.
 */
export function checkEdits(doc) {
  const report = editReport(doc.blocks, doc.corrections);
  const dead = report.filter((r) => r.hits === 0);
  if (dead.length) {
    throw new Error(
      `library: ${doc.slug}: ${dead.length} correction rule(s) match nothing in the served text — ` +
        `a rule that matches nothing is unreviewed machinery:\n` +
        dead.map((r) => `  ${r.cls}  ${JSON.stringify(r.find)} → ${JSON.stringify(r.repl)}  ${r.note}`).join('\n') +
        `\n  Fix the rules file (tools/library/edits/${doc.slug}.json): delete a rule an earlier rule ` +
        `has already done the work of, or correct a rule whose find is not in this transcription.`,
    );
  }
  return report;
}

/** A section opener at the start of a line, with the transcription's stray
 * quote before the number. The number must then fit the sequence (below). */
const OPENER = /^['\u2018]?(\d{1,2})\.\s/;
/** A note definition's marker, at the start of a line in the notes region. */
const NOTE_MARK = /^\(([^)\s]{1,3})\)\s*/;
/** A note reference in the running text: every reference in this edition is
 * explicit (MEASURED: 25 of 25), so none has to be reconstructed. */
const NOTE_REF = /\(note\s+([^)\s]{1,4})\)/g;

/** Read a marker's token against the value the sequence requires, and say HOW
 * it was read — the only three outcomes there are:
 *
 *   `read`      — the token is the expected number, as digits.
 *   `confusion` — the token is the expected number read through an OCR digit
 *                 confusion ("io", "II", "i", "l", "o", "S").
 *   `fitted`    — the token cannot be read as a number at all (`n` for 11): the
 *                 SEQUENCE supplies the value, which is a rule, not a special
 *                 case for that one string.
 *
 * A token that reads as a DIFFERENT number is not fitted — that is a real
 * disagreement between the marker and the sequence, and the caller fails on it.
 * Without that, "the markers run 1…N" would be true by construction and could
 * never fail. */
function fitMarker(token, expected) {
  const n = normaliseNumber(token);
  if (n && n.value === expected) return { value: n.value, how: n.plain ? 'read' : 'confusion' };
  if (n) return { value: n.value, how: 'disagreed' };
  return { value: expected, how: 'fitted' };
}

/** Every line of the transcription, in reading order, with the furniture the
 * pagination pass takes out of it. `at` gives each marker the index of its line
 * in the WHOLE line stream of the edition, which is the index space a leaf
 * boundary is measured in (§4.6, phase 4). */
function scan(lines, cfg, at) {
  const markers = new Map();
  const junk = new Set();
  for (let bi = 0; bi < lines.length; bi++) {
    for (let li = 0; li < lines[bi].length; li++) {
      const line = lines[bi][li];
      const key = `${bi}:${li}`;
      const index = at(bi, li);
      const head = runningHead(line, cfg.head);
      if (head) {
        const n = normaliseNumber(head.num);
        markers.set(key, {
          kind: 'head',
          raw: line,
          value: n ? n.value : null,
          plain: n ? n.plain : false,
          at: index,
        });
        continue;
      }
      const folio = bareFolio(line);
      if (folio) {
        markers.set(key, { kind: 'folio', raw: line, value: folio.value, plain: folio.plain, at: index });
        continue;
      }
      if (isFurnitureJunk(line)) junk.add(key);
    }
  }
  return { markers, junk };
}

/** The next marker that carries a readable head number, from `from` on. */
function nextHeadValue(markers, keys, from) {
  for (let i = from; i < keys.length; i++) {
    const m = markers.get(keys[i]);
    if (m.kind === 'head' && m.value != null) return m.value;
  }
  return null;
}

/** Reconcile the page candidates — the plan's rule, in one place (§4.2). */
function reconcile(markers) {
  const keys = [...markers.keys()];
  let last = null;
  for (let i = 0; i < keys.length; i++) {
    const m = markers.get(keys[i]);
    if (m.value == null) {
      m.page = null;
      m.how = 'refused';
      continue;
    }
    const next = nextHeadValue(markers, keys, i + 1);
    let ok;
    if (m.kind === 'head' && m.plain) {
      // a plain reading of the print: it is believed as long as the page
      // sequence moves forward (the volume's own gaps are real pages we cannot
      // read a number for, not an error to refuse)
      ok = last === null || m.value > last;
    } else if (m.kind === 'head') {
      // an ambiguous reading: it must fill the gap it sits in
      ok = m.value === (last !== null ? last + 1 : next !== null ? next - 1 : m.value);
      ok = ok && (last === null || m.value > last);
    } else {
      // a bare folio: the same test, and the neighbours must agree
      ok =
        (last !== null && m.value === last + 1) ||
        (last === null && next !== null && m.value === next - 1);
    }
    if (ok) {
      m.page = m.value;
      m.how = m.kind === 'head' ? 'head' : 'folio';
      last = m.value;
    } else {
      m.page = null;
      m.how = 'refused';
    }
  }
  return markers;
}

/** A section's title: the section's OWN opening words, capped at eight words and
 * cut at the earliest punctuation boundary inside the cap, ellipsised. The 1917
 * print has no contents page (MEASURED: nothing between the title page and §1),
 * so the table of contents is generated apparatus and the title is honestly
 * derived from the text, not taken from the edition. */
export function sectionTitle(text) {
  const words = text.split(' ').filter((w) => w !== '');
  const cap = Math.min(words.length, 8);
  let cut = cap;
  for (let i = 2; i < cap; i++) {
    if (/[,.;:?!]$/.test(words[i])) {
      cut = i + 1;
      break;
    }
  }
  const title = words.slice(0, cut).join(' ').replace(/[,.;:?!]+$/, '');
  return words.length > cut ? `${title}…` : title;
}

/** The characters a transcription uses where the print has a letter or a mark the
 * scan could not carry. THE SET IS NOT DECLARED HERE: it is the base policy's
 * (`tools/library/edits/_base.json`) `damage` list, which was MEASURED on the
 * transcription rather than guessed — every character standing inside a
 * letter-bearing token that a 1917 print cannot set inside a word. The policy is
 * the one place the set is stated, so the census, the reading view's marking and
 * the rules' own validation cannot disagree about what damage is.
 *
 * MEASURED on this edition: `^ _ ~ * / £ > \ | # ™ ± » « } { &` — and the
 * characters a print DOES set inside a word (the full stop of an abbreviation,
 * the apostrophe of a contraction, a comma, a dash) are excluded, because marking
 * one of those as damage would be a false claim in the reading view. The base
 * file carries the counts and the excluded set. */
let damageRe = null;
function damageRegex() {
  if (!damageRe) {
    const inClass = loadBasePolicy()
      .damage.replace(/[\\\]^$.*+?()[{|]/g, '\\$&');
    damageRe = new RegExp(`[${inClass}]`);
  }
  return damageRe;
}

/** A word of the transcription that carries a character the census marks as
 * damage: a word whose letters were lost. A reader cannot tell such a word from
 * an English one, and the reading view either shows the recorded reading for it
 * or shows it as the transcription has it (marker and all). A word that mixes
 * letters with digits is the census's other damaged class: no character can be
 * removed from it without inventing a letter or leaving one. */
export function wordDamaged(word) {
  const bare = word
    .replace(/^[.,;:?!()"'\u201c\u201d\[]+/, '')
    .replace(/[.,;:?!()"\u201c\u201d\]|\\]+$/, '');
  if (bare === '' || !/[A-Za-z]/.test(bare)) return false;
  return damageRegex().test(bare) || /[A-Za-z]\d|\d[A-Za-z]/.test(bare);
}

/** Cut a section title down to the words the cap keeps, before ellipsising — so a
 * damage test can be asked about exactly the words the title SHOWS, not about the
 * opening words it did not use. */
function titleWords(text) {
  return sectionTitle(text).replace(/…$/, '').split(' ').filter((w) => w !== '');
}

/**
 * Is a derived title still damaged AFTER the rules have been applied?
 *
 * The answer has to distinguish two things a naive census does not: a word whose
 * damage a rule READS — the section-11 opener `n.^Tb,eologists` → `11.
 * Theologists` is a rule that states what the print says, and the title it
 * produces is readable — from a word whose damage a rule only STRIPS. So a word
 * counts as still damaged when the census marks it and NO reading rule (any class
 * other than `ocr`) touches it. Words that would remain damaged after every rule
 * has run are counted too, so the test cannot be defeated by a rule that strips a
 * marked character and leaves one behind.
 *
 * MEASURED on this edition: sections 2 and 9 are still damaged (`Thpanrt'p'rii'c:`
 * and `ajgyejbpjthe` for §2, `rpmntq` for §9); section 11 is repaired by its
 * opener rule and is not flagged. A title is never invented to hide either case.
 */
export function titleDamage(rawTitle, correctedTitle, rules) {
  const readings = rules.filter((r) => r.cls !== 'review');
  const stripped = titleWords(rawTitle).filter(
    (w) => wordDamaged(w) && !readings.some((r) => r.find === w || w.includes(r.find)),
  );
  const left = titleWords(correctedTitle).filter(wordDamaged);
  return { damaged: stripped.length > 0 || left.length > 0, words: [...new Set([...stripped, ...left])] };
}

/** The text of the FRONT-MATTER REGION: the block run between the front mark and
 * the body's first division, plus the dropped blocks (the library's stamp is not
 * served but is front matter by any reading). */
export function frontMatterText(doc) {
  const body = doc.blocks.findIndex((b) => b.t === 'region' && b.kind === 'body');
  const from = doc.blocks.findIndex((b) => b.t === 'region' && b.kind === 'front');
  return [
    ...(doc.dropped || []).map((d) => d.x),
    ...doc.blocks.slice(from, body < 0 ? doc.blocks.length : body).map((b) => b.x || ''),
  ].join(' ');
}

/**
 * THE POLICY'S ONE EXCEPTION (plan §7), as an assertion that can fail.
 *
 * The title page's "From the Greeh of Porphyry" is CITED AS EVIDENCE by the
 * reading itself (content/porphyry-cave-of-the-nymphs.md): the reading's argument
 * rests on the print's spoiled reading, so a rule that repaired it in the served
 * text would destroy the evidence it points at. The transcription view preserves
 * it by construction — and NO rule may touch the front-matter region at all. A
 * rule added later that reaches into the title page fails here rather than
 * silently repairing the evidence.
 */
export function checkFrontMatter(doc) {
  const front = frontMatterText(doc);
  const into = (doc.corrections || []).filter((c) => c.find && front.includes(c.find));
  if (into.length) {
    throw new Error(
      `library: ${doc.slug}: ${into.length} correction rule(s) match inside the front-matter region — ` +
        `the front matter is the print's title page, and one of its readings is cited as evidence by a ` +
        `reading that uses this text:\n` +
        into.map((c) => `  ${c.cls}  ${JSON.stringify(c.find)}`).join('\n') +
        `\n  The title page is preserved by construction and no correction may touch it (plan §7).`,
    );
  }
  return front;
}

/**
 * THE LEAF MODEL, ALIGNED TO THIS EDITION (phase 4, plan §4.6).
 *
 * The derived artifact gives each leaf the index of its first line in the line
 * stream of the edition it was derived against. This checks that the alignment
 * still holds — the edition's byte length is checked by `loadDerivs`, and here its
 * line stream is checked leaf by leaf: the leaves must TILE the stream (no gap, no
 * overlap) and every leaf's recorded first line must BE the line at that index.
 * Any of those failing means the boundary positions are wrong, which is a failure
 * the build must not paper over: it throws, and it says which leaf is out of step.
 */
function alignLeaves(sig, model, meta) {
  if (!model.leaves || !model.totals) {
    throw new Error(`library: ${meta.entry.slug}: the derived page model has no leaf table — it is not one`);
  }
  if (model.edition && meta.sha256 && model.edition.sha256 !== meta.sha256) {
    throw new Error(
      `library: ${meta.entry.slug}: the derived page model was built from other bytes than this edition\n` +
        `  Make a new one deliberately: node tools/library/derive.mjs ${meta.entry.slug}`,
    );
  }
  const flat = sig.flat;
  if (model.totals.lines !== flat.length) {
    throw new Error(
      `library: ${meta.entry.slug}: the derived page model indexes ${model.totals.lines} line(s) and this edition has ` +
        `${flat.length} — the model was derived against another edition, and its leaf boundaries point at lines that ` +
        `are not these lines:\n  node tools/library/derive.mjs ${meta.entry.slug}`,
    );
  }
  let at = 0;
  const byLeaf = new Map();
  const lineLeaf = [];
  for (const lf of model.leaves) {
    if (lf.start !== at) {
      throw new Error(
        `library: ${meta.entry.slug}: the leaf model does not tile the edition — leaf ${lf.leaf} starts at line ` +
          `${lf.start} where the leaves before it end at ${at}:\n  node tools/library/derive.mjs ${meta.entry.slug}`,
      );
    }
    byLeaf.set(lf.leaf, lf);
    for (let i = 0; i < lf.lines; i++) lineLeaf[lf.start + i] = lf.leaf;
    if (lf.lines > 0 && flat[lf.start] !== lf.head) {
      throw new Error(
        `library: ${meta.entry.slug}: leaf ${lf.leaf}'s boundary does not land where the model says — the model's ` +
          `first line for it is ${JSON.stringify(lf.head)} and this edition's line ${lf.start} is ` +
          `${JSON.stringify(flat[lf.start])}:\n  node tools/library/derive.mjs ${meta.entry.slug}`,
      );
    }
    at += lf.lines;
  }
  if (at !== flat.length) {
    throw new Error(
      `library: ${meta.entry.slug}: the leaf model covers ${at} of the edition's ${flat.length} line(s):\n` +
        `  node tools/library/derive.mjs ${meta.entry.slug}`,
    );
  }
  return { model, byLeaf, lineLeaf, keyAt: sig.markerKeyAt, span: model.totals.span };
}

/**
 * THE THREE SIGNALS, RECONCILED (plan §4.2), and every disagreement reported.
 *
 *  1. the item's own page-number pass, per leaf (in the derived artifact);
 *  2. the LEAF a marker in the text stands on, measured by aligning the two line
 *     streams — this is what makes a page boundary structural rather than inferred;
 *  3. the transcription's own running heads and bare folios (read above).
 *
 * The third signal decides what is SERVED: a number no source read is never
 * invented. The second decides two things the text alone cannot:
 *
 *   - a marker the ±1 stride rule of `reconcile` REFUSED is re-read when its own
 *     reading is the page its leaf carries. The stride rule refuses a marker whose
 *     neighbours do not supply the step; a leaf supplies the step by construction,
 *     and where the two agree the refusal was arithmetic about a missing marker,
 *     not a disagreement about the print. (MEASURED on this volume: the folio "43"
 *     at the foot of leaf 49, refused because leaf 48 is blank in the
 *     transcription and carries no marker for page 42.)
 *   - a leaf boundary the transcription does not mark AT ALL gets a marker that
 *     carries its leaf and NO page number. It is emitted with `how: "leaf"`, which
 *     is exactly what it is: a page boundary established structurally, whose
 *     printed number could not be read.
 *
 * Nothing is merged silently: every case above and every marker that does not
 * stand at its leaf's own first line goes into the document's `findings`.
 */
function applyLeaves(markers, leaves, findings) {
  const ordered = [...markers.values()].sort((a, b) => a.at - b.at);
  for (const m of ordered) {
    m.leaf = m.at < leaves.lineLeaf.length ? leaves.lineLeaf[m.at] ?? null : null;
    const lf = m.leaf == null ? null : leaves.byLeaf.get(m.leaf);
    if (!lf) continue;
    m.leafAt = m.at - lf.start;
    if (m.value == null || m.page != null) continue;
    if (lf.page == null || lf.page !== m.value) continue;
    m.page = lf.page;
    m.how = m.kind === 'head' ? 'head' : 'folio';
    m.reRead = true;
    findings.push(
      `page ${m.page}: the transcription reads ${JSON.stringify(m.raw)} at line ${m.leafAt + 1} of ${lf.lines} of ` +
        `leaf ${lf.leaf} — the leaf's own page — and the ±1 stride rule had refused it because the marker before it ` +
        `is not the page before it. The leaf supplies the step the text alone could not, so the reading stands.`,
    );
  }
  for (const m of ordered) {
    if (m.leafAt === undefined || m.leafAt === 0) continue;
    const lf = leaves.byLeaf.get(m.leaf);
    const where =
      `stands at line ${m.leafAt + 1} of ${lf.lines} of leaf ${lf.leaf} — the foot of the leaf — ` +
      `and not at its first line`;
    findings.push(
      m.page == null
        ? `a page marker (${JSON.stringify(m.raw)}) ${where}. Its leaf's own head reads page ${lf.page}, ` +
          `so this is a second, damaged reading of a folio the leaf already has, and it is refused.`
        : `page ${m.page} (${JSON.stringify(m.raw)}) ${where}, which is where this volume prints the folio of a ` +
          `page whose division opens on it; the leaf is that page, so the reading stands where it is printed.`,
    );
  }
  /* 3. The leaf boundaries the transcription carries no marker for at all. Only
   * the numbered span: outside it the model has no page to place, and a boundary
   * marker with nothing on either side of it is furniture of our own making. */
  const accepted = ordered.filter((m) => m.page != null && m.leaf != null);
  if (!accepted.length) return;
  const lo = Math.min(...accepted.map((m) => m.leaf));
  const hi = Math.max(...accepted.map((m) => m.leaf));
  const marked = new Set(ordered.map((m) => m.leaf).filter((n) => n != null));
  for (const lf of leaves.model.leaves) {
    if (lf.leaf < lo || lf.leaf > hi || lf.lines === 0 || marked.has(lf.leaf)) continue;
    const key = leaves.keyAt(lf.start);
    if (!key) continue;
    markers.set(key, {
      kind: 'leaf',
      raw: null,
      value: null,
      page: null,
      how: 'leaf',
      at: lf.start,
      leaf: lf.leaf,
      leafAt: 0,
    });
    marked.add(lf.leaf);
    findings.push(
      `leaf ${lf.leaf}: the transcription carries no running head for this leaf at all, and nothing on it reads as ` +
        `a page number, so the boundary stands here UNNUMBERED` +
        (lf.page == null
          ? ' (the leaf index has no number for it either)'
          : ` (the leaf index fills in ${lf.page} from the leaves around it, which is a number nothing on the leaf ` +
            `reads, and it is NOT served as one)`) +
        `.`,
    );
  }
}

/**
 * Extract one stored edition into the served document (plan §4.1).
 *
 * `meta` is the shelf entry (`{slug, lang, item}`) plus the sha256 of the
 * transcription this document was built from. The return value is exactly the
 * document that is emitted at `/library/<slug>/t`.
 *
 * A LEAF-ACCURATE PAGE MODEL IS USED WHEN THE REPO STORES ONE (phase 4, §4.6):
 * `meta.derivs` is the model (or `null` to read the text without it, which is
 * what the diff between the two modes is made of). When it is absent the stored
 * artifact is loaded if there is one, and when there is none the document is the
 * txt-mode one: the shelf's other texts have no derivatives, and a text whose page
 * model rests only on its own running heads is honest, just less accurate.
 */
export function extract(src, meta) {
  const entry = meta.entry;
  const cfg = TEXT_RULES[entry.slug] || {};
  /* The rules come from the reviewed edits file, not from this module, and the
   * whole list is loaded before anything is read: the extraction NEEDS the
   * `opener` class to find a section at all, and the document ships every rule
   * to the reading view. The list's order is the file's order (plan §7). */
  const { edits } = loadEdits(entry.slug);
  const openers = edits.filter((c) => c.cls === 'opener');

  /* 1. The library's stamp is not text (plan §4.5): recorded, then dropped. */
  const sig = pageSignals(src, entry);
  const { lines, markers, junk, dropped } = sig;

  /* 2. Page furniture, consumed before anything is read as a heading (§4.2).
   * `reconcile` has already given every marker the page the TRANSCRIPTION's own
   * readings support; step 2b then reads the leaves. */
  const leafModel = meta.derivs !== undefined ? meta.derivs : meta.leaf === false ? null : loadDerivs(entry.slug, meta.sha256);
  const leaves = leafModel ? alignLeaves(sig, leafModel, meta) : null;
  const pageFindings = [];
  if (leaves) applyLeaves(markers, leaves, pageFindings);

  /* 3. The document, in one pass over the lines. */
  const out = [];
  const findings = [];
  const refs = [];
  const defs = [];
  let region = 'front';
  let cur = null;
  let curNote = null;
  let par = 0;
  let secN = 0;
  let expectedSec = 1;
  let expectedNote = 1;
  let expectedRef = 1;

  const push = (b) => out.push(b);
  // the front matter: the book's own front, served but marked (§4.5). Its
  // fragment anchor (#sfront) is part of the reserved grammar.
  push({ t: 'region', kind: 'front', id: 'sfront' });
  const flush = () => {
    if (!cur || cur.lines.length === 0) {
      cur = null;
      return;
    }
    emitText(cur);
    cur = null;
  };
  const start = (kind, line, { sameParagraph }) => {
    if (!sameParagraph) par++;
    // `sec` runs on past the body (secN is only bumped by an opener), so a block
    // must carry whether it is IN the body: the notes and ads regions were
    // claiming section-18 paragraph anchors, which would have made a #s18-77
    // citation land on a catalogue blurb.
    cur = { kind, lines: [line], par, sec: secN, inBody: region === 'body' };
  };

  /** Emit a joined text block, with its note references as `ref` blocks. */
  function emitText(block) {
    const note = block.note || null;
    // a note's own paragraphs are the note, quoted or not: a quotation inside a
    // note is part of the note (the edition sets it inside the note's paragraph)
    if (block.kind === 'verse' && !note && block.inBody) {
      // verse keeps its lines; a reference inside a verse line splits the verse
      let held = [];
      const emitVerse = () => {
        if (!held.length) return;
        push({ t: 'verse', x: held.join('\n'), ...(block.sec && block.inBody ? { at: anchorOf(block) } : {}) });
        held = [];
      };
      for (const line of block.lines) {
        const runs = splitRefs(line, block);
        for (const run of runs) {
          if (run.t === 'ref') {
            emitVerse();
            push(run);
          } else if (run.x !== '') held.push(run.x);
        }
      }
      emitVerse();
      return;
    }
    // the reader's own join: hard-wrapped lines joined, a word broken across the
    // line break rejoined — the document's text must be the text the page shows
    const runs = splitRefs(joinLines(block.lines), block);
    for (const run of runs) {
      if (run.t === 'ref') push(run);
      else if (run.x !== '')
        push({
          t: note ? 'notedef' : 'p',
          x: run.x,
          ...(note ? { n: note.n, ...(note.lang ? { lang: note.lang } : {}) } : {}),
          ...(block.sec && block.inBody && !note ? { at: anchorOf(block) } : {}),
        });
    }
  }

  const anchorOf = (block) => (block.sec ? `s${block.sec}-${block.par}` : null);

  /** Split one piece of text into text runs and reference blocks, IN ORDER. The
   * reference keeps the transcription's own words — "(note i)" — beside the
   * number it resolves to, so nothing the print has is lost to the link. */
  function splitRefs(text, block) {
    const runs = [];
    let at = 0;
    for (const m of text.matchAll(NOTE_REF)) {
      const before = text.slice(at, m.index).trim();
      if (before !== '') runs.push({ x: before });
      const fit = fitMarker(m[1], expectedRef);
      if (fit.how === 'disagreed') {
        throw new Error(
          `library: ${entry.slug}: the note references do not run in order — reference ${expectedRef} ` +
            `is due here but the transcription reads "(note ${m[1]})" (${fit.value}) — ` +
            `a marker that reads as another number is a disagreement, not something to fit`,
        );
      }
      if (fit.how === 'fitted') {
        findings.push(
          `reference ${expectedRef}: the transcription reads "(note ${m[1]})", which is not a number ` +
            `— the position in the sequence supplies the value`,
        );
      }
      // the reference and the punctuation the print sets against it travel
      // together: "(note 16)." is one run of the edition's text, and splitting
      // the full stop off would leave a block holding one character
      let end = m.index + m[0].length;
      while (end < text.length && /[.,;:!?]/.test(text[end])) end++;
      refs.push({ n: fit.value, token: m[1], how: fit.how, sec: block.sec, par: block.par });
      runs.push({
        t: 'ref',
        n: fit.value,
        x: text.slice(m.index, end),
        ...(block.sec && block.inBody ? { at: anchorOf(block) } : {}),
      });
      expectedRef = fit.value + 1;
      at = end;
    }
    const rest = text.slice(at).trim();
    if (rest !== '') runs.push({ x: rest });
    return runs;
  }

  for (let bi = 0; bi < lines.length; bi++) {
    for (let li = 0; li < lines[bi].length; li++) {
      const line = lines[bi][li];
      const key = `${bi}:${li}`;
      const mark = markers.get(key);

      if (mark) {
        // page furniture: it ends the paragraph run, and claims the page
        flush();
        if (mark.kind === 'head') push({ t: 'rh', x: line });
        push({
          t: 'pb',
          page: mark.page,
          how: mark.how,
          // the LEAF the marker stands on (phase 4): a page boundary is only
          // honest if the leaf it belongs to is named, and a HONEST model is
          // what the reading view turns into "leaf N" where no number was read
          ...(leafModel ? { leaf: mark.leaf } : {}),
          // a number the stride rule had refused, accepted because the leaf it
          // stands on is that page: the document says so on the marker itself,
          // so provenance can count them without reading the findings
          ...(mark.reRead ? { by: 'leaf' } : {}),
          // a bare folio IS its own text (no head words to carry it); the head's
          // words are in the `rh` block above, so the number is not repeated
          ...(mark.kind === 'folio' ? { x: line } : {}),
        });
        // A LEAF BOUNDARY the transcription marks nothing on is a marker and
        // NOT a line of furniture: the line it opens is the page's first line of
        // text and is emitted below like any other (dropping it would lose the
        // page's opening words — a silent loss this document does not allow).
        if (mark.kind !== 'leaf') continue;
      }
      if (junk.has(key)) {
        flush();
        push({ t: 'rh', x: line });
        continue;
      }

      const fixed = applyCorrections(line, openers);

      if (line === (cfg.divisions || {}).notes) {
        flush();
        push({ t: 'region', kind: 'notes', id: 'snotes' });
        region = 'notes';
        par = 0;
        curNote = null;
        start('p', line, { sameParagraph: false });
        continue;
      }
      // The ads boundary is a PREFIX test: the colophon line carries OCR runs of
      // spaces and runs on ('PRINTED IN GREAT BRITAIN BY NEILL AND CO., LTD.,
      // EDINBURGH.'), so an equality test never fires.
      const adsRule = (cfg.divisions || {}).ads;
      if (adsRule && (line === adsRule || line.startsWith(adsRule))) {
        flush();
        push({ t: 'region', kind: 'ads' });
        region = 'ads';
        par = 0;
        curNote = null;
        start('p', line, { sameParagraph: false });
        continue;
      }

      const open = OPENER.exec(fixed);
      if (open && region === 'front') {
        if (Number(open[1]) !== expectedSec) {
          throw new Error(
            `library: ${entry.slug}: section ${expectedSec} is expected here but the text opens ` +
              `section ${open[1]} (${JSON.stringify(line.slice(0, 60))}) — the divisions do not run 1…N`,
          );
        }
        flush();
        push({ t: 'region', kind: 'body' });
        region = 'body';
        par = 0;
        secN = expectedSec;
        push({ t: 'sec', n: secN, id: `s${secN}` });
        expectedSec++;
        start('p', line, { sameParagraph: false });
        continue;
      }
      if (open && region === 'body' && Number(open[1]) === expectedSec) {
        // a division the transcription ran into the paragraph before it (§11 of
        // this volume opens mid-paragraph): the paragraph break the print has is
        // restored here, and the line begins the new section's first paragraph.
        // The number must be the one DUE — that is what makes a mid-paragraph
        // opener safe to look for at all.
        flush();
        par = 0;
        secN = expectedSec;
        push({ t: 'sec', n: secN, id: `s${secN}` });
        expectedSec++;
        start('p', line, { sameParagraph: false });
        continue;
      }

      const defMark = region === 'notes' ? NOTE_MARK.exec(fixed) : null;
      if (defMark && li === 0) {
        flush();
        const fit = fitMarker(defMark[1], expectedNote);
        if (fit.how === 'disagreed') {
          throw new Error(
            `library: ${entry.slug}: the note definitions do not run in order — note ${expectedNote} ` +
              `is due here but the transcription reads "(${defMark[1]})" (${fit.value}) — ` +
              `a marker that reads as another number is a disagreement, not something to fit`,
          );
        }
        if (fit.how === 'fitted') {
          findings.push(
            `note ${expectedNote}: the transcription's marker "(${defMark[1]})" is not a number ` +
              `— the position in the sequence supplies the value`,
          );
        }
        defs.push({ n: fit.value, token: defMark[1], how: fit.how });
        expectedNote = fit.value + 1;
        par++;
        curNote = { n: fit.value };
        cur = { kind: 'p', lines: [line], par, sec: 0, note: curNote };
        continue;
      }

      if (li === 0) {
        // a source block is a paragraph, so a block boundary ends the run —
        // unless the page furniture above already did (a paragraph that runs
        // over a page break keeps its text blocks, one per side of the break)
        flush();
        start(isQuoted(lines[bi]) ? 'verse' : 'p', line, { sameParagraph: false });
      } else if (cur) {
        cur.lines.push(line);
      } else {
        start('p', line, { sameParagraph: false });
      }
      // a note that runs past a page break continues: the accumulator keeps the
      // note it belongs to, so the definition is one note with a page marker in
      // the middle of it rather than a note that stops at the page
      if (region === 'notes' && curNote && !cur.note) cur.note = curNote;
    }
  }
  flush();

  /* 4. The properties the plan requires the extraction to have, asserted here so
   * a silent mis-read cannot be served: the divisions run 1…N with none missing
   * and none duplicated, and every note marker runs 1…M and is referenced. */
  if (expectedSec - 1 !== 18) {
    throw new Error(
      `library: ${entry.slug}: the text's divisions do not run 1…18 — ` +
        `${expectedSec - 1} were found, so a section is either not detected (its opener is still ` +
        `mangled) or detected twice (an opener that is not one); the offender is the division whose ` +
        `number is not the one due`,
    );
  }
  const consecutive = defs.every((d, i) => d.n === i + 1);
  if (!consecutive) {
    const bad = defs.find((d, i) => d.n !== i + 1);
    throw new Error(
      `library: ${entry.slug}: the note definitions do not run 1…${defs.length} — ` +
        `note ${bad.n} stands where ${defs.indexOf(bad) + 1} is due (marker "${bad.token}")`,
    );
  }
  const referenced = new Set(refs.map((r) => r.n));
  const unreferenced = defs.filter((d) => !referenced.has(d.n));
  if (unreferenced.length) {
    throw new Error(
      `library: ${entry.slug}: ${unreferenced.length} note definition(s) nothing refers to ` +
        `(${unreferenced.map((d) => d.n).join(', ')}) — every note of this edition is referenced in the text`,
    );
  }
  const undefinedRef = refs.find((r) => r.n < 1 || r.n > defs.length);
  if (undefinedRef || refs.length > defs.length) {
    throw new Error(
      `library: ${entry.slug}: a note reference resolves to no definition — ` +
        `${refs.length} references against ${defs.length} definitions, so at least one definition was ` +
        `missed (a marker the extraction does not see, or a note whose paragraph start is not a line start)`,
    );
  }

  /* 4b. The language of the notes. The one Latin passage in this edition is a
   * quotation inside note (6), laid over two blocks by a page break; the answer
   * is computed once for the note and carried by all its blocks. */
  const noteText = new Map();
  const seenNote = new Set();
  for (const b of out) {
    if (b.t !== 'notedef') continue;
    noteText.set(b.n, `${noteText.get(b.n) || ''} ${b.x}`);
  }
  for (const b of out) {
    if (b.t === 'notedef' && latinLang(noteText.get(b.n))) b.lang = 'la';
  }

  /* 5. The page a position is printed on, and the sections' first page. A
   * position belongs to the last page marker at or before it; the text before
   * the first marker (the body's opening page, whose folio the transcription
   * put at the foot) takes the first recovered page. */
  const firstPage = (() => {
    for (const b of out) if (b.t === 'pb' && b.page != null) return b.page;
    return null;
  })();
  let here = null;
  for (const b of out) {
    if (b.t === 'pb' && b.page != null) here = b.page;
    else if (b.t === 'sec') b.page = here != null ? here : firstPage;
  }

  /* 5b. The fragment grammar, materialised: `#s<n>` a division, `#p<n>` a printed
   * page, `#n<n>` a note, `#r<n>` the reference a note returns to. The grammar is
   * the plan's (§3) and it is carried in the document rather than left to the
   * reader app to invent, so the anchors a citation names exist in the artefact
   * that serves them — and #s<sec>-<par> (the reference's own place) is reserved
   * on every `ref` as `at`, not closed off. */
  for (const b of out) {
    if (b.t === 'pb' && b.page != null) b.id = `p${b.page}`;
    else if (b.t === 'ref') b.id = `r${b.n}`;
    else if (b.t === 'notedef' && !seenNote.has(b.n)) {
      seenNote.add(b.n);
      b.id = `n${b.n}`; // the note's first block carries the anchor: a note laid
      // over two pages is one note, and two elements cannot hold one id
    }
  }
  const ids = out.filter((b) => b.id).map((b) => b.id);
  const dupe = ids.find((x, i) => ids.indexOf(x) !== i);
  if (dupe) {
    throw new Error(
      `library: ${entry.slug}: two blocks claim the anchor "${dupe}" — an anchor two elements share is ` +
        `not an anchor (this happens when a note is referenced twice, and the fix is a per-reference anchor)`,
    );
  }

  /* 5c. THE BLOCKS A RULE CANNOT SEE ACROSS. The transcription splits a sentence
   * at every blank line, and sometimes the print's text simply continues across
   * one — a page break mid-word (`…patient perse-` | `verance.`, printed pages 38
   * and 39) or words lost at the break (`…but they also assu` | `'symbol of all
   * invisible powers`). The reading view joins consecutive text blocks, but a
   * RULE is applied per block, so a find that spans the join can never fire, and
   * no per-block reading can state it: `assu` -> `assumed` leaves its own find
   * standing, and `verance` -> `perseverance` does too.
   *
   * So a rule may be marked `"join": true`, meaning its find CROSSES the boundary
   * between two adjacent text blocks. The two are merged here, before the rules
   * run, so the find is inside the one block and every engine (this one, the
   * reader, the search) sees the same text — and the reader renders the joined
   * sentence as one paragraph, which is what the print has.
   *
   * The pair is located BY THE FIND, not by an anchor: `at` is a paragraph label
   * and a paragraph spans several blocks, so an anchor does not name one block
   * (MEASURED — `s3-1` labels two blocks, and joining by it merged the wrong
   * pair). The merge condition is exact: the find is in the two blocks' joined
   * text and in NEITHER alone. The merged block keeps the first block's place;
   * anchors are fixed strings assigned during assembly, so nothing renumbers. */
  const joins = edits.filter((r) => r.join && r.action !== 'leave');
  if (joins.length) {
    // A `join` rule whose find already sits inside ONE block would never trigger
    // the merge and would still fire like an ordinary rule — a flag that does
    // nothing, which is unreviewed machinery. So it is refused up front: the flag
    // is only meaningful when the find SPANS a seam.
    for (const r of joins) {
      const inside = out.some(
        (b) => (b.t === 'p' || b.t === 'verse' || b.t === 'ref') && typeof b.x === 'string' && b.x.includes(r.find),
      );
      if (inside) {
        throw new Error(
          `library: ${entry.slug}: the rule "${r.find}" is marked "join" but its find lies inside a single block — ` +
            `the join would do nothing`,
        );
      }
    }
    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i + 1 < out.length && !merged; i += 1) {
        const a = out[i];
        const b = out[i + 1];
        if (!(a.t === 'p' || a.t === 'verse')) continue;
        if (!(b.t === 'p' || b.t === 'verse' || b.t === 'ref')) continue;
        const glue = a.t === 'p' && b.t === 'p' ? '' : ' ';
        const joined = `${a.x || ''}${glue}${b.x || ''}`;
        const crosses = joins.some(
          (r) => joined.includes(r.find) && !(a.x || '').includes(r.find) && !(b.x || '').includes(r.find),
        );
        if (!crosses) continue;
        out[i] = { ...a, x: joined };
        out.splice(i + 1, 1);
        merged = true;
      }
    }
  }

  /* 6. The rules the reading view applies — the reviewed list, in the file's own
   * order. They are loaded above (the extraction needs the `opener` class), and
   * they are shipped with the document exactly as plan §7 says: corrections travel
   * as RULES, never as a second text, so the transcription above stays verbatim
   * and the diff view is this list. */
  const corrections = edits;

  /* 6a. THE POLICY'S ONE EXCEPTION, ASSERTED (§7) — the assertion itself is
   * `checkFrontMatter` below, so the smoke can call the same code over a fixture
   * instead of re-stating it. */
  checkFrontMatter({ slug: entry.slug, blocks: out, dropped: dropped.map((x) => ({ x })), corrections });

  /* 7. The table of contents: generated, from the divisions the edition itself
   * makes, each entry carrying the section's own opening words.
   *
   * The TITLE is generated apparatus — the 1917 print has no contents page — and
   * it is derived from the CORRECTED opening words (option (a) of the phase-3
   * brief, not (b)): the title is built from the same words, with the same rules,
   * in the same order, as the reading view applies to that same line, so the
   * contents list and the reading cannot disagree about the sentence a reader
   * meets first. Deriving it from the whole corrected view instead would mean the
   * client deriving apparatus from text it has already rendered, for no gain.
   *
   * Every entry also carries the RAW derivation (`raw`) — the title the
   * transcription's own damaged words give — because that is what the
   * transcription view must show and what the review diffs against. A title still
   * damaged after correction is marked `damaged` and the entry names the words: it
   * is NEVER repaired by inventing a reading. */
  const toc = [];
  for (let i = 0; i < out.length; i++) {
    const b = out[i];
    if (b.t !== 'sec') continue;
    const body = out.slice(i + 1).find((x) => x.t === 'p' || x.t === 'verse');
    const line = body ? body.x.split('\n')[0] : '';
    // `raw` is the title with NO rule applied — the transcription's own words,
    // which is what the transcription view must show; `title` is the same words
    // through the full rule list, which is what the reading view applies.
    const rawTitle = sectionTitle(line.replace(OPENER, ''));
    const title = sectionTitle(applyCorrections(line, corrections).replace(OPENER, ''));
    const harm = titleDamage(rawTitle, title, corrections);
    toc.push({
      id: b.id,
      n: b.n,
      title,
      raw: rawTitle,
      // a title the transcription damaged beyond what the rules can read: the
      // contents list says so instead of showing damaged words as a title, and the
      // words themselves stand in `raw` for the reader and the review
      ...(harm.damaged ? { damaged: true, damagedWords: harm.words } : {}),
      page: b.page,
    });
  }
  const titles = toc.map((t) => t.title);
  if (new Set(titles).size !== titles.length) {
    throw new Error(`library: ${entry.slug}: two sections derive the same title — the titles must distinguish them`);
  }

  /* 7b. THE POLICY, COUNTED — on the text the reader is given. The base policy is
   * "substitute the reading when one is recorded, otherwise leave the marker in
   * place", so the numbers are (i) the readings applied and (ii) the damage the
   * reading view still shows: the damaged words and the STANDALONE MARKERS the
   * rules did not reach. All are measured on the served text AFTER the rules run:
   * a word the rules resolved no longer carries damage, and one they did not is
   * exactly the word whose marker a reader can still see.
   *
   * The DOMAIN is the text the reading view renders: every `p`, `verse` and
   * `notedef` block, in document order, one block at a time, with the hard-wrapped
   * lines joined as the reader joins them. That is the app's own rendering set
   * (`Reader.Document.flow` → `FPara`/`FNote`); running heads (`rh`) are furniture
   * the reading view suppresses and the transcription view shows, and the page
   * markers (`pb`) are chrome. MEASURED, and why the domain is stated here: the
   * earlier domain was the section-labelled body paragraphs only, which left the
   * note definitions and the unlabelled paragraphs of the front matter and the
   * advertisements outside the census — so the count said 2 while the reading view
   * showed 33 damage characters. A count over less than the reading view is not a
   * count of the reading view. */
  const readingViewText = out
    .filter((b) => b.t === 'p' || b.t === 'verse' || b.t === 'notedef')
    .map((b) => b.x.replace(/\n/g, ' '))
    .join(' ');

  /* 7c. The hit table: every rule, and how many times it fires in the text the
   * reading view is given. It is measured here, shipped with each rule, and the
   * build FAILS on a rule that fires zero times (`checkEdits`, called by the
   * build — the acceptance rule of plan §7). */
  const report = editReport(out, corrections);
  report.forEach((r, i) => {
    corrections[i].hits = r.hits;
  });
  const policy = policyReport(readingViewText, corrections);

  /* 7d. What the LEAF MODEL found is a finding like any other, and the document
   * keeps it: every page marker that does not stand at its leaf's own boundary,
   * every marker the leaf re-read, and every boundary the transcription carries
   * no marker for. The build prints them, so the difference between the txt-mode
   * page model and the leaf-accurate one is accounted for one case at a time. */
  findings.push(...pageFindings);

  const doc = {
    slug: entry.slug,
    lang: entry.lang || 'en',
    source: {
      item: entry.item || null,
      sha256: meta.sha256,
      // what the page model rests on, named in the document itself: the leaves
      // when there is a leaf model, and nothing but the transcription otherwise
      ...(leafModel
        ? {
            leaves: {
              item: leafModel.item,
              leaves: leafModel.totals.leaves,
              withText: leafModel.totals.withText,
              numbered: leafModel.totals.numbered,
              detected: leafModel.totals.detected,
              interpolated: leafModel.totals.interpolated,
              offset: leafModel.totals.offset,
              // the cross-check's own outcome, so a page that says what the
              // provenance claims can be checked against it (the disagreeing
              // pages, if any, are named — never merged into the text's reading)
              agreed: leafModel.agreement ? leafModel.agreement.agree : null,
              textOnly: leafModel.agreement ? leafModel.agreement.textOnly : null,
              leafOnly: leafModel.agreement ? leafModel.agreement.leafOnly : null,
              disagreed: leafModel.agreement ? leafModel.agreement.disagree : null,
            },
          }
        : {}),
    },
    // the page model, in the order the markers stand in the text. A LEAF-ACCURATE
    // model names the leaf each boundary belongs to and says HOW the page was
    // read; the txt-mode model has no leaves to name (which is what `leaf: null`
    // says — not an invented one).
    pages: [...markers.values()]
      .sort((a, b) => a.at - b.at)
      .map((m) => (leafModel ? { leaf: m.leaf ?? null, page: m.page, how: m.how } : { leaf: null, page: m.page })),
    toc,
    blocks: out,
    corrections,
    // THE DAMAGE SET, from the base policy to the reading view. The app marks a
    // character of this set where a damaged word has no recorded reading, so the
    // reader can SEE that the word is damaged instead of reading a silent edit.
    damage: loadBasePolicy().damage,
    correctionsMeta: {
      reviewed: true,
      order: 'the order this list gives them, first to last, applied to every occurrence one text block at a time',
      policy: {
        rule: loadBasePolicy().rule,
        damage: loadBasePolicy().damage,
        base: 'the shared base policy every text inherits',
        states: loadBasePolicy().states,
      },
      classes: Object.fromEntries(
        EDIT_CLASSES.map((k) => [k, corrections.filter((c) => c.cls === k).length]),
      ),
      hits: Object.fromEntries(
        EDIT_CLASSES.map((k) => [
          k,
          corrections.filter((c) => c.cls === k).reduce((a, c) => a + c.hits, 0),
        ]),
      ),
      repeated: report.filter((r) => r.hits > 1).map((r) => ({ cls: r.cls, find: r.find, hits: r.hits })),
      readings: policy.readings,
      leftWordCount: policy.left.damaged,
      leftWords: policy.left.words,
      leftMarkerCount: policy.left.markers.length,
      leftMarkers: policy.left.markers,
      leftDamageChars: policy.left.chars,
      readingView:
        'the text the reading view renders: every p, verse and notedef block in document order, rules ' +
        'applied, counted after they run. Running heads are furniture the view suppresses; page markers ' +
        'are chrome.',
      damagedWords: policy.raw.damaged,
      repairedWords: policy.raw.repaired,
      unrepairedWords: policy.raw.unrepaired,
      unrepairedList: policy.raw.words,
      damagedTitles: toc.filter((t) => t.damaged).map((t) => t.n),
      note:
        'The reading view of this text is produced by these rules and nothing else, under the policy in ' +
        'tools/library/edits/_base.json: the transcription served here is verbatim and uncorrected, and each ' +
        'rule is applied to it in this order. Every rule fires at least once in the served text, and one that ' +
        'fires nowhere is caught before this document is served, because a rule that matches nothing is ' +
        'machinery nothing read. The "opener" rules are readings the print requires for its divisions to run ' +
        'in order. The "digit" rules are the printed numbers and note markers the transcription wrote through ' +
        'an OCR confusion, each pinned to the line or marker it was read from. The "reading" rules record the ' +
        "print's own word for a damaged run, so the reading view shows what the edition says instead of a " +
        'word the transcription left damaged. The "review" rules record that a reading is NOT determinable there (action ' +
        '"leave"), and a damaged word with no rule at all is left the same way: the policy substitutes a ' +
        'reading when one is recorded and otherwise LEAVES THE MARKER IN PLACE, visible in the reading view. ' +
        'The damage that survives is counted in TWO classes, kept apart because they are different things: ' +
        'the damaged WORDS no rule resolved, and the STANDALONE MARKERS — one or more damage characters ' +
        'standing as their own token between words, a lost space or the scanner\u2019s debris — which are NOT ' +
        'words and are not counted as any. Both counts, the damage characters they account for between ' +
        'them, and a section title the rules still leave damaged, are stated below.',
    },
    dropped: dropped.map((x) => ({ x, why: 'the library stamp, not text' })),
    findings,
  };
  return doc;
}

/** A block the print sets apart by quotation — the plan's `verse` type. Its lines
 * are kept, so a quoted passage appears as the edition sets it rather than as one
 * justified line.
 *
 * MEASURED, and why the rule is only "it opens with a quotation": line length
 * does NOT separate verse from prose in these transcriptions. The 1917 Porphyry's
 * prose blocks are as ragged as its verse blocks (a prose block 0.76 ragged, the
 * Odyssey quotation 0.93), because the line breaks are the OCR's, not the
 * printer's measure — so "short lines" would call the prose verse and "long
 * lines" would call the verse prose. What the class honestly carries here is a
 * QUOTATION the edition sets apart, and that is what the leading quotation mark
 * identifies (11 in this text's body). */
function isQuoted(lines) {
  // a real quotation mark, not the stray apostrophe the transcription drops in
  // ("'symbol oT aH invisible powers" opens no quotation)
  return lines.length > 0 && /^["\u201c\u201d]/.test(lines[0]);
}

/** Inflections that are the signature of Latin running text, and are not English
 * words: a scan of the whole edition finds them ONLY inside note (6)'s quotation
 * (MEASURED: four in "…flammarum congestione plenissimam… mercibus conspicatur
 * … praesidebant", one in the line before it, and none anywhere else in the
 * book). The test is therefore a count of inflections, not a judgement about
 * taste, and it is the whole text's count: no other block reaches one. */
const LATIN_INFLECTION = /(ibus|arum|orum|atur|ebant|entem|issim|ntur|isse)$/;

/** Is this a passage of Latin? Answered on a NOTE's whole text — the edition's
 * Latin is one quotation inside note (6), and a page break inside that note
 * splits it over two blocks, so the question is asked of the note and the answer
 * is carried by every block of it. */
export function latinLang(text) {
  const words = text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  return words.filter((w) => LATIN_INFLECTION.test(w)).length >= 4;
}

/**
 * The census of the transcription's damaged words, counted on the text the
 * reading view is given and split by whether a rule reaches them. It is a
 * PARTITION, so the three counts add up and the provenance cannot tell a story
 * the numbers do not support:
 *
 *   `damaged`    distinct WORDS — a word being a token with a letter in it, not
 *                the scan's debris — that carry a character the census marks as
 *                damage;
 *   `repaired`   of those, the ones a rule NAMES — its `find` is the whole word,
 *                so the rule is a statement about that word;
 *   `unrepaired` the rest. A rule that only reaches part of the word may still
 *                remove the character that damaged it (`^and` repairs the opening
 *                of `qreneratioi^and`), so "unrepaired" means exactly this and no
 *                more: no rule names the word, and the letters it lost are left
 *                as the transcription has them.
 *
 * The unrepaired words are counted, named in the build log, and never turned into
 * a rule: a rule that guessed would be worse than the damage.
 *
 * A WORD here is exactly "a whitespace token with a letter in it". The other half
 * of the damage — a marker standing ALONE between words, with no letter to
 * qualify it as a word — is counted by `markerCensus`, deliberately apart from
 * this one. The two are not the same thing and merging them would hide which is
 * which; the split is total, because a token either has a letter or does not.
 */
export function damageCensus(text, finds) {
  const rules = new Set(finds || []);
  const seen = new Set();
  const unrepaired = new Set();
  for (const rawTok of text.split(/\s+/)) {
    const tok = rawTok.replace(/^[.,;:?!()"'„“”\[]+/, '').replace(/[.,;:?!()"“”\]|\\]+$/, '');
    if (tok === '' || !/[A-Za-z]/.test(tok)) continue; // a word, not the scan's debris
    if (seen.has(tok) || !damageRegex().test(tok)) continue;
    seen.add(tok);
    if (!rules.has(tok)) unrepaired.add(tok);
  }
  return {
    damaged: seen.size,
    repaired: seen.size - unrepaired.size,
    unrepaired: unrepaired.size,
    words: [...unrepaired],
  };
}

/**
 * THE STANDALONE MARKERS — the half of the damage a word census cannot see, and
 * the reason the model needed widening.
 *
 * MEASURED on this edition's reading view: the words census reported 2 damaged
 * words while the reading view still showed 33 damage characters. The rest were
 * not in words at all — they were markers standing as their OWN token between
 * words (`of ^ any other matter`, `petitioner. _ Thus`, a `\` alone between
 * `place` and `which`), which the word census skips by construction
 * (`if (tok === '' || !/[A-Za-z]/.test(tok)) continue`) because it is looking for
 * words.
 *
 * A STANDALONE MARKER is a whitespace token that has NO LETTER and carries at
 * least one character of the policy's damage set. It is DAMAGE on the same terms
 * as a damaged word: either the scan lost the SPACE the print has there, or the
 * token is the scan's debris (page furniture, a shattered run). It is NOT a word,
 * so it is counted here and never mixed into the word count: a reader told "2
 * damaged words" is told the truth about words, and the honest statement about
 * the damage as a whole is "2 damaged words, 13 standalone markers".
 *
 * The tokens are reported AS THEY STAND in the reading view (the raw token, not
 * an edge-stripped one), because a marker has no word around it to strip to: what
 * the list names is what the reader sees.
 */
export function markerCensus(text) {
  const seen = new Set();
  for (const tok of text.split(/\s+/)) {
    if (tok === '' || !damageRegex().test(tok)) continue;
    if (/[A-Za-z]/.test(tok)) continue; // a damaged word: damageCensus's half
    seen.add(tok);
  }
  return [...seen];
}

/** How many characters of the policy's damage set the text still shows. The
 * number the two censuses have to account for between them, counted on the same
 * text they are counted on. */
export function damageCharCount(text) {
  let n = 0;
  for (const c of text) if (damageRegex().test(c)) n++;
  return n;
}

/**
 * THE POLICY, COUNTED — the numbers the provenance reports and the smoke asserts.
 *
 * The base policy is "substitute the reading when one is recorded, otherwise leave
 * the marker in place", so there are exactly two outcomes to count, and they are
 * counted on the text the reader is given, not on the file:
 *
 *   `recorded`  the rules of class `reading`: every one records the print's word,
 *               and every one fires at least once (the build fails otherwise);
 *   `applied`   their OCCURRENCES in the served text — the readings the reading
 *               view actually shows;
 *   `left`      the damage the reading view still shows, after every reading has
 *               been applied, in its TWO classes, kept apart because they are
 *               different things and one number would hide that:
 *                 `left.words`   the distinct damaged WORDS no rule resolved;
 *                 `left.markers` the distinct STANDALONE MARKERS between words;
 *                 `left.chars`   the damage characters still standing in the view,
 *                                which those two lists account for item by item.
 *
 * The partition is honest without a `repaired` count: a word is either shown as
 * its recorded reading (it no longer carries damage) or left as the transcription
 * has it (it does). Every reading that matches nothing is caught before this, so
 * `recorded === appliedRules`.
 */
export function policyReport(rawText, corrections) {
  const rules = corrections.map((c) => ({ find: c.find, repl: c.repl, action: c.action }));
  const view = applyEditsCounted(rawText, rules);
  const rawCensus = damageCensus(rawText, corrections.map((c) => c.find));
  const leftWords = damageCensus(view, []);
  const readings = corrections.filter((c) => c.cls === 'reading');
  const applied = readings.filter((c) => c.hits > 0).length;
  const occurrences = readings.reduce((a, c) => a + (c.hits || 0), 0);
  const leaves = corrections.filter((c) => c.action === 'leave');
  return {
    raw: rawCensus,
    left: { ...leftWords, markers: markerCensus(view), chars: damageCharCount(view) },
    readings: {
      recorded: readings.length,
      applied,
      occurrences,
      leavesRecorded: leaves.length,
      leavesFired: leaves.filter((c) => c.hits > 0).length,
    },
  };
}

/** What the document holds, for provenance and for the smoke test. */
export function counts(doc) {
  const byType = {};
  for (const b of doc.blocks) byType[b.t] = (byType[b.t] || 0) + 1;
  const pages = { detected: 0, folio: 0, interpolated: 0, refused: 0 };
  for (const b of doc.blocks) {
    if (b.t !== 'pb') continue;
    if (b.how === 'head') pages.detected++;
    else if (b.how === 'folio') {
      pages.folio++;
      pages.detected++;
    } else if (b.how === 'interpolated') pages.interpolated++;
    else pages.refused++;
  }
  const regions = doc.blocks.filter((b) => b.t === 'region').map((b) => b.kind);
  const classes = {};
  const hits = {};
  for (const c of doc.corrections) {
    classes[c.cls] = (classes[c.cls] || 0) + 1;
    hits[c.cls] = (hits[c.cls] || 0) + (c.hits || 0);
  }
  /* The LEAF-ACCURATE page model, counted from what the document itself carries:
   * how many boundaries name the leaf they stand on, how many of those stand AT
   * the leaf's first line, how many are boundaries the transcription marks nothing
   * on, and what the leaf index has for the pages the text could not read. */
  const pb = doc.blocks.filter((b) => b.t === 'pb');
  const leaf = {
    model: doc.source && doc.source.leaves ? doc.source.leaves : null,
    boundaries: pb.length,
    named: pb.filter((b) => b.leaf != null).length,
    structural: pb.filter((b) => b.how === 'leaf').length,
    numbered: pb.filter((b) => b.page != null).length,
    unnumbered: pb.filter((b) => b.page == null).length,
    reread: pb.filter((b) => b.by === 'leaf').length,
    leaves: new Set(pb.map((b) => b.leaf).filter((n) => n != null)).size,
    modelLeaves: doc.source && doc.source.leaves ? doc.source.leaves.leaves : null,
  };
  return {
    blocks: doc.blocks.length,
    byType,
    regions,
    sections: doc.toc.length,
    notes: doc.blocks.filter((b) => b.t === 'notedef').map((b) => b.n).filter((n, i, a) => a.indexOf(n) === i).length,
    refs: doc.blocks.filter((b) => b.t === 'ref').length,
    pages,
    leaf,
    corrections: classes,
    correctionHits: hits,
    damagedTitles: doc.toc.filter((t) => t.damaged).map((t) => t.n),
    correctionsMeta: doc.correctionsMeta || null,
  };
}

/**
 * THE DIFF BETWEEN THE TWO PAGE MODELS (plan §4.6, the acceptance test).
 *
 * Phase 4 does not rewrite the document: it re-derives the PAGE MODEL. So the
 * difference between the txt-mode document and the leaf-accurate one must be
 * exactly the page model and nothing else — and this function is what says so,
 * item by item, so the build can print every difference and the smoke can assert
 * that the list is the whole of it. The two documents are taken as a parameter
 * rather than the files, because the point is to compare the two READINGS of one
 * edition, not two builds of it.
 *
 * Each difference is `{kind, what}`: `kind` is the place in the document, `what`
 * the difference itself. Anything the diff cannot pair up is a difference too —
 * an unexplained one, which is the failure this test exists to catch.
 */
export function diffDocs(txt, leaf) {
  const out = [];
  const nonMarker = (doc) => doc.blocks.filter((b) => b.t !== 'pb').map((b) => JSON.stringify(b));
  const a = nonMarker(txt);
  const b = nonMarker(leaf);
  if (a.length !== b.length) {
    out.push({ kind: 'text', what: `the two documents carry ${a.length} and ${b.length} non-marker block(s)` });
  }
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      out.push({
        kind: 'text',
        what: `block ${i} of the text differs: ${a[i].slice(0, 60)}… against ${b[i].slice(0, 60)}…`,
      });
      break;
    }
  }
  const pbTxt = txt.blocks.filter((x) => x.t === 'pb');
  const pbLeaf = leaf.blocks.filter((x) => x.t === 'pb');
  let i = 0;
  let j = 0;
  while (i < pbTxt.length || j < pbLeaf.length) {
    const t = pbTxt[i];
    const l = pbLeaf[j];
    const same = t && l && t.page === l.page && t.how === l.how;
    if (same) {
      if (t.leaf !== l.leaf || (l.leaf != null && t.leaf == null)) {
        out.push({ kind: 'pb.leaf', what: `page ${t.page == null ? '—' : t.page}: the marker gains leaf ${l.leaf}` });
      }
      i++;
      j++;
      continue;
    }
    if (l && t && l.how === 'leaf' && l.page == null) {
      out.push({
        kind: 'pb.added',
        what: `leaf ${l.leaf}: a page boundary the transcription carries no marker for, added UNNUMBERED (how: leaf)`,
      });
      j++;
      continue;
    }
    if (t && l) {
      out.push({
        kind: 'pb.changed',
        what:
          `a marker of the transcription (${JSON.stringify(t.x ?? '')}) was ${t.how} at page ${t.page == null ? '—' : t.page} ` +
          `and is ${l.how} at page ${l.page == null ? '—' : l.page} on leaf ${l.leaf}`,
      });
      i++;
      j++;
      continue;
    }
    out.push({
      kind: l ? 'pb.added' : 'pb.dropped',
      what: l ? `a marker the transcription does not carry (leaf ${l.leaf})` : `a marker the leaf model lost (page ${t.page})`,
    });
    if (l) j++;
    else i++;
  }
  /* The page model (`pages[]`) is the marker list — the same boundaries, in the
   * same order, with the number and the how and nothing else — so it is checked
   * to MIRROR the markers in both documents rather than diffed entry by entry.
   * Diffing it by index would report the leaf-28 insertion as 36 shifted entries,
   * which is a fact about the comparison, not about the page model. What the model
   * changed is said in one place: it gains a leaf on every entry, and it gains the
   * entry for the boundary the markers gained. */
  const mirror = (doc) => {
    const pbs = doc.blocks.filter((x) => x.t === 'pb');
    const pages = doc.pages || [];
    if (pages.length !== pbs.length) return `carries ${pages.length} page model entr(y/ies) for ${pbs.length} marker(s)`;
    for (let k = 0; k < pages.length; k++) {
      if (pages[k].page !== pbs[k].page) return `names page ${pages[k].page == null ? '—' : pages[k].page} for the marker at ${pbs[k].page == null ? '—' : pbs[k].page}`;
      if (pages[k].how !== undefined && pages[k].how !== pbs[k].how) return `says "${pages[k].how}" for a marker its own block says is "${pbs[k].how}"`;
      if ((pages[k].leaf ?? null) !== (pbs[k].leaf ?? null)) return `names leaf ${pages[k].leaf ?? '—'} for a marker its own block puts on leaf ${pbs[k].leaf ?? '—'}`;
    }
    return null;
  };
  for (const [name, doc] of [['the txt-mode document', txt], ['the leaf-accurate document', leaf]]) {
    const bad = mirror(doc);
    if (bad) out.push({ kind: 'pages', what: `${name} ${bad} — the page model is not the marker list` });
  }
  const leafGains = (leaf.pages || []).filter((p, k) => p.leaf != null && (txt.pages[k] || {}).leaf !== p.leaf).length;
  if (leafGains) {
    out.push({
      kind: 'pages.leaf',
      what: `every entry of the page model names the leaf its marker stands on (${leafGains} of ${(leaf.pages || []).length})`,
    });
  }
  return out;
}

/**
 * THE SAME DIFF, AS THE BUILD LOG SAYS IT.
 *
 * The full list is 108 items for this volume, and 106 of them are one rule applied
 * 106 times ("the marker gains its leaf"). Printing all of them would bury the two
 * that are not that rule — which are the entire point of the exercise. So the log
 * gets the count per kind, a SHORT sample of the repeated kind, and every item of
 * a kind that is a change rather than an addition. The smoke asserts the FULL
 * list, item by item, against an independently derived expectation: the log is for
 * a human, the smoke is for the claim.
 */
export function summariseDiff(diff) {
  const byKind = new Map();
  for (const d of diff) byKind.set(d.kind, [...(byKind.get(d.kind) || []), d.what]);
  const lines = [];
  for (const [kind, items] of byKind) {
    const uniform = items.every((w) => /gains leaf \d+$/.test(w));
    if (uniform && items.length > 3) {
      lines.push(`${items.length} marker(s)/entr(ies): ${kind} — each gains the leaf it stands on, e.g. ${items[0]}`);
    } else {
      for (const w of items) lines.push(`${kind}: ${w}`);
    }
  }
  return lines;
}

/* ---------- the two emitted files ---------- */

/** The document as it is served: one block per line, so a reader can inspect it
 * and a diff of two builds is readable. */
export function serialiseDoc(doc) {
  return `${JSON.stringify(doc).replace(/\},\{/g, '},\n{')}\n`;
}

/** The whole text as one plain file: the JS-off fallback and the citation of
 * record. The running heads are furniture and are not repeated here — their page
 * numbers are — and nothing else is dropped: the text is the transcription. */
export function plainText(doc, entry) {
  const lines = [];
  lines.push(entry.edition);
  lines.push('');
  lines.push(
    'The whole text of the edition named above, as transcribed. Nothing here is corrected; ' +
      'the defects of the transcription stand in it. A number in square brackets is a page of ' +
      'the printed volume, and [s1]…[sN] mark the editions own numbered divisions.',
  );
  lines.push('');
  for (const b of doc.blocks) {
    switch (b.t) {
      case 'pb':
        lines.push(b.page == null ? `[p—] ${b.x || ''}`.trim() : `[p${b.page}]`);
        lines.push('');
        break;
      case 'sec':
        lines.push('', `[s${b.n}]`, '');
        break;
      case 'region':
        lines.push('', `[region ${b.kind}]`, '');
        break;
      case 'rh':
        break; // furniture: its page number is the [pN] above
      case 'ref':
        // its words stand in the sentence the reference separates, and the
        // reference is its OWN block — dropping it here lost all 25 markers
        // from the citation of record, so a reader of /plain could not see
        // that a note existed anywhere in the book.
        lines.push(b.x);
        break;
      case 'p':
      case 'verse':
      case 'notedef':
        lines.push(b.x);
        lines.push('');
        break;
      default:
        break;
    }
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

/* ---------- the anchor manifest ---------- */

/** Every anchor a reading may link to, in document order: the sections, the
 * printed pages, the notes, and the two region anchors the fragment grammar
 * reserves (`#sfront`, `#snotes`). */
export function anchorLists(doc) {
  const uniq = (xs) => [...new Set(xs)];
  return {
    regions: uniq(doc.blocks.filter((b) => b.t === 'region' && b.id).map((b) => b.id)),
    sections: uniq(doc.blocks.filter((b) => b.t === 'sec').map((b) => b.id)),
    pages: uniq(doc.blocks.filter((b) => b.t === 'pb' && b.page != null).map((b) => `p${b.page}`)),
    notes: uniq(doc.blocks.filter((b) => b.t === 'notedef').map((b) => `n${b.n}`)),
    // the RETURN anchors are served too (#r<n>, the plan's own grammar), so they
    // must be pinned: they were materialised in the document but left out of the
    // hash, so a moved reference fired nothing.
    refs: uniq(doc.blocks.filter((b) => b.t === 'ref').map((b) => `r${b.n}`)),
  };
}

export function anchorHash(lists) {
  const canonical = JSON.stringify({
    regions: lists.regions,
    sections: lists.sections,
    pages: lists.pages,
    notes: lists.notes,
    refs: lists.refs,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * The anchor-stability gate (plan §3): the build hashes the anchor list into a
 * COMMITTED manifest, and a regeneration that changes any anchor fails with
 * migration instructions. It is in place before any reading links an anchor,
 * because an anchor that silently moves is a citation that silently rots.
 *
 * There is no bypass. The only deliberate way through is to delete the pinned
 * file and rebuild — which is a decision someone has to make on purpose.
 *
 * PHASE 4 ADDED ONE GUARD TO THAT. The manifest also records WHEN the page
 * anchors came from a leaf model, because the derivation can be absent while the
 * manifest stays: the text would then be read in txt mode, its page anchors would
 * be the 51 the transcription alone reads, and the gate would report p43 as
 * DROPPED and — this is the trap — instruct the reader to delete the manifest and
 * re-pin. Following that instruction would drop a page the volume prints and the
 * leaf model confirmed, silently, with the gate's own blessing. So a manifest
 * built from a leaf model fails, with the model named, when the extraction has
 * none: the artifact is stored in the repo, and the fix is to restore it.
 */
export function checkAnchors(doc, file = anchorPath(doc.slug)) {
  const lists = anchorLists(doc);
  const hash = anchorHash(lists);
  const leafModel = doc.source && doc.source.leaves ? doc.source.leaves : null;
  const want = { slug: doc.slug, ...lists, hash, ...(leafModel ? { model: { leaves: leafModel.leaves, numbered: leafModel.numbered } } : {}) };
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(want, null, 2)}\n`);
    return { pinned: true, ...want };
  }
  const have = JSON.parse(readFileSync(file, 'utf8'));
  if (have.model && !leafModel) {
    throw new Error(
      `library: ${doc.slug}: the pinned anchors were built from the leaf-accurate page model and this extraction ` +
        `has none — it is reading the text in txt mode, where the page anchors are only what the running heads ` +
        `alone read, so re-pinning from here would DROP the pages the leaves confirm.\n` +
        `  The model is not fetched at build time and is not on the shelf: it is derived once, from the item's own ` +
        `page files, and stored beside the edition.\n` +
        `  Restore it: node tools/library/derive.mjs ${doc.slug}`,
    );
  }
  if (have.hash === hash) return { pinned: false, ...have };
  const moved = [];
  for (const k of ['regions', 'sections', 'pages', 'notes']) {
    const a = new Set(have[k] || []);
    const b = new Set(lists[k]);
    for (const x of b) if (!a.has(x)) moved.push(`added   ${k}:${x}`);
    for (const x of a) if (!b.has(x)) moved.push(`dropped ${k}:${x}`);
  }
  throw new Error(
    `library: ${doc.slug}: the anchors moved since they were pinned — a link that exists would rot.\n` +
      (moved.length ? `  ${moved.join('\n  ')}\n` : '') +
      `  pinned: ${have.hash}\n  now:    ${hash}\n` +
      `  If nothing cites this text yet, pin the new set deliberately: delete\n` +
      `  tools/library/anchors/${doc.slug}.json and build again.\n` +
      `  If something cites it, the pinned list is the record of what was published: ` +
      `keep the old anchor for every moved one (an alias, or a redirect), and only then re-pin.`,
  );
}

/* ---------- the one-time import ---------- */

/** A WITNESS EDITION held in the library beside the transcription. The parallel
 * of a text (another printing of the same work) is not a library reading of its
 * own — it may be a multi-treatise volume the extractor cannot serve — so it is
 * kept verbatim under `<slug>/witnesses/<name>.txt` and recorded in
 * `<slug>/witnesses.json`. The tools read it THERE, not from the shelf: the shelf
 * may be absent, and the evidence a rule was decided from belongs in the library
 * beside the rule. Matched by the shelf filename the record names, so the caller
 * keeps naming the file and never guesses a slug. Returns the path, or null. */
export function witnessPath(slug, shelfFilename) {
  const rec = join(LIBRARY_DIR, slug, 'witnesses.json');
  if (!existsSync(rec)) return null;
  try {
    const j = JSON.parse(readFileSync(rec, 'utf8'));
    for (const w of j.witnesses || []) {
      if (w.shelf === shelfFilename) {
        const p = join(LIBRARY_DIR, slug, 'witnesses', `${w.name}.txt`);
        if (existsSync(p)) return p;
      }
    }
  } catch {
    /* an unreadable record is not a reason to guess a witness */
  }
  return null;
}

/** Copy a shelf file into the library as a WITNESS of `slug`, ONCE, recording
 * its sha256. A witness is evidence for a reading, never a served text, so it
 * carries no document, no anchors and no pages, and the build never reads it. */
export function importWitness(slug, shelfFilename, why) {
  const resolved = shelfFile(shelfFilename, shelfFiles());
  const bytes = readFileSync(join(SHELF, resolved));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const name = basename(resolved).replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const dir = join(LIBRARY_DIR, slug, 'witnesses');
  mkdirSync(dir, { recursive: true });
  const rec = join(LIBRARY_DIR, slug, 'witnesses.json');
  const doc = existsSync(rec) ? JSON.parse(readFileSync(rec, 'utf8')) : { slug, witnesses: [] };
  const prev = (doc.witnesses || []).find((w) => w.shelf === resolved);
  if (prev && prev.sha256 !== sha256) {
    throw new Error(
      `library: ${slug}: the witness "${resolved}" has changed since it was imported.\n` +
        `  imported: ${prev.sha256}\n  now:      ${sha256}\n  Nothing was overwritten — a reading may have been decided from the old bytes.`,
    );
  }
  if (prev) return { ...prev, skipped: true };
  writeFileSync(join(dir, `${name}.txt`), bytes);
  const out = { name, shelf: resolved, sha256, bytes: bytes.length, why: why || '', imported: new Date().toISOString().slice(0, 10) };
  doc.witnesses = [...(doc.witnesses || []), out];
  writeFileSync(rec, `${JSON.stringify(doc, null, 2)}\n`);
  return out;
}

/** Copy the shelf's transcription into the repo, ONCE, and record where it came
 * from. The shelf is the source of an import, never a build dependency: after
 * this, the build reads `content/library/<slug>/source.txt` and the shelf can be
 * absent. Re-running on a CHANGED shelf file fails rather than overwrite: the
 * stored edition may already be cited, and replacing it silently would move
 * every page number a citation names. */
export function importEdition(slug) {
  const entry = TEXTS.find((t) => t.slug === slug);
  if (!entry) throw new Error(`library: no shelf entry '${slug}'`);
  const from = textSource(entry, shelfFiles());
  const bytes = readFileSync(from);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const record = join(LIBRARY_DIR, slug, 'import.json');
  if (existsSync(record)) {
    const prev = JSON.parse(readFileSync(record, 'utf8'));
    if (prev.sha256 === sha256) return { ...prev, skipped: true };
    throw new Error(
      `library: ${slug}: the shelf file has changed since this edition was imported.\n` +
        `  imported: ${prev.sha256} (${prev.bytes} bytes, ${prev.imported})\n` +
        `  now:      ${sha256} (${bytes.length} bytes)\n` +
        `  Nothing was overwritten. This edition may already be cited, and page numbers move with it.\n` +
        `  Read the difference, decide, and only then import: compare the two files, and if the new ` +
        `transcription is the edition you want, import it as a NEW edition (a new slug) or delete ` +
        `content/library/${slug}/import.json deliberately, knowing what the citations point at.`,
    );
  }
  mkdirSync(dirname(record), { recursive: true });
  writeFileSync(editionPath(slug), bytes);
  const out = {
    slug,
    shelf: basename(from),
    sha256,
    bytes: bytes.length,
    imported: new Date().toISOString().slice(0, 10),
  };
  writeFileSync(record, `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

/* ---------- the command line ---------- */

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const [cmd, slug] = process.argv.slice(2);
  if (cmd === '--import') {
    if (!slug) {
      console.error('usage: node tools/library/extract.mjs --import <slug>');
      process.exit(2);
    }
    const r = importEdition(slug);
    console.log(
      r.skipped
        ? `library: ${slug}: already imported, unchanged (${r.sha256})`
        : `library: ${slug}: imported ${r.shelf} (${r.bytes} bytes, ${r.sha256})`,
    );
  } else if (cmd === '--witness') {
    // --witness <slug> <shelf-filename> [why] — copy a shelf file into the
    // library as a witness of <slug> (a parallel edition a reading was decided
    // from). Held verbatim; the build never serves or extracts it.
    const [, wslug, shelf, ...why] = process.argv.slice(2);
    if (!wslug || !shelf) {
      console.error('usage: node tools/library/extract.mjs --witness <slug> <shelf-filename> [why]');
      process.exit(2);
    }
    const r = importWitness(wslug, shelf, why.join(' '));
    console.log(
      r.skipped
        ? `library: ${wslug}: witness ${r.shelf} already imported, unchanged (${r.sha256})`
        : `library: ${wslug}: witness ${r.shelf} -> witnesses/${r.name}.txt (${r.bytes} bytes, ${r.sha256})`,
    );
  } else {
    console.error(
      'usage: node tools/library/extract.mjs --import <slug>\n' +
        '       node tools/library/extract.mjs --witness <slug> <shelf-filename> [why]\n' +
        '  The build extracts stored editions itself (tools/build.mjs); these commands only\n' +
        '  bring a text in from the shelf, once, and refuse to replace a changed one.',
    );
    process.exit(2);
  }
}
