# What Actually Works

### The model's rescue result is the least intuitive thing in it: a cheap fixed floor beats an elaborate one — and the elaboration is what breaks it

*Third in the mechanism series — the measured work, as distinct from the implications. [The
mechanism post](/meditation-harm/) sets out the collapse and how it hides;
[the risk post](/anxiety-damping/) asks who is at risk. This one asks the question both leave
open: **what stops it, and what happens when you try to stop it cleverly?***

*Status.* All numbers below are measured in the frozen model and traceable to the paper
(doi:[10.5281/zenodo.22943641](https://doi.org/10.5281/zenodo.22943641)). The translation into
practice is an interpretation, as everywhere in this series.

---

## 1. The result, in one table

Set the system at the collapsed fixed point — `G = 0.049`, stuck, switch armed — and engage a
**floor**: a fixed lower bound that stops the cannibalisation switch from seeing an error above
its threshold. Then vary the floor's value.

| floor engaged | outcome |
|---|---|
| **0.0 – 0.4** | **all fail** — the system stays stuck |
| **0.5 / 0.6 / 0.7 / 0.9 / 1.0 / 1.2** | **all escape, identically** — to `G = 0.8855`, in ~22 t.u. |

The critical value is **0.4795**, and its meaning is exact:[^floor] it is essentially the collapsed
state's **own error level** (`E* = 0.4969`). The floor must sit at or above what the switch is
reading. **Below it, nothing. Above it, everything — and how far above it makes no difference
at all.**

That is already the counter-intuitive part. Most people expect a graded dose-response: press
harder, get more. Here the response is a step, and once you are over the step, *more is
exactly as good as enough.*

---

## 2. The part that is genuinely strange

Now add sophistication to the rescue — the things a well-resourced person or programme would
reach for.

| rescue | result |
|---|---|
| **A cheap floor alone** (cost structurally zero) | **escapes** — in 22 t.u. |
| **An elaborate configuration** — actuator `k = 2` **plus** gated monitoring `c_mon = 0.8` | **fails** (`G_end = 0.116`; at `c_mon = 1.5`, `G_end = 0.090`) |
| The gated-monitoring critical at `k = 2` | **`c_mon_crit = 0.511`** |

**The elaborate rescue fails, and the cheap one succeeds.**[^cheap] Not because the elaborate version
is badly built, but for the structural reason this whole series is about: monitoring is itself
inward attention. Adding a monitoring channel to the rescue adds a *second* drain to the same
system, and past `c_mon_crit = 0.511` the monitoring sustains the collapse it was installed to
detect.

**And the sharper version of the same finding: a floor you keep checking cancels itself.** Hold
the floor at 0.7 while *continuously re-checking it* — ungated monitoring at `c_mon = 0.1 /
0.2 / 0.3 / 0.5` — and the outcome degrades: `G_end = 0.53 / 0.34 / 0.24 / 0.16`. The
**knowing-floor critical is `kc ≈ 0.2`**.[^knowing]. Simply *re-deriving* your support, at low cost,
destroys it.

This is the model's version of a familiar human fact: the support you keep auditing is the
support you undermine. The whole value of a floor is that it is **held without observation** —
which is why a cheap, fixed, never-re-examined one is not a lazy version of a good one. It is
the only kind that works.

---

## 3. Why the value doesn't matter (above the threshold)

The mechanism is worth stating because it tells you what to look for. The switch arms on the
**error** `E = D − G`: the reducer is demanding, the generator is not producing, and the gap
crosses a threshold. A floor does not repair the generator. It **changes what the switch can
see** — it holds the visible error below the arming line, which disarms `c`, which releases
attention from the inward capture.

Once that has happened, the *ordinary* dynamics do the rest: with attention no longer held
inward, the growth term in `dG/dt` is no longer starved, and `G` regrows on its own to the
healthy equilibrium. The floor is a **starter motor, not an engine** — it defeats the latch and
then gets out of the way.

Which is exactly why the value is flat above the threshold: the floor's job is binary. Does it
disarm the switch, yes or no? Once yes, it has nothing further to contribute, and pushing it
higher adds no force. The only thing that would improve the rescue is having **less of it to
do** — which is what early detection buys.

**And the rescue costs nothing when you don't need it.** With no episode, a floor at 0.7
changes the system by **exactly zero** (`max|ΔG| = 0.00e+00`, switch never arms, monitoring
cost 0.000). It does not suppress legitimate response — sub-collapse dips are actually
*shallower* than in the unregulated system. Holding a protection you rarely use is free.[^zerocost]

And the free protection holds over the long run: across **sixty consecutive episodes**, the
unregulated system collapses in the first and never recovers, while the regulated one never
enters the stuck attractor at all — re-settling to the healthy equilibrium between episodes.[^longhorizon]

---

## 4. What it implies

Stated as interpretation, and with the obvious caveat that this is a five-state ODE:

**Cheap and fixed beats elaborate and maintained.** The model gives a specific reason, and it
is the same reason as the sensor problem in the mechanism post: the monitoring channel is not
orthogonal to the failure. So the practical rule is inverted from intuition — *do not improve
your support; protect it from being improved.* Keep it cheap, keep it fixed, and above all
**stop re-examining it**, because the re-examination is the cost.

And the threshold has a humane reading. The floor works at `0.4795` because that is where the
switch's own reading sits — the protection does not have to be *good*, or *true*, or
*insightful*; it has to be **at or above what the failure is showing you**, and then held
without observation. That is a low bar, deliberately, and it is the model's argument that the
bar is low in exactly the direction people find hardest to accept: less force, less
sophistication, no checking.

---

## 5. What this is not

- **Not a treatment protocol.** The floor is a single scalar clamp on a switch in a toy system.
  Nothing here says what a person should do; the translation is interpretation, and the mapping
  is ordinal and unvalidated.
- **Not a claim that support is unnecessary.** The result is that *a* support works where *a
  monitored* one fails. Complexity is the failure mode, not support.
- **Scoped, on the corpus's own instruction.** The cheap-versus-elaborate contrast is a property
  of the **post-collapse-settled assay**, not of deployment — the paper flags this explicitly.
  It is a statement about rescuing an already-stuck system, and nothing more.
- **Not about "knowing" in the human sense.** The "knowing floor" is a cost term, not a person
  doubting themselves. The translation — *you cannot maintain a floor you keep re-adjudicating*
  — is the interpretation, and it is offered as one.

---

## Notes

[^floor]: The escape taxonomy — floors 0.0–0.4 fail; 0.5/0.6/0.7/0.9/1.0/1.2 escape identically
to `G = 0.8855` in ~22 t.u. under all three collapse loads; bisected critical floor 0.4795 ≈
E* = 0.4969. Paper §4.3; driver `dpdr/experiments/exp6_regulator.py`, caches `cache/exp6_floor.npz`
and `cache/exp6_bisect.npz`.

[^cheap]: Cheap floor alone escapes in 22 t.u.; the elaborate configuration (actuator k = 2 +
gated monitoring `c_mon` = 0.8) fails at `G_end` = 0.116 (1.5 → 0.090); `c_mon_crit` = 0.511 at
k = 2. Paper §4.3. Scoped, per the paper's own review note, to the post-collapse-settled assay.

[^knowing]: The knowing floor — floor 0.7 with ungated monitoring `c_mon` = 0.1/0.2/0.3/0.5 gives
`G_end` = 0.53/0.34/0.24/0.16; knowing-floor critical `kc ≈ 0.2`. Paper §4.3;
`dpdr/predictions.md:512-522`.

[^zerocost]: Zero healthy-regime cost — with no episode, floor 0.7 changes nothing
(`max|ΔG| = 0.00e+00`, `c_max` = 0.000); sub-collapse dips shallower than unregulated (0.12–0.22
vs 0.05). Paper §4.3.

[^longhorizon]: Sixty canonical episodes: the frozen system collapses in episode 1 and stays
stuck (`G_end` = 0.0486); the floor-regulated system never enters the stuck attractor (dip minima
0.218/0.184/0.163/0.139/0.132 at `a_hold` 0.4–0.9, re-settling to 0.885 between episodes); under
a denser sub-threshold pattern the frozen system fails at episode 2, the regulated one never.
Paper §4.3.

*Marking:* measured — every number in §1–§3 (floor thresholds, the cheap/elaborate contrast,
the knowing-floor critical, zero healthy cost, the 60-episode margins). Interpretation — the
practical translation in §4, and the mechanism gloss in §3 (the floor as a starter motor).
