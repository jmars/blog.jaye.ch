# Recovery Is Not Immunity

### The measured result the model kept insisting on: a full rescue buys the recovered state *nothing* against the next trigger

*Fourth in the mechanism series. [The mechanism post](/meditation-harm/) describes the collapse;
[the risk post](/anxiety-damping/) asks who is at risk;
[the rescue post](/what-actually-works/) shows what actually gets someone out. This one is the
uncomfortable sequel: **what the recovery is worth afterwards.***

*Status.* Measured in the frozen model, traceable to the paper
(doi:[10.5281/zenodo.22943641](https://doi.org/10.5281/zenodo.22943641)). Interpretation is
marked where it appears.

---

## 1. The intuition

After a person comes out of a collapse, there is a natural picture of what the recovery means.
They have been through it. They know the territory now. They have a floor that works, people
around them, a frame for what happened. The next time something pushes them inward, surely they
are **harder to collapse** — that is what recovering is *for*.

It is a reasonable picture. The model says no.

---

## 2. The measurement

Set up the canonical rescue: the system collapses, is rescued, and settles fully healthy at
`G = 0.885`. Then, later, apply **the same second inward episode** the first one used — no new
mechanism, no retuning, only the schedule.

| | first episode (from healthy `G` ≈ 0.885) | second episode (after full rescue, `G` = 0.885) |
|---|---|---|
| **duration threshold to collapse** | **66.3 t.u.** | **66.0 t.u.** |
| **when `G` falls below 0.1** | 73 t.u. into the episode | **73 t.u. into the episode** |

Read that carefully. The thresholds are the same to within a grid step. The onset timing is
**identical**. And note the starting point is *the same in both cases* — because a full rescue
returns `G` to where it started. The recovered state is `G = 0.885`. So was the naïve state.

**The recovery bought exactly nothing.**[^p4] Not a smaller margin, not a slower descent — a head
start that is not a head start, because it restores the *same* value the healthy system already
had.

---

## 3. Why — and it is the S-loop again

There is a specific mechanism, and it is the same one that makes the collapse irreversible in
the first place: the **setpoint**.

Recall that the arming threshold is not fixed. It drifts with the allostatic setpoint `S`:

    Θ_eff = Θ · S / S_rest

During recovery, `S` climbs back — in the measured run it goes from `0.13` (the drained,
collapsed level) up toward `0.76`. That rise is *what recovery is*, mechanically: the threshold
returns to a healthy height so the switch stops arming on ordinary fluctuations.

Now apply the second episode. As attention goes inward again, `S` **drains again** — `0.76` back
to `0.13` — and the threshold falls with it. And here is the point: **`G`'s head start does not
help, because the collapse is not decided by `G`.**

The switch arms on the *error*. The second episode restores the same inward drive, which drains
the same setpoint, which lowers the same threshold, and `G` — however healthy it started — falls
at the same rate against the same falling bar. The recovered system is not defending from a
better position; it is the same system, and the thing that was restored is also the thing that
gets drained.

**The S-loop that slowly repaired the system is exactly what re-collapses it.**[^slop] Restoring the
threshold is what recovery *is*; losing the threshold is what the second episode *does*. They
are the same mechanism run in opposite directions, and the second run is faster than the first.

---

## 4. The measured asymmetry, and the honest gap

Two facts sit together and should be stated precisely, because they are different kinds of
claim:

**Measured:** under **single-episode** schedules, the relapse fraction is **exactly 0** — 816
runs in a controlled grid (6 delays × 17 strengths × 8 durations) plus 112 in a deliberately
confounded grid, and *no* run lifts past 0.5 and then re-crosses below 0.1. A rescued state is
stable **as long as no new trigger arrives**. The reason is micro-structural: after a full
rescue the error sits at `E ≤ 0.15`, far below the raised threshold `Θ_eff ≈ 0.76`, so the
switch simply cannot reactivate.

**Also measured:** the moment a new trigger *does* arrive, the protection evaporates — 66.0 vs
66.3 — and the system collapses **as if it had never been rescued at all**.

So the accurate statement is not "recovery is worthless." It is: **recovery restores the
condition, and the condition is precisely what the next episode removes.** A restored state is
safe until it is needed, and then no safer than a naïve one.

**The honest gap.** The model has **no memory term** — no content persists between episodes, and
consistency across episodes is not represented.[^memory] So it says nothing about what a person *learns*,
and it cannot represent the frame, the knowledge, the community, or the holder. Those are real,
and this post does not claim they don't work.

What it claims is narrower and harder: **the part of recovery that is a return to the healthy
baseline is not protection.** It is a *reset*. And a reset is not a defence — it is the starting
position, which is where the first episode came from too.

---

## 5. What it implies

Interpretation, and the same caveat as everywhere in this series:

**Being back to normal is not the same as being safe.** If the model's structure holds, the
thing that protects someone is not the recovery it is the **holding structure around it** —
which is exactly what the coercion post's inversion and the safeguards post are about. The
baseline is not a defence. The guardrails are.

And it reframes what "recovered" should mean. In this model, a rescued system is one that has
had its **threshold restored** — that is all. Its vulnerability is unchanged; the trigger that
arrived before will work again, on schedule, and the number is the same. So the useful question
after a collapse is not *"are they back to baseline?"* — they are — but **"what is around them
that was not there before?"**

That is a much less comfortable question, and it is the one the measurement actually supports.

---

## 6. What this is not

- **Not a claim that people don't learn.** The model has no memory, so it cannot speak to
  learning at all. Everything a person gains from an experience is outside what this measures.
- **Not a prediction of inevitable relapse.** Relapse in the model *requires a new trigger* —
  the single-episode relapse fraction is exactly zero. This is a statement about what happens
  **when** a trigger arrives, not that one will.
- **Not a reason for fatalism, and not a reason for restriction.** It argues for holding
  structure, not for avoiding practice or for treating anyone as fragile. (The series' standing
  non-use clause applies: nothing here is a way to assess or restrict a person.)
- **Not the memory result.** The corpus also has consolidation findings — including that
  retrieval *alone* can trigger relapse with no external episode, and that the collapse writes
  *more* self-referential content while it happens (`M_self` 0.778 → 0.998). Those belong to a
  different, agent-side line of work and are not claimed here.

---

## Notes

[^p4]: Paper §4.1, prediction P4. Single-episode relapse fraction exactly 0 (816-run controlled
grid + 112-run confounded grid); largest post-collapse `G` reached by any non-rescued run is
0.298. Recurring-episode: second-episode duration threshold 66.0 t.u. with pulse (117.7 without)
versus first-episode 66.3 (≈150 without); `G < 0.1` reached 73 t.u. into either episode; the
counterexample run relapses `G` 0.885 → 0.049 with `c` = 1.0 and `Θ_eff` = 0.129, and the
shipped classifier labels it 'relapsed' (`detect_relapse` fires at t = 872.8).
`dpdr/predictions.md:126-183`; driver `dpdr/experiments/exp2_rescue.py` (Phase 3c, the second
episode at t = 800, same `a_hold` 0.9 and 60-t.u. pulse 0.5 as the canonical scenario); figure
`f04_relapse.png`.

[^slop]: The setpoint mechanism: `Θ_eff = Θ·S/S_rest`; `S` restores 0.13 → 0.76 across the
rescue and drains 0.76 → 0.13 across the second episode, so "the S-loop that slowly restored
`Θ_eff` … is exactly what re-collapses it." Paper §4.1 and §4.11 (the τ_S sweep: onset-to-crossing
scales with τ_S; collapse disappears above the bisected `τ_S_crit` = 141.47 — i.e. the threshold
drain *is* the crossing mechanism).

[^memory]: Paper §6, limitation 15: the model has no memory term; consistency across episodes is
not represented and there is no consolidation. The consolidation results referenced in §6 of this
post are separate, agent-side measurements and are not used here.

*Marking:* measured — §2's thresholds and onset timings, §4's single-episode zero-relapse result
and its micro-structural reason. Interpretation — §5, and the reading of the S-loop in §3.
Not claimed — anything about learning, memory, or the effect of frame, community and holder.
