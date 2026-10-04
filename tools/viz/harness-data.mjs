/**
 * tools/viz/harness-data.mjs — distil the design documents into the committed
 * tools/viz/harness-data.json for the /harness/ page.
 *
 * THE SOURCE. The design sketch of a substrate-heterogeneous triple-network
 * agent (architecture.md), its open-problems plan, and the build's own
 * component map (the Stage-2 scaffold README). The page is CURATED FROM THE
 * DESIGN, not derived from run data: what it shows is the design's own shape —
 * which of its binding constraints are MEASURED, which are INTERPRETATION,
 * which PROJECTION, which DECIDED, and which are open design choices.
 *
 * THE OUTPUT is everything the /harness/ page and its figures read: the
 * constraint set (one entry per C-row, with its text and status), the
 * design-rules table, the traps, the three modules with substrate and measured
 * disqualifier and build status, the failure classes, the timescales, the
 * routing requirements R1–R6, the codec layer (the three codecs on their two
 * orderings, the S1–S5 selection policy, the envelope, the compounding guard,
 * and the retrieval depletability demonstration with its control), and the
 * build-state component map. Every string is transcribed by PARSING the
 * document, never typed from memory, so a doc
 * edit regenerates the page and the transcription is checked against its
 * source on every run.
 *
 * THE CHECK. Each row's status is CLASSIFIED from the status cell's own words
 * (MEASURED / INTERPRETATION / PROJECTION / DECIDED / [C]); a row whose cell
 * matches none of them fails the run rather than being bucketed by guess — a
 * status the page cannot name honestly must not be smoothed into one it can.
 *
 * Run: node tools/viz/harness-data.mjs
 * Sources default to the design tree; HARNESS_ARCH / HARNESS_READM override.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'harness-data.json');
const ARCH = process.env.HARNESS_ARCH || '/home/jaye/thing/design/architecture.md';
const READM = process.env.HARNESS_READM || '/home/jaye/thing/agent/stage2_README.md';
const CODECS = process.env.HARNESS_CODECS || '/home/jaye/thing/design/memory-codecs.md';
const RETR = process.env.HARNESS_RETR || '/home/jaye/thing/agent/stage2_retrieval_tests.py';

const arch = readFileSync(ARCH, 'utf8');
const codecsDoc = readFileSync(CODECS, 'utf8');
const retrDoc = readFileSync(RETR, 'utf8');

/** The text of one numbered section (## n. ... up to the next ## or EOF). */
function section(headerRe) {
  const m = arch.match(headerRe);
  if (!m) throw new Error(`harness-data: section ${headerRe} not found`);
  return arch.slice(m.index, arch.length);
}
function slice(from, to) {
  const i = arch.indexOf(from);
  if (i < 0) throw new Error(`harness-data: "${from}" not found`);
  const j = arch.indexOf(to, i);
  if (j < 0) throw new Error(`harness-data: "${to}" not found after "${from}"`);
  return arch.slice(i, j);
}

/** Markdown **bold** → plain text; backticked code → plain; whitespace runs →
 * single spaces. The design docs mark their load-bearing terms in bold; the
 * page's figures need the words, not the emphasis. The docs' own evidence
 * markers (**[M — node]**, [C — …], [LITERATURE-SUPPORTED …]) are internal
 * citation names — stripped here, because a node name is workshop material
 * the published page must not carry. */
function plain(s) {
  return s
    .replace(/\*\*?\[M[^\]]*\]\*?\*?/g, '')
    .replace(/\[LITERATURE-SUPPORTED[^\]]*\]/g, '')
    .replace(/\[MODEL-DERIVED[^\]]*\]/g, '')
    // bare node names cited inline ("(handoff-selfreg-supply-lever — R5 forbids
    // …)") are the same internal citation vocabulary; the citation often sits in
    // its own parens, so the emptied pair is collapsed with it
    .replace(/\s*\(?\s*handoff-[a-z0-9-]+\s*\)?/g, '')
    // source-file citations ("agent/routing.py, battery F1–F7") are the build's
    // own tree, not the design's public vocabulary
    .replace(/\s*\(?\s*[a-z_]+\/[a-z_0-9]+\.py\s*,?\s*/g, ' ')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\s+/g, ' ')
    // tidy the seams the citation strips leave (", , tests" → ", tests"),
    // after the whitespace collapse so the pattern sees the collapsed form
    .replace(/,\s*,/g, ',')
    .replace(/\(\s*,/g, '(')
    .replace(/,\s*\./g, '.')
    .replace(/\s+\)/g, ')')
    .replace(/\(\s*\)/g, '')
    .trim();
}

/* ---------------------- the constraint set (§4a, the C-table) ---------------------- */

function parseConstraints() {
  const seg = slice('### 4a. The constraint set', '### 4b. Eager vs scheduled');
  const rows = [];
  for (const line of seg.split('\n')) {
    if (!/^\| C[0-9]/.test(line)) continue;
    const parts = line.trim().replace(/^\|/, '').replace(/\|\s*$/, '').split(' | ');
    if (parts.length !== 3) throw new Error(`harness-data: C-row does not have 3 cells: ${line.slice(0, 80)}`);
    const id = parts[0].trim();
    const text = plain(parts[1]);
    // the status cell keeps its own [C] marker — the marker IS the status, not
    // workshop citation. The doc writes it as "[C, qualifier]" with the whole
    // cell inside one bracket; the page shows the word form "[C] qualifier]"
    const statusCell = plain(parts[2])
      .replace(/^\[C\b,?\s*/, '[C] ')
      .replace(/\]$/, '')
      .replace(/^\[C\]\s*;\s*/, '[C] ')
      .trim();
    const status = classifyStatus(id, statusCell);
    rows.push({ id, text, status, statusCell });
  }
  if (rows.length < 27) throw new Error(`harness-data: expected ≥27 C-rows, parsed ${rows.length}`);
  return rows;
}

/** A status cell often carries TWO statuses for one row ("MEASURED (inputs);
 * PROJECTION (component)") — the design's own honesty about which half of a
 * claim is measured. The classification keeps every status the cell names and
 * the ORDER it names them in; the FIRST is the row's headline status (the one
 * the grid sorts it under), the rest are visible in the readout. */
function classifyStatus(id, cell) {
  const found = [];
  // `\[C` needs its own alternation arm: `[` is a non-word character, so the
  // \b before it matches the C-row's bracketed design choices only this way.
  // The [C arm matches the bracket; the captured NAME is "C" so the JSON can
  // sort it as a status word rather than a null.
  const re = /\b(MEASURED|INTERPRETATION|PROJECTION|DECIDED)\b|\[C\b/g;
  let m;
  while ((m = re.exec(cell))) {
    const word = m[0] === '[C' ? 'C' : m[1];
    if (!found.includes(word)) found.push(word);
  }
  if (!found.length) throw new Error(`harness-data: C${id} status cell matches no known status: "${cell}"`);
  return found;
}

/* ------------------------------ the design rules (§7) ----------------------------- */

function parseRules() {
  const seg = slice('## 7. Design-rules table', '## 8. Traps');
  const rows = [];
  for (const line of seg.split('\n')) {
    if (!/^\| [0-9]/.test(line)) continue;
    const parts = line.trim().replace(/^\|/, '').replace(/\|\s*$/, '').split(' | ');
    if (parts.length !== 4) throw new Error(`harness-data: rule row does not have 4 cells: ${line.slice(0, 80)}`);
    rows.push({ id: parts[0].trim(), rule: plain(parts[1]), measurement: plain(parts[2]) });
  }
  if (rows.length !== 20) throw new Error(`harness-data: expected 20 rules, parsed ${rows.length}`);
  return rows;
}

/* --------------------------------- the traps (§8) -------------------------------- */

function parseTraps() {
  const seg = slice('## 8. Traps', '## 9. What is not designed');
  const rows = [];
  for (const m of seg.matchAll(/^- \*\*(.+?)\*\* (.+?)(?=^- |\n[^*\n]|\n$|$)/gms)) {
    rows.push({ name: plain(m[1]), evidence: plain(m[2]) });
  }
  const expect = 8; // the doc's own count: eight traps, each with a measurement
  if (rows.length !== expect) throw new Error(`harness-data: expected ${expect} traps, parsed ${rows.length}`);
  return rows;
}

/* --------------------------- the failure classes (§5a) ---------------------------- */

function parseClasses() {
  const seg = slice('### 5a. The four failure classes', '## 6. Timescales');
  const rows = [];
  const re = /^- \*\*\(([A-D])\) (.+?)\*\* (.+?)(?=^- |\n\n|\n## )/gms;
  let m;
  while ((m = re.exec(seg))) {
    rows.push({ id: m[1], name: plain(m[2]), text: plain(m[3]) });
  }
  if (rows.length !== 4) throw new Error(`harness-data: expected 4 failure classes, parsed ${rows.length}`);
  // each class's fix family is named in its own text ("Fix family: …")
  for (const r of rows) {
    const fm = r.text.match(/Fix family: ([^;.]+)/i);
    if (!fm) throw new Error(`harness-data: class (${r.id}) names no fix family`);
    r.fix = plain(fm[1]);
    const sig = r.text.match(/signal[:.] (.*?)(?:\.|Fix family)/i) || r.text.match(/distinguishing signal.*?: (.*?)(?:\.|Fix family)/i);
    r.signal = sig ? plain(sig[1]) : r.text.split('.').slice(0, 1).join('.') + '.';
  }
  return rows;
}

/* -------------------------------- the timescales (§6) ----------------------------- */

function parseTimescales() {
  const seg = slice('## 6. Timescales', '## 7. Design-rules table');
  // the doc's own list: "τ_a = 1 (attention, fastest), τ_G = 20, τ_D = 50,
  // τ_S = 100, τ_g = 200 (gain, slowest)" — only the first and last carry a
  // note in the sentence; the middle three are bare values, so the note is an
  // optional group and the names come from the doc's own axis letters
  const rows = [];
  const re = /τ_(\w+) = (\d+)(?: \(([^)]*)\))?/g;
  let m;
  while ((m = re.exec(seg))) {
    if (rows.some((r) => r.name === 'τ_' + m[1])) continue;
    rows.push({ name: 'τ_' + m[1], value: Number(m[2]), note: m[3] || '' });
  }
  const ids = rows.map((r) => r.name).join(',');
  if (ids !== 'τ_a,τ_G,τ_D,τ_S,τ_g') throw new Error(`harness-data: timescales parsed wrong: ${ids}`);
  return {
    rows,
    separation: 'about 200× between the fastest (τ_a = 1, attention) and the slowest (τ_g = 200, gain)',
    open: 'the gain/capacity analogue — the timescale that should move ~200× slower than attention — has no designated supplier',
  };
}

/* ------------------------------ the modules (§2 + §10) ---------------------------- */

function parseModules(readme) {
  const seg = slice('## 2. The three modules', '## 3. The currency');
  const rows = [];
  // each module's own paragraph: **X analogue — substrate.** Job: …
  const re = /^\*\*(DMN|CEN|SN) analogue — (.+?)\*\*\nJob: (.+?)\s?\*\*\[M/gms;
  let m;
  while ((m = re.exec(seg))) {
    rows.push({ key: m[1], substrate: plain(m[2]), job: plain(m[3]) });
  }
  if (rows.length !== 3) throw new Error(`harness-data: expected 3 modules, parsed ${rows.length}`);

  /* A SHORT label for the module box, so the box never has to truncate the
   * subsentence — the full substrate is in the readout when the module is
   * selected, so nothing is lost and the box ends on a whole word. */
  const SHORT = {
    DMN: 'an LLM',
    CEN: 'a Datalog engine',
    SN: 'a rule-based regulator',
  };
  for (const r of rows) r.short = SHORT[r.key];

  // the MEASURED requirement that forced each substrate — quoted from the
  // module's own paragraph, so the figure never restates it from memory
  const req = {
    DMN: 'it must be genuinely self-referential (its output includes a model of itself), not a content buffer',
    CEN: 'if the CEN is a deductive engine, cannibalization becomes literal (self-referential proof loops), the floor becomes cycle detection',
    SN: 'Two independent measured requirements disqualify an LLM from this slot: τ_a = 1 means it must act every step',
  };
  // verify each quoted requirement IS in the doc before shipping it
  for (const r of rows) {
    if (!seg.includes(req[r.key])) {
      throw new Error(`harness-data: module ${r.key}'s quoted requirement not found verbatim in §2`);
    }
    r.requirement = req[r.key];
  }

  // build status: the scaffold's own component map, by module
  const status = componentStatus(readme);
  const map = {
    DMN: status.dmn,
    CEN: status.cen,
    SN: status.sn,
  };
  return rows.map((r) => ({ ...r, build: map[r.key] }));
}

/** The build's own REAL/STUB/PENDING words for the three module seats, read
 * from the component map so the page cannot claim more than the scaffold
 * does. Throws when the map's own rows are absent — the honest current value
 * is stated in the README, never invented here. */
function componentStatus(readme) {
  const pick = (label, re) => {
    const m = readme.match(re);
    if (!m) throw new Error(`harness-data: component-map row "${label}" not found`);
    return plain(m[1]).split(/[—.]/)[0].trim();
  };
  return {
    sn: pick('plant loop', /^\| plant loop \(a\/S\/g, floor, actuator, block, store\) \| \*\*(.+?)\*\*/m),
    cen: pick('Datalog engine', /^\| Datalog engine \| \*\*(.+?)\*\*/m),
    dmn: pick('DMN', /^\| DMN \| \*\*(.+?)\*\*/m),
  };
}

/* --------------------------- the routing requirements (§3a) ------------------------ */

function parseRouting() {
  const seg = slice('### 3a. The two axes', '## 4. The shared store');
  const rows = [];
  for (const id of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6']) {
    const i = seg.indexOf(`**${id} — `);
    if (i < 0) throw new Error(`harness-data: routing requirement ${id} not found in §3a`);
    const j = seg.indexOf(`**R`, i + 10);
    const text = seg.slice(i, j < 0 ? seg.length : j);
    const head = plain(text.match(/\*\*(.+?)\*\*/)[1]);
    const body = plain(text.replace(/^[^*]*\*\*.+?\*\*/, ''));
    rows.push({ id, head, text: body });
  }
  return rows;
}

/* --------------------------- the codec layer (memory-codecs.md) ------------------- */

/** The memory-codec spec: three implementations of one EXISTING seat, a
 * selection policy with rules and no weights, an envelope, a compounding
 * guard, and the retrieval depletability demonstration with its control.
 * Everything is parsed from the spec's own §-blocks and the retrieval
 * battery's own docstring/lines; a number the parser cannot find fails the
 * run rather than being typed in from memory. */
function parseCodecs() {
  const doc = codecsDoc;

  /* -- §2's table: the three codecs, what Z is, the decoder, the drift, the
   * buildability. The row cells are quoted, not paraphrased; a marker the
   * doc carries (**bold**, [M — node]) is stripped by plain(). */
  const seg2 = docSlice(doc, '## 2. The three codecs', '## 3. The ordering');
  const CODEC_IDS = ['SCHEMA', 'GIST', 'LATENT'];
  const rows = [];
  for (const id of CODEC_IDS) {
    const re = new RegExp(`^\\| \\*\\*${id}\\*\\* \\| (.+?) \\| (.+?) \\| (.+?) \\| (.+?) \\|$`, 'm');
    const m = seg2.match(re);
    if (!m) throw new Error(`harness-data: codec ${id}'s §2 table row not found`);
    rows.push({
      id: id.toLowerCase(),
      z: plain(m[1]),
      decoder: plain(m[2]),
      drift: plain(m[3]),
      buildable: plain(m[4]),
    });
  }

  /* -- §3: the two orderings, and where they break. The orderings are the
   * design's core claim; the breaks are the honest boundaries of each codec.
   * Each break is quoted verbatim from its own bullet. */
  const seg3 = docSlice(doc, '## 3. The ordering', '## 4. The selection');
  const ordMatch = seg3.match(/\*\*Cost: SCHEMA < GIST < LATENT\*\* (.+?) \*\*Structural fidelity: SCHEMA > GIST > LATENT\*\* (.+?) These orderings AGREE, and that agreement is the core of\nthe design: \*\*(.+?)\*\* — so the policy never trades fidelity for economy on structured content\./s);
  if (!ordMatch) throw new Error('harness-data: §3 ordering sentence not found');
  const breaks = [];
  const breakRe = /^- \*\*(SCHEMA|GIST|LATENT) (.+?)\*\* (.+?)(?=^- |\n\n)/gms;
  let bm;
  while ((bm = breakRe.exec(seg3))) {
    breaks.push({ id: bm[1].toLowerCase(), what: plain(bm[2]), text: plain(bm[3]) });
  }
  if (breaks.length !== 3) throw new Error(`harness-data: expected 3 ordering breaks, parsed ${breaks.length}`);

  /* -- §4.2: the five rules. Precedence order, each with its own rationale;
   * the implemented policy (memory_codecs.select_codec) checks S4 first
   * among re-encodes, so the page's live order is the built one, and the
   * spec's precedence is stated beside it. */
  const seg42 = docSlice(doc, '### 4.2 The rules', '### 4.3 External');
  const rules = [];
  const ruleRe = /^- \*\*(S[1-5]) — (.+?)\*\* (.+?)(?=^- |\n\n)/gms;
  let rm;
  while ((rm = ruleRe.exec(seg42))) {
    rules.push({ id: rm[1], head: plain(rm[2]), text: plain(rm[3]) });
  }
  if (rules.length !== 5) throw new Error(`harness-data: expected 5 codec rules, parsed ${rules.length}`);
  // the S1–S5 the BUILT policy applies (the doc is a spec; the
  // implementation's precedence — S4 first among re-encodes, because it
  // binds S1 too — is stated at its own docstring; a spec/impl divergence
  // this size must be visible, not smoothed)
  const lowTier = plain(
    (seg42.match(/The LOW TIER never reaches the policy at all: (.+?)(?=\n\n|$)/s) || [])[1] || ''
  );
  if (!lowTier) throw new Error('harness-data: §4.2 low-tier note not found');
  const s4Bound = rules.length === 5 && rules[3].id === 'S4' && /hot/i.test(rules[3].head);
  if (!s4Bound) throw new Error('harness-data: S4 rule did not parse');

  /* -- §4.3: the external-ownership ladder. The codec policy is the THIRD
   * externally-owned selector, after the R5 retrieval selector and the cue
   * policy; the reason is quoted verbatim (it is the project's own subject
   * one layer down, and the figure must carry it, not paraphrase it). */
  const seg43 = docSlice(doc, '### 4.3 External', '## 5. The decision');
  const ownM = seg43.match(/\*\*A mechanism choosing its own codec would choose the one that makes its own content easiest\nto predict and smallest — a SELF-SERVING COMPRESSION\.\*\* (.+?)(?:\n\n| Therefore)/s);
  if (!ownM) throw new Error('harness-data: §4.3 self-serving-compression sentence not found');
  const ladder = [
    { n: 'the R5 retrieval selector', what: 'selects the evidence the reconstruction is built from — content-blind by construction' },
    { n: 'the cue policy', what: 'a frozen dataclass injected at construction; nothing in the mechanism chooses' },
    { n: 'the codec policy', what: 'a frozen dataclass injected with the consolidation seat; the mechanism never constructs one' },
  ];
  const contentRead = seg43.match(/the\ncodec policy READS CONTENT — the structural test is a content read\. This is safe only\nbecause \(i\) (.+?), and \(ii\) (.+?)\. Any future/s);
  if (!contentRead) throw new Error('harness-data: §4.3 content-read honesty paragraph not found');

  /* -- §5: encode-time, settled; supersession, never rewrite. */
  const seg5 = docSlice(doc, '## 5. The decision point', '## 6. Attributability');
  const decodePriced = seg5.includes('It multiplies the store, which is the resource the codec exists to BOUND.');
  if (!decodePriced) throw new Error('harness-data: §5 decode-time pricing paragraph not found');

  /* -- §6: the envelope and the C19 floor. */
  const seg6 = docSlice(doc, '## 6. Attributability', '## 7. The gist');
  const envM = seg6.match(/```\ncodec_id \| decoder_version \| payload\(Z\)\n```/);
  if (!envM) throw new Error('harness-data: §6 envelope shape not found');
  const fields = [];
  for (const name of ['codec_id', 'decoder_version']) {
    const fm = seg6.match(new RegExp(`- \\*\\*\`(${name})\`\\*\\* (.+?)(?=^\\n|^- |\\n\\n)`, 'ms'));
    if (!fm) throw new Error(`harness-data: §6 envelope field ${name} not found`);
    fields.push({ name: fm[1], text: plain(fm[2]) });
  }
  const provM = seg6.match(/- \*\*provenance\*\* — `supersedes` (.+?) the C19 supersession chain\./s);
  if (!provM) throw new Error('harness-data: §6 provenance row not found');
  const floorM = seg6.match(/\*\*The decode chain has a guaranteed floor, and C19 is why\.\*\* (.+?)(?:\*\*\[INTERPRETATION|$)/s);
  if (!floorM) throw new Error('harness-data: §6 decode-chain floor not found');

  /* -- §7: the gist call's own generation policy — the measured §5.3 trap. */
  const seg7 = docSlice(doc, '## 7. The gist', '## 8. Honesty');
  const trapM = seg7.match(/can spend\nits whole budget on its own trace and emit NOTHING\*\*: (.+?)\n\*\*\[M /s);
  if (!trapM) throw new Error('harness-data: §7 trace-budget trap not found');

  /* -- §8: the honesty statuses. Y is the task; what is buildable now and
   * what is PROJECTION — the three build statuses the page draws as words. */
  const seg8 = docSlice(doc, '## 8. Honesty: Y is the task', '## 9. Compounding');
  const buildableM = seg8.match(/- \*\*BUILDABLE NOW:\*\* (.+?)(?=\n- )/s);
  const projectionM = seg8.match(/- \*\*PROJECTION UNTIL PREREQUISITE 2 LANDS:\*\* (.+?)(?=\n- )/s);
  const notBuildableM = seg8.match(/- \*\*NOT BUILDABLE:\*\* (.+?)(?=\n|$)/s);
  if (!buildableM || !projectionM || !notBuildableM) {
    throw new Error('harness-data: §8 honesty rows not found');
  }

  /* -- §9: the compounding guard. */
  const seg9 = docSlice(doc, '## 9. Compounding', '## 10. What is');
  const guardM = seg9.match(/the gist input at ANY window is the\nSUPERSEDED ORIGINAL ENTRY, never the previous gist\. (.+?)(?:\*\*\[PROJECTION|$)/s);
  if (!guardM) throw new Error('harness-data: §9 compounding guard not found');
  const priorArt = /24\s+registered generations/.test(seg9);
  if (!priorArt) throw new Error('harness-data: §9 generational prior art not found');

  return {
    codecs: rows,
    orderings: {
      cost: plain(ordMatch[1]),
      fidelity: plain(ordMatch[2]),
      agree: plain(ordMatch[3]),
      breaks,
    },
    rules,
    lowTier,
    ownership: {
      selfServing: plain(ownM[1]),
      ladder,
      contentRead: {
        safe1: plain(contentRead[1]),
        safe2: plain(contentRead[2]),
      },
    },
    envelope: {
      shape: 'codec_id | decoder_version | payload(Z)',
      fields,
      provenance: plain(provM[1]),
      floor: plain(floorM[1]),
    },
    gistTrap: plain(trapM[1]),
    honesty: {
      buildable: plain(buildableM[1]),
      projection: plain(projectionM[1]),
      notBuildable: plain(notBuildableM[1]),
    },
    compounding: {
      guard: plain(guardM[1]),
      priorArt: 'the generational line: 24 registered generations, no trap of either kind — licenses the SHAPE (a re-applied operator on its own output), not the text case',
    },
  };
}

/** Slice a bounded segment out of the memory-codecs spec (same shape as
 * slice(), but for the codec doc rather than architecture.md). */
function docSlice(doc, from, to) {
  const i = doc.indexOf(from);
  if (i < 0) throw new Error(`harness-data: memory-codecs.md "${from}" not found`);
  const j = doc.indexOf(to, i);
  if (j < 0) throw new Error(`harness-data: memory-codecs.md "${to}" not found after "${from}"`);
  return doc.slice(i, j);
}

/* ------------------ the retrieval demonstration (battery D2 + §11c) ---------------- */

/** The depletability measurement with its free-retrieval control, from the
 * design's own §11c paragraph and the battery's own D2 source. The three
 * points and the budget are the design's published numbers; the CANDIDATE
 * arithmetic (min(turns-1, B) / max(turns-1, 1)) is the battery's own
 * mechanism, re-derived here so the figure's live numbers always land on the
 * published three when the reader leaves the sliders alone. */
function parseRetrieval() {
  // §11c's demonstration paragraph — the source of the headline numbers
  const seg = slice('**The demonstration and its control', '**What is MODEL-DERIVED');
  const m = seg.match(/Measured \(D2, B=(\d+)\): store 3→8→12 turns, priced coverage \*\*([\d.]+) → ([\d.]+) → ([\d.]+)\*\*\. The CONTROL: with retrieval priced at ZERO, the SAME growth does NOT thin — coverage stays \*\*([\d.]+)\*\* at store 12 with charge 0/);
  if (!m) throw new Error('harness-data: §11c D2 demonstration numbers not found');
  const B = Number(m[1]);
  const points = [Number(m[2]), Number(m[3]), Number(m[4])];
  const freeCov = Number(m[5]);
  if (B !== 6 || points.join(',') !== '1,0.857,0.545' || freeCov !== 1) {
    throw new Error(`harness-data: §11c D2 numbers parsed wrong (B=${B}, ${points})`);
  }
  // the arithmetic the battery runs: candidates = turns - 1 (the fixture's
  // per-turn keys collide with seeded self keys, and each retrieval records
  // one access), affordable = min(candidates, B), coverage = the ratio. The
  // marker is checked here, not trusted: 6/7 -> 0.857 and 6/11 -> 0.545 are
  // the design's own published values.
  const b2 = retrDoc.match(/B = 6\n    sizes = \(3, 8, 12\)/);
  if (!b2) throw new Error('harness-data: the retrieval battery\'s own D2 line not found');
  const pricedLine = retrDoc.match(/priced_cov\.append\(\(turns, out\.candidate_count,/);
  if (!pricedLine) throw new Error('harness-data: the retrieval battery\'s own candidate-count line not found');
  for (const [turns, cov] of [[8, 0.857], [12, 0.545]]) {
    const cand = turns - 1;
    const got = Math.min(cand, B) / cand;
    if (Math.abs(got - cov) > 0.0005) {
      throw new Error(`harness-data: the D2 arithmetic disagrees with the published value at store ${turns} (${got} vs ${cov})`);
    }
  }
  // the control's own statement in the battery — quoted, so the figure never
  // paraphrases the reason the control exists
  const ctrlM = retrDoc.match(/f"charge 0: the pilot's retention-1\.000 defect reproduced "\n\s*f"\('nothing was consumed, so the model's mechanism was never "\n\s*f"engaged', architecture\.md:176\) \[MEASURED\]/);
  if (!ctrlM) throw new Error('harness-data: the D2 control\'s own quoted reason not found');
  return {
    budget: B,
    points: [
      { store: 3, coverage: points[0] },
      { store: 8, coverage: points[1] },
      { store: 12, coverage: points[2] },
    ],
    freeCoverage: freeCov,
    controlReason:
      "nothing was consumed, so the model's mechanism was never engaged — the pilot's retention-1.000 defect, reproduced as the control arm",
    arithmetic:
      'priced coverage = min(store − 1, budget) / (store − 1): the candidate pool is the self entries written before the turn (each turn overwrites the seed key), and the budget buys at most B of them',
    statusNote:
      'MEASURED on the fixture substrate — stub DMN, deterministic; the vocation-level number does not exist',
  };
}


const readme = readFileSync(READM, 'utf8');
const data = {
  schema: 1,
  curated: true,
  constraints: parseConstraints(),
  rules: parseRules(),
  traps: parseTraps(),
  classes: parseClasses(),
  timescales: parseTimescales(),
  modules: parseModules(readme),
  routing: parseRouting(),
  codecs: parseCodecs(),
  retrieval: parseRetrieval(),
};

writeFileSync(OUT, JSON.stringify(data) + '\n');
const counts = {};
for (const c of data.constraints) {
  const k = c.status[0];
  counts[k] = (counts[k] || 0) + 1;
}
console.log(`harness-data: wrote ${OUT}`);
console.log(`  constraints: ${data.constraints.length} (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')})`);
console.log(`  rules: ${data.rules.length} · traps: ${data.traps.length} · classes: ${data.classes.length} · modules: ${data.modules.length} · routing: ${data.routing.length}`);
console.log(`  codecs: ${data.codecs.codecs.length} (SCHEMA/GIST/LATENT) · rules S1–S5: ${data.codecs.rules.length} · retrieval: D2 B=${data.retrieval.budget} coverage ${data.retrieval.points.map((p) => p.coverage).join(' → ')} (control ${data.retrieval.freeCoverage.toFixed(3)})`);
