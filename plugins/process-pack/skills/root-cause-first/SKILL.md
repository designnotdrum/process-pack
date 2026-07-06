---
name: root-cause-first
description: Use before proposing any fix for a bug, test failure, performance regression, or unexpected behavior. Requires a stated causal mechanism before a fix is written, and treats a contradicted hypothesis as progress, not failure.
---

# Root Cause First

## The loop

Reproduce → mechanism → fix the mechanism → prove with measurement.

1. **Reproduce.** Get a repeatable trigger for the exact symptom, not a nearby one. A fix aimed at a symptom you cannot reliably reproduce is a guess wearing a diff.
2. **Mechanism.** State the causal chain from trigger to symptom in one or two sentences — not "probably X," the actual path: this input reaches this code, which does this, which produces that. No fix ships without this sentence written down first.
3. **Fix the mechanism.** The change targets the causal step named above. If the fix does not touch the thing named in the mechanism, the mechanism was not found yet — go back to step 2.
4. **Prove with measurement.** Re-run the exact reproduction from step 1 and show it now passes, with numbers where the symptom was numeric (latency, failure rate, memory). "Should be fixed" is not proof; a before/after number is.

## Symptom patches are allowed, but must be named

Retries, widened timeouts, threshold bumps, heap increases, and similar changes sometimes ship anyway, under time pressure or as a stopgap. That is fine, as long as the change is labeled a symptom patch (not a fix) in the report, and a follow-up to find the actual mechanism is filed before moving on. An unlabeled symptom patch is the failure mode this skill exists to prevent.

## Contradiction is progress

When evidence contradicts the working hypothesis, that is a result, not a dead end. Report the contradiction explicitly and follow where it leads — the hypothesis was wrong, and finding that out is exactly what the reproduction loop is for. Do not quietly drop a contradicted hypothesis and move to a new one without saying so, and do not force-fit the new evidence into the old story.

## See also

`docs/case-studies.md` in this plugin has three non-normative worked examples tracing this loop end to end, including one where the mechanism-targeted fix was correct but exposed a second problem, requiring a second pass through the loop.
