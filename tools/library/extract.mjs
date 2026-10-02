/**
 * tools/library/extract.mjs — the library's document extractor (plan §4, phase 1).
 *
 * A scanned printed edition is a STRUCTURED object: it has printed pages with
 * numbers, divisions with numbers, notes attached to passages, and page
 * furniture. The `_djvu.txt` derivative throws that structure away and the
 * reader that renders it inherits the loss. This module RE-DERIVES the
 * structure from the transcription and emits it as a document the reader can
 * navigate, cite and search — in txt-mode, with no dependency on the archive's
 * derivatives, so it works on the transcription alone.
 *
 * FIVE DECISIONS, and why they are these decisions:
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
import { TEXTS, shelfFiles, textSource } from './shelf.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Where the repo keeps an EDITION of a text, and where the anchors it serves
 * are pinned. Both are in the repo, beside the posts. */
export const LIBRARY_DIR = join(ROOT, 'content', 'library');
export const ANCHOR_DIR = join(ROOT, 'tools', 'library', 'anchors');

export const editionPath = (slug) => join(LIBRARY_DIR, slug, 'source.txt');
export const importPath = (slug) => join(LIBRARY_DIR, slug, 'import.json');
export const anchorPath = (slug) => join(ANCHOR_DIR, `${slug}.json`);
export const hasEdition = (slug) => existsSync(editionPath(slug));
export const readEdition = (slug) => readFileSync(editionPath(slug), 'utf8');

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
 * from; `ocr` rules touch a word's letters and come last, so they can never
 * consume a number or a division before the pass that needs it has run. A file
 * whose classes are not grouped in this order is rejected at load rather than
 * silently applied out of order. */
export const EDIT_CLASSES = ['opener', 'digit', 'ocr', 'review'];
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
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`library: ${slug}: the edits file is not valid JSON — ${e.message}`);
  }
  if (raw.slug !== slug) {
    throw new Error(`library: ${slug}: the edits file names "${raw.slug}" — a rule list that names another text is a rule list for another text`);
  }
  if (!Array.isArray(raw.edits) || raw.edits.length === 0) {
    throw new Error(`library: ${slug}: the edits file carries no rules`);
  }
  let rank = -1;
  const seen = new Map();
  const edits = raw.edits.map((e, i) => {
    const where = `the edits file's rule ${i + 1}`;
    for (const k of ['find', 'replace', 'class', 'note']) {
      if (typeof e[k] !== 'string' || e[k] === '') {
        throw new Error(`library: ${slug}: ${where} has no ${k} — a rule without one is not reviewable`);
      }
    }
    if (e.find === e.replace) {
      throw new Error(`library: ${slug}: ${where} ("${e.find}") replaces the text with itself — it is not a correction`);
    }
    const r = classRank(e.class);
    if (r < rank) {
      throw new Error(
        `library: ${slug}: ${where} ("${e.find}") is class "${e.class}", which is out of pipeline order — ` +
          `the classes must be grouped ${EDIT_CLASSES.join(' → ')}, because an opener is what lets the ` +
          `extraction find a section and an ocr rule may consume the characters a later class needs`,
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
    return { find: e.find, repl: e.replace, cls: e.class, note: e.note };
  });
  return { edits, meta: { classes: raw.classes || {}, order: raw.order || null } };
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
    if (!f || f === rules[i].repl) continue;
    const parts = out.split(f);
    if (parts.length === 1) continue;
    if (onHit) onHit(i, parts.length - 1);
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
  const rules = corrections.map((c) => ({ find: c.find, repl: c.repl }));
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
 * pagination pass takes out of it. */
function scan(lines, cfg) {
  const markers = new Map();
  const junk = new Set();
  for (let bi = 0; bi < lines.length; bi++) {
    for (let li = 0; li < lines[bi].length; li++) {
      const line = lines[bi][li];
      const key = `${bi}:${li}`;
      const head = runningHead(line, cfg.head);
      if (head) {
        const n = normaliseNumber(head.num);
        markers.set(key, {
          kind: 'head',
          raw: line,
          value: n ? n.value : null,
          plain: n ? n.plain : false,
        });
        continue;
      }
      const folio = bareFolio(line);
      if (folio) {
        markers.set(key, { kind: 'folio', raw: line, value: folio.value, plain: folio.plain });
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

/** The characters a transcription uses where the print has a letter or a mark
 * the scan could not carry. This is the DAMAGE census the extractor counts by —
 * the classes it knows, and the only ones it treats as damage. (Not a global
 * regex: `.test` on a global regex carries `lastIndex` between calls, which is
 * how a census comes to count every second word.) */
const DAMAGE = /[\^_|\\*+=~{}[\]@$%#<>¬£±»«]/;

/** A word of the transcription that carries a character the census marks as
 * damage: a word whose letters were lost. A reader cannot tell such a word from
 * an English one, and the reading view's `ocr` rules only REMOVE the character —
 * their own note says the lost letter is not guessed, so the word stays wrong.
 * A word that mixes letters with digits is the census's other damaged class: no
 * character can be removed from it without inventing a letter or leaving one. */
export function wordDamaged(word) {
  const bare = word
    .replace(/^[.,;:?!()"'\u201c\u201d\[]+/, '')
    .replace(/[.,;:?!()"\u201c\u201d\]|\\]+$/, '');
  if (bare === '' || !/[A-Za-z]/.test(bare)) return false;
  return DAMAGE.test(bare) || /[A-Za-z]\d|\d[A-Za-z]/.test(bare);
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
  const readings = rules.filter((r) => r.cls !== 'ocr');
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
 * Extract one stored edition into the served document (plan §4.1).
 *
 * `meta` is the shelf entry (`{slug, lang, item}`) plus the sha256 of the
 * transcription this document was built from. The return value is exactly the
 * document that is emitted at `/library/<slug>/t`.
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
  const lines = rawBlocks(src);

  /* 1. The library's stamp is not text (plan §4.5): recorded, then dropped. */
  const stamp = cfg.stamp || [];
  const dropped = [];
  for (const want of stamp) {
    const got = lines.length ? lines[0].join(' ') : null;
    if (got !== want) {
      throw new Error(
        `library: ${entry.slug}: the library stamp is not where it was measured ` +
          `(wanted block ${JSON.stringify(want)}, found ${JSON.stringify(got)}) — ` +
          `the transcription has changed shape and the extraction must be re-read, not patched`,
      );
    }
    dropped.push(lines.shift()[0]);
  }

  /* 2. Page furniture, consumed before anything is read as a heading (§4.2). */
  const { markers, junk } = scan(lines, cfg);
  reconcile(markers);

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
          // a bare folio IS its own text (no head words to carry it); the head's
          // words are in the `rh` block above, so the number is not repeated
          ...(mark.kind === 'folio' ? { x: line } : {}),
        });
        continue;
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

  /* 7b. The damage the rules do NOT reach, measured rather than described: the
   * words of the body the census marks as damaged, and how many of them the rules
   * repair (one rule per distinct damaged word — the rule list is generated from
   * exactly this census, so the two counts are the two halves of one picture). A
   * word whose damage no rule can reach — a numeral standing inside a word
   * ("ever7it"), where removing the character invents a letter — is COUNTED, not
   * guessed at, and the count is stated in provenance. */
  const bodyText = out
    .filter((b) => (b.t === 'p' || b.t === 'verse') && b.at && /^s\d/.test(b.at))
    .map((b) => b.x.replace(/\n/g, ' '))
    .join(' ');
  const census = damageCensus(bodyText, corrections.map((c) => c.find));

  /* 7c. The hit table: every rule, and how many times it fires in the text the
   * reading view is given. It is measured here, shipped with each rule, and the
   * build FAILS on a rule that fires zero times (`checkEdits`, called by the
   * build — the acceptance rule of plan §7). */
  const report = editReport(out, corrections);
  report.forEach((r, i) => {
    corrections[i].hits = r.hits;
  });

  const doc = {
    slug: entry.slug,
    lang: entry.lang || 'en',
    source: { item: entry.item || null, sha256: meta.sha256 },
    pages: [...markers.values()].map((m) => ({ leaf: null, page: m.page })),
    toc,
    blocks: out,
    corrections,
    correctionsMeta: {
      reviewed: true,
      order: 'the order this list gives them, first to last, applied to every occurrence one text block at a time',
      classes: Object.fromEntries(
        ['opener', 'digit', 'ocr'].map((k) => [k, corrections.filter((c) => c.cls === k).length]),
      ),
      hits: Object.fromEntries(
        ['opener', 'digit', 'ocr'].map((k) => [
          k,
          corrections.filter((c) => c.cls === k).reduce((a, c) => a + c.hits, 0),
        ]),
      ),
      repeated: report.filter((r) => r.hits > 1).map((r) => ({ cls: r.cls, find: r.find, hits: r.hits })),
      damagedWords: census.damaged,
      repairedWords: census.repaired,
      unrepairedWords: census.unrepaired,
      unrepairedList: census.words,
      damagedTitles: toc.filter((t) => t.damaged).map((t) => t.n),
      note:
        'The reading view of this text is produced by these rules and nothing else: the transcription ' +
        'served here is verbatim and uncorrected, and each rule is applied to it in this order. Every ' +
        'rule fires at least once in the served text, and one that fires nowhere is caught before ' +
        'this document is served, because a rule that matches nothing is machinery nothing read. ' +
        'The "opener" rules are ' +
        'readings the print requires for its divisions to run in order. The "digit" rules are the ' +
        'printed numbers and note markers the transcription wrote through an OCR confusion, each ' +
        'pinned to the line or marker it was read from. The "ocr" rules remove a character that is ' +
        'not a letter from a word whose letters were lost, and they offer no reading of what was ' +
        'lost: the words the rules cannot reach are counted and left as the transcription has them. ' +
        'A section title the rules still leave damaged is marked, with the words named, rather than ' +
        'repaired by a guess.',
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
 *   `damaged`    distinct WORDS of the body — a word being a token with a letter
 *                in it, not the scan's debris — that carry a character the census
 *                marks as damage;
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
 */
export function damageCensus(text, finds) {
  const rules = new Set(finds || []);
  const seen = new Set();
  const unrepaired = new Set();
  for (const rawTok of text.split(/\s+/)) {
    const tok = rawTok.replace(/^[.,;:?!()"'„“”\[]+/, '').replace(/[.,;:?!()"“”\]|\\]+$/, '');
    if (tok === '' || !/[A-Za-z]/.test(tok)) continue; // a word, not the scan's debris
    if (seen.has(tok) || !DAMAGE.test(tok)) continue;
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
  return {
    blocks: doc.blocks.length,
    byType,
    regions,
    sections: doc.toc.length,
    notes: doc.blocks.filter((b) => b.t === 'notedef').map((b) => b.n).filter((n, i, a) => a.indexOf(n) === i).length,
    refs: doc.blocks.filter((b) => b.t === 'ref').length,
    pages,
    corrections: classes,
    correctionHits: hits,
    damagedTitles: doc.toc.filter((t) => t.damaged).map((t) => t.n),
    correctionsMeta: doc.correctionsMeta || null,
  };
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
 */
export function checkAnchors(doc, file = anchorPath(doc.slug)) {
  const lists = anchorLists(doc);
  const hash = anchorHash(lists);
  const want = { slug: doc.slug, ...lists, hash };
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(want, null, 2)}\n`);
    return { pinned: true, ...want };
  }
  const have = JSON.parse(readFileSync(file, 'utf8'));
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
  } else {
    console.error(
      'usage: node tools/library/extract.mjs --import <slug>\n' +
        '  The build extracts stored editions itself (tools/build.mjs); this command line only\n' +
        '  imports one from the shelf, once, and refuses to replace a changed one.',
    );
    process.exit(2);
  }
}
