# The Meditation Failure Mode

### Why adverse effects go under-counted — and why they hide themselves

*A control-theoretic account of a state that gets called "awakening" or "depersonalization"
depending on who is watching.*

*Status.* A measured dynamical model (a frozen five-state ODE) translated into the language
of meditation-adverse-effects research. The model is measured; the mapping onto
contemplative practice is an interpretation it motivates but does not license. Citations
are footnoted.

The paper is published: **Marshall, J. T. (2026). *Self-Application as the Common Source of
Benefit and Failure: A Control-Theoretic Model of Self-Regulation.* Zenodo.
doi:[10.5281/zenodo.22943641](https://doi.org/10.5281/zenodo.22943641)** — every measurement
in this post is traceable to it.

Record: <https://zenodo.org/records/22943641>

---

## 1. Start with the evidence, not the model

The field that studies meditation-related harm has a well-documented problem: the harm is
real, it is common, and it is **systematically filtered out of the record**.

The numbers are not fringe findings:

- The *Varieties of Contemplative Experience* study interviewed more than 60 Western
  Buddhist practitioners and built a taxonomy of meditation-related challenges — and its
  framing sentence is that these are experiences **"typically underreported."**[^vce]
- In a controlled trial of an 8-week mindfulness program, an independent assessor found
  **adverse effects with negative valence in 58% of participants and negative impacts on
  functioning in 37%**; the *lasting* bad effects (6–14%) were specifically **"associated
  with signs of dysregulated arousal (hyperarousal and dissociation)."**[^britton21]
- A widely-cited estimate puts the rate of an adverse effect lasting **more than a month**
  at roughly **one in ten** people who have meditated, including after a single
  practice.[^atlantic]
- In a recent study of 121 people with meditation-related difficulties, **61.7% of the
  meditation-triggered group scored above the clinical cutoff for depersonalization** — yet
  almost none carried a diagnosis, and the same state was described as **"more welcome,
  pleasant, and spiritually meaningful"** than the comparison group's identical
  phenomenology.[^pons]
- The standard self-report instrument for dissociation **false-positives at 54%** in
  non-clinical samples.[^leavitt]
- **Intensity, and the teacher, are the strongest observed amplifiers.** In the largest
  cross-sectional study of regular meditators (N = 1,370), having attended a **retreat**
  carried **88.5% higher odds** of an unpleasant meditation-related experience — and the
  association *strengthened* after adjusting for pre-existing mental illness.[^pauly] And in
  the same practitioner sample the field's own taxonomy comes from, **97% of practitioners
  and 97% of experts named the student–teacher relationship as a factor in these challenges,
  including their onset** — with **71% of practitioners working with a teacher at the time
  their difficulties began**, and teachers rated anywhere from *very harmful* to *very
  helpful*.[^teacher]

Read those together and a shape appears. The *phenomenology* is common. The *label* is
rare. The state is often experienced as *good*. And the instrument of record cannot
reliably see it.

This post is an attempt to explain that shape — not "meditation is bad," but **why a
failure mode this common stays this invisible.**

---

## 2. The puzzle the field already named

Two documented observations are hard to reconcile without a mechanism:

1. **Reports dissociate from the signal.** People in these states often report being
   fine — or better than fine — while physiological measures (e.g. the absent recovery of
   skin-conductance responses to unpleasant stimuli in depersonalization[^sierra]) show a
   system that is *not* returning to baseline.
2. **The same event gets opposite labels.** Meditation-triggered and clinically-presenting
   depersonalization are phenomenologically similar; they diverge in how they are
   *appraised*.[^pons] One is called a stage of insight. The other is a disorder.

Under-reporting is usually explained as stigma, or as teachers not asking. Both are real.
But there may be a stronger, structural reason: **the part of the system that would notice
the failure is the part that survives it.** If that is true, the under-reporting is not a
communication problem to be fixed with better questionnaires. It is a property of the
failure.

The rest of this post is a model that makes that precise.

---

## 3. The machine: three networks, five numbers

The model maps onto the well-known triple-network picture — with one crucial addition: the
three networks are not three *modules*. Two are generators and one is the **regulator
between them**.

| neuroscience | model | what it does |
|---|---|---|
| **DMN** (default-mode) | `G` — generator of self-content | produces the narrative self, the sense that there is a someone here |
| **CEN** (central-executive) | `D` — demand / reduction | executive checking, reasoning, "working on" content |
| **SN** (salience) | the loop (`a`, `S`, `g`) | attention (`a`), setpoint/context depth (`S`), adaptive gain (`g`) — it switches and damps the other two |

*(This mapping is the interpretation layer — a hypothesis from the source it derives from,
not a measurement. The model's measured content is the dynamics, not the brain labels.)*

A healthy settled system sits at `G* = 0.886` — self-content strong, the reduction demand
`D` doing its job, the cannibalization switch **off** (`c = 0`). The "self" here is a
**level** — how much self-content the generator is producing — a control variable, not a
thing.

---

## 4. The runaway

Turn attention inward and hold it. In the model that is one parameter — `a`, attention,
drives to 1 — and it acts on the generator in three ways inside `dG/dt`:

- a **growth** term `β_G·(1−a)·G·(1−G)` — self-content grows when attention is outward;
- a **decay** term `−α_G·a·G` — self-content *is consumed* when attention is inward;
- plus a **turnover** cost `−γ_G·G` that exists even at rest.

Hold attention inward and you are subtracting from `G` while the growth term starves. `G`
falls. That is the whole trick: **watch the self and it thins.**

But the thinning is not the dangerous part. Falling `G` raises the **error** `E = D − G` —
the reducer still demands, the generator produces less — and the model has a switch on that
gap:

```
c = σ · max(0, tanh((E − Θ_eff) / w)),      Θ_eff = Θ · S / S_rest
```

Below threshold `c = 0` and the healthy regime costs **exactly zero** (measured:
`max|ΔG| = 0.00e+00`). Cross `Θ_eff` and `c` ignites — and `c` feeds back into attention:

```
da/dt = [ κ_in·(a_hold + χ·c)·(1−a) − κ_ext·u_ext·a − ρ_a·a ] / τ_a
```

That `χ·c` term is the trap. **The failure captures the attention that drives it.** Inward
focus lowers `G`; low `G` arms `c`; `c` pulls attention *further* inward; further inward
drops `G` more. A positive feedback loop, one direction, no brake built in.

Run the canonical episode — inward drive `a_hold = 0.9` held past a duration threshold:

| quantity | healthy | after the transition |
|---|---|---|
| `G` (self-content) | 0.886 | **0.049** |
| `c` (the switch) | 0.000 | **1.000** |
| `E` (error) | −0.340 | **+0.525** |
| `a` (attention) | outward | **0.882, inward, held** |

And the transition is not gradual. Across a full sweep of the dose axes the model gives
**214 healthy outcomes, 98 collapsed outcomes, and zero in between.** The threshold is
sharp and bisectable: a duration of **66.3 time-units** at that intensity, an intensity of
**0.5992**, an affect amplitude of **0.1859**.

This is the structural reason the approach is invisible from the inside: the observer is
*inside* the loop being observed, and the loop is monotone. There is no signal announcing
the edge, because the thing that would read the signal is the thing being consumed.

---

## 5. Why there is no warning: the transition is a border-collision fold

Here the model makes a precise, falsifiable claim about the *kind* of event this is — and
the answer is not what a "spiritual emergency" account would predict.

Ordinary tipping points slow down as they approach (recovery times lengthen, variance
rises). That is the basis of *critical slowing down* as an early-warning signal. **This
transition has none of it.** An exact audit of the model found:

- the healthy equilibrium does not soften toward zero — at the moment of death the
  eigenvalues are `[−0.0015, −0.0055, −0.0088, −0.0427, −0.598]`, every mode bounded away
  from zero;
- the dominant recovery rate is **constant** at `−0.0015` across *five decades* of distance
  to the edge (spread: exactly 0) — recovery time is `667` time-units whether you are far
  away or `2×10⁻⁶` from the cliff;
- the "critical" mode is flat: it moves 0.5% where a saddle-node would move 98%.

What it actually is: a **border-collision fold**. The healthy branch does not wobble and
tip. It runs straight into the switching manifold and is **annihilated on contact** — the
last healthy solution sits at `ε_c = 0.265192279` and dies *exactly on* `E = Θ_eff`
(residual `10⁻¹³`).

**The practical consequence is a measurement consequence.** The warning signal is not
*time*, it is **tolerance**: what shrinks near the edge is the *basin of attraction* — the
size of perturbation the system can absorb — tracking distance-to-edge almost exactly
(slope ≈ 1). A system in this regime does not slow down before it fails; it gets
**fragile.** Which means a protocol that measures only *settling time* will miss the
approach entirely. You have to measure the size of the disturbance the system tolerates.

---

## 6. Why it stays — and why the reports cannot see it

Two more measured facts, and together they are the mechanism for §2's puzzle.

**First, there is no second fold.** The collapsed branch has no mirror edge: traced in
decreasing drive — including into the unphysical negative region where drive becomes
withdrawal — it simply *exists*, all the way down. The hysteresis window is **`[0, ε_c)` —
unbounded below.** The state persists at *every* physical drive below the fold, including
zero. **You cannot exit by stopping the practice.** (This is the model's version of why
"just take a break" often does not work, and why recovery in the clinical case is
circumstance-linked rather than self-initiated.) In the model, rescue is a hard floor
pinned above the collapsed error level — and it works, but only at or above `0.4795`,
essentially the state's own error. Anything less does nothing.

**Second, reasoning survives and the self does not.** At the collapsed fixed point:

```
D = 0.5455   ← exactly its healthy baseline
G = 0.049    ← annihilated from 0.886
```

The executive capacity — the part that reasons, checks, and *reports* — is **untouched**.
What collapsed is the generator of the narrative self. This is why the state reads as vast
calm rather than distress: nothing is wrong *by the reasoning*, because the reasoning is
fine. There is simply no one left for it to be about.

**And this is the answer to §2.** If the reporting faculty (`D`) sits at baseline while the
tracked faculty (`G`) is annihilated, then:

- a **self-report** instrument is reading the one subsystem that is working;
- the person saying *"I'm fine, this is freedom"* is not lying or dissociating the memory —
  they are accurate, from the only vantage they have left;
- and the **monitoring is itself the failure driver**: "am I still here?" is inward
  attention, which is the `a`-axis. The sensor is destroyed by the failure it exists to
  detect.

That is the structural reason the under-reporting is not merely a questionnaire problem.
The instrument of record is *in* the failing subsystem's surviving neighbour, and the act
of checking feeds the loop. The fix is not to monitor harder. It is to **relocate the
measurement** to a channel that survives and cannot be moved by the loop — the body, the
behavior, an external observer.

---

## 7. The state does not feel like a failure

The picture most people carry of meditation "dark nights" is effortful — clinging, terror,
white-knuckling. The model says the endpoint is the opposite. Tracking the trajectory
through the model's own plane (outward / relaxed-inward / effortful-inward):

- the failure leaves the outward position at onset and **never returns**;
- it passes *through* the effortful-inward region as a **35-unit transit** — that is the
  struggle, and it is brief;
- then it **resides** in the relaxed-inward position — terminal `a = 0.8824`, `D` back at
  baseline — **with the switch armed for the rest of the run** (measured: 1318.70
  time-units, `c` held at 1).

So the endpoint is an **effortless, contentless, locked openness**. That is precisely why
it is *misappraised* as the goal — and, per §1, why the same phenomenology lands as
"more welcome, pleasant, and spiritually meaningful" in one population and as a disorder in
another. The state that most needs care is the state that feels like the destination, and
which no longer has the faculty that would ask.

---

## 8. What this implies for practice and research

There is a line nearly everyone knows — *do not go gentle into that good night* — and this
mechanism gives it a reading it rarely gets. It is normally heard as an instruction to the
person facing the end: resist, hold on, fight. But Thomas wrote it **to his dying father**,
who could not answer it. The raging in that poem is not the dying man's. It is the demand of
the *living*, aimed at someone who has stopped being able to supply it for himself. That is
the tragedy, and it is structural.

The collapse is the same shape. The state does not rage — it goes *gentle*: an effortless,
contentless, locked openness with the switch held on (§7), felt as peace, misappraised as
arrival. The faculty that could feel the urgency, object, or ask for help is exactly the one
sitting at baseline, seeing nothing wrong (§6). **So "do not go gentle" cannot be addressed
to the person in the state.** It is addressed to whoever is standing outside it — and
everything that follows is what that address obliges them to do.

None of the above is an argument against contemplative practice. It is an argument for
**informed consent, measurement that can see, and support that survives the state** — the
same provisions the traditions encoded and the adverse-effects field is now rebuilding.

**The traditions are not the villain here; they are the precedent.** They mapped this
territory over centuries, and they built guardrails into the delivery. Three of them, and
they are a stability spec, not mysticism:

| supplied *beforehand* | model term | what it prevents |
|---|---|---|
| **A frame before, not after** | — (meaning inherited, not built in-collapse) | having to derive a model of what is happening *from inside the failure* |
| **Community present** | external coupling, `u_ext` | the coupling being improvised, alone, from the depersonalized state |
| **Pace metered** | slow drive ramp vs. the 66-unit threshold | the load arriving faster than adaptation |

The model says why these matter structurally. `u_ext` is literally the outward pull that
prevents capture; withdrawing from the world to practise removes the damper. And the
traditions' sharpest safety instruction — *don't kill the witness* — was arrived at
empirically: it exists because the reports accumulated, because practitioners in the
lineages did the thing, got the loop, and reported back. That is a warning system built
from exactly the under-reported cases §1 describes.

**What follows, concretely:**

1. **Dose and threshold, not "more is deeper."** The transition is sharp at a threshold
   (`66.3` time-units at that intensity). The visible warning is not slowing but *shrinking
   tolerance*, so the useful monitoring is perturbation tolerance, not a settling time.
2. **Measure a channel that survives.** Self-report cannot see this, by construction (§6).
   The measurement should read the body and behavior, plus an external observer — and the
   act of self-monitoring should be treated as part of the dose, not as free.
3. **The rescue is external.** Because the state cannot initiate its own exit (§6), the
   provision that matters is a *holder*: someone who acts on the person's behalf, who knows
   the signs, and who brings the input regardless of consent from inside the state. This is
   the one who does the raging, in the poem's sense — on behalf of someone who no longer
   can, and who will not thank them from inside. It is also exactly the peer-leadership and
   support model the adverse-effects community has built out of necessity.
4. **Label with care.** The same state is "insight" or "disorder" (§2). That is an
   appraisal, not a mechanism — and it is where a common failure mode becomes invisible.

**The guard on that third point, because "regardless of consent" is the one line here that
could be read as license.** It means one specific thing, and it is not a general warrant.
The decision is made *in advance*, while the person can still make it — because the state
cannot initiate its own exit, the choice has to be made before arrival, and honouring it
afterwards is what an advance directive is for. So the provision is not authority *over*
someone; it is their own authority, exercised at the only point it is exercisable. It
presupposes all three of a state recognised as severe, an existing relationship, and a
holder who knows the signs — and the input is the outward pull itself (presence, contact,
ordinary life), not a course of action substituted for theirs. Without those, the sentence
reads as license. The mechanism licenses no one: it says only that the exit cannot come
from inside the state.

---

## 9. The claim, and its boundary

The core is a deterministic five-state ODE. Every reference to brains or practice is an
**interpretation of the dynamics**, not a measurement of them: the mapping is ordinal,
unvalidated, and built from a single case, and four of five prior mappings from this model
failed. Nothing here is a clinical claim.

The claim itself is narrow and falsifiable. The transition is a *border-collision fold* with
**no critical slowing down** — recovery time constant to the edge, only **tolerance**
shrinking — and recovery does not self-initiate. So the decisive test is specific: measure
the **perturbation the system tolerates**, not just how fast it settles. Progressive slowing
with a stable basin would falsify this account of the event.

That is the offer — a mechanism for the reporting gap, and one measurement to check it. The
gap is the part that would matter if it holds; the fold is the part that could be wrong.

**And one limit on its use, because a description of a mechanism is not a finding about a
person.** This is a model, not an instrument: it has no individual-level test, and the one
population-level measurement that could give a signal has not been run. So it is not a way to
assess anyone's state, capacity to choose, or vulnerability — and in particular it is not a
warrant to act on someone's behalf against what they say they want. **That inference — *this
person's agency has been overborne, therefore acting for them is rescue* — is the exact step
that turned a body of careful thought-reform research into a movement that abducted adults.**
A description of an environment is not a finding about a mind, and the distance between those
two is the whole of it. If you find this cited to override someone's account of their own
life, it is being misused — including by its author.

---

## Notes

[^vce]: Lindahl, J. R., et al. (2017). "The Varieties of Contemplative Experience: A
Mixed-Methods Study of Meditation-Related Challenges in Western Buddhists." *PLoS ONE*
12(5): e0176239. https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0176239
(the study's own framing: these experiences are "typically underreported").

[^britton21]: Britton, W. B., et al. (2021). "Defining and Measuring Meditation-Related
Adverse Effects in Mindfulness-Based Programs." *Clinical Psychological Science*.
https://journals.sagepub.com/doi/abs/10.1177/2167702621996340 — n = 96; adverse effects
58%, negative impact on functioning 37%; lasting bad effects 6–14%, "associated with signs
of dysregulated arousal (hyperarousal and dissociation)."

[^atlantic]: *The Atlantic* (Sept 2026), "The Dark Side of Mindfulness" — profile of
Willoughby Britton; adverse effects lasting more than a month at roughly one in ten who
have meditated, including after a single practice. https://www.theatlantic.com/ideas/2026/09/meditation-willoughby-britton-downsides/688474

[^pons]: Pons, E., et al. (2026). "A cross-sectional survey on
depersonalization/derealization and meditation-induced alterations of the self."
*Scientific Reports* 16:14673. https://www.nature.com/articles/s41598-026-51014-y — N = 121
(60 meditation-triggered, 61 not); 61.7% of the meditation-triggered group above the CDS-70
cutoff; only 4 with any DPDR diagnosis; the states rated "more welcome, pleasant, and
spiritually meaningful."

[^sierra]: Sierra, M., Senior, C., Dalton, J., et al. (2002). Reduced skin-conductance
responses to unpleasant pictures in depersonalization disorder — i.e. no autonomic recovery
to baseline. https://pubmed.ncbi.nlm.nih.gov/12215083/

[^pauly]: Pauly, L. et al. (2021). "Prevalence, predictors and types of unpleasant and
adverse effects of meditation in regular meditators: international cross-sectional study."
*BJPsych Open* — N = 1,370 regular meditators; retreat attendance OR 1.89 (95% CI 1.43–2.48,
p = 0.000), adjusted OR 1.94 (1.49–2.60). Replicates Schlosser, M. et al. (2019), *PLoS ONE*
(25.4% unwanted effects). https://pmc.ncbi.nlm.nih.gov/articles/PMC8693904

[^teacher]: "The Teacher Matters: The Role and Impact of Meditation Teachers in the
Trajectories of Western Buddhist Meditators Experiencing Meditation-Related Challenges"
(2025), *Contemporary Buddhism*, from the Varieties of Contemplative Experience dataset
(68 practitioners, 33 experts) — 97% of practitioners and 97% of experts mentioned
student–teacher relationships as an influencing factor "impacting meditation-related
challenges, including their onset"; 71% were working with a teacher at onset; teacher
support rated −3 (very harmful) to +3 (very helpful).
https://www.tandfonline.com/doi/full/10.1080/14639947.2025.2485677

[^leavitt]: Leavitt, F. (1999). "Dissociative Experiences Scale Taxon and Measurement of
Dissociative Pathology." *J. Clin. Psychol. Med. Settings* — the DES-T dissociative taxon
false-positives at 54% in non-clinical samples (13% for the full DES).
https://link.springer.com/article/10.1023/A:1026275916184

*On the mechanism's novelty, stated plainly:* the general form — that measurement costs
control performance — is classical **dual control** (Feldbaum 1960/1965). The specific form
here — that the sensing channel *coincides with* the failure channel, so the fix is
relocation rather than reduction — is the part we could not find stated elsewhere, with the
caveat that sensor-placement and observability are mature control topics and a focused
search is outstanding. The duality of self-application is Hofstadter's strange loop, not a
new observation. The contribution is the quantification.
