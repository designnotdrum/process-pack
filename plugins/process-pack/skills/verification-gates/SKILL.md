---
name: verification-gates
description: Use when declaring any work item done, or when writing the report/evidence block of a dispatch brief. Defines the gate list — the specific evidence required before something counts as done — per class of work, plus universal rules that apply to every class.
---

# Verification Gates: Definition of Done, by Work Class

## Overview

"Done" is not a feeling, it is a gate list. Different classes of work fail in different, predictable ways, so each class has its own required evidence. Find the closest matching work class below and gather every item on its list before declaring done. These lists are a floor: a repo's own constants can extend them (see Extending, below), never shrink them.

## Universal rules (apply to every work class)

**Review-bot triage is part of done.** An automated reviewer's comments are not optional feedback for later — triaging every comment (fix it, dismiss it with stated reasoning, or park it with a written reason) is itself a required gate. A change is not done while an automated review comment sits untriaged, even if every other gate passed.

**Stale-premise rule.** Before executing a work item, check whether its stated premise still holds — the thing it says to add might already exist, the bug it names might already be fixed, the config it assumes might have already changed. When reality contradicts the brief, report the discrepancy with evidence instead of executing anyway. A no-op backed by evidence is a valid, completed outcome, not a failure to act.

**Bounded-temporary rule.** Every temporary path, flag, stub, or band-aid must state its removal criterion and have a filed follow-up task. Without both, it is not temporary, it is permanent scaffolding wearing a temporary label. The difference between a migration step and scaffolding is exactly this: a migration step names the condition under which it goes away ("remove once X ships," "remove after the last consumer of Y migrates"); scaffolding has no such condition, or only a vague one like "revisit later."

## Gate lists by work class

### CI / workflow change
- Measured before-and-after numbers from real runs, not estimates. Link the run IDs.
- One live end-to-end run through the changed path, not only a dry validation.
- Every consumer of a required-check's name checked for consistency — gate jobs, branch-protection rulesets, anything else that references the check by name. A rename or restructuring that isn't propagated to every consumer is a broken gate wearing a passing badge.

### Flaky-test fix
- A stated mechanism for the flakiness (see the root-cause-first skill) — not "made it less flaky."
- Reproduction N times locally before the fix, showing the failure rate, and N times after, showing it is gone. Same N on both sides.
- No threshold-fiddling (loosened tolerance, added retries, bumped a timeout) accepted as the fix without an accompanying mechanism. A widened threshold with no stated mechanism is a hidden instance of the bounded-temporary rule — it still needs a removal criterion and a follow-up.

### Design round
- A per-feedback-item mapping: every item in the round maps to a specific change, or to a stated reason it was not changed.
- A preview URL, or equivalent staged artifact, reflecting the change — not only a local diff.
- Updated tests that assert the new intent. Deleting an assertion that contradicted the new design is not the same as replacing it with one that confirms the new design; the gate requires the replacement.

### Deploy-path change
- Watch the change's own merge through to the platform's deployment dashboard reaching a ready/live state. Do not declare done at merge time.
- Record the wall-clock time from merge to live.
- State the revert plan before the deploy happens, not after something breaks.

### DB-adjacent change
- Prove connection isolation: a grep (or equivalent static check) showing which code paths can reach which connection strings or credentials, confirming the change did not introduce cross-environment or cross-tenant leakage.

### Mobile feature (adds to whichever base checklist applies)
- Every UI state on the feature's named checklist smoked on a simulator or device, not only the happy path.
- Any local-only stub used during development reverted before the change is considered done (see the stub-guard hook / repo constants for declared stub patterns).
- Platform metadata (store-listing fields, permission manifests, build configuration) verified as deployed, not only the code.

### Removal / migration change
**Done means deleted.** Before declaring this class complete:
- Search for remaining references to the removed thing — call sites, imports, config entries, documentation.
- Search for aliases and feature gates that route around the removal instead of completing it.
- Delete legacy tests that tested the removed behavior along with it. A test suite that stays green only because it is now exercising a compatibility shim, not the real removed path, is a failed gate, not a passed one.

## Extending

A repo's own constants (a `repo.yaml` or equivalent) can add new work classes, or extend an existing class's gate list with landmines specific to that repo — a known-flaky consumer, a required staging step, an extra sign-off. When repo constants add a gate, it applies in addition to the list here, never instead of it.
