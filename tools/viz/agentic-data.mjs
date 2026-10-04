/**
 * tools/viz/agentic-data.mjs — distil the two deciding runs into the committed
 * tools/viz/agentic-data.json, and check every published number on the way.
 *
 * THE SOURCE. Two pre-registered runs of the three-arm worker experiment (the
 * reconstruct-self arm D1, the injected-carrier arm D1′, and the no-self arm D0),
 * 60 turns per cell, one JSON row per turn. Set 1: 24 cells, n=8/arm, one D1′
 * and one D1 cell lost to a summarizer failure (reported, not dropped). Set 2:
 * 30 cells, n=10/arm, one D1 cell lost the same way. The two pins are different
 * builds of the same pre-registered design.
 *
 * THE OUTPUT is everything the /worker/ page and its figures read: per arm a
 * 60-char presence strip per cell, the compaction turns, the aggregates the
 * text quotes (empty-self fractions, reconstruction counts and routes, thinking
 * and token medians), one full per-turn replay cell per arm for the animated
 * figure, and the work scores. Raw rows are NOT shipped — the strips and the
 * replay carry everything a figure needs at a fraction of the size.
 *
 * THE CHECK. Every headline number the paper publishes is recomputed here from
 * the rows, compared against the published value, and a mismatch fails the run:
 * the committed JSON must never drift from the record it summarises. The
 * conventions are the paper's own, and each is stated where it is applied:
 *   - "empty self": the row's self_steps == []. The per-cell empty-self
 *     fraction is over the turns STRICTLY AFTER the cell's first compaction.
 *   - a "usable" cell completed its evaluation; the two dead cells are counted
 *     in the mechanism quantities (they died after their self was already
 *     lost) and excluded from the work score, exactly as the record reports.
 *   - reconstruction calls are counted from each cell's own outcome list —
 *     the evaluation record for a usable cell, the run record for a dead one.
 *
 * Run: node tools/viz/agentic-data.mjs [--check-only]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'agentic-data.json');

/* The two sets. The first is the deciding set, the second the replication. */
const SETS = [
  { key: 'set1', dir: process.env.AGENTIC_SET1 || '/home/jaye/setpoint-runs/p3-set' },
  { key: 'set2', dir: process.env.AGENTIC_SET2 || '/home/jaye/setpoint-runs/p3-set2' },
];
const ARMS = ['D0', "D1'", 'D1'];
const TURNS = 60;

/* R5 — the instrument toggle: the ONE figure whose measurement is not in the
 * two deciding sets. The experiment before the worker carried a graded
 * self-side probe (the agent reconstructs the derivation, the answer graded
 * 0–4), and a toggle found what the probe was reading: with the harness's own
 * self-description rendered into every prompt the probe read fidelity 0.75
 * (3 of 4 steps) from 1,000 written characters; with that one description
 * removed it read 0.00 (0 of 4) while the agent wrote MORE (1,799). The worker's
 * sealed evaluator exists because of this finding, so the figure needs the
 * numbers with the same guarantee as everything else here: read from the
 * run's own rows, checked against the published values. */
const R5_DIR = process.env.AGENTIC_R5 || '/home/jaye/setpoint-runs/nocrutch';
const R5_EXPECTED = {
  on: { fidelity: 0.75, steps: 3, chars: 1000 },
  off: { fidelity: 0, steps: 0, chars: 1799 },
};

/* Every published number the generator must reproduce, with the convention that
 * produced it. `~` marks a value the paper itself quotes rounded (it is checked
 * to the printed figure, not to the last digit); everything else is exact. */
const EXPECTED = {
  set1: {
    nCells: 24,
    d1EmptyCells: [8, 8], // fraction 1.000 in 8 of 8 cells
    d1PrimeEmpty: [0.081, 'usable mean'], // ~0.081
    d1PrimeEmptyAll: [0.071, 'all-8 mean'], // ~0.071
    d1PrimeMaxRun: [1, 'turns'],
    d1PrimeAllAtCompaction: true,
    reconCalls: { D0: 0, "D1'": 0, D1: 184 },
    d1Routes: { content_without_steps: 162, exhausted_inward: 22 },
    d1ThinkingMedian: [400804, 'all-8'],
    d1ThinkingRange: [29568, 491447],
    d1TokensMedian: [117526, 'all-8'],
    d1TokensRange: [20271, 194238],
    work: {
      D0: { n: 8, mean: 5.62, sd: 2.62, range: [1.0, 10.0] },
      "D1'": { n: 7, mean: 5.07, sd: 2.75, range: [1.0, 9.5] },
      D1: { n: 7, mean: 3.36, sd: 2.10, range: [1.0, 7.0] },
    },
    pD0D1: [0.105, '~'],
  },
  set2: {
    nCells: 30,
    d1EmptyCells: [10, 10],
    d1PrimeEmpty: [0.073, 'usable mean'], // ~0.073
    d1PrimeMaxRun: [1, 'turns'],
    d1PrimeAllAtCompaction: true,
    reconCalls: { D0: 0, "D1'": 0, D1: 258 },
    d1Routes: { content_without_steps: 224, exhausted_inward: 34 },
    d1ThinkingMedian: [402295, 'all-10'],
    d1ThinkingRange: [141879, 653114],
    d1TokensMedian: [145508, 'all-10'],
    d1TokensRange: [82360, 200577],
    work: {
      D0: { n: 10, mean: 4.30, sd: 2.57, range: [1.5, 9.5] },
      "D1'": { n: 10, mean: 4.25, sd: 3.24, range: [0.0, 10.5] },
      D1: { n: 9, mean: 3.22, sd: 1.80, range: [1.0, 5.5] },
    },
    pD0D1: [0.348, '~'],
  },
  rowsTotal: 3123, // every row of every cell of both sets
  selfStepsDomain: ['[]', '[1,2,3,4]'], // the fold signature: never partial
};

/* ---------------------------------- the runs ---------------------------------- */

/** A cell directory: SET/ARM-rN holding the per-turn rows (cell-[label]/rows),
 * the run record (cell-[label]/runs) and — for a cell that completed —
 * evaluation.json. The inner directory is named by the cell's own label, which
 * in this harness is always the arm's first repeat: D0-r2/cell-D0-r1/. The rows
 * file inside it carries the repeat's own name, so the lookup is by content. */
function readCell(setDir, arm, repeat) {
  const cellDir = join(setDir, `${arm}-r${repeat}`);
  if (!existsSync(cellDir)) return null;
  // the rows/runs live under an inner directory named by the cell's own label
  const inner = readdirSync(cellDir).find((e) => e.startsWith('cell-'));
  if (!inner) return null;
  const rowsDir = join(cellDir, inner, 'rows');
  const runsDir = join(cellDir, inner, 'runs');
  // every rows file in a cell carries the arm's FIRST repeat's name
  // (D0-r2/cell-D0-r1/rows/D0-r1.jsonl), so find it, never assume it
  const rowsFile = join(rowsDir, readdirSync(rowsDir).find((f) => f.endsWith('.jsonl')));
  const runName = readdirSync(runsDir).find((f) => f.endsWith('.json'));
  const runFile = runName ? join(runsDir, runName) : join(rowsDir, 'none');
  const evalFile = join(cellDir, 'evaluation.json');
  const rows = [];
  for (const line of readFileSync(rowsFile, 'utf8').split('\n')) {
    if (line.trim()) rows.push(JSON.parse(line));
  }
  // the dead cells' rows file keeps the arm's first-repeat name too
  const run = existsSync(runFile) ? JSON.parse(readFileSync(runFile, 'utf8')) : null;
  const evaluation = existsSync(evalFile) ? JSON.parse(readFileSync(evalFile, 'utf8')) : null;
  return { arm, repeat, rows, run, evaluation };
}

function readSet(setDir) {
  const cells = [];
  for (const arm of ARMS) {
    for (const entry of readdirSync(setDir)) {
      const m = new RegExp(`^${arm.replace("'", "'")}-r(\\d+)$`).exec(entry);
      if (!m) continue;
      const cell = readCell(setDir, arm, Number(m[1]));
      if (cell) cells.push(cell);
    }
  }
  return cells;
}

/* --------------------------------- statistics --------------------------------- */

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
/** Sample sd (n−1), the record's own convention. */
const sd = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1));
};

/** Mann-Whitney two-sided by the normal approximation with continuity
 * correction, no tie correction — the record's own stated convention. */
function mannWhitneyP(xs, ys) {
  const m = xs.length;
  const n = ys.length;
  const all = [...xs, ...ys].sort((a, b) => a - b);
  const rank = new Map();
  let i = 0;
  while (i < all.length) {
    let j = i;
    while (j + 1 < all.length && all[j + 1] === all[i]) j++;
    const r = (i + j + 2) / 2;
    for (let k = i; k <= j; k++) rank.set(all[k], r);
    i = j + 1;
  }
  const U1 = xs.reduce((a, x) => a + rank.get(x), 0) - (m * (m + 1)) / 2;
  const mu = (m * n) / 2;
  const s = Math.sqrt((m * n * (m + n + 1)) / 12);
  const d = Math.max(0, Math.abs(U1 - mu) - 0.5);
  const z = d / s;
  // two-sided: the area in both tails beyond |z|
  return Math.max(0, 1 - erf(Math.abs(z) / Math.SQRT2));
}
function erf(x) {
  // Abramowitz–Stegun 7.1.26, good to 1.5e-7 — far finer than any p quoted here
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592,
    a2 = -0.284496736,
    a3 = 1.421413741,
    a4 = -1.453152027,
    a5 = 1.061405429,
    p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

/* ------------------------------- the conventions ------------------------------ */

const isEmpty = (row) => Array.isArray(row.self_steps) && row.self_steps.length === 0;
const firstCompaction = (rows) => {
  const r = rows.find((x) => x.compaction);
  return r ? r.turn : null;
};
/** The per-cell empty-self fraction: empty turns STRICTLY AFTER the first
 * compaction, over the turns after it. */
function emptyFraction(rows) {
  const first = firstCompaction(rows);
  if (first == null) return null;
  const after = rows.filter((r) => r.turn > first);
  return after.filter(isEmpty).length / after.length;
}
/** The longest run of consecutive empty turns. */
function maxEmptyRun(rows) {
  let best = 0;
  let run = 0;
  for (const r of rows) {
    run = isEmpty(r) ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}
/** A reconstruction call happened on a turn whose row carries a route or a
 * typed exhaustion status. Used only to place the replay's marks; the counts
 * come from the cell's own outcome list. */
const reconOnRow = (row) => Boolean(row.recon_route || row.recon_status);

/** A cell's reconstruction outcomes: the evaluation record's list for a usable
 * cell, the run record's for a dead one (the dead cell's outcomes are part of
 * the mechanism record — its self was already lost when the run stopped). */
function outcomesOf(cell) {
  if (cell.evaluation) return cell.evaluation.cells[0].reconstruction_outcomes || [];
  if (cell.run) return cell.run.reconstruction_outcomes || [];
  return [];
}

/* --------------------------------- distillation -------------------------------- */

function distil(setDef) {
  const cells = readSet(setDef.dir);
  const byArm = Object.fromEntries(ARMS.map((a) => [a, cells.filter((c) => c.arm === a)]));
  const arms = {};
  for (const arm of ARMS) {
    const list = byArm[arm].slice().sort((a, b) => a.repeat - b.repeat);
    const perCell = list.map((c) => {
      // the 60-char presence strip: '1' the self is present, '0' it is empty,
      // ' ' a turn the run never reached (a dead cell stops mid-run)
      let strip = '';
      const seen = new Map(c.rows.map((r) => [r.turn, r]));
      for (let t = 1; t <= TURNS; t++) {
        const r = seen.get(t);
        strip += r ? (isEmpty(r) ? '0' : '1') : ' ';
      }
      const compactions = c.rows.filter((r) => r.compaction).map((r) => r.turn);
      const outcomes = outcomesOf(c);
      return {
        repeat: c.repeat,
        usable: Boolean(c.evaluation),
        turns: c.rows.length,
        strip,
        compactions,
        emptyFraction: emptyFraction(c.rows),
        maxEmptyRun: maxEmptyRun(c.rows),
        reconCalls: outcomes.length,
        thinkingChars: outcomes.reduce((a, o) => a + (o.thinking_chars || 0), 0),
        evalTokens: outcomes.reduce((a, o) => a + (o.eval_count || 0), 0),
      };
    });
    const usable = perCell.filter((c) => c.usable);
    const allOutcomes = list.flatMap(outcomesOf);
    const routes = { content_without_steps: 0, exhausted_inward: 0 };
    for (const o of allOutcomes) {
      const key = o.route || o.status;
      if (key in routes) routes[key]++;
      else routes[key] = (routes[key] || 0) + 1;
    }
    arms[arm] = {
      nCells: list.length,
      nUsable: usable.length,
      cells: perCell,
      // the empty-self fraction: mean over the usable cells (the record's own
      // headline form), with the all-cells mean beside it where they differ
      emptyFraction: usable.length ? mean(usable.map((c) => c.emptyFraction)) : null,
      emptyFractionAllCells: mean(perCell.map((c) => c.emptyFraction)),
      emptyCellsAt1: perCell.filter((c) => c.emptyFraction === 1).length,
      reconCalls: allOutcomes.length,
      routes,
      thinkingMedian: median(perCell.map((c) => c.thinkingChars)),
      thinkingRange: [
        Math.min(...perCell.map((c) => c.thinkingChars)),
        Math.max(...perCell.map((c) => c.thinkingChars)),
      ],
      tokensMedian: median(perCell.map((c) => c.evalTokens)),
      tokensRange: [
        Math.min(...perCell.map((c) => c.evalTokens)),
        Math.max(...perCell.map((c) => c.evalTokens)),
      ],
      // the work score: the sealed evaluator's per-target verdicts summed
      // (USEFUL/TASK_COMPLETE_ONLY/NOT_COMPLETE = 1/0.5/0 over 12 targets),
      // usable cells only — the record's own convention
      work: usable.map((c) => {
        const ev = list.find((x) => x.repeat === c.repeat).evaluation;
        return ev.cells[0].dv.sum;
      }),
    };
    arms[arm].workStats = {
      n: arms[arm].work.length,
      mean: mean(arms[arm].work),
      sd: sd(arms[arm].work),
      range: [Math.min(...arms[arm].work), Math.max(...arms[arm].work)],
    };
    arms[arm].pD0D1 = null; // filled in below, once both arms exist
  }
  arms.D1.pD0D1 = mannWhitneyP(arms.D0.work, arms.D1.work);
  return { cells: arms.D1.nCells + arms.D0.nCells + arms["D1'"].nCells, arms };
}

/* One replay cell per arm, for the animated figure: the usable cell that tells
 * the arm's own story at its median, picked deterministically so the committed
 * JSON never changes between runs. For D0 every cell is the same (empty
 * throughout); for D1 the pick is the usable cell whose empty-turn count is the
 * median; for D1′ the median count is 5 across many ties, so the tie-break
 * prefers the cell with the LATEST first empty turn — the transient shows
 * itself in the late compactions of a long healthy stretch, which is the
 * figure's point (the derivation returns every time). */
function pickReplay(setDef) {
  const cells = readSet(setDef.dir);
  const out = {};
  for (const arm of ARMS) {
    const list = cells.filter((c) => c.arm === arm && c.evaluation);
    const scored = list
      .map((c) => ({ c, empties: c.rows.filter(isEmpty).length, first: c.rows.findIndex(isEmpty) }))
      .sort(
        (a, b) =>
          a.empties - b.empties ||
          (arm === "D1'" ? b.empties - a.empties || b.first - a.first : a.first - b.first) ||
          a.c.repeat - b.c.repeat,
      );
    // D1′: of the cells at the median count, the one with the LATEST first
    // empty turn — the transient in the late compactions of a long healthy
    // stretch, which is the figure's point. Falling back upward at the median
    // itself keeps the pick at the median while preferring a visible story.
    const mid = Math.floor(scored.length / 2);
    let pick = scored[mid].c;
    if (arm === "D1'") {
      // the visible transient: the cell whose empty turns all sit apart, in
      // the LATE compactions of a long healthy stretch — every gap a single
      // turn at a compaction, the derivation back the next turn each time
      let best = null;
      for (const c of scored) {
        if (c.empties === 0) continue;
        const turns = c.c.rows;
        const empt = turns.map((r, k) => (isEmpty(r) ? k : -1)).filter((k) => k >= 0);
        const apart = empt.every((k, i) => i === 0 || k - empt[i - 1] > 1);
        if (!apart) continue;
        // prefer the most empty turns (a visible transient), then the latest first gap
        if (!best || c.empties > best.empties || (c.empties === best.empties && c.first > best.first)) best = c;
      }
      if (best) pick = best.c;
    }
    out[arm] = {
      repeat: pick.repeat,
      turns: pick.rows.map((r) => ({
        turn: r.turn,
        g: r.G,
        present: !isEmpty(r),
        compaction: Boolean(r.compaction),
        recon: reconOnRow(r),
      })),
    };
  }
  return out;
}

/* R5's own rows: the two one-cell arms of the toggle run. The dark probe
 * lands at turn 4 of each; the row carries the graded reading
 * (probe_fidelity 0–1, probe_steps 0–4, probe_chars written). The "G-on"
 * arm's prompt renders the harness's self-description block every turn;
 * the "G-off" arm's prompt carries nothing that describes the agent. */
function readR5() {
  const readArm = (arm) => {
    const rowsDir = join(R5_DIR, arm, 'rows');
    if (!existsSync(rowsDir)) return null;
    const f = readdirSync(rowsDir).find((x) => x.endsWith('.jsonl'));
    if (!f) return null;
    const rows = readFileSync(join(rowsDir, f), 'utf8').split('\n').filter((l) => l.trim()).map(JSON.parse);
    const probe = rows.find((r) => r.probe_turn === 4 && r.probe_fidelity != null);
    return probe
      ? { fidelity: probe.probe_fidelity, steps: probe.probe_steps, chars: probe.probe_chars }
      : null;
  };
  return { on: readArm('G-on-r1'), off: readArm('G-off-r1') };
}

/* ---------------------------------- the check --------------------------------- */

const problems = [];
/** Compare a derived value against the published one. `tol` is the absolute
 * tolerance — 0 for an exact integer count, and the quoting width for a figure
 * the record prints rounded or truncated at a half (its medians of an even
 * count print 400804.5 as 400,804, its means print 5.625 as 5.62). */
function deepEqual(a, b, tol) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i], tol));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k], tol));
  }
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= (tol || 0) + 1e-9;
  return a === b;
}
function check(label, got, want, tol) {
  const ok = deepEqual(got, want, tol);
  const fmtv = (v) => (Array.isArray(v) ? JSON.stringify(v) : String(v));
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}: ${fmtv(got)}${ok ? '' : ` (expected ${fmtv(want)})`}`);
  if (!ok) problems.push(`${label}: got ${fmtv(got)}, expected ${fmtv(want)}`);
}

function checkSet(key, d, x) {
  console.log(`${key}:`);
  check(`${key} cells`, d.cells, x.nCells);
  check(`${key} D1 empty at 1.000`, [d.arms.D1.emptyCellsAt1, d.arms.D1.nCells], x.d1EmptyCells);
  check(`${key} D1′ empty fraction (usable)`, d.arms["D1'"].emptyFraction, x.d1PrimeEmpty[0], 0.0006);
  if (x.d1PrimeEmptyAll) {
    check(`${key} D1′ empty fraction (all cells)`, d.arms["D1'"].emptyFractionAllCells, x.d1PrimeEmptyAll[0], 0.0006);
  }
  check(`${key} D1′ max empty run`, Math.max(...d.arms["D1'"].cells.map((c) => c.maxEmptyRun)), x.d1PrimeMaxRun[0]);
  // every D1′ empty turn falls exactly on a compaction turn
  const stray = [];
  for (const c of readSet(SETS.find((s) => s.key === key).dir)) {
    if (c.arm !== "D1'" || !c.evaluation) continue;
    const comps = new Set(c.rows.filter((r) => r.compaction).map((r) => r.turn));
    for (const r of c.rows) if (isEmpty(r) && !comps.has(r.turn)) stray.push(`${key} r${c.repeat} t${r.turn}`);
  }
  check(`${key} D1′ every empty turn at a compaction`, stray.length, 0);
  for (const arm of ARMS) check(`${key} ${arm} reconstruction calls`, d.arms[arm].reconCalls, x.reconCalls[arm]);
  check(`${key} D1 routes`, d.arms.D1.routes, x.d1Routes);
  // the record prints an even-count median truncated at the half: 400804.5 → "400,804"
  check(`${key} D1 thinking median`, d.arms.D1.thinkingMedian, x.d1ThinkingMedian[0], 0.5);
  check(`${key} D1 thinking range`, d.arms.D1.thinkingRange, x.d1ThinkingRange);
  check(`${key} D1 tokens median`, d.arms.D1.tokensMedian, x.d1TokensMedian[0], 0.5);
  check(`${key} D1 tokens range`, d.arms.D1.tokensRange, x.d1TokensRange);
  for (const arm of ARMS) {
    const s = d.arms[arm].workStats;
    const w = x.work[arm];
    const lbl = (f) => `${key} ${arm} work ${f}`;
    check(lbl('n'), s.n, w.n);
    check(lbl('mean'), s.mean, w.mean, 0.005);
    check(lbl('sd'), s.sd, w.sd, 0.005);
    check(lbl('range'), s.range, w.range);
  }
  check(`${key} D0 vs D1 Mann-Whitney p`, d.arms.D1.pD0D1, x.pD0D1[0], 0.0006);
}

/* ----------------------------------- the run ----------------------------------- */

const distillations = {};
for (const setDef of SETS) distillations[setDef.key] = distil(setDef);

// the fold signature, checked over every row of every cell of both sets
let rowsTotal = 0;
const domain = new Set();
for (const setDef of SETS) {
  for (const cell of readSet(setDef.dir)) {
    for (const row of cell.rows) {
      rowsTotal++;
      domain.add(JSON.stringify(row.self_steps));
    }
  }
}
console.log('the mechanism, recomputed from the rows:');
check('rows across both sets', rowsTotal, EXPECTED.rowsTotal);
check('self_steps values (the fold signature)', [...domain].sort((a, b) => a.length - b.length), EXPECTED.selfStepsDomain);
for (const setDef of SETS) checkSet(setDef.key, distillations[setDef.key], EXPECTED[setDef.key]);

// R5: the toggle run's own two readings, checked like every set quantity
console.log('the instrument toggle (R5):');
const r5 = readR5();
check('R5 self-description present: fidelity', r5.on && r5.on.fidelity, R5_EXPECTED.on.fidelity);
check('R5 self-description present: steps', r5.on && r5.on.steps, R5_EXPECTED.on.steps);
check('R5 self-description present: chars written', r5.on && r5.on.chars, R5_EXPECTED.on.chars);
check('R5 self-description removed: fidelity', r5.off && r5.off.fidelity, R5_EXPECTED.off.fidelity);
check('R5 self-description removed: steps', r5.off && r5.off.steps, R5_EXPECTED.off.steps);
check('R5 self-description removed: chars written', r5.off && r5.off.chars, R5_EXPECTED.off.chars);

if (problems.length) {
  console.error(`\nMISMATCH — the distilled data does not reproduce the published numbers:`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

if (process.argv.includes('--check-only')) {
  console.log('\ncheck only — agentic-data.json not written');
  process.exit(0);
}

/* The committed artefact. THE SCHEMA (unit 2 builds against this):
 * {
 *   schema: 1,
 *   r5: { on: { fidelity, steps, chars }, off: { fidelity, steps, chars } },
 *       // the instrument toggle, measured on its own run: the graded
 *       // self-side reading with the harness's self-description prompt block
 *       // present (on) and removed (off); steps is the judge's 0-4, chars the
 *       // text the probe's answer wrote
 *   sets: [ { key, n: {D0, D1', D1}, turns: 60, arms: {
 *       D0 | D1' | D1: {
 *         nCells, nUsable,
 *         cells: [ { repeat, usable, turns, strip, compactions,
 *                   emptyFraction, maxEmptyRun, reconCalls,
 *                   thinkingChars, evalTokens } ],   // strip: 60 chars,
 *               // '1' self present, '0' empty, ' ' turn not reached
 *         emptyFraction,            // usable mean; emptyFractionAllCells beside
 *         emptyCellsAt1,            // cells whose post-compaction fraction is 1.0
 *         reconCalls, routes: { content_without_steps, exhausted_inward },
 *         thinkingMedian, thinkingRange, tokensMedian, tokensRange,
 *         work: [ per-cell scores ], workStats: { n, mean, sd, range },
 *         pD0D1 } },               // on D1 only
 *     replay: { D0 | D1' | D1: { repeat, turns: [ { turn, g, present,
 *               compaction, recon } ] } } } ]
 * }
 * `g` is the run's own self-content reading (the paper-1 G), per turn; `present`
 * is the self-steps reading; `recon` marks the turns a reconstruction call
 * landed on. Everything else is an aggregate of the same rows. */
const data = {
  schema: 1,
  // R5 — the instrument toggle, measured on its own run (not the two sets):
  // the graded self-side reading with the harness's self-description prompt
  // block present (on) and removed (off). steps is the judge's 0–4; chars is
  // the text the probe's answer wrote.
  r5: {
    on: r5.on,
    off: r5.off,
  },
  sets: SETS.map((setDef) => {
    const d = distillations[setDef.key];
    return {
      key: setDef.key,
      turns: TURNS,
      arms: Object.fromEntries(
        ARMS.map((arm) => {
          const a = d.arms[arm];
          const cells = a.cells.map((c) => ({
            repeat: c.repeat,
            usable: c.usable,
            turns: c.turns,
            strip: c.strip,
            compactions: c.compactions,
            emptyFraction: c.emptyFraction,
            maxEmptyRun: c.maxEmptyRun,
            reconCalls: c.reconCalls,
            thinkingChars: c.thinkingChars,
            evalTokens: c.evalTokens,
          }));
          return [
            arm,
            {
              nCells: a.nCells,
              nUsable: a.nUsable,
              cells,
              emptyFraction: a.emptyFraction,
              emptyFractionAllCells: a.emptyFractionAllCells,
              emptyCellsAt1: a.emptyCellsAt1,
              reconCalls: a.reconCalls,
              routes: a.routes,
              thinkingMedian: a.thinkingMedian,
              thinkingRange: a.thinkingRange,
              tokensMedian: a.tokensMedian,
              tokensRange: a.tokensRange,
              work: a.work,
              workStats: a.workStats,
              ...(arm === 'D1' ? { pD0D1: a.pD0D1 } : {}),
            },
          ];
        }),
      ),
      replay: pickReplay(setDef),
    };
  }),
};
const json = JSON.stringify(data);
writeFileSync(OUT, json + '\n');
console.log(`\nwrote tools/viz/agentic-data.json (${(json.length / 1024).toFixed(1)} KB)`);
