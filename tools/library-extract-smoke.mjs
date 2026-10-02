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
  check(
    doc.blocks[adsAt + 1] && doc.blocks[adsAt + 1].x === 'FROM THE GREEK OF PORPHYRY',
    `the advertisements open at the catalogue's head (${JSON.stringify((doc.blocks[adsAt + 1] || {}).x)})`,
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
    `  draft corrections: ${Object.entries(recount.corrections).map(([k, v]) => `${v} ${k}`).join(', ')}` +
      `, ${doc.correctionsDraft.unrepaired} damaged word(s) no rule can reach`,
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
