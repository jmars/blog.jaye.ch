# Release plan

The blog is the **translation layer** for each of the artifacts. Nothing is published without
the user's explicit go-ahead, and the mechanism is `posts.json` — **flipping `"published":
true` on a post is the whole release step.** A normal `./build.sh` emits the home page plus the
published posts only; drafts are not written to `dist/` and do not appear in the nav.

Everything below is a **suggestion recorded for the user**. The user decides every flip.

---

## The gate: paper 1 first

The series cites the paper as its mechanism reference. So the paper is deposited (**DOI**) and
citable **before** any post goes out — then post 1 points at a real artifact instead of a
personal theory. Deposit first; the blog follows.

---

## Two series

The posts are split by **epistemic status** — the boundary the posts already draw — and indexed
separately on the home page so the arguments cannot be read as part of the result. This is the
most important structural decision in the release: it is what protects the research from the
essays.

| series | posts | status | audience |
|---|---|---|---|
| **The mechanism** | 1 `meditation-harm` (measured), 2 `anxiety-damping` (prediction), 3 `what-actually-works` (measured), 4 `recovery-is-not-immunity` (measured) | a measured model, a falsifiable prediction, and two measured follow-ups (rescue; relapse) | researchers, clinicians — **this is what gets sent** |
| **The implications** | 3 `manufacturing-the-collapse`, 4 `sacred-science`, 5 `empty-leader`, 6 `what-the-traditions-knew`, 7 `safeguards`, 8 `the-label` | arguments built on cited literature | general readers, practitioners, cult / spiritual-abuse community |

**Do not send the implications series to a researcher before they have engaged with the
mechanism series.** A reader who meets *Sacred Science* or *Empty Leader* first will discount
the measured result. The mechanism series stands on its own, and it does.

## Release order

Reading order **is** release order, in manifest order within each series.

| # | series | slug | kind | release |
|---|---|---|---|---|
| 1 | mechanism | `meditation-harm` | **measured** | with the blog going live |
| 2 | mechanism | `anxiety-damping` | **prediction** | ~1 week after #1 |
| 3 | mechanism | `what-actually-works` | **measured** | ~1 week after #2 |
| 4 | mechanism | `recovery-is-not-immunity` | **measured** | ~1 week after #3 |
| 5 | implications | `manufacturing-the-collapse` | argument | ~2–3 weeks after #4 |
| 6 | implications | `sacred-science` | argument | ~1–2 weeks after #5 |
| 7 | implications | `empty-leader` | argument | ~1–2 weeks after #6 |
| 7 | implications | `what-the-traditions-knew` | argument | ~1–2 weeks after #6 — the evidence |
| 8 | implications | `safeguards` | argument | ~1–2 weeks after #7 — the resolution |
| 9 | implications | `the-label` | argument | last |

**Why this order.** The evidence ladder has to stay legible. The mechanism series is
measured-then-testable; the implications series is argument. Within the implications series:
3–5 are the coercive, metaphysical and psychological posts, **6 turns it up** by ending on what
works, and 7 handles the ethics of the word.

**Placement note.** Post 6 (`safeguards`) is the most citation-heavy of the implications posts
and the closest to clinical practice; it could move into the mechanism series to give that
series a practical close. It sits here for thematic cohesion with the harm arc (what groups do
wrong → what the traditions do right). Moving it is a one-line `series` change in `posts.json`.

---

## Timing rules

- **~1–2 weeks between posts.** Long enough that each is read and shared on its own footing;
  short enough to stay a series. Do not dump.
- **Pause and assess after #1–#2.** That is the moment for first contact with the
  adverse-effects field (Britton / Cheetah House / Lindahl and the surrounding literature) —
  #1 is the post they could actually engage with, and that conversation is what makes #3–#6
  read as informed rather than as an outsider's synthesis.
- **#6 lands best last**, and after any field feedback — so it can be adjusted if the field
  pushes back on an earlier claim.
- Never deploy a `PREVIEW=1` build (it includes the drafts).

---

## Second batch — the AI / agent series (placeholder, not yet written)

Gated on the **agent build / paper 2**, not on paper 1. The agent design is a *design
hypothesis* until the build exists, so no AI post goes out before it does — that is the same
rule that applies here, applied to a different artifact.

It is also a **separate audience and a separate artifact**, and it reuses material that is
paper 2's core (sensor relocation; block vs down-weight). Publishing it early would be the
overclaiming the field punishes; published after paper 2, it is a translation like these are.

Mechanism when the drafts exist: add entries to `posts.json` — or, if the two batches should
have separate indexes and navs, a second manifest (`posts.ai.json`) with the same schema. The
staged-release machinery is unchanged.

---

## Publishing checklist (each flip)

1. Paper is deposited and the DOI is citable.
2. Set `"published": true` on the post in `posts.json` (and nothing else).
3. `./build.sh` — the scope guard runs first; the link check must report no published page
   referencing a draft slug.
4. Commit + push the repo.
5. Copy `dist/` to `/srv/www/jaye-ch` on node-infra, preserving `caddy:caddy` ownership.
6. Confirm the page is live and the series index reflects the new count.
