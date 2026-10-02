#!/usr/bin/env node
/**
 * tools/headers/prompts.mjs — turn each post into an emblem brief.
 *
 * This is stage 1 of the header pipeline. A post is an argument; a header is a
 * single object standing for it. That mapping needs a reader, and a small local
 * model produces generic iconography ("a brain, a network, a lightbulb"), so it
 * is done by a frontier model over the local OpenAI-compatible GLM endpoint
 * from the hax config (provider `glm-router`).
 *
 * The model does NOT write the style. The hand, the palette and the negative
 * prompt are fixed in style.json; the model supplies only the subject and the
 * composition, and its output is re-assembled here into the final prompt. That
 * division is the whole point: 58 images have to look like one hand, so nothing
 * style-bearing is left to a per-post generation.
 *
 * Writes tools/headers/briefs.json. Cached on a hash of the post's text plus
 * the model and the style version, so re-running only regenerates what changed.
 *
 *   node tools/headers/prompts.mjs                 # fill in what's missing
 *   node tools/headers/prompts.mjs --force         # regenerate everything
 *   node tools/headers/prompts.mjs --only <slug>   # one post
 *   node tools/headers/prompts.mjs --dry-run       # show inputs, call nothing
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const ENDPOINT = process.env.LLM_URL || 'http://10.0.0.1:8324/v1';
const MODEL = process.env.LLM_MODEL || 'glm-5.3';
const CONCURRENCY = Number(process.env.HEADERS_CONCURRENCY || 4);
const BODY_CHARS = 6000;

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i === -1 ? null : argv[i + 1]; };
const DRY = has('--dry-run');
const FORCE = has('--force');
// comma-separated or repeated, like render.py's --only: a repair pass names
// several slugs and the single-value form would silently drop all but the last
const ONLY = argv.flatMap((a, i) => (a === '--only' ? (argv[i + 1] || '').split(',') : [])).filter(Boolean);
const RECOMPOSE = has('--recompose');

const style = JSON.parse(readFileSync(join(__dirname, 'style.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(ROOT, 'posts.json'), 'utf8'));
const BRIEFS = join(__dirname, 'briefs.json');
const briefs = existsSync(BRIEFS) ? JSON.parse(readFileSync(BRIEFS, 'utf8')) : {};

/** Strip markdown scaffolding down to the words a reader would see. */
function plain(md) {
  return md
    .replace(/^---$/gm, ' ')
    .replace(/```[\s\S]*?```/g, ' ')      // fenced code
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')   // headings
    .replace(/^\s{0,3}>\s?/gm, '')        // blockquotes
    .replace(/^\s{0,3}[-*+]\s+/gm, '')    // bullets
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/\[\^[^\]]*\]/g, ' ')        // footnote refs
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** First substantial paragraphs — where a post states its own subject. */
function opening(body) {
  const text = plain(body);
  const paras = text.split(/\n\s*\n/).filter((p) => p.trim().length > 80);
  let out = '';
  for (const p of paras) {
    if (out.length + p.length > BODY_CHARS) break;
    out += p + '\n\n';
  }
  return out.trim() || text.slice(0, BODY_CHARS);
}

const SYSTEM = `You write emblem briefs for hand-drawn headers on an essay blog.

An emblem is ONE PHYSICAL OBJECT, drawn as a recognisable thing. The test is: at
240px wide, can a stranger name what it is? A vessel, a key, a ladder, a chair, a
tree, a book, a door, a bell, a hand, a figure, a mask, a pair of scales, a crown,
a bridge, a well. It must have BODY — solid masses and a strong silhouette.

BANNED SUBJECTS, because they render as a grey tangle of strokes rather than as a
thing: concentric rings, spirals, convergence points, radiating rays, starbursts,
grids, meshes, networks of fine lines, mandalas, rosettes, graphs, charts, RINGS,
hoops, loops, bands and orbits (a ring is the worst offender: it always renders
as a tangle), and any
"diagram" whose form is defined by thin structural lines. If the post's idea wants
one of these, TRANSLATE it into a solid object that carries the same meaning. Not
"collapse" but "a stack that has begun to lean". Not "convergence" but "funnel".
Not "orbital rings" but "a millstone". Not "a balance drawn as pure geometry" but
"a heavy pair of scales, its beam a solid bar and its pans shallow bowls".

The blog argues in two registers. The "readings" series is hermetic and esoteric
(Proclus, the Chaldean Oracles, Picatrix, Geosophia). The "mechanism" series is
analytic — collapse, damping, containment, runaway feedback, group capture. Both
use the same visual language: real symbolic objects for the first, real structural
objects (a vessel, a loop, a threshold, a leaning stack) for the second.

Rules:
- Never propose text, letters, runes, inscriptions or readable symbols. Diffusion models render lettering as convincing nonsense, and a header that seems to carry an inscription it does not have is a lie on the page. If a glyph matters, describe it as pure GEOMETRY.
- Never name a colour, tone, or background. The palette is FIXED elsewhere and is not yours to choose: bone paper, black ink, and exactly one oxblood red accent. An invented colour ("slate", "instrument white", "deep blue", a hex code) fights the house style, so describe only FORM. For "accent" say which single element carries the red, not what shade it is.
- Never name a MEDIUM or technique. Not "engraved", "etched", "linework", "lithograph", "like a plate". The medium is FIXED elsewhere and is not yours to choose; your words steer the drawing hand out of the style. Describe only the FORM of the object — its shape, edges, mass, and what is drawn around it.
- No gradients, no lighting, no atmosphere. Lines and masses only.
- MASS OVER LINE. Say how the object is BUILT of solid black shapes, not how it is outlined. A thing described as thin lines comes back as a scribble.
- The object must be named as something concrete and drawable. If you cannot picture a woodcut of it, it is the wrong emblem.
- Reach for the concrete object, not the abstraction. Not "isolation" but "a single figure with the crowd's lines cut away".
- The image must read at 240px wide. Silhouette first, detail second.

Return ONLY a JSON object:
{
  "emblem": "the object, in five words or fewer",
  "composition": "how it sits in the frame and where the empty space is — form only, no colour",
  "symbols": ["2-4 specific things to draw, concretely, describing MASS and SHAPE"],
  "accent": "the one element that carries the red wash"
}`;

function buildInput(post, body) {
  return [
    `TITLE: ${post.navLabel || post.slug}`,
    `SERIES: ${post.series} (${post.kind})`,
    `SUMMARY: ${post.summary}`,
    '',
    'OPENING:',
    opening(body),
  ].join('\n');
}

function cacheKey(post, body) {
  // Note: the style version is deliberately NOT part of this key. A brief is a
  // function of the post and the model; the style is applied later, at compose
  // time. Folding the style in here would throw away 58 good briefs every time
  // the house style is tuned.
  return createHash('sha256')
    .update([post.slug, post.summary, post.kind, post.series, body, MODEL].join('\u0000'))
    .digest('hex')
    .slice(0, 16);
}

/** Parse the reply's JSON, tolerating the small malformations a model emits:
 *  a trailing comma, or a bare (unquoted) property name. A strict parse turns
 *  any of those into a hard failure for the whole post, and re-asking is
 *  cheaper than losing it. */
function parseLoose(text) {
  const body = text.match(/\{[\s\S]*\}/)?.[0];
  if (!body) throw new Error('no JSON object in reply');
  const attempts = [
    body,
    body.replace(/,\s*([}\]])/g, '$1'),                       // trailing commas
    body.replace(/,\s*([}\]])/g, '$1')
        .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":'),  // bare keys
  ];
  let last;
  for (const a of attempts) {
    try { return JSON.parse(a); } catch (e) { last = e; }
  }
  throw last;
}

async function generate(post, body) {
  const input = buildInput(post, body);
  const res = await fetch(`${ENDPOINT}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: input },
      ],
      temperature: 0.9,          // emblems should not all converge
      // reasoning_effort is load-bearing. This model thinks before it answers,
      // and on a prompt this specific it will spend the ENTIRE completion budget
      // reasoning and emit nothing: with the cap at 4000 the reply came back
      // finish_reason=length with 3999 reasoning tokens and zero content, which
      // surfaces as "no JSON in reply" and reads like a parse bug. Capping the
      // effort turns a 17k-character deliberation into ~110 tokens and the same
      // request returns clean JSON in ~11s.
      reasoning_effort: 'low',
      max_tokens: 8000,
      // NO response_format here, deliberately. json_object makes this router
      // hang indefinitely (four workers sat on open sockets for ten minutes
      // with zero replies); the same request without it returns in seconds. The
      // JSON is extracted from the reply text instead, which is what the
      // prompt already asks for.
    }),
  });
  if (!res.ok) throw new Error(`${post.slug}: HTTP ${res.status} ${await res.text()}`);
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content ?? '';
  if (!content.trim()) {
    // Distinguish the two ways this comes back empty. A model that spends its
    // whole budget reasoning returns finish_reason=length with no content,
    // which is a configuration problem, not a bad roll.
    const c = json.choices?.[0];
    throw new Error(`${post.slug}: empty content (finish=${c?.finish_reason}, `
      + `reasoning_tokens=${json.usage?.completion_tokens_details?.reasoning_tokens})`);
  }
  return parseLoose(content);
}

/** Assemble the final render prompt: the fixed house hand, then the model's subject.
 *
 * ORDER IS LOAD-BEARING. The gestural clause goes FIRST, not in the middle of a
 * list. Measured (tools/headers/ab.py): with the hand clause buried at position
 * ~108 of 235 words, surrounded by the brief's own engraving vocabulary, the
 * render came back as a purely technical drawn plate — the model obeyed the
 * most specific signal around it. Hand-first, at the same seed, produces the
 * gestural ink the style is named for.
 */
function compose(brief) {
  const { prefix, style: handStyle, suffix, singular } = style.prompt;
  // Mutable: the token budget may trim the hand, and must never trim the subject.
  let hand = handStyle;
  // The briefs legitimately reach for "engraved line" and "like a plate" to
  // describe FORM, but that vocabulary is also a medium instruction that pulls
  // the whole image toward engraving. Strip it here so the style block above
  // alone decides the medium.
  const MEDIUM = /\b(engraved|engraving|etched|etching|linework|line work|lithograph|woodcut|steel[- ]?plate|plate)\b/gi;
  // The briefs were written against the ORIGINAL 2.4:1 canvas and still describe
  // a wide frame ("centred left of a wide frame", "empty paper to either side").
  // Under the square canvas that text is not merely stale, it is the very prior
  // the square migration removed: it re-asks for a wide field to fill. Normalise
  // the geometry rather than re-asking the LLM for 59 briefs.
  const WIDE = [
    [/\bwide horizontal vignette\b/gi, ''],
    [/\bwide\s+frame\b/gi, 'square frame'],
    [/\bwide\s+empt(?:y|iness)\b/gi, 'empty'],
    [/\bwide\s+(arc|sheet|field|plate|band|sweep)\b/gi, '$1'],
    [/\bwide-/gi, 'broad-'],          // keep the compound: wide-mouthed -> broad-mouthed
    [/\bwide\b/gi, ''],
  ];
  // ICON SUPPRESSION. A centred, isolated, symmetrical object on an empty field
  // IS an icon, and the briefs were written for a wide banner where "centred in
  // the frame" merely meant "not at the edge" — under a square it reads as
  // heraldry. 20 of 59 briefs carry that phrasing, so it is rewritten here
  // rather than paid for with 59 frontier calls. The form is kept; only the
  // placement claim is replaced.
  const PLACEMENT = [
    [/\b(?:at|in|of)\s+the\s+(?:exact\s+)?(?:centre|center)\s+of\s+(?:the\s+|a\s+)?(?:wide\s+|square\s+)?(?:frame|field)\b/gi,
     'cropped by the frame edge'],
    [/\boccupies\s+the\s+centre-left\s+of\s+(?:the\s+)?(?:wide\s+|square\s+)?(?:frame|field)\b/gi,
     'sits off-centre'],
    [/\b(?:centred|centered)\s*(?:slightly\s+)?(?:left|right|low|high)?\s*(?:of|in)?\s*(?:the|a)?\s*(?:wide\s+|square\s+)?(?:frame|field)\b/gi,
     'off-centre, running off the frame edge'],
    [/\b(?:centred|centered)\s+(slightly\s+)?(left|right|low|high)\b/gi, 'off-centre'],
    [/\bdead\s+centre\b/gi, 'off-centre'],
    [/\b(?:floating|sits|sitting|stands?|standing)\s+at\s+the\s+(?:exact\s+)?(?:centre|center)\b/gi, 'off-centre'],
    [/\bcentred\b/gi, 'off-centre'],
    [/\bcentered\b/gi, 'off-centre'],
  ];
  const clean = (s) => {
    // Brief fields are prose: they start with a capital and sometimes end with a
    // full stop, which reads inside a comma-separated prompt as separate sentences
    // ('a drawing of A held empty frame:'). Normalise the casing here.
    let t = String(s ?? '').trim()
      .replace(/^(A|An|The)\s+/, (m) => m.toLowerCase())
      .replace(/^([A-Z])(?=[a-z])/, (m) => m.toLowerCase())
      .replace(/[.]+$/, '').replace(MEDIUM, '');
    for (const [re, to] of WIDE) t = t.replace(re, to);
    for (const [re, to] of PLACEMENT) t = t.replace(re, to);
    return t.replace(/\s{2,}/g, ' ').replace(/\s+([,.;])/g, '$1').trim();
  };
  const subject = [brief.emblem, ...(brief.symbols || [])].map(clean).filter(Boolean).join(', ');
  // OBJECT ANCHOR. The gestural clause describes a PROCESS and never says the
  // drawing DEPICTS anything, so a plate whose subject is an abstract noun
  // ("a gate with no bar") can render as a pure ink mass with no object in it.
  const anchor = brief.emblem ? `a drawing of ${clean(brief.emblem)}: ` : '';
  const accent = clean(brief.accent).split(/\s+/).slice(0, 8).join(' ');
  // TOKEN BUDGET. SDXL reads 2 CLIP chunks of 77 tokens and SILENTLY DROPS the
  // rest; the composed prompts averaged ~303 tokens, so the subject and
  // composition sat past the cut and the model rendered only the hand.
  //
  // WHAT IS DROPPED, IN WHAT ORDER, IS THE WHOLE POINT — and getting it wrong
  // made the images WORSE, measurably. A first version dropped the composition,
  // then the accent, then the SYMBOLS, which are the concrete visual description
  // of the object; the model then had a four-word subject and forty words of
  // brush technique, and every plate came back as abstract ink (QC: "no named
  // object is clearly depicted in any cell"). The style is what may be trimmed,
  // never the subject: drop the accent, then the composition, then trim the HAND,
  // and only as a last resort the symbols beyond the first.
  const BUDGET = 148;                       // ~2x77, with headroom
  const tok = (s) => (String(s).split(/\s+/).length * 1.35);
  const joint = (a) => a.filter(Boolean).join(', ');
  let comp = clean(brief.composition);
  let accl = `one oxblood red accent on ${accent}`;
  const build = (subj) => joint([prefix, anchor + subj, hand, comp, accl, suffix]);
  let out = build(subject);
  // ORDER OF SACRIFICE — measured, twice. The accent goes LAST, not first: it is
  // only ~8 words, and dropping it turned the whole batch MONOCHROME (measured
  // with tools/headers/red.py: 58 of 59 plates had ~0% red pixels) when the house
  // style promises exactly one oxblood wash. The style is what gets trimmed.
  if (tok(out) > BUDGET) { comp = ''; out = build(subject); }
  if (tok(out) > BUDGET) {
    // trim the HAND, not the object: keep its first clause, which names the medium.
    const handTrim = hand.split(', ').slice(0, 3).join(', ');
    const saved = hand; hand = handTrim;
    out = build(subject);
    if (tok(out) > BUDGET) {
      const syms = (brief.symbols || []).map(clean).filter(Boolean);
      out = build([clean(brief.emblem), ...syms.slice(0, 1)].filter(Boolean).join(', '));
    }
    hand = saved;
  }
  if (tok(out) > BUDGET) { accl = ''; out = build(subject); }
  out = out.replace(/,\s*,/g, ',').replace(/\s{2,}/g, ' ');
  if (tok(out) > BUDGET) {
    out = out.split(' ').slice(0, Math.floor(BUDGET / 1.35)).join(' ')
             .replace(/[,;:\s]+$/, '');
  }
  return out;
}

async function main() {
  // Style-only re-application: rebuild the prompt/negative of every EXISTING
  // brief from style.json, touching no LLM-facing field. Tuning the hand must
  // not cost 58 frontier calls, and `input_hash` (the LLM cache key) is
  // deliberately not updated, so the briefs stay cached.
  if (RECOMPOSE) {
    let n = 0;
    for (const [slug, b] of Object.entries(briefs)) {
      if (ONLY.length && !ONLY.includes(slug)) continue;
      briefs[slug] = { ...b, prompt: compose(b), negative: style.prompt.negative };
      n++;
    }
    writeFileSync(BRIEFS, JSON.stringify(briefs, null, 2) + '\n');
    console.log(`recomposed ${n} briefs at style version ${style.version}`);
    return;
  }

  const posts = manifest.posts.filter((p) => p.published && (!ONLY.length || ONLY.includes(p.slug)));
  if (ONLY.length && posts.length === 0) throw new Error(`no published post with slug ${ONLY.join(', ')}`);

  const todo = [];
  for (const post of posts) {
    const body = readFileSync(join(ROOT, 'content', post.file), 'utf8');
    const key = cacheKey(post, body);
    const have = briefs[post.slug];
    if (!FORCE && have && have.input_hash === key) continue;
    todo.push({ post, body, key });
  }

  console.log(`${posts.length} posts, ${todo.length} to generate (model ${MODEL})`);
  if (DRY) {
    for (const t of todo) console.log(`\n--- ${t.post.slug} ---\n${buildInput(t.post, t.body).slice(0, 400)}`);
    return;
  }

  let done = 0, failed = 0;
  const queue = [...todo];
  async function worker(id) {
    while (queue.length) {
      const { post, body, key } = queue.shift();
      let brief;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          brief = await generate(post, body);
          break;
        } catch (e) {
          if (attempt === 3) {
            failed++;
            console.error(`  [${done + failed}/${todo.length}] FAILED ${post.slug}: ${e.message}`);
          } else {
            // a malformed reply is a bad roll, not a bad prompt — ask again
            await new Promise((r) => setTimeout(r, 500 * attempt));
          }
        }
      }
      if (brief) {
        briefs[post.slug] = {
          ...brief,
          input_hash: key,
          model: MODEL,
          prompt: compose(brief),
          negative: style.prompt.negative,
          seed: parseInt(createHash('sha256').update(post.slug).digest('hex').slice(0, 8), 16),
        };
        done++;
        console.log(`  [${done + failed}/${todo.length}] ${post.slug} — ${brief.emblem}`);
      }
      // persisted per result, not at the end: a 58-post batch runs for minutes,
      // and losing it to one interruption (or being unable to watch it make
      // progress) costs more than the extra writes.
      writeFileSync(BRIEFS, JSON.stringify(briefs, null, 2) + '\n');
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, (_, i) => worker(i)));

  writeFileSync(BRIEFS, JSON.stringify(briefs, null, 2) + '\n');
  console.log(`wrote ${BRIEFS} (${Object.keys(briefs).length} briefs, ${failed} failed)`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
