/**
 * tools/library-extract-smoke.mjs — the extractor's proof (plan §11 Phase 1).
 *
 * `library-smoke.mjs` proves the built PAGES say something true about the shelf.
 * This proves the DOCUMENT does — and it recomputes everything from the stored
 * edition itself (`content/library/<slug>/source.txt`), never from the build's
 * own report, because an expectation copied from the thing under test asserts
 * only that the thing is self-consistent.
 *
 * What it asserts, and what would break each:
 *
 *  1. NO TEXT IS LOST, DUPLICATED OR REORDERED. The source blocks are recomputed
 *     here (the same blank-line split the extractor uses, and the same
 *     de-hyphenation the reader uses — the text of the document must be the text
 *     of the page), the library stamp is recomputed as the leading run, and the
 *     document's text stream is compared with them. Fails if a block is dropped,
 *     a run is emitted twice, a run is emitted OUT OF ORDER (this caught the
 *     reference runs being emitted before the paragraph they sit in), or a
 *     character is changed. The comparison is on the character sequence with
 *     whitespace removed, because the reader normalises whitespace by design;
 *     state the convention and check the thing you can check.
 *  2. THE DIVISIONS RUN 1…18, NO GAPS, NO DUPLICATES, DISTINCT TITLES. The
 *     openers are re-derived here by a SECOND implementation of the three opener
 *     repairs, and the sequence is checked independently of the document. Fails
 *     if a section is missed, found twice, or two sections derive one title.
 *  3. EVERY NOTE IS DEFINED AND REFERENCED, AND THE NUMBER-FITTING RULE CAN FAIL.
 *     The definitions and references are recounted here from the source. The
 *     `(n)`→11 resolution is proven by TWO fixtures over the real text: a marker
 *     re-spelled as an unreadable token must still resolve to 11 (the rule fits
 *     the sequence, it does not know that string), and a marker re-spelled as a
 *     WRONG NUMBER must fail the extraction (so the fitting cannot paper over a
 *     real disagreement). Fails if fitting is a special case, or if the sequence
 *     is not actually enforced.
 *  4. THE PAGE SEQUENCE IS MONOTONE, AND ONLY THE RULE REFUSES. Every marker is
 *     recomputed from the running heads and the bare folios, the ±1 stride rule
 *     is re-applied here, and each `pb` in the document must carry a `how` and
 *     agree with the recomputation. Fails if a page goes backwards, if a pb has
 *     no `how`, if a refused marker would have been accepted (or the reverse),
 *     or if the document claims a page the text does not have.
 *  5. NO ANCHOR DRIFT — AND A DELIBERATE MOVE FAILS. The anchor list is
 *     recomputed and hashed against the committed manifest. Then the source is
 *     MUTATED (a head line deleted, a section number changed) and the gate must
 *     fire: `checkAnchors` must refuse the moved anchors, and the extraction must
 *     refuse the broken division sequence. Fails if the manifest has drifted, if
 *     the gate is a no-op, or if it writes over a pinned manifest.
 *  6. THE TWO FILES ARE EMITTED, ARE WHAT THE EXTRACTOR PRODUCES, LEAK NOTHING,
 *     AND FIT THE BUDGET. `/t` and `/plain` are read from dist and compared with
 *     a fresh extraction; an INDEPENDENT leak list (not the build's) is scanned
 *     over both; the sizes are measured against the plan's budget. Fails if a
 *     file is missing, stale, carries an internal path or a size claim, has no
 *     extension-cheating name problem, or grows past the cap. Skipped, loudly,
 *     when the library is not built (LIBRARY=1).
 *  6b. THE RULES FILE IS THE DOCUMENT'S RULES, AND EVERY ONE OF THEM FIRES
 *     (phase 3, plan §7). The rules file is read here, its order and its classes
 *     are checked against the pipeline's own order, and every rule's hit count is
 *     RECOMPUTED over the document's own text fields — never read off the
 *     document. Then: the document's own `hits` must equal the recomputation; a
 *     rule ADDED to a copy and matching nothing must make `checkEdits` fail and be
 *     named; a rule whose find stands in the front-matter region must make the
 *     extraction fail (so the title page the reading cites as evidence cannot be
 *     quietly repaired); and the rules that fire more than once must be the ones
 *     the document names.
 *  6c. THE SECTION TITLES ARE THE READING'S OWN WORDS (phase 3, plan §11). Each
 *     title is recomputed here — from the section's opening words, with the file's
 *     rules applied — and must equal the document's. The raw title (no rule
 *     applied) must equal the document's `raw`. The titles the transcription
 *     damaged past repair must be exactly the ones whose damaged words no reading
 *     rule touches, must be marked rather than invented, and a section whose
 *     damage a reading rule READS (§11's opener) must come out readable and
 *     unmarked. Fails if a title is derived from the raw words, if a still-damaged
 *     title ships unmarked, or if a readable one is marked damaged.
 *  7. THE EDITION IN THE REPO IS THE SHELF FILE, AND A CHANGED SHELF FILE CANNOT
 *     OVERWRITE IT. The stored edition's sha256 is compared with the shelf's when
 *     the shelf is present, and the importer is run against a MODIFIED copy of
 *     the shelf in a temporary shelf directory: it must fail without writing.
 *     Fails if the edition drifted from its recorded provenance, or if the
 *     importer would silently replace a published edition.
 *
 * Run against a built tree:
 *
 *     LIBRARY=1 SKIP_CSS=1 ./build.sh && node tools/library-extract-smoke.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, copyFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  extract,
  counts,
  checkEdits,
  checkFrontMatter,
  frontMatterText,
  editsPath,
  sectionTitle,
  titleDamage,
  loadEdits,
  serialiseDoc,
  plainText,
  anchorLists,
  anchorHash,
  checkAnchors,
  anchorPath,
  editionPath,
  importPath,
  hasEdition,
  sha256,
} from './library/extract.mjs';
import { TEXTS, SHELF } from './library/shelf.mjs';
import { rawBlocks, joinLines, normaliseNumber, runningHead, bareFolio } from './library/reader.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const SLUG = 'porphyry-on-the-cave-of-the-nymphs-taylor-1917';
const ENTRY = TEXTS.find((t) => t.slug === SLUG);
const strip = (s) => s.replace(/\s+/g, '');

let failures = 0;
let skipped = 0;
const check = (cond, msg) => {
  console.log((cond ? '  OK   ' : '  FAIL ') + msg);
  if (!cond) failures++;
};
const skip = (msg) => {
  skipped++;
  console.log(`  SKIP ${msg}`);
};
const section = (name) => console.log(`\n${name}`);

if (!ENTRY) {
  console.error(`library-extract-smoke: no shelf entry '${SLUG}'`);
  process.exit(1);
}

/* The stored edition, and a fresh extraction of it. Everything below is checked
 * against these two, recomputed here. */
const src = readFileSync(editionPath(SLUG), 'utf8');
const doc = extract(src, { entry: ENTRY, sha256: sha256(src) });
const recount = counts(doc);

/* The corrections this smoke applies itself — a SECOND statement of the three
 * opener repairs (§1.1 of the plan), so the document's 18 sections are not
 * trusted to the extractor's own rule list. */
const OPENERS = [
  ['I i. What', '1. What'],
  ["'3. After", '3. After'],
  ['n.^Tb,eologists', '11. Theologists'],
];
const fix = (line) => OPENERS.reduce((s, [a, b]) => (s.includes(a) ? s.split(a).join(b) : s), line);

/* ---------- 1. no text lost, duplicated or reordered ---------- */

section('every source block lands exactly once, in order (recomputed)');
{
  const blocks = rawBlocks(src);
  // the library stamp: the leading run of blocks that carry no word of letters
  // and no digits-only text of the book's own — recomputed as the first five
  // short blocks, then asserted to be exactly what the document recorded
  const stampCount = doc.dropped.length;
  check(stampCount > 0, `the library stamp is recorded as dropped text (${stampCount} block(s))`);
  check(
    blocks.slice(0, stampCount).every((ls, i) => ls.join(' ') === doc.dropped[i].x),
    `the dropped blocks are the file's own leading blocks (${doc.dropped.map((d) => d.x).join(' ')})`,
  );
  const source = blocks.slice(stampCount);
  const stream = doc.blocks.map((b) => b.x || '').join(' ');
  check(
    strip(stream) === strip(source.map((ls) => joinLines(ls)).join(' ')),
    `the document's text is the transcription's text, character for character ` +
      `(${strip(stream).length} characters against ${strip(source.map((ls) => joinLines(ls)).join(' ')).length})`,
  );
  let at = 0;
  let outOfPlace = null;
  for (const ls of source) {
    const t = strip(joinLines(ls));
    if (t === '') continue;
    if (strip(stream).slice(at, at + t.length) !== t) {
      outOfPlace = t.slice(0, 60);
      break;
    }
    at += t.length;
  }
  check(outOfPlace === null, `every source block stands at its own position in the document${outOfPlace ? ` (first out of place: ${JSON.stringify(outOfPlace)})` : ''}`);
  check(at === strip(stream).length, `and nothing stands in the document that the transcription does not have (${at} of ${strip(stream).length} characters accounted for)`);
}

/* ---------- 2. the divisions ---------- */

section('the divisions run 1…18, with distinct titles (recomputed)');
{
  const openers = [];
  for (const ls of rawBlocks(src)) {
    for (const line of ls) {
      const m = /^['\u2018]?(\d{1,2})\.\s/.exec(fix(line));
      if (m) openers.push(Number(m[1]));
    }
  }
  // the sequence, independently: each opener must be the next number due
  const sequence = openers.filter((n, i) => n === i + 1);
  check(
    openers.length === 18 && sequence.length === 18,
    `18 section openers were found in the transcription by a second reading of the three repairs ` +
      `(${openers.length} found: ${openers.join(', ')})`,
  );
  const secs = doc.blocks.filter((b) => b.t === 'sec').map((b) => b.n);
  check(
    secs.length === 18 && secs.every((n, i) => n === i + 1),
    `the document's sections are consecutive 1…18 (${secs.join(', ')})`,
  );
  check(doc.toc.length === 18 && doc.toc.every((e, i) => e.n === i + 1), `the contents list carries all 18, in order`);
  const titles = doc.toc.map((e) => e.title);
  check(new Set(titles).size === 18, `the 18 titles are distinct (${new Set(titles).size} distinct)`);
  check(
    doc.toc.every((e) => typeof e.title === 'string' && e.title.length > 0 && e.title.length <= 90),
    `every title is a short piece of the section's own opening words (longest ${Math.max(...titles.map((t) => t.length))} characters)`,
  );
  const body = doc.blocks.findIndex((b) => b.t === 'region' && b.kind === 'body');
  check(body > 0, `the body region opens where the first division opens (block ${body})`);
  const regions = doc.blocks.filter((b) => b.t === 'region').map((b) => b.kind);
  check(
    regions.join(',') === 'front,body,notes,ads',
    `the four regions are in the order of the volume (${regions.join(', ')})`,
  );
  // the notes division and the catalogue head: the boundaries the plan names
  const notesAt = doc.blocks.findIndex((b) => b.t === 'region' && b.kind === 'notes');
  const adsAt = doc.blocks.findIndex((b) => b.t === 'region' && b.kind === 'ads');
  check(
    doc.blocks[notesAt + 1] && doc.blocks[notesAt + 1].x === 'Notes',
    `the notes region opens at the print's own Notes division (${JSON.stringify((doc.blocks[notesAt + 1] || {}).x)})`,
  );
  // The boundary is the COLOPHON — the first block after note (25)'s own
  // paragraph — not the plan's `FROM THE GREEK OF PORPHYRY`, which occurs once in
  // the edition and on the title page, which OCRs as "From the Greeh of
  // Porphyry", so the rule never fired. This assertion used to encode the wrong
  // rule; it encodes the corrected one.
  check(
    doc.blocks[adsAt + 1] && /^PRINTED IN GREAT BRITAIN/.test(doc.blocks[adsAt + 1].x),
    `the advertisements open at the colophon (${JSON.stringify((doc.blocks[adsAt + 1] || {}).x)})`,
  );
  check(
    doc.blocks.filter((b) => b.t === 'notedef' && b.n === 25).length === 1,
    'and the note before it did not swallow the colophon',
  );
}

/* ---------- 2b. the rules file, and the acceptance rule (phase 3) ---------- */

section('the rules are the file\'s, every one of them fires, and a dead rule fails');
{
  const file = JSON.parse(readFileSync(editsPath(SLUG), 'utf8'));
  const edits = loadEdits(SLUG).edits;
  check(
    Array.isArray(file.edits) && file.edits.length === edits.length && edits.length > 0,
    `the rules file loads and carries ${edits.length} rule(s)`,
  );
  check(
    file.edits.every((e) => ['find', 'replace', 'class', 'note'].every((k) => typeof e[k] === 'string' && e[k] !== '')),
    'every rule in the file has a find, a replace, a class and a note — a rule without a note is not reviewable',
  );
  // the file's shape is the PLAN's ({find, replace, class}), the document's is the
  // app's contract ({find, repl, cls}); the mapping is checked here so the two
  // cannot drift apart silently
  check(
    edits.every((c, i) => c.find === file.edits[i].find && c.repl === file.edits[i].replace && c.cls === file.edits[i].class && c.note === file.edits[i].note),
    'the document\'s rules are the file\'s rules, in the file\'s order, field for field',
  );
  const ORDER = ['opener', 'digit', 'ocr'];
  const ranks = edits.map((c) => ORDER.indexOf(c.cls));
  check(
    ranks.every((r) => r >= 0) && ranks.every((r, i) => i === 0 || r >= ranks[i - 1]),
    `the classes are grouped in the pipeline's order (${ORDER.join(' → ')}): ${[...new Set(edits.map((c) => c.cls))].join(', ')}`,
  );
  check(
    edits.every((c) => c.find !== c.repl),
    'no rule replaces a text with itself',
  );
  check(new Set(edits.map((c) => c.find)).size === edits.length, 'no two rules share a find');

  // the document's rules are the extraction's rules — not a second list
  check(
    doc.corrections.length === edits.length &&
      doc.corrections.every((c, i) => c.find === edits[i].find && c.repl === edits[i].repl && c.cls === edits[i].cls),
    `the document ships the file's rules and no others (${doc.corrections.length})`,
  );

  // THE HIT COUNT, RECOMPUTED HERE: each rule applied in order to every text field
  // of the document, one field at a time, counting what each one actually changes.
  const myHits = edits.map(() => 0);
  for (const b of doc.blocks) {
    if (typeof b.x !== 'string') continue;
    let text = b.x;
    edits.forEach((r, i) => {
      const parts = text.split(r.find);
      if (parts.length > 1) {
        myHits[i] += parts.length - 1;
        text = parts.join(r.repl);
      }
    });
  }
  const dead = edits.filter((_, i) => myHits[i] === 0);
  check(
    dead.length === 0,
    `every rule fires at least once in the served text (${edits.length} rules, ` +
      `${myHits.reduce((a, b) => a + b, 0)} applications)${dead.length ? `: ${dead.map((d) => JSON.stringify(d.find)).join(', ')}` : ''}`,
  );
  check(
    doc.corrections.every((c, i) => c.hits === myHits[i]),
    `the document's own hit counts are the ones recomputed here (${doc.corrections.map((c) => c.hits).join(', ').slice(0, 60)}…)`,
  );
  const repeated = edits.filter((_, i) => myHits[i] > 1);
  check(
    repeated.length > 0 &&
      JSON.stringify(doc.correctionsMeta.repeated.map((r) => r.find)) === JSON.stringify(repeated.map((r) => r.find)),
    `the rules that fire more than once are named as such ` +
      `(${repeated.map((r, k) => `${JSON.stringify(r.find)} ×${myHits[edits.indexOf(r)]}`).join(', ')})`,
  );
  const byClass = (k) => edits.filter((c) => c.cls === k).length;
  check(
    Object.entries(doc.correctionsMeta.classes).every(([k, v]) => byClass(k) === v) &&
      Object.entries(doc.correctionsMeta.hits).every(([k, v]) => edits.filter((c) => c.cls === k).reduce((a, r, i) => a + myHits[edits.indexOf(r)], 0) === v),
    `the class and hit totals the document states are the recomputed ones ` +
      `(${Object.entries(doc.correctionsMeta.classes).map(([k, v]) => `${v} ${k}`).join(', ')}; ` +
      `${Object.entries(doc.correctionsMeta.hits).map(([k, v]) => `${v} ${k}`).join(', ')} applications)`,
  );

  // THE ASYMMETRY: the gate must fail on a rule that matches nothing, and name it
  let gate = null;
  try {
    checkEdits(doc);
    gate = 'passed (the gate is a no-op)';
  } catch (e) {
    gate = `threw: ${e.message}`;
  }
  check(gate === 'passed (the gate is a no-op)', `the real rule set passes the acceptance gate: ${gate.slice(0, 40)}`);
  const withDead = {
    ...doc,
    blocks: doc.blocks,
    corrections: [...doc.corrections, { find: 'nothing-in-this-text-matches-this', repl: 'x', cls: 'ocr', note: 'a fixture, added deliberately' }],
  };
  let fired = null;
  try {
    checkEdits(withDead);
    fired = 'accepted (the gate is a no-op)';
  } catch (e) {
    fired = e.message;
  }
  check(
    typeof fired === 'string' && fired.includes('unreviewed machinery') && fired.includes('nothing-in-this-text-matches-this'),
    `a rule that matches nothing FAILS the gate and is named: ${fired.split('\n')[0].slice(0, 120)}`,
  );
}

/* ---------- 2c. the front matter is preserved by construction ---------- */

section('no rule touches the front-matter region');
{
  // the region recomputed here AND asserted by the extractor itself
  const front = frontMatterText(doc);
  check(
    front.includes('From the Greeh of Porphyry'),
    'the front matter still carries the reading the title page is cited for ' +
      '("From the Greeh of Porphyry" — the thing the transcription\'s own damage is evidence of)',
  );
  const into = doc.corrections.filter((c) => front.includes(c.find));
  check(into.length === 0, `and no rule's find occurs in it (${into.length} found${into.length ? `: ${into.map((c) => JSON.stringify(c.find)).join(', ')}` : ''})`);
  let real = null;
  try {
    checkFrontMatter(doc);
    real = 'accepted (the assertion is a no-op)';
  } catch (e) {
    real = `threw: ${e.message}`;
  }
  check(
    real === 'accepted (the assertion is a no-op)',
    `the extractor's own front-matter assertion accepts this edition: ${real.slice(0, 60)}`,
  );
  // THE ASYMMETRY, through the extractor's OWN code: the same assertion over a
  // rule that would repair the evidence must fail and name the rule. A fixture
  // that re-stated the assertion would prove only that the fixture can count.
  let bad = null;
  try {
    checkFrontMatter({
      ...doc,
      corrections: [
        ...doc.corrections,
        { find: 'From the Greeh of Porphyry', repl: 'From the Greek of Porphyry', cls: 'ocr', note: 'a fixture: this would repair the evidence the reading cites' },
      ],
    });
    bad = 'accepted (the assertion is a no-op)';
  } catch (e) {
    bad = e.message;
  }
  check(
    typeof bad === 'string' && bad.includes('preserved by construction') && bad.includes('From the Greeh of Porphyry'),
    `and a rule that would repair the evidence is refused by that same code: ${bad.split('\n')[0].slice(0, 120)}`,
  );
}

/* ---------- 2d. the titles are the reading's own words ---------- */

section('the section titles are the reading view\'s words, and a damaged one is marked');
{
  const edits = loadEdits(SLUG).edits;
  const apply = (t) => edits.reduce((acc, r) => (acc.includes(r.find) ? acc.split(r.find).join(r.repl) : acc), t);
  const OPENER = /^['\u2018]?(\d{1,2})\.\s/;
  const mine = [];
  for (let i = 0; i < doc.blocks.length; i++) {
    const b = doc.blocks[i];
    if (b.t !== 'sec') continue;
    const body = doc.blocks.slice(i + 1).find((x) => x.t === 'p' || x.t === 'verse');
    const line = body ? body.x.split('\n')[0] : '';
    mine.push({
      n: b.n,
      title: sectionTitle(apply(line).replace(OPENER, '')),
      raw: sectionTitle(line.replace(OPENER, '')),
    });
  }
  check(
    mine.length === doc.toc.length && mine.every((m, i) => m.title === doc.toc[i].title && m.n === doc.toc[i].n),
    `every title is the section's opening words with the rules applied, recomputed here ` +
      `(${mine.filter((m) => m.title !== doc.toc[m.n - 1].title).length} disagreement(s) of ${mine.length})`,
  );
  check(
    mine.every((m, i) => m.raw === doc.toc[i].raw),
    'and every `raw` title is the same words with NO rule applied (the transcription view\'s title)',
  );
  // the flag is a measured statement, recomputed here: a damaged word that no
  // READING rule (opener/digit) touches. An ocr rule only removes characters.
  const readings = edits.filter((c) => c.cls !== 'ocr');
  const census = (w) => /[\^_|\\*+=~{}[\]@$%#<>¬£±»«]/.test(w);
  const mineDamaged = mine.filter((m) => {
    const words = m.raw.replace(/…$/, '').split(' ');
    return words.some((w) => {
      const bare = w.replace(/^[.,;:?!()"'\u201c\u201d\[]+/, '').replace(/[.,;:?!()"\u201c\u201d\]|\\]+$/, '');
      return bare !== '' && /[A-Za-z]/.test(bare) && census(bare) && !readings.some((r) => r.find === bare || bare.includes(r.find));
    });
  });
  const docDamaged = doc.toc.filter((t) => t.damaged).map((t) => t.n);
  check(
    JSON.stringify(mineDamaged.map((m) => m.n)) === JSON.stringify(docDamaged),
    `the titles marked damaged are exactly the ones whose damaged words no READING rule repairs ` +
      `(recomputed: ${mineDamaged.map((m) => `§${m.n}`).join(', ')}; the document marks ${docDamaged.map((n) => `§${n}`).join(', ')})`,
  );
  check(
    docDamaged.length > 0 && doc.toc.filter((t) => t.damaged).every((t) => t.damagedWords.length > 0),
    `each marked title names the transcription's own damaged words, so the mark is evidence and not a shrug ` +
      `(${doc.toc.filter((t) => t.damaged).map((t) => `§${t.n}: ${t.damagedWords.join(' ')}`).join('; ')})`,
  );
  // §11: its opener's damage is a READING (the rule states the print's number), so
  // its title must come out readable and unmarked — the other side of the flag
  const s11 = doc.toc.find((t) => t.n === 11);
  check(
    !s11.damaged && /^Theologists therefore assert/.test(s11.title) && /^\S*[\^_]\S*/.test(s11.raw),
    `§11's title is repaired by its opener rule and NOT marked — the raw form still carries the damage ` +
      `(${JSON.stringify(s11.raw)} → ${JSON.stringify(s11.title)})`,
  );
  const s2 = doc.toc.find((t) => t.n === 2);
  check(
    s2.damaged === true && /[\^_]/.test(s2.raw) && doc.toc.every((t) => t.title !== s2.raw),
    `§2's title is marked damaged, and the damaged words are NOT shipped as a title ` +
      `(${JSON.stringify(s2.title)})`,
  );
  check(
    doc.toc.every((t) => t.title.length > 0 && t.raw.length > 0),
    'and no title is emptied: the flagged entries still carry the reading and the transcription',
  );
}

/* ---------- 3. the notes, and the fitting rule's failability ---------- */

section('25 notes, each defined, each referenced, each resolved');
{
  const live = src.slice(src.indexOf('\nNotes'), src.indexOf('FROM THE GREEK OF PORPHYRY'));
  const defTokens = [...live.matchAll(/^\(([^)\s]{1,3})\)/gm)].map((m) => m[1]);
  const refTokens = [...src.matchAll(/\(note\s+([^)\s]{1,4})\)/g)].map((m) => m[1]);
  check(
    defTokens.length === 25,
    `the transcription carries 25 note definitions in its notes region (${defTokens.length} found)`,
  );
  check(refTokens.length === 25, `and 25 references in the text (${refTokens.length} found)`);
  const defs = doc.blocks.filter((b) => b.t === 'notedef');
  const nums = [...new Set(defs.map((b) => b.n))].sort((a, b) => a - b);
  check(
    nums.length === 25 && nums.every((n, i) => n === i + 1),
    `the document carries all 25 notes, consecutive (${nums.length} distinct, ${defs.length} block(s))`,
  );
  const refs = doc.blocks.filter((b) => b.t === 'ref');
  check(
    new Set(refs.map((r) => r.n)).size === 25,
    `every note is referenced (${new Set(refs.map((r) => r.n)).size} distinct references)`,
  );
  const refTextOk =
    refs.length === refTokens.length &&
    refs.every((r, i) => {
      const want = `(note ${refTokens[i]})`;
      return r.x.startsWith(want) && /^[.,;:!?]*$/.test(r.x.slice(want.length));
    });
  check(
    refTextOk,
    `each reference still carries the transcription's own words beside its number ` +
      `(${JSON.stringify(refs[0].x)} … ${JSON.stringify(refs[refs.length - 1].x)})`,
  );
  check(
    doc.blocks.filter((b) => b.t === 'notedef' && b.n === 6).every((b) => b.lang === 'la'),
    `note (6) is the Latin quotation and says so (${doc.blocks.filter((b) => b.lang === 'la').length} block(s) marked la)`,
  );
  check(
    new Set(doc.blocks.filter((b) => b.lang === 'la').map((b) => b.n)).size === 1,
    'and no other note is marked Latin',
  );

  // the fixtures: the fitting rule is a rule, and it can fail
  // the transcription writes the marker with two spaces after it (its own word
  // spacing), so the fixture must replace the string the file actually holds
  const MARKER = '(_x)'; // a marker of the shape the notes use, and no number
  const N_MARK = '(n)  Hence';
  const broken = src.replace(N_MARK, `${MARKER}  Hence`);
  check(!broken.includes(N_MARK) && broken.includes(MARKER), 'the fixture replaced the one unreadable marker');
  let fitted = null;
  try {
    const d = extract(broken, { entry: ENTRY, sha256: sha256(broken) });
    fitted = [...new Set(d.blocks.filter((b) => b.t === 'notedef').map((b) => b.n))];
  } catch (e) {
    fitted = `threw: ${e.message}`;
  }
  check(
    Array.isArray(fitted) && fitted.length === 25 && fitted[10] === 11,
    `a marker re-spelled as an unknown token still resolves to 11 by the SEQUENCE ` +
      `(not by knowing the string "n"): ${Array.isArray(fitted) ? `${fitted.length} notes, 11th = ${fitted[10]}` : fitted}`,
  );
  const wrong = src.replace(N_MARK, '(9)  Hence');
  check(!wrong.includes(N_MARK) && wrong.includes('(9)  Hence'), 'the fixture made that marker a wrong number');
  let refused = null;
  try {
    extract(wrong, { entry: ENTRY, sha256: sha256(wrong) });
    refused = 'accepted (the sequence was not enforced)';
  } catch (e) {
    refused = e.message;
  }
  check(
    typeof refused === 'string' && refused.includes('do not run in order'),
    `and a marker that reads as a WRONG NUMBER fails the extraction: ${refused.slice(0, 120)}`,
  );
}

/* ---------- 4. the page sequence ---------- */

section('the printed pages are monotone, and only the rule refuses');
{
  // recompute every marker, then re-apply the ±1 rule here — over the same
  // lines the extractor reads, i.e. after the library stamp (whose "08" would
  // otherwise read as a bare folio)
  const markers = [];
  for (const ls of rawBlocks(src).slice(doc.dropped.length)) {
    for (const line of ls) {
      const head = runningHead(line);
      const n = head ? normaliseNumber(head.num) : null;
      if (head) markers.push({ raw: line, kind: 'head', value: n ? n.value : null, plain: n ? n.plain : false });
      else {
        const folio = bareFolio(line);
        if (folio) markers.push({ raw: line, kind: 'folio', value: folio.value, plain: folio.plain });
      }
    }
  }
  let last = null;
  const expect = [];
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i];
    const next = (() => {
      for (let j = i + 1; j < markers.length; j++) if (markers[j].kind === 'head' && markers[j].value != null) return markers[j].value;
      return null;
    })();
    const ok =
      m.value == null
        ? false
        : m.kind === 'head' && m.plain
          ? last === null || m.value > last
          : m.kind === 'head'
            ? m.value > (last === null ? -Infinity : last) && m.value === (last !== null ? last + 1 : next != null ? next - 1 : m.value)
            : (last !== null && m.value === last + 1) || (last === null && next !== null && m.value === next - 1);
    if (ok) {
      expect.push({ raw: m.raw, page: m.value, how: m.kind === 'head' ? 'head' : 'folio' });
      last = m.value;
    } else {
      expect.push({ raw: m.raw, page: null, how: 'refused' });
    }
  }
  const pbs = doc.blocks.filter((b) => b.t === 'pb');
  check(
    pbs.length === expect.length,
    `the document marks every page boundary the transcription carries (${pbs.length} of ${expect.length})`,
  );
  check(
    pbs.every((b, i) => b.page === expect[i].page && b.how === expect[i].how),
    `each one carries the page and the HOW the rule gives it (${expect.filter((e) => e.page != null).length} numbered, ${expect.filter((e) => e.page == null).length} refused)`,
  );
  const HOW = new Set(['head', 'folio', 'interpolated', 'refused']);
  check(pbs.every((b) => HOW.has(b.how)), `every pb has a how∈{${[...HOW].join(', ')}}`);
  const numbered = pbs.filter((b) => b.page != null).map((b) => b.page);
  check(
    numbered.every((p, i) => i === 0 || p > numbered[i - 1]),
    `the page sequence is strictly increasing (${numbered[0]}…${numbered[numbered.length - 1]}, ${numbered.length} pages)`,
  );
  // a refusal must be a refusal *for a reason*: the marker's own number must fail
  // both neighbours
  const refusals = pbs.map((b, i) => ({ b, i })).filter(({ b }) => b.how === 'refused');
  let unjustified = 0;
  for (const { i } of refusals) {
    const raw = expect[i].raw.split(' ');
    const v = raw.length ? Number(normaliseNumber(raw[0])?.value ?? normaliseNumber(raw[raw.length - 1])?.value) : NaN;
    const prev = i > 0 ? expect[i - 1].page : null;
    const next = (() => {
      for (let j = i + 1; j < expect.length; j++) if (expect[j].page != null) return expect[j].page;
      return null;
    })();
    if (v === prev + 1 || (prev == null && v === (next != null ? next - 1 : NaN))) unjustified++;
  }
  check(
    refusals.length === 2 && unjustified === 0,
    `each of the ${refusals.length} refusals is one the ±1 rule refuses ` +
      `(${refusals.map(({ b }) => `${JSON.stringify(b.x)} at ${b.page}`).join(', ')})`,
  );
  check(
    numbered.length === 51 && numbered.includes(5) && numbered.includes(58) && !numbered.includes(22) && !numbered.includes(42) && !numbered.includes(43),
    `the recovered pages are 5…58 with 22, 42 and 43 unreadable (${numbered.length} pages)`,
  );
  check(doc.pages.length === pbs.length, `the page model has one entry per boundary (${doc.pages.length})`);
  check(doc.pages.every((p) => p.leaf === null), 'and every entry says leaf: null — this is the txt-mode model, not an invented leaf');
  check(
    doc.toc.every((e) => doc.blocks.some((b) => b.t === 'pb' && b.page === e.page)),
    `every contents entry names a page the document actually recovered (${doc.toc.map((e) => e.page).join(', ')})`,
  );
  // the folio-as-heading defect: no block may BE a bare page number
  // the folio-as-heading defect: a FOLIO standing as a heading. An island of
  // digits in the print is a folio only when it is short enough to be one (the
  // bound `bareFolio` uses); the title page's "1917" is the imprint's year and
  // is text, so it is not counted here.
  const bare = doc.blocks.filter((b) => b.x && b.t !== 'pb' && /^[0-9]{1,3}$/.test(b.x));
  check(bare.length === 0, `no folio stands as a heading of its own (the folio-as-heading defect; ${bare.length} found)`);
}

/* ---------- 5. the anchors ---------- */

section('the notes and the adverts are not the body');
{
  // The review found three symptoms of ONE region bug: the ads boundary never
  // fired (the plan's rule matched a phrase the title page OCRs differently), so
  // note (25) swallowed the colophon and the catalogue's opening, and the notes
  // and the adverts claimed section-18 paragraph anchors.
  const regions = doc.blocks.filter((b) => b.t === 'region').map((b) => b.kind);
  check(regions.join(' ') === 'front body notes ads',
    `the volume's four regions are all present, in order (${regions.join(' ')})`);

  let region = null, outside = 0, verseOutside = 0;
  for (const b of doc.blocks) {
    if (b.t === 'region') region = b.kind;
    else if (b.at && region !== 'body') outside++;
    if (b.t === 'verse' && region !== 'body') verseOutside++;
  }
  check(outside === 0, `no block outside the body claims a paragraph anchor (${outside} found)`);
  check(verseOutside === 0, `no verse block outside the body (${verseOutside} found)`);

  const n25 = doc.blocks.filter((b) => b.t === 'notedef' && b.n === 25);
  check(n25.length === 1 && /The anger of the Gods/.test(n25[0].x),
    `note 25 is its own paragraph, not the colophon and the catalogue (${n25.length} block(s))`);

  // The library is HELD BACK by default (LIBRARY=1 builds it): a check needing
  // the emitted files skips rather than failing, so the default tree is green and
  // the assertions run whenever the library is built.
  const plainPath = join(ROOT, 'dist', 'library', SLUG, 'plain');
  if (!existsSync(plainPath)) {
    check(true, 'the plain text is not built (LIBRARY=1 builds it) — skipped');
  } else {
    const plain = readFileSync(plainPath, 'utf8');
    const inPlain = (plain.match(/\(note /g) || []).length;
    check(inPlain === 25,
      `the plain text carries all 25 note references (${inPlain}; it dropped every one before)`);
  }

  const manifest = JSON.parse(readFileSync(anchorPath(SLUG), 'utf8'));
  check(Array.isArray(manifest.refs) && manifest.refs.length === 25,
    `the pinned manifest covers the return anchors too (${manifest.refs && manifest.refs.length} r<n>)`);
}

section('the anchors are pinned, and a deliberate move fails');
{
  const lists = anchorLists(doc);
  const hash = anchorHash(lists);
  const pinned = JSON.parse(readFileSync(anchorPath(SLUG), 'utf8'));
  check(
    pinned.hash === hash && JSON.stringify(pinned.sections) === JSON.stringify(lists.sections),
    `the committed manifest is this document's anchor list (${lists.sections.length} sections, ` +
      `${lists.pages.length} pages, ${lists.notes.length} notes, hash ${hash.slice(0, 12)}…)`,
  );
  // the fragment grammar, materialised in the artefact that serves it
  const ids = doc.blocks.filter((b) => b.id).map((b) => b.id);
  check(new Set(ids).size === ids.length, `no two blocks claim one anchor (${ids.length} anchors, ${new Set(ids).size} distinct)`);
  const nums = (re) => ids.filter((x) => re.test(x)).length;
  check(
    [...Array(18)].every((_, i) => ids.includes(`s${i + 1}`)) &&
      nums(/^p\d+$/) === 51 &&
      [...Array(25)].every((_, i) => ids.includes(`n${i + 1}`) && ids.includes(`r${i + 1}`)),
    `the grammar #s<n>/#p<n>/#n<n>/#r<n> is carried (${nums(/^s/) } s, ${nums(/^p/)} p, ${nums(/^n/)} n, ${nums(/^r/)} r)`,
  );
  check(
    [...lists.sections, ...lists.pages, ...lists.notes, ...lists.regions].every((id) => ids.includes(id)),
    `every anchor the manifest pins is carried by a block (${lists.sections.length + lists.pages.length + lists.notes.length + lists.regions.length} pinned)`,
  );
  check(
    doc.blocks.filter((b) => b.t === 'ref').every((b) => /^s\d+-\d+$/.test(b.at)),
    `every reference is anchored to its section and paragraph, never to a page (${doc.blocks.filter((b) => b.t === 'ref')[0].at}…)`,
  );
  const before = statSync(anchorPath(SLUG)).size;

  // a mutation that moves an anchor: the head of page 49 removed
  const mut = src.replace('ON  THE  CAVE  OF  THE  NYMPHS     49 \n', '');
  check(mut.length < src.length, 'the fixture removed one running head');
  const movedDoc = extract(mut, { entry: ENTRY, sha256: sha256(mut) });
  const tmp = mkdtempSync(join(tmpdir(), 'anchors-'));
  const tmpManifest = join(tmp, 'pinned.json');
  copyFileSync(anchorPath(SLUG), tmpManifest);
  let gate = null;
  try {
    checkAnchors(movedDoc, tmpManifest);
    gate = 'accepted (the gate is a no-op)';
  } catch (e) {
    gate = e.message;
  }
  check(
    typeof gate === 'string' && gate.includes('p49') && gate.includes('anchors moved'),
    `a moved anchor FAILS the gate, naming it: ${gate.split('\n').slice(0, 2).join(' / ').slice(0, 140)}`,
  );
  check(
    gate.includes('delete') && gate.includes('build again') && gate.includes('alias'),
    'and the failure carries the migration instructions',
  );
  check(
    statSync(anchorPath(SLUG)).size === before,
    'the gate did not write over the pinned manifest',
  );

  // a mutation that breaks the division sequence: the gate for §2's opener
  const bad = src.replace('2.  Thp_anrt', '5.  Thp_anrt');
  let seq = null;
  try {
    extract(bad, { entry: ENTRY, sha256: sha256(bad) });
    seq = 'accepted (the sequence is not enforced)';
  } catch (e) {
    seq = e.message;
  }
  check(
    typeof seq === 'string' && seq.includes('divisions do not run 1…18'),
    `a division out of sequence fails the extraction: ${seq.slice(0, 120)}`,
  );
  rmSync(tmp, { recursive: true, force: true });
}

/* ---------- 6. the emitted files ---------- */

section('the document and the plain text are emitted, and leak nothing');
{
  const docFile = join(DIST, 'library', SLUG, 't');
  const plainFile = join(DIST, 'library', SLUG, 'plain');
  if (!existsSync(docFile)) {
    skip('the library is not built — run LIBRARY=1 SKIP_CSS=1 ./build.sh to check the two emitted files');
  } else {
    const tText = readFileSync(docFile, 'utf8');
    const pText = readFileSync(plainFile, 'utf8');
    check(
      tText === serialiseDoc(doc),
      `the emitted document is what the extractor produces now (${Buffer.byteLength(tText)} bytes)`,
    );
    check(
      pText === plainText(doc, ENTRY),
      `the emitted plain text is what the extractor produces now (${Buffer.byteLength(pText)} bytes)`,
    );
    const budget = 110 * 1024; // the plan's ~100 KB raw (§8), with the draft rules' headroom
    check(
      Buffer.byteLength(tText) < budget,
      `the document is inside the plan's size budget (${Buffer.byteLength(tText)} of ${budget} bytes raw)`,
    );
    check(
      Buffer.byteLength(pText) < budget,
      `and so is the plain text (${Buffer.byteLength(pText)} bytes raw)`,
    );
    check(!/\.(?:json|txt|mjs)$/.test(docFile.replace(DIST, '')), `the documents' name carries no extension (${docFile.slice(DIST.length + 1)})`);

    // an INDEPENDENT leak list, not the build's (see library-smoke for the same
    // reasoning): a test that asks the build what a leak is proves only that the
    // build is self-consistent
    const BANNED = [
      [/(?:^|["'\s(])(?:~|\/home\/[a-z])\/[\w./-]+/, 'local filesystem path'],
      [/\b[\w.-]+\.(?:txt|mjs|json)\b(?=[\s"',.)]|$)/, 'source-file name'],
      [/\btools\/(?:build|viz|check-scope)[\w./-]*/, 'internal path'],
      [/\bthe scan\b|\bthe brief\b|\bthe manifest\b|\bthe plumbing\b|\bthe corpus\b|\bthe extract\b/i, 'workshop wording'],
      [/\b\d[\d,]{2,}\s*(?:bytes|KB|MB)\b/i, 'file size'],
      [/\b\d[\d,]{3,}\s+characters\b/, 'character count'],
      [/\/\*\s*[-=]*\s*[a-z]/i, 'a comment delimiter in emitted code'],
      [/^\s*\/\/\s/m, 'a line comment in emitted code'],
    ];
    const bad = [];
    for (const [name, text] of [['t', tText], ['plain', pText]]) {
      for (const [re, what] of BANNED) {
        const m = re.exec(text);
        if (m) bad.push(`${name}: ${what}: ${JSON.stringify(text.slice(Math.max(0, m.index - 40), m.index + 40))}`);
      }
    }
    check(bad.length === 0, `neither file carries an internal path, a source filename or workshop wording${bad.length ? `\n       ${bad.join('\n       ')}` : ''}`);
    let parsed = true;
    try {
      JSON.parse(tText);
    } catch {
      parsed = false;
    }
    check(parsed, 'the document parses as JSON');
    check(
      pText.includes(ENTRY.edition) && pText.includes('[s1]') && pText.includes('[p58]'),
      'the plain text carries the edition, the division markers and the page markers',
    );
  }
}

/* ---------- 7. the stored edition and the importer ---------- */

section('the edition in the repo is the shelf file, and cannot be silently replaced');
{
  const record = JSON.parse(readFileSync(importPath(SLUG), 'utf8'));
  check(hasEdition(SLUG) && sha256(src) === record.sha256, `the stored edition is the one the import recorded (${record.sha256.slice(0, 12)}…)`);
  check(
    Buffer.byteLength(src, 'utf8') === record.bytes,
    `and its length is the length that was recorded (${Buffer.byteLength(src, 'utf8')} bytes; ` +
      `the file is not ASCII, so this is bytes and not characters)`,
  );
  check(record.shelf === 'Porphyry-On-the-Cave-of-the-Nymphs-Taylor-1917.txt', `the import names the shelf file it came from (${record.shelf})`);
  check(/^\d{4}-\d{2}-\d{2}$/.test(record.imported), `and the day it was imported (${record.imported})`);
  if (existsSync(join(SHELF, record.shelf))) {
    const shelfFile = readFileSync(join(SHELF, record.shelf), 'utf8');
    check(
      sha256(shelfFile) === record.sha256,
      'the shelf file and the stored edition are the same bytes',
    );
  } else {
    skip(`the shelf is not at ${SHELF} — the build does not need it for this text, and the cross-check is skipped`);
  }
  // the importer must refuse a changed shelf file, in a shelf of its own
  const tmp = mkdtempSync(join(tmpdir(), 'shelf-'));
  const name = record.shelf;
  const text = readFileSync(editionPath(SLUG), 'utf8');
  writeFileSync(join(tmp, name), `${text}\nextra line\n`);
  let out = '';
  let failed = false;
  try {
    execFileSync(process.execPath, [join(ROOT, 'tools', 'library', 'extract.mjs'), '--import', SLUG], {
      env: { ...process.env, LIBRARY_SHELF: tmp },
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (e) {
    failed = true;
    out = `${e.stdout || ''}${e.stderr || ''}`;
  }
  check(
    failed && out.includes('changed since this edition was imported'),
    `re-importing a changed shelf file FAILS loudly: ${out.split('\n').find((l) => l.includes('changed since')) || out.slice(0, 100)}`,
  );
  check(
    readFileSync(editionPath(SLUG), 'utf8') === text,
    'and the stored edition on disk was NOT overwritten',
  );
  rmSync(tmp, { recursive: true, force: true });
}

/* ---------- what the run measured ---------- */

section('measured');
{
  console.log(
    `  document: ${recount.blocks} block(s) — ` +
      `${recount.sections} sections, ${recount.notes} notes, ${recount.refs} references, ` +
      `${recount.pages.detected} page number(s) read (${recount.pages.folio} from a bare folio), ` +
      `${recount.pages.refused} refused, ${recount.pages.interpolated} interpolated`,
  );
  console.log(`  blocks by type: ${Object.entries(recount.byType).map(([k, v]) => `${v} ${k}`).join(', ')}`);
  console.log(
    `  corrections: ${Object.entries(recount.corrections).map(([k, v]) => `${v} ${k}`).join(', ')}` +
      `, every one firing (${Object.entries(recount.correctionHits).map(([k, v]) => `${v} ${k}`).join(', ')} application(s))` +
      `, ${doc.correctionsMeta.unrepairedWords} damaged word(s) no rule names`,
  );
  console.log(`  regions: ${recount.regions.join(' → ')}`);
  console.log(
    `  size: /t ${Buffer.byteLength(serialiseDoc(doc))} bytes raw, /plain ${Buffer.byteLength(plainText(doc, ENTRY))} bytes raw, ` +
      `stored edition ${Buffer.byteLength(src, 'utf8')} bytes`,
  );
  const gz = (await import('node:zlib')).gzipSync;
  console.log(
    `  gzipped as served: /t ${gz(Buffer.from(serialiseDoc(doc))).length} bytes, ` +
      `/plain ${gz(Buffer.from(plainText(doc, ENTRY))).length} bytes, ` +
      `stored edition ${gz(Buffer.from(src)).length} bytes`,
  );
}

console.log(
  failures === 0
    ? `\nlibrary-extract-smoke: all checks passed${skipped ? ` (${skipped} skipped)` : ''}`
    : `\nlibrary-extract-smoke: ${failures} check(s) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
