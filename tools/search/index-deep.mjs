/**
 * tools/search/index-deep.mjs — the FETCHED half of the search index.
 *
 * The page keeps everything a query needs to START (the docs, the vocabulary,
 * the vectors, the graph): that part is inlined and always present. This file
 * derives the half that is too big to inline — measured, the passages alone are
 * several times the whole page — and the build writes it to ONE static,
 * same-origin, extensionless file the page fetches on first search (see
 * buildSearch; the leak gate forbids a source-file-looking name on the wire, so
 * the path carries none).
 *
 * Three things live here, and they JOIN:
 *
 *   lex    per vocabulary term, the BODY positions it occurs at — one entry per
 *          (term, piece): [docIndex, pos, pos−pos, …] with the POSITIONS
 *          DELTA-ENCODED as plain integers. A varint/base64 layer was measured
 *          against this and rejected: the deltas are small, gzip eats repeated
 *          small integers better than it eats an opaque base64 blob, and JSON
 *          parses without a decoder both sides must keep in step. The positions
 *          are stream positions over the piece's passages laid end to end (see
 *          `passAt`), so a phrase's adjacency is adjacency in THIS stream.
 *   pass   per piece, its passages — the paragraph rule is in `passagesOf`.
 *   passAt per piece, the stream position each passage STARTS at: the join. A
 *          position resolves to its passage by the last boundary at or under it,
 *          which is what makes a snippet name the passage a hit sat in.
 *
 * The token rule is the index's own (searchTerms in tools/build.mjs): the same
 * regex, the same length floor, the same stopword list — the words counted here
 * are the words the page's own tokeniser will count in the passage text, or the
 * join is meaningless. A piece with no body (should not happen) yields no rows.
 *
 * Rows are in VOCABULARY order and the row count EQUALS the vocabulary, empty
 * rows included (a term that reached the vocabulary through a title and never
 * occurs in any body): the client addresses a row by the term's own index, so
 * a missing row would read as a silence the vocabulary does not have.
 */

/** The index's own word rule, repeated here (not imported) for the same reason
 * the smoke test repeats it: the build's derivation and the page's must be two
 * copies of one rule that can be held against each other, not one call. */
const DEEP_WORD = /[a-z][a-z'-]+/g;

/** A term's body positions in one piece.
 *
 * `passages` are the piece's passages; the stream is their token lists laid end
 * to end, so a position is (passage index, offset in passage) flattened — the
 * flattening is what makes ADJACENCY a single +1, and the passage join is
 * `passAt`. Every word of the passage advances the stream — stopwords and short
 * words included, so adjacency is the text's own — but only VOCABULARY terms
 * are recorded: a fragment the whole-file word rule never sees (a link's url
 * left bare by a paragraph break inside the link) is not a word any query can
 * ask for, and recording it would address a posting row that does not exist. */
function termPositions(passages, stop, termAt) {
  const hits = new Map(); // term -> [stream position, …]
  const passAt = [];
  let pos = 0;
  for (const p of passages) {
    passAt.push(pos);
    const words = String(p).toLowerCase().match(DEEP_WORD) || [];
    for (const w of words) {
      if (w.length >= 3 && !stop.has(w) && termAt.has(w)) {
        let list = hits.get(w);
        if (!list) hits.set(w, (list = []));
        list.push(pos);
      }
      pos++;
    }
  }
  return { hits, passAt, total: pos };
}

/** The BODY of a piece: everything after the front matter's `---` rule, which
 * every piece of this blog carries between its summary block and its prose. The
 * body's own section headings stay IN (they are prose a query reaches), the
 * footnote DEFINITIONS stay out (their text renders in the notes block, and the
 * deep link marks the prose; the term index still sees their words — a term
 * whose only occurrence is in a note is found by the search and falls back to
 * the old snippet, which is the honest answer for a hit outside the prose). */
function mdBody(src) {
  const lines = String(src).split('\n');
  const at = lines.findIndex((l) => /^---\s*$/.test(l));
  return at < 0 ? String(src) : lines.slice(at + 1).join('\n');
}

/** A piece's passages. The rule: a passage is a PARAGRAPH — a run of non-blank
 * body lines, taken before the markup is stripped so the break the reader sees
 * decides the split. A heading line is a passage of its own (a heading the
 * query reached is the sharpest line to show); a footnote definition line is
 * skipped; a blank line ends the passage. Nothing is split mid-paragraph, so no
 * passage is ever a fragment the page does not show as a unit. */
function passagesOf(body) {
  const out = [];
  let para = [];
  const flush = () => {
    if (!para.length) return;
    const text = mdTextLocal(para.join(' '));
    if (text) out.push(text);
    para = [];
  };
  for (const line of body.split('\n')) {
    if (/^\s*$/.test(line)) {
      flush();
    } else if (/^\s{0,3}#{1,6}\s/.test(line)) {
      flush();
      const text = mdTextLocal(line);
      if (text) out.push(text);
    } else if (/^\s*\[\^/.test(line)) {
      flush();
    } else {
      para.push(line);
    }
  }
  flush();
  return out;
}

/** mdText as the build defines it (tools/build.mjs), repeated here for the same
 * reason the word rule is: the passage text this module stores is the text the
 * client will mark, and a second copy is checkable against the first by the
 * smoke test, which derives its expectation from content/ with a third. */
function mdTextLocal(src) {
  return String(src)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\^[^\]]+\]/g, ' ')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/[*_`|]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The deep index. `vocab` is the SORTED vocabulary the inline half ships (the
 * automaton walks out the same list), `sources` the pieces' markdown in the
 * same order as the docs array, `stop` the same stopword list.
 */
export function deepIndex(vocab, sources, stop) {
  const termAt = new Map(vocab.map((t, i) => [t, i]));
  const perDoc = sources.map((src) => {
    const passages = passagesOf(mdBody(src));
    return { passages, ...termPositions(passages, stop, termAt) };
  });
  // rows in vocabulary order, each row a list of per-piece runs
  // [piece, firstPosition, delta, delta, …] — a run names the piece it is in,
  // then the term's positions there, every position after the first stored as
  // its difference from the one before. The runs are their own structure (not a
  // flat list aligned with the inline postings) because the two halves see two
  // token streams — the inline index reads the whole file, this one the body's
  // passages — so a term can be in the vocabulary through the front matter and
  // have no run here at all.
  const lex = vocab.map(() => []);
  for (let d = 0; d < perDoc.length; d++) {
    for (const [term, positions] of perDoc[d].hits) {
      const run = [d];
      for (let k = 0; k < positions.length; k++) {
        run.push(k === 0 ? positions[0] : positions[k] - positions[k - 1]);
      }
      lex[termAt.get(term)].push(run);
    }
  }
  return {
    lex,
    pass: perDoc.map((x) => x.passages),
    passAt: perDoc.map((x) => x.passAt),
  };
}

/** The counts the build logs — the build's own account of what it shipped. */
export function deepTotals(deep) {
  let positions = 0;
  let rows = 0;
  let longest = 0;
  for (const row of deep.lex) {
    if (!row.length) continue;
    rows++;
    positions += row.length - 1;
  }
  for (const ps of deep.pass) {
    for (const p of ps) if (p.length > longest) longest = p.length;
  }
  return {
    rows,
    positions,
    passages: deep.pass.reduce((n, ps) => n + ps.length, 0),
    longest,
  };
}
