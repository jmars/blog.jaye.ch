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
import { GROUPS, TEXTS, shelfFiles, textSource, SHELF } from './library/shelf.mjs';
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

if (!existsSync(LIB)) {
  // The library is HELD BACK by default (LIBRARY=1 in tools/build.mjs): its
  // transcriptions are not yet worth reading, so nothing is emitted and there is
  // nothing to check. That is a skip, not a failure — the module, the shelf and
  // the checks below all still run when the switch is on, and a test that failed
  // here would make the default build look broken.
  console.log('library-smoke: the library is held back (LIBRARY=1 builds it) — nothing to check');
  console.log('library-smoke: PASSED (skipped)');
  process.exit(0);
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
  const src = srcOf(t);
  const a = assess(src, t.lang);
  const pages = builtPages(t.slug);
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
  const unwritten = TEXTS.filter((t) => !dirs.includes(t.slug)).map((t) => t.slug);
  const extra = dirs.filter((d) => !TEXTS.some((t) => t.slug === d));
  check(unwritten.length === 0, `every shelf entry has a built page (${TEXTS.length} entries${unwritten.length ? `; missing ${unwritten.join(', ')}` : ''})`);
  check(extra.length === 0, `no built library page belongs to no entry${extra.length ? `: ${extra.join(', ')}` : ''}`);
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
  check(pages.length > 40, `scanned ${pages.length} emitted file(s) under dist/library/ (pages and the data files a text serves)`);
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
  check(seen === pages.length && pages.length > 40, `read the prompt and palette data of ${seen} page(s)`);
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
  const order = [...index.matchAll(/<h2 id="group-([a-z-]+)">/g)].map((m) => m[1]);
  check(
    order.join(',') === GROUPS.map((g) => g.key).join(','),
    `the groups appear in the shelf's order (${order.join(', ')})`,
  );
  check(
    GROUPS.every((g) => TEXTS.some((t) => t.group === g.key)),
    'every group on the index has at least one text',
  );
  check(
    TEXTS.every((t) => GROUPS.some((g) => g.key === t.group)),
    'every text is in a group the index draws',
  );
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
  let withCitations = 0;
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
    if (want.size) withCitations++;
  }
  check(compared === TEXTS.length, `compared a citation line for every text (${compared})`);
  check(withCitations >= 3, `at least three texts are cited by a reading (${withCitations})`);
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
