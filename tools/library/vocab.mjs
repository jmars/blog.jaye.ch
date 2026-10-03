#!/usr/bin/env node
/**
 * vocab.mjs — find the words that do not exist.
 *
 * WHY THIS EXISTS. The damage census reads a character set, and a merged rule is
 * only ever as good as the garble someone NOTICED. Neither can see a wrong word
 * that carries no damage character at all — the class the whole-text read keeps
 * finding by eye (`considerexLby` -> `considered by`, `wnnlrf` -> `would`). A
 * DICTIONARY sees them all at once: a token the reading view shows that is not a
 * word, not a proper noun the text uses, and not in the same-translation parallel
 * is a garble candidate, whether or not any character of it looked damaged.
 *
 * WHAT IT IS NOT. A dictionary is not a witness. `o'er`, `consign'd`, `Naiades'`,
 * `Phædrus`, `cunctaque` (the Latin quotation) and `WATKINS` are all real, and
 * several are OOV. So this tool REPORTS candidates with their site; a human (or
 * the scan) decides. It repairs nothing.
 *
 *   node tools/library/vocab.mjs [slug] [--json <out>] [--allow <file>]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { applyEditsCounted } from './extract.mjs';
import { TEXTS, SHELF, shelfFile } from './shelf.mjs';

const argv = process.argv.slice(2);
const slug = argv.find((a) => TEXTS.some((t) => t.slug === a)) || 'porphyry-on-the-cave-of-the-nymphs-taylor-1917';
const jsonOut = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;
const allowFile = argv.includes('--allow') ? argv[argv.indexOf('--allow') + 1] : null;

const ROOT = join(import.meta.dirname, '..', '..');
const CACHE = join(ROOT, 'content', 'library', '.words');
const WORDLIST = join(CACHE, 'words.txt');
const WORDLIST_URL = 'https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt';

async function wordlist() {
  if (existsSync(WORDLIST)) return readFileSync(WORDLIST, 'utf8');
  mkdirSync(CACHE, { recursive: true });
  const res = await fetch(WORDLIST_URL);
  if (!res.ok) throw new Error(`vocab: cannot fetch the wordlist (${res.status}); put one at ${WORDLIST}`);
  const text = await res.text();
  writeFileSync(WORDLIST, text);
  return text;
}

// A token is checked by its alphabetic core: possessives, the elisions the 1917
// print uses ('d, 'er, 't), the ligatures, and hyphenation are spelling, not words.
const core = (tok) => tok
  .toLowerCase()
  .replace(/æ/g, 'ae').replace(/œ/g, 'oe')
  .replace(/[’'](s|d|er|t|st|ll|re|ve|m)$/, '')
  .replace(/[’']/g, '');

// The allowlist (if present) names the words that are NOT garbles — the print's
// own foreign/archaic spellings, and the few garbles a per-block rule cannot
// express. Only lines with NO leading whitespace are entries; '#' starts a
// comment. Each entry is put through `core`, so the list and the text are
// compared in the same form.
const allowPath = allowFile && existsSync(allowFile)
  ? allowFile
  : join(ROOT, 'content', 'library', slug, 'vocab-allow.txt');
const allow = existsSync(allowPath)
  ? new Set(readFileSync(allowPath, 'utf8').split('\n')
      .filter((l) => l && !/^\s/.test(l))
      .map((l) => l.replace(/#.*$/, '').trim().split(/\s+/)[0])
      .filter(Boolean)
      .map(core))
  : new Set();

const doc = JSON.parse(readFileSync(join(ROOT, 'dist', 'library', slug, 't'), 'utf8'));
const rules = JSON.parse(readFileSync(join(ROOT, 'tools', 'library', 'edits', `${slug}.json`), 'utf8'))
  .edits.filter((r) => r.action !== 'leave')
  .map((r) => ({ find: r.find, repl: r.replace }));

// The parallel, same translation: a word that appears there cleanly is real.
const wit = join(ROOT, 'content', 'library', slug, 'witnesses.json');
const parWords = new Set();
if (existsSync(wit)) {
  const rec = JSON.parse(readFileSync(wit, 'utf8'));
  for (const w of rec.witnesses || []) {
    const p = join(ROOT, 'content', 'library', slug, 'witnesses', `${w.name}.txt`);
    if (!existsSync(p)) continue;
    for (const t of readFileSync(p, 'utf8').toLowerCase().match(/[a-z]{2,}/g) || []) parWords.add(t);
  }
}

const known = new Set((await wordlist()).split(/\s+/).filter(Boolean));
// (the allowlist is built below, once `core` exists — it must be normalised the
// same way the text is, or 'nautæ' in the list would not match 'nautae' in the text)

const isWord = (part) => {
  if (part.length < 2) return true; // single letters are initialisms, not garbles
  if (known.has(part) || parWords.has(part) || allow.has(part)) return true;
  // crude morphology: a known stem with a known affix is a word the list lacks
  for (const suf of ['s', 'es', 'ed', 'd', 'ing', 'ly', 'er', 'est', 'ness', 'ion', 'ions', 'ive', 'ity']) {
    if (part.endsWith(suf) && (known.has(part.slice(0, -suf.length)) || parWords.has(part.slice(0, -suf.length)))) return true;
  }
  return false;
};

// The reading view, block by block, exactly as the reader applies it.
const blocks = (doc.blocks || []).filter((b) => typeof b.x === 'string');
let section = null;
const findings = [];
for (const b of blocks) {
  if (b.t === 'sec' && b.x) section = b.x.replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!['p', 'verse', 'notedef'].includes(b.t)) continue;
  const view = applyEditsCounted(b.x, rules);
  for (const m of view.matchAll(/[A-Za-zÀ-ÿŒœÆæ’'’\-]+/g)) {
    const tok = m[0];
    if (/[A-Z]/.test(tok[0]) && tok.length > 1) {
      // a capitalised token is a proper noun unless it is a garble; keep it only
      // if it is the FIRST word of a sentence (those are ordinary words) — a
      // capital mid-sentence is a name. Conservative: skip capitalised tokens.
      continue;
    }
    const parts = core(tok).split('-').filter(Boolean);
    if (!parts.length) continue;
    if (parts.every(isWord)) continue;
    const i = m.index;
    findings.push({
      token: tok,
      section,
      context: view.slice(Math.max(0, i - 45), i + tok.length + 45).replace(/\s+/g, ' '),
    });
  }
}

const byToken = new Map();
for (const f of findings) {
  if (!byToken.has(f.token)) byToken.set(f.token, { token: f.token, n: 0, sites: [] });
  const e = byToken.get(f.token);
  e.n++;
  if (e.sites.length < 3) e.sites.push({ section: f.section, context: f.context });
}

const out = [...byToken.values()].sort((a, b) => b.n - a.n);
console.log(`vocab ${slug}: ${out.length} word(s) the reading view shows that the dictionary does not know`);
console.log(`  (proper nouns are skipped; a real archaic or foreign word can still appear — a reporter, not a judge)`);
for (const e of out) {
  console.log(`\n  ${JSON.stringify(e.token)} x${e.n}  [${e.sites[0].section || '?'}]`);
  for (const s of e.sites) console.log(`      ...${s.context}...`);
}
// A GATE, when there is no --report: any candidate that survives the allowlist is
// a word the reading view shows that no dictionary knows, and it exits non-zero so
// a build or a deploy can refuse. `--report` prints and exits 0 regardless.
if (jsonOut) {
  writeFileSync(jsonOut, `${JSON.stringify({ slug, candidates: out }, null, 2)}\n`);
  console.log(`\n  wrote ${jsonOut}`);
}
if (!argv.includes('--report') && out.length > 0) {
  console.error(`vocab: ${out.length} word(s) the dictionary does not know and the allowlist does not excuse`);
  process.exit(1);
}
