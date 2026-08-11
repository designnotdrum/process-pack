---
name: verification-gates
description: Use when declaring any work item done, or when writing the report/evidence block of a dispatch brief. Defines the gate list — the specific evidence required before something counts as done — per class of work, plus universal rules that apply to every class.
---

# Verification Gates: Definition of Done, by Work Class

## Overview

"Done" is not a feeling, it is a gate list. Different classes of work fail in different, predictable ways, so each class has its own required evidence. Find the closest matching work class below and gather every item on its list before declaring done. These lists are a floor: a repo's own constants can extend them (see Extending, below), never shrink them.

## Universal rules (apply to every work class)

**Review-bot triage is part of done.** An automated reviewer's comments are not optional feedback for later — triaging every comment is itself a required gate. A change is not done while an automated review comment sits untriaged, even if every other gate passed.

Triage has three outcomes, and they are not equally available. **Fix it** is the default. **Dismiss it** requires stating why the reviewer is wrong. **Park it** requires naming a blocker from `fix-what-you-find` — a decision only the human can make, access you do not have, a collision with a concurrent lane (which means sequence it, not drop it), or a size that genuinely needs its own plan. "Out of scope", "pre-existing", "non-blocking" and "follow-up ticket filed" are not blockers, and a parked item with one of those as its reason has not been triaged. See `fix-what-you-find`.

**Stale-premise rule.** Before executing a work item, check whether its stated premise still holds — the thing it says to add might already exist, the bug it names might already be fixed, the config it assumes might have already changed. When reality contradicts the brief, report the discrepancy with evidence instead of executing anyway. A no-op backed by evidence is a valid, completed outcome, not a failure to act.

**Bounded-temporary rule.** Every temporary path, flag, stub, or band-aid must state its removal criterion and have a filed follow-up task. Without both, it is not temporary, it is permanent scaffolding wearing a temporary label. The difference between a migration step and scaffolding is exactly this: a migration step names the condition under which it goes away ("remove once X ships," "remove after the last consumer of Y migrates"); scaffolding has no such condition, or only a vague one like "revisit later." File the follow-up in the tracker of record for the active context — read from constants' `tool_mapping` — not whichever tracker CLI happens to be on hand; a follow-up filed in the wrong tracker is invisible to whoever actually owns it and doesn't satisfy this rule.

## Adversarial pre-merge review

A change matching this gate's risk criteria does not merge on green checks and an author's own "done" report alone. It also gets an independent adversarial review, commissioned before the merge — not requested after, and not skipped because the diff looks small or the report sounds confident.

**Risk criteria (the applicability gate).** This review is required whenever a change matches any of:

- A deploy-path change (see the work class below)
- A security-adjacent change — touches authentication, authorization, secrets handling, or any other trust boundary
- A data-migration change — alters data at rest, or the shape or meaning of stored data, for a system real users currently depend on
- Explicitly flagged — anyone with standing on the change (the author, a reviewer, a repo owner) names it high-risk, regardless of whether it matches one of the criteria above

A repo's own constants may name additional risk criteria on top of this base list. Treat that the same as the gate-list extension mechanism below: additive only, never a way to narrow the baseline.

**The reviewer must be independent.** Its identity is read from constants (repo or personal scope, per your own setup) — never chosen ad hoc by whoever is running the merge. "Independent" has exactly one meaning here: a genuinely different agent or tool than the one that authored the change. Not the same runtime re-invoked in a fresh context. Not a second pass by the same session. Never the author reviewing itself. An author's offer to self-review — however well-intentioned, however much time it would save — is declined outright; it is not a lighter-weight version of the required review, it is not the required review at all.

**If the designated reviewer is unavailable, that is escalated, never routed around.** Report the block by name — which reviewer, why it's unavailable — and propose a wait or a named alternate. Do not silently substitute a self-review because nothing else is on hand, and do not silently drop the gate because the change is otherwise ready. Unavailability is exactly the moment this rule exists to hold; it is the least convenient time to skip it and the most important time not to.

**Briefing the reviewer.** Commission the review per the dispatch-brief skill, framed as refutation, not confirmation: find the missed edge case, the wrong assumption, the security hole, the simpler alternative. A reviewer asked to "check this looks okay" tends to produce a rubber stamp; a reviewer asked to find flaws produces a review.

**Triage before merge.** Sort every finding from the review into one of the feedback-triage skill's four buckets — fixed now, delegated, escalated as a real decision, or parked with a stated reason — before the change merges. This is the review-bot-triage universal rule above, extended to a commissioned reviewer instead of an automated one. A finding marked "addressed" with no diff or written rebuttal is untriaged, not done.

**Named exceptions:**
- A change already covered by an equivalent independent adversarial pass earlier in its lifecycle — for instance, the plan or spec behind this exact change was already red-teamed before execution, and the execution didn't deviate from what was reviewed. Name which earlier pass covers it in the report rather than re-running a redundant one.
- Any further exception is a repo-constants entry naming the specific carve-out explicitly. An unnamed "this one's obviously fine" carve-out is not an exception, it is a hole in the gate.

**Escape hatch.** A human with standing to accept the risk states, in the moment, that this specific change proceeds without the independent pass — and that statement is the record (in the merge instruction, the PR, or the board entry), not an inference drawn from silence. A merge that simply doesn't mention the missing review is an unlogged gap, not an invoked escape hatch.

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

### User-visible or behavioural UI change
- **A recording of the reported symptom no longer happening**, driven in a real browser against a deployed preview. Not a tour of the feature and not the happy path in general: if the complaint was "clicking does nothing", the artifact shows a mouse click working. **Narrated video is the format**: it plays inline in a PR comment, and the narration carries what a reviewer would otherwise have to infer from the pixels. GIF is the named fallback, not the default — it is silent, and a silent recording makes the reviewer guess at intent.
- The interaction exercised the way a user does it. A passing test that renders the real component is good evidence of logic; it is not evidence that the control can be operated. Three separate fixes have shipped green on unit tests while the interface stayed broken, because the failure lived in CSS, in hit-testing, and in an effect's dependency array — none of which a jsdom test observes.
- **Pin the deployment before trusting a single observation.** Read the build identity from the running page and confirm it matches the commit under test. Preview aliases point at whatever was deployed last, and a stale one serves a different build with different behaviour. Measured: an entire investigation ran against an alias whose build returned empty data, producing three successive wrong explanations — the session, the account, then the cache — while a build four minutes old behaved correctly with the identical session. "It loaded" and "it loaded the code under test" are different claims.
- **Confirm the input landed before believing the result.** A control that did not receive the click, and a field that did not receive the text, both produce a page that looks like a bug. Probe what the interaction actually hit rather than inferring from a screenshot.
- **Assert the feature, not a proxy for it.** Every cheap readiness signal has passed on a page that was not the page under test: HTTP 200 on a sign-in redirect; a session cookie on a blank page; network-idle on an app frozen in loading skeletons; an absence of skeletons on a signed-out form, which has none either; visible signed-in chrome on a page whose content never arrived. Assert something only the working feature renders, and combine signals.
- If the recording could not be produced, the PR says so and names the fallback used. A silent omission reads as "not checked", because it usually is. The same applies to a recording that was produced but shows a placeholder, a loading state, or a signed-out screen — that is a failed recording, not evidence, and passing it off as evidence is worse than shipping none.

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

The same applies to the adversarial pre-merge review above: a repo's constants name its designated independent reviewer and may add risk criteria beyond the base list, always additive, never a substitute for the reviewer being genuinely independent of the author.
