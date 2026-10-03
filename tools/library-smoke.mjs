/**
 * tools/library-smoke.mjs — runtime test for the library.
 *
 * The build gates prove every page is valid and leaks nothing; they do not prove
 * the library says something TRUE about the shelf. This reads the BUILT pages
 * under dist/library/ and checks them against the shelf itself, recomputing
 * every expectation from the source text — nothing here is hard-coded from the
 * build's own report, because an expectation copied from the thing under test
 * asserts only that the build is self-consistent.
 *
 * The assertions, and what would break each:
 *
 *  1. THE READER'S TRANSFORMS — a unit test on `joinLines`/`preprocess` with the
 *     cases named. Each case fails if the transform it names regresses: a space
 *     instead of no space at a de-hyphenation (case 3), a compound's hyphen
 *     dropped (case 4), a broken capital's hyphen dropped (case 5), double spaces
 *     surviving (case 1), a hard wrap left in (case 2), a blank line not ending a
 *     paragraph (case 6), an all-caps division line not read as a heading (case
 *     7), or a paragraph lost between the read and the write (case 8).
 *  2. EVERY TEXT PAGE IS THERE, WITH THE PARAGRAPHS THE READER SAID — the
 *     preprocessor is run HERE, over the shelf file, and its paragraph count is
 *     compared with the `<p>` count of the built text region, summed across a
 *     text's parts. Fails if a page is missing, if a part is missing, if a
 *     paragraph was dropped or duplicated in rendering, or if the build's reader
 *     and this one disagree.
 *  3. NOTHING INTERNAL REACHED A PAGE — a local filesystem path, a `.txt`
 *     filename, or a workshop token (the same families the build's own leak gate
 *     bans), scanned over every built library page. Fails if a shelf path or a
 *     source filename is printed, or if a leak's wording reaches the page.
 *  4. THE INDEX AND THE PAGES AGREE BOTH WAYS — every text with a page is linked
 *     from /library/, every link on it resolves to a built page, and no page is
 *     orphaned. Fails on a 404 from the index, or a page nothing links to.
 *  5. THE CITATION LINE IS THE CITATION RECORD — the citing readings are
 *     recomputed here from tools/catalogue.json + the posts' own footnote
 *     definitions, and compared with the links the pages carry. Fails if a page
 *     names a reading that does not cite it, misses one that does, or claims a
 *     citation for a work the record does not carry.
 *
 * Run against a built tree:
 *
 *     SKIP_CSS=1 ./build.sh && node tools/library-smoke.mjs
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROUPS, TEXTS, shelfFiles, textSource, SHELF, isPublished, isInRepair, repairState, REPAIR_LABELS } from './library/shelf.mjs';
import { preprocess, joinLines, assess, countParagraphs } from './library/reader.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const LIB = join(DIST, 'library');

let failures = 0;
const check = (cond, msg) => {
  console.log((cond ? '  OK   ' : '  FAIL ') + msg);
  if (!cond) failures++;
};
const section = (name) => console.log(`\n${name}`);

/* ---------- 1. the reader's transforms, unit-tested ---------- */

section('the reader (unit)');
const cases = [
  ['double spaces collapse to one', joinLines(['a  double   spaced   line']), 'a double spaced line'],
  ['a hard-wrapped line is joined with a space', joinLines(['the end of one line', 'and the start of the next']), 'the end of one line and the start of the next'],
  ['a hyphen across a line break is dropped (lower case next)', joinLines(['let-', 'ters']), 'letters'],
  ['a compound keeps its hyphen', joinLines(['self-', 'knowledge']), 'self-knowledge'],
  ['a break before a capital keeps its hyphen', joinLines(['Anglo-', 'Saxon']), 'Anglo-Saxon'],
  ['a break inside a capitalised word is still the printer’s', joinLines(['Craty-', 'lus']), 'Cratylus'],
];
for (const [name, got, want] of cases) {
  check(got === want, `${name}: ${JSON.stringify(got)}${got === want ? '' : ` (wanted ${JSON.stringify(want)})`}`);
}
{
  const two = preprocess('one paragraph\n\nand a second one\n');
  check(countParagraphs(two.blocks) === 2 && two.stats.parasIn === two.stats.parasOut,
    `a blank line ends a paragraph (${countParagraphs(two.blocks)} paragraphs read, ${two.stats.parasIn} in / ${two.stats.parasOut} out)`);
  const heading = preprocess('CHAPTER I\n\nsome text follows\n');
  check(heading.stats.headings === 1 && heading.blocks[0].level === 2 && heading.stats.parasOut === 1,
    `an all-caps division line is read as a heading and not as a paragraph (${heading.stats.headings} heading, ${heading.stats.parasOut} paragraph)`);
  const lossy = preprocess('  spaced   text  \n\nsecond  \n');
  check(lossy.stats.parasIn === lossy.stats.parasOut && lossy.stats.parasOut === 2,
    'no paragraph is lost between the read and the write');
}

/* ---------- the shelf ---------- */

/* WHAT THIS TREE SHOULD HOLD (plan §11 phase 5). Publication is per text and it
 * lives on the shelf entry, so the smoke asks the shelf the same question the
 * build asks: the PUBLISHED texts are what a default build serves, and LIBRARY=1
 * (the preview switch) means every entry was built. The two states are asserted
 * ASYMMETRICALLY — a published text MUST have its pages, an unpublished one must
 * have none — because a build that quietly serves a text its entry does not
 * publish is the defect this flag exists to make impossible. */
// LIBRARY=1 is the BUILD's preview flag (it builds every entry regardless), but
// what a page SERVES is the per-text `published` flag (plan §11 phase 5). The two
// were the same thing before phase 5 and are not any more: a previewed tree
// builds the held-back entries so the reader and these checks can see them, while
// the expected page set still follows `published`. So the expectation is built
// from the flag, and the BUILD does not change it.
const PREVIEW = process.env.LIBRARY === '1';
const SERVED = TEXTS.filter(isPublished);
const BUILT_EXTRA = PREVIEW ? TEXTS.filter((t) => !isPublished(t)) : [];
const HELD = TEXTS.filter((t) => !SERVED.includes(t));
// What the TREE carries: the published texts, plus — in a preview build — the
// held-back ones the build was explicitly asked for. The assertions separate the
// two questions: what the shelf PUBLISHES (SERVED) and what this build EMITS.
const EMITTED = TEXTS.filter((t) => SERVED.includes(t) || BUILT_EXTRA.includes(t));
// What this TREE holds back: not published, and not emitted either.
const WITHHELD = TEXTS.filter((t) => !EMITTED.includes(t));
const BUILT = existsSync(LIB);

if (!BUILT && SERVED.length > 0) {
  console.error(
    `library-smoke: ${SERVED.length} text(s) are published on the shelf ` +
      `(${SERVED.map((t) => t.slug).join(', ')}) but dist/library/ is not built — ` +
      'the build did not serve what the shelf publishes.',
  );
  process.exit(1);
}
if (!BUILT) {
  // Nothing is published and nothing is previewed: the shelf is held back whole,
  // so the library's own pages have nothing to check. What is still checked —
  // because this is the state the whole per-text flag is FOR — is that nothing
  // on the site points at the library: no nav entry, no command-line entry, no
  // sitemap address, no line in the 404. (A tree with pages for a held-back text
  // does not reach this branch: it falls through to the checks above and fails
  // there.) That is a skip of the library's pages, not of the publication rule.
  console.log(
    `library-smoke: nothing is published (${TEXTS.length} texts on the shelf, none marked published) and this is not a preview build`,
  );
  const files = [
    ['index.html', readFileSync(join(DIST, 'index.html'), 'utf8')],
    ['404.html', readFileSync(join(DIST, '404.html'), 'utf8')],
    ['sitemap.xml', readFileSync(join(DIST, 'sitemap.xml'), 'utf8')],
  ];
  let leak = 0;
  for (const [rel, text] of files) {
    const hits = (text.match(/\/library\//g) || []).length;
    if (hits) leak += hits;
    check(hits === 0, `${rel}: no reference to /library/ with nothing published (${hits})`);
  }
  check(leak === 0, 'and the site is silent about a library it does not serve');
  // FAILS IF: the nav entry, the command-line entries, the sitemap addresses or
  // the 404's list are emitted whatever the shelf publishes — the trace of the
  // library on a site that has none.
  console.log('library-smoke: PASSED (the library is held back whole)');
  process.exit(failures === 0 ? 0 : 1);
}
const files = shelfFiles();
const srcOf = (t) => readFileSync(textSource(t, files), 'utf8');
const builtPages = (slug) => {
  const dir = join(LIB, slug);
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.name === 'index.html') out.push(join(d, e.name));
    }
  };
  walk(dir);
  return out.sort();
};

/** The `<p>`s of a page's text region — the div that follows <h2>The text</h2>.
 * The reader emits no nested div there, so the region ends at the first close. */
function textParagraphs(html) {
  const at = html.indexOf('<h2>The text</h2>');
  if (at < 0) return null;
  const from = html.indexOf('<div class="prose">', at);
  if (from < 0) return null;
  const to = html.indexOf('</div>', from);
  const region = html.slice(from, to);
  return { count: (region.match(/<p>/g) || []).length, headings: (region.match(/<h[23]\b/g) || []).length, region };
}

/* ---------- 2. every text page, with the reader's own paragraph count ---------- */

section('the pages (built vs. the shelf)');
const expected = new Map(); // slug -> { paras, headings, readable, parts, pages }
for (const t of TEXTS) {
  const pages = builtPages(t.slug);
  /* A HELD-BACK text is ABSENT — not skipped, asserted absent (phase 5). This is
   * the asymmetry the publication flag turns on: the same tree, built with the
   * flag flipped, has the pages here, and this check is what fails when a build
   * serves what the shelf does not publish. */
  if (!SERVED.includes(t)) {
    // An UNPUBLISHED text is asserted ABSENT — that is the asymmetry the
    // publication flag turns on, and the check that fails when a build serves
    // what the shelf does not publish. In a PREVIEW build (LIBRARY=1) the build
    // deliberately emits it so the held-back shelf can be read and these other
    // checks can run, so here the assertion becomes: present only BECAUSE the
    // build was asked for everything.
    check(
      pages.length === 0 || PREVIEW,
      `${t.slug}: not published, and no page is built for it (${pages.length} found)`,
    );
    if (pages.length === 0) continue;
  }
  const src = srcOf(t);
  const a = assess(src, t.lang);
  if (!a.readable) {
    expected.set(t.slug, { paras: 0, headings: 0, readable: false, pages: pages.length });
    check(pages.length === 1, `${t.slug}: one page for a text that cannot be served (${pages.length})`);
    if (pages.length === 1) {
      const html = readFileSync(pages[0], 'utf8');
      check(html.includes('cannot be served as text'), `${t.slug}: the page says the text cannot be read`);
      check(textParagraphs(html) === null, `${t.slug}: and serves no prose region`);
      check(
        html.includes(`${a.greekLetters}`) && html.includes(`${a.latinLetters}`),
        `${t.slug}: the page carries the measured letter counts (${a.greekLetters} Greek-range, ${a.latinLetters} Latin)`,
      );
    }
    continue;
  }
  const doc = preprocess(src);
  // A text served in parts has a PARENT page (the text's own URL) that carries
  // the list of parts instead of the text; every other page carries a region.
  const parent = pages.find((p) => !/\/part-\d+\/index\.html$/.test(p));
  let gotParas = 0;
  let gotHeadings = 0;
  let missing = 0;
  for (const p of pages) {
    const region = textParagraphs(readFileSync(p, 'utf8'));
    if (p === parent && pages.length > 1) {
      check(
        readFileSync(p, 'utf8').includes('<h2>The text, in parts</h2>'),
        `${t.slug}: the parent page lists the parts instead of carrying the text`,
      );
      continue;
    }
    if (!region) {
      missing++;
      continue;
    }
    gotParas += region.count;
    gotHeadings += region.headings;
  }
  expected.set(t.slug, {
    paras: doc.stats.parasOut,
    headings: doc.stats.headings,
    readable: true,
    pages: pages.length,
  });
  check(missing === 0, `${t.slug}: every text page carries a text region (${missing} without)`);
  check(
    gotParas === doc.stats.parasOut,
    `${t.slug}: ${gotParas} paragraph(s) in the built pages, ${doc.stats.parasOut} in the source (${pages.length} page(s))`,
  );
  check(gotHeadings === doc.stats.headings, `${t.slug}: ${gotHeadings} heading(s) built, ${doc.stats.headings} detected`);
}
{
  const dirs = readdirSync(LIB, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  const unwritten = EMITTED.filter((t) => !dirs.includes(t.slug)).map((t) => t.slug);
  const extra = dirs.filter((d) => !EMITTED.some((t) => t.slug === d));
  check(
    unwritten.length === 0,
    `every text this build serves has a built page (${EMITTED.length} of ${TEXTS.length} entries${unwritten.length ? `; missing ${unwritten.join(', ')}` : ''})`,
  );
  check(extra.length === 0, `no built library page belongs to no text this build serves${extra.length ? `: ${extra.join(', ')}` : ''}`);
  // FAILS IF: a published text is missing its page, or a page exists for a text
  // the shelf does not serve — the two failures the flag's two states are.
}

/* ---------- 3. nothing internal on a page ---------- */

section('what a page may not say');
// An INDEPENDENT list, not the build's: a test that asks the build what a leak
// is proves only that the build is self-consistent.
const BANNED = [
  [/(?:^|["'\s(])(?:~|\/home\/[a-z])\/[\w./-]+/, 'local filesystem path'],
  [/\b[\w.-]+\.(?:txt|mjs|json)\b(?=[\s"',.)]|$)/, 'source-file name'],
  [/\btools\/(?:build|viz|check-scope)[\w./-]*/, 'internal path'],
  [/\bthe scan\b|\bthe brief\b|\bthe manifest\b|\bthe plumbing\b|\bthe corpus\b|\bthe extract\b/i, 'workshop wording'],
  [/\b\d[\d,]{2,}\s*(?:bytes|KB|MB)\b/i, 'file size'],
  [/\/\*\s*[-=]*\s*[a-z]/i, 'a comment delimiter in emitted code'],
  [/^\s*\/\/\s/m, 'a line comment in emitted code'],
];
{
  // EVERY emitted file under dist/library/, not only the pages: MEASURED, the
  // walk here used to read `index.html` only and so never scanned the library's
  // data files — the document a text serves beside its page, and its plain text
  // (plan §5/§8, the smoke-walk bug). Those are emitted text like any other, so
  // the gate that reads this list must see them.
  const pages = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else pages.push(join(d, e.name));
    }
  };
  walk(LIB);
  const bad = [];
  let empty = 0;
  let threeNewlines = 0;
  for (const p of pages) {
    const html = readFileSync(p, 'utf8');
    const rel = p.slice(DIST.length + 1);
    if (/<p>\s*<\/p>/.test(html)) empty++;
    const region = textParagraphs(html);
    if (region && /\n{3,}/.test(region.region)) threeNewlines++;
    for (const [re, what] of BANNED) {
      const m = re.exec(html);
      if (m) bad.push(`${rel}: ${what}: ${JSON.stringify(html.slice(Math.max(0, m.index - 40), m.index + 40))}`);
    }
  }
  // The floor is derived from the SERVED texts, not fixed: a build that serves
  // one text emits far fewer files than one that serves thirty-eight, and a
  // hard-coded 40 would either be a tautology in a preview or a false failure in
  // a default build. Each served text contributes at least its page, and each
  // stored edition its document and its plain text — counted here so the walk is
  // asserted to have found the files the build must have written.
  const floor = EMITTED.length + EMITTED.filter((t) => existsSync(join(ROOT, 'content', 'library', t.slug))).length * 2;
  check(
    pages.length >= floor,
    `scanned ${pages.length} emitted file(s) under dist/library/ (at least ${floor} for ${EMITTED.length} text(s) this build serves: pages, documents and plain texts)`,
  );
  check(bad.length === 0, `no page carries an internal path, a source filename or workshop wording${bad.length ? `\n       ${bad.slice(0, 6).join('\n       ')}` : ''}`);
  check(empty === 0, `no page has an empty paragraph (${empty})`);
  check(threeNewlines === 0, `no text region has a run of three or more newlines (${threeNewlines})`);
}

/* ---------- 3b. a page's own printed command runs ---------- */

// Every page's masthead prints a command. A command line that prints a command
// that does not work is worse than no command line, so this drives the check
// from the page itself: the prompt the page shows must resolve against the
// palette data the SAME page carries. Fails if a page prints `ls library/` where
// the listing knows only the series `library`, or prints a `cat` of a slug no
// page entry has — the two ways this check failed while the library was built.
section("the command a page prints");
{
  const promptOf = (html) => {
    const m = /<span class="dollar">\$<\/span> ([^<]*)<span class="blink">/.exec(html);
    return m ? m[1].trim() : null;
  };
  const dataOf = (html) => {
    const m = /var DATA = (\{[^\n]*\});/.exec(html);
    return m ? JSON.parse(m[1]) : null;
  };
  const pages = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.name === 'index.html') pages.push(join(d, e.name));
    }
  };
  walk(LIB);
  const bad = [];
  let seen = 0;
  for (const p of pages) {
    const html = readFileSync(p, 'utf8');
    const prompt = promptOf(html);
    const data = dataOf(html);
    if (!prompt || !data) {
      bad.push(`${p.slice(DIST.length + 1)}: no prompt or no palette data`);
      continue;
    }
    seen++;
    const [cmd, arg] = prompt.split(/\s+/);
    if (cmd === 'cat' || cmd === 'open' || cmd === 'cd' || cmd === 'less') {
      if (arg && !data.pages.some((x) => x.slug === arg)) {
        bad.push(`${p.slice(DIST.length + 1)}: prints "${prompt}" but no page entry is "${arg}"`);
      }
    } else if (cmd === 'ls' || cmd === 'll' || cmd === 'dir') {
      if (arg && !data.pages.some((x) => x.series === arg)) {
        bad.push(`${p.slice(DIST.length + 1)}: prints "${prompt}" but the listing has no series "${arg}"`);
      }
    } else {
      bad.push(`${p.slice(DIST.length + 1)}: prints "${prompt}", which this check does not know how to run`);
    }
  }
  check(seen === pages.length && pages.length >= EMITTED.length, `read the prompt and palette data of ${seen} page(s)`);
  check(bad.length === 0, `every page prints a command its own palette can run${bad.length ? `\n       ${bad.slice(0, 5).join('\n       ')}` : ''}`);
}

/* ---------- 4. the index and the pages agree both ways ---------- */

section('the index');
{
  const index = readFileSync(join(LIB, 'index.html'), 'utf8');
  const linked = new Set([...index.matchAll(/href="\/library\/([a-z0-9-]+)\/"/g)].map((m) => m[1]));
  const present = new Set(readdirSync(LIB, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name));
  const unlinked = [...present].filter((s) => !linked.has(s));
  const dead = [...linked].filter((s) => !existsSync(join(LIB, s, 'index.html')));
  check(unlinked.length === 0, `every text with a page is linked from the index${unlinked.length ? `: ${unlinked.join(', ')}` : ` (${linked.size})`}`);
  check(dead.length === 0, `every link on the index resolves to a built page${dead.length ? ` (404: ${dead.join(', ')})` : ''}`);
  // The group headings are the blog's axis, in order, and each is a real group.
  // With the shelf served one text at a time, a group with nothing served
  // contributes nothing (phase 5): an empty heading over an empty list is a
  // promise the page does not keep.
  const drawn = GROUPS.filter((g) => EMITTED.some((t) => t.group === g.key));
  const order = [...index.matchAll(/<h2 id="group-([a-z-]+)">/g)].map((m) => m[1]);
  check(
    order.join(',') === drawn.map((g) => g.key).join(','),
    `the groups with a served text appear in the shelf's order (${order.join(', ')} of ${drawn.length})`,
  );
  check(
    drawn.every((g) => EMITTED.some((t) => t.group === g.key)),
    'every group on the index has at least one served text',
  );
  check(
    EMITTED.every((t) => drawn.some((g) => g.key === t.group)),
    'every served text is in a group the index draws',
  );
  /* THE REPAIR STATE, stated ABOVE the list (the author's ask): a reader meeting
   * the shelf is told which editions are readable and NOT finished. FAILS IF: the
   * badge or the statement is dropped — a reader then takes an edition in repair
   * for a finished one. */
  {
    // the states a served text can be in: damaged (the default — unrepaired),
    // in repair, repaired. Every one present is named above the list and tagged
    // beside the title. FAILS IF: a state is dropped from the statement, or the
    // statement sinks below the groups.
    const firstGroup = index.indexOf('<section><div class="wrap"><h2 id="group-');
    const noteAt = index.indexOf('Some of these editions are not finished.');
    check(
      noteAt >= 0 && firstGroup >= 0 && noteAt < firstGroup,
      `the index states the repair state ABOVE the list of books (note at ${noteAt}, first group at ${firstGroup})`,
    );
    // the note REGION: from the statement to the first group, so a label found
    // only beside a title does not count as "named above the list"
    const noteRegion = noteAt >= 0 && firstGroup > noteAt ? index.slice(noteAt, firstGroup) : '';
    for (const st of ['damaged', 'in-repair', 'repaired']) {
      const ts = EMITTED.filter((t) => repairState(t) === st);
      const label = REPAIR_LABELS[st];
      if (!ts.length) continue; // nothing to name: the held-back note may still use the word
      check(
        noteRegion.includes(`<span class="tag">${label}</span>`) && ts.every((t) => noteRegion.includes(`/library/${t.slug}/`)),
        `the ${label} state is named above the list, with its texts (${ts.length})`,
      );
      check(
        ts.every((t) => new RegExp(`<a href="/library/${t.slug}/">[^<]*</a> <span class="tag">${label}</span>`).test(index)),
        `and each ${label} text carries the tag beside its name (${ts.map((t) => t.slug).join(', ')})`,
      );
    }
    // the default, asserted directly: a text that declares no repair state is
    // DAMAGED, not state-less — an unrepaired transcription is a damaged one
    check(
      repairState({ slug: 'x' }) === 'damaged' && REPAIR_LABELS[repairState({ slug: 'x' })] === 'damaged',
      'a text with no declared repair state reports damaged (the default)',
    );
  }

  /* WHAT AN INDEX THAT SERVES PART OF THE SHELF MUST SAY (phase 5). The library's
   * own paragraphs describe the shelf — the held-back entries and the modern
   * editions that are not free included — so a page that serves one text out of
   * thirty-eight has to say which it serves, or its description reads as a claim
   * about the page in front of the reader. */
  if (WITHHELD.length) {
    check(
      index.includes('What is served here now') &&
        EMITTED.every((t) => new RegExp(`<a href="/library/${t.slug}/">`).test(index)),
      `the index states what is served and what is held back (${EMITTED.length} served here, ${WITHHELD.length} held back in this tree)`,
    );
    // FAILS IF: a partial shelf is described as the whole one — the page then
    // claims to hold texts it does not serve.
  } else {
    check(!index.includes('What is served here now'), 'and says nothing about a held-back shelf when there is none');
    // FAILS IF: the sentence is emitted unconditionally, which would leave the
    // preview build reading "38 of 38 texts served" beside a paragraph about
    // held-back texts.
  }
}

/* ---------- 5. the citation line is the citation record ---------- */

section('readings cited by');
{
  const catalogue = JSON.parse(readFileSync(join(ROOT, 'tools', 'catalogue.json'), 'utf8')).sources;
  const manifest = JSON.parse(readFileSync(join(ROOT, 'posts.json'), 'utf8'));
  const posts = manifest.posts.filter((p) => p.published);

  /** A second implementation of the note reading, on purpose (see the header):
   * a definition is `[^key]:` at the start of a line plus its continuation. */
  const defsOf = (file) => {
    const src = readFileSync(join(ROOT, 'content', file), 'utf8');
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
    return out.map((d) => d.replace(/\s+/g, ' '));
  };

  const matchers = catalogue.map((s) => {
    try {
      return new RegExp(s.match, 'i');
    } catch {
      return null;
    }
  });
  const citing = catalogue.map(() => new Set());
  posts.forEach((p) => {
    const defs = defsOf(p.file);
    catalogue.forEach((_, k) => {
      const re = matchers[k];
      if (re && defs.some((d) => re.test(d))) citing[k].add(p.slug);
    });
  });
  const byId = new Map(catalogue.map((s, k) => [s.id, k]));

  let compared = 0;
  for (const t of TEXTS) {
    const pages = builtPages(t.slug);
    if (pages.length === 0) continue;
    const html = pages.map((p) => readFileSync(p, 'utf8')).join('\n');
    const at = html.indexOf('<b>Where it is cited.</b>');
    if (at < 0) {
      check(false, `${t.slug}: the page states where it is cited`);
      continue;
    }
    const para = html.slice(at, html.indexOf('</p>', at));
    const want = new Set();
    for (const id of t.cat) {
      const k = byId.get(id);
      if (k == null) continue;
      for (const slug of citing[k]) want.add(slug);
    }
    const got = new Set([...para.matchAll(/href="\/([a-z0-9-]+)\/"/g)].map((m) => m[1]));
    const same = got.size === want.size && [...want].every((w) => got.has(w));
    check(
      same,
      `${t.slug}: cites {${[...got].sort().join(', ')}} — the record says {${[...want].sort().join(', ')}}`,
    );
    compared++;
  }
  check(compared === EMITTED.length, `compared a citation line for every text this build serves (${compared} of ${EMITTED.length})`);
  // The citation derivation is checked over the SHELF, not over what this tree
  // serves: which texts the readings cite is a property of the catalogue and the
  // posts' own notes, and it does not change when the shelf is published one text
  // at a time. Asserting it over SERVED would make the check vacuous the day the
  // served text is one no reading's notes name — which is exactly the case here.
  const citedOnShelf = TEXTS.filter((t) =>
    t.cat.some((id) => {
      const k = byId.get(id);
      return k != null && citing[k].size > 0;
    }),
  );
  check(
    citedOnShelf.length >= 3,
    `at least three texts on the shelf are cited by a reading, so the record is not inert (${citedOnShelf.length})`,
  );
  // FAILS IF: the catalogue or the note-reading derivation goes inert — the map,
  // the "where it is cited" lines and every library page would then say that no
  // reading cites anything.
}

/* ---------- 6. what publication puts on the site, and what it takes off ---------- */

/* Publication is not only the library's own pages (plan §11 phase 5): the nav
 * entry, the command-line entries, the sitemap addresses and the 404's own list
 * of the site's pages all appear with them and go with them. Asserted here from
 * the BUILT tree, both ways: the furniture must be there when a text is served
 * and absent when none is, so a flag that stops emitting pages but leaves the
 * links behind is caught. */
section('the site around the library');
{
  const home = readFileSync(join(DIST, 'index.html'), 'utf8');
  const notFound = readFileSync(join(DIST, '404.html'), 'utf8');
  const sitemap = readFileSync(join(DIST, 'sitemap.xml'), 'utf8');
  const navEntry = /href="\/library\/"[^>]*>library</.test(home);
  const sitemapLocs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  check(navEntry, `the nav entry is in every page's chrome (${navEntry})`);
  check(
    /<a href="\/library\/">/.test(notFound),
    'and the 404 lists the library among the pages the site has',
  );
  // FAILS IF: the 404's sentence "every address on this site is one of the pages
  // below" is left standing while a library page exists and is not listed.
  check(sitemapLocs.includes('https://blog.jaye.ch/library/'), 'and the sitemap addresses the index');
  const missing = EMITTED.map((t) => `/library/${t.slug}/`).filter(
    (rel) => !sitemapLocs.includes(`https://blog.jaye.ch${rel}`),
  );
  check(missing.length === 0, `and every served text (${SERVED.length} of ${TEXTS.length} on the shelf)${missing.length ? `: missing ${missing.join(', ')}` : ''}`);
  // FAILS IF: a served text is absent from the sitemap, or a held-back one is in
  // it — an address that 404s is worse than an absent one.
  const heldInSitemap = WITHHELD.map((t) => `/library/${t.slug}/`).filter((rel) =>
    sitemapLocs.includes(`https://blog.jaye.ch${rel}`),
  );
  check(heldInSitemap.length === 0, `and no text this tree withholds is addressed${heldInSitemap.length ? `: ${heldInSitemap.join(', ')}` : ''}`);
  // FAILS IF: the sitemap advertises the whole shelf whatever the shelf publishes.
  const palette = /var DATA = (\{[^\n]*\});/.exec(home);
  const data = palette ? JSON.parse(palette[1]) : null;
  const clEntries = data ? data.pages.filter((p) => String(p.slug).startsWith('library/')).map((p) => p.slug.slice(8)) : [];
  check(
    data && clEntries.length === EMITTED.length && clEntries.every((s) => EMITTED.some((t) => t.slug === s)),
    `and the command line carries exactly the texts this build serves (${clEntries.length} of ${EMITTED.length})`,
  );
  // FAILS IF: the palette offers a `cat` of a text no page serves — a printed
  // command that cannot run.
}

/* ---------- 7. the reading's citations resolve ---------- */

/* The reading of this treatise cites it BY SECTION in prose — "Porphyry, section
 * 4, Taylor's translation, 1917 printing" — and phase 5 makes those citations
 * real links into the library. A link that does not resolve is worse than the
 * prose it replaced, so every one of them is followed HERE: the target page must
 * exist, and the fragment must name an anchor the served document actually
 * carries. Nothing is hard-coded: the links are read out of the BUILT reading,
 * and the anchors out of the BUILT document. */
section("the reading's citations resolve");
{
  const manifest = JSON.parse(readFileSync(join(ROOT, 'posts.json'), 'utf8'));
  const entry = manifest.posts.find((p) => p.file === 'porphyry-cave-of-the-nymphs.md');
  const readingPath = entry ? join(DIST, entry.slug, 'index.html') : null;
  check(!!readingPath && existsSync(readingPath), `the reading is built (${entry ? entry.slug : 'not in the manifest'})`);
  if (readingPath && existsSync(readingPath)) {
    const html = readFileSync(readingPath, 'utf8');
    const links = [...html.matchAll(/href="(\/library\/([a-z0-9-]+)\/)#([a-z0-9-]+)"/g)].map((m) => ({
      href: m[1] + '#' + m[3],
      slug: m[2],
      frag: m[3],
    }));
    // The links exist only while the text they cite is SERVED: a prose citation
    // is the correct state when the library holds the text back, so the assertion
    // follows the served set rather than assuming phase 5's links are present.
    const CITED = 'porphyry-on-the-cave-of-the-nymphs-taylor-1917';
    // PUBLICATION, not the preview build: a previewed text is built for the
    // tests and the reader, but linking the reading's citations to a page the
    // public cannot reach would 404 for everyone but us.
    const citedServed = SERVED.some((t) => t.slug === CITED);
    check(
      citedServed ? links.length > 0 : links.length === 0,
      citedServed
        ? `the reading links its citations into the library (${links.length} link(s) by section)`
        : `the reading's citations are prose while the library holds the text back (${links.length} link(s))`,
    );
    const slugs = [...new Set(links.map((l) => l.slug))];
    const deadPages = slugs.filter((s) => !existsSync(join(LIB, s, 'index.html')));
    check(deadPages.length === 0, `every text the reading cites has a built page${deadPages.length ? `: ${deadPages.join(', ')}` : ` (${slugs.join(', ')})`}`);
    // FAILS IF: the reading cites a text the library does not serve — the exact
    // failure the per-text publication flag could produce, a citation to a page
    // that is held back.
    const anchors = new Map();
    for (const s of slugs) {
      const docPath = join(LIB, s, 't');
      if (!existsSync(docPath)) continue;
      const doc = JSON.parse(readFileSync(docPath, 'utf8'));
      const set = new Set();
      for (const b of doc.blocks) {
        for (const k of ['id', 'at']) if (b[k]) set.add(b[k]);
        if (b.t === 'sec' && b.n != null) set.add(`s${b.n}`);
        if (b.t === 'region' && b.kind === 'front') set.add('sfront');
        if (b.t === 'region' && b.kind === 'notes') set.add('snotes');
        if (b.t === 'pb' && b.page != null) set.add(`p${b.page}`);
      }
      anchors.set(s, set);
    }
    const unresolved = links.filter((l) => !(anchors.get(l.slug) || new Set()).has(l.frag));
    check(
      unresolved.length === 0,
      `and every fragment names an anchor the served document carries` +
        (unresolved.length ? ` — ${unresolved.length} do not: ${[...new Set(unresolved.map((u) => u.href))].join(', ')}` : ` (${[...new Set(links.map((l) => l.frag))].sort().join(', ')})`),
    );
    // FAILS IF: a citation points at an anchor the document does not have — a
    // section number the edition does not print, or an anchor grammar that
    // drifted between the reading and the document.
  }
}

/* ---------- 8. the print stylesheet is emitted, and says what print does ---------- */

/* The print rules are checked by LOOKING at a print rendering (a headless Chrome
 * screenshot, in the phase's own proof); what a smoke can assert is that the
 * rules are in the built page at all — a print block dropped in a refactor
 * renders as the screen page on paper, and nothing else here would notice. */
section('print');
{
  // The reader exists only for a text whose EDITION the repo stores (the shelf
  // alone has no document, no anchors and no app), so the stylesheet is checked
  // on a served text that has one — which is not the first entry on the shelf,
  // and not any entry at all in a preview of a shelf that has no stored editions.
  const readerText = SERVED.find((t) => existsSync(join(ROOT, 'content', 'library', t.slug)));
  if (!readerText) {
    console.log('  SKIP no served text has a stored edition, so there is no reader stylesheet to check');
  } else {
    const shell = readFileSync(join(LIB, readerText.slug, 'index.html'), 'utf8');
    // The READER's own stylesheet, found by what only it declares: the page also
    // carries the design system's print rules (the site's chrome), so taking the
    // first <style> or the first @media print would check the wrong block.
    const blocks = [...shell.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
    const css = blocks.find((b) => b.includes('.rd-flow') && b.includes('@media print')) || '';
    const print = css.slice(css.indexOf('@media print'));
    const needs = [
      ['.rd-bar, .rd-nav', 'the app chrome is dropped'],
      ['display: none !important', 'and really dropped, not faded'],
      ['.rd-item.rd-out', 'the items outside the range do not print'],
      ['.rd-pb', 'the printed page numbers are restyled for paper'],
      ['position: absolute', 'and placed in the margin'],
      ['.rd-margin, .rd-rh', 'the margin notes and the running heads do not print'],
      ['.rd-note { break-inside: avoid', 'and a note is not split across two sheets'],
    ];
    const missing = needs.filter(([frag]) => !print.includes(frag)).map(([, what]) => what);
    check(
      print.length > 0 && missing.length === 0,
      `the reader's print block is emitted with every rule it needs${missing.length ? ` — missing: ${missing.join('; ')}` : ` (${blocks.length} style block(s) in ${readerText.slug})`}`,
    );
    // FAILS IF: the @media print block is dropped or trimmed — the page then
    // prints its toolbar, its drawer and its page markers inline in the prose.
  }
}

/* ---------- what the run measured ---------- */

section('measured');
{
  const { execFileSync } = await import('node:child_process');
  const bytes = (p) => Number(execFileSync('du', ['-sb', p], { encoding: 'utf8' }).split('\t')[0]);
  const libBytes = bytes(LIB);
  const pages = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.name === 'index.html') pages.push(join(d, e.name));
    }
  };
  walk(LIB);
  const sized = pages.map((p) => ({ p, size: statSync(p).size })).sort((a, b) => b.size - a.size);
  const over = sized.filter((x) => x.size > 2 * 1024 * 1024);
  console.log(`  library: ${pages.length} page(s), ${libBytes} bytes across dist/library/`);
  console.log(`  largest page: ${sized[0].size} bytes (${sized[0].p.slice(DIST.length + 1)})`);
  check(over.length === 0, `no page exceeds 2 MB (${over.length} over; largest ${(sized[0].size / 1048576).toFixed(2)} MB)`);
  const split = [...expected.entries()].filter(([, e]) => e.pages > 1);
  console.log(`  texts served in parts: ${split.length ? split.map(([s, e]) => `${s} (${e.pages} pages)`).join(', ') : 'none'}`);
  console.log(`  shelf: ${SHELF} — ${TEXTS.length} entries${statSync(SHELF).isDirectory() ? '' : ' (missing)'}`);
}

console.log(failures === 0 ? '\nlibrary-smoke: all checks passed' : `\nlibrary-smoke: ${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
