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

## Release order

Reading order **is** release order, which is the array order in `posts.json`.

| # | slug | nav label | kind | release |
|---|---|---|---|---|
| 1 | `meditation-harm` | the failure mode | **measured** | with the blog going live |
| 2 | `anxiety-damping` | the damping dial | **prediction** | ~1 week after #1 |
| 3 | `manufacturing-the-crossing` | the engineered collapse | argument | ~2–3 weeks after #2 |
| 4 | `sacred-science` | the sacred science | argument | ~1–2 weeks after #3 |
| 5 | `empty-leader` | the empty leader | argument | ~1–2 weeks after #4 |
| 6 | `safeguards` | the safeguards | argument | ~1–2 weeks after #5 — the resolution |

**Why this order.** The evidence ladder has to stay legible. #1 is a **measured** model; #2 is a
**falsifiable prediction**; #3–#6 are **arguments built on cited literature**. Publishing them
together would let the weakest claim tar the strongest — a skeptical clinician would read the
last essay and attribute it to the model. Staged, each is received on its own footing, and the
early ones earn the standing that lets the later ones be read charitably.

It also lands the darkness correctly: #3–#5 are the coercive, metaphysical and psychological
posts; **#6 turns the series up** by ending on what works.

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
