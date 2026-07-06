---
name: escalation-policy
description: Use when a fork in the work could produce a consequence outside this task's own blast radius, or when a decision is hard enough that you're tempted to reach for the most capable model available to resolve it. Names the fork classes that always stop for a human, and the pattern for calling in a top-tier model as a consultant rather than a resident decision-maker.
---

# Escalation Policy

## Named fork classes that always escalate

The following fork classes stop for a human, no matter how confident the
autonomous path looks. Your constants may add more that are specific to a
person, repo, or org — treat that as additive, never as a way to narrow this
baseline:

1. **Architecture contracts** — decisions other people's future work will be
   built on top of, not just this task's own shape.
2. **Production data mutations** — anything that writes, deletes, or
   migrates data a real user currently depends on.
3. **Removing user-facing controls** — deleting a button, permission, or
   capability a user currently relies on.
4. **Spend outside the declared budget** — dollars, compute, or time beyond
   what was agreed for this task.
5. **Root-cause verdicts that contradict the ticket** — your investigation
   concludes the reported problem isn't what the ticket assumed.
6. **Anything crossing a resource wall** — see the resource-wall-preflight
   skill; a wall is itself a reason to escalate, not an obstacle to route
   around.

When you hit one of these: stop, report what you found and the real options,
and wait for an answer. Do not improvise around a listed fork with a
plausible-sounding default — a fork class exists specifically because the
plausible answer and the correct answer diverge there often enough to
matter.

## The consultant pattern

A single call to the most capable model available is pre-authorized at named
judgment moments — not as a way to run the task, but as a consultant brought
in for one decision:

- Wording an architecture contract precisely.
- Synthesizing candidate directions down to a recommendation.
- Summarizing incident forensics into a clear narrative.

The rule: the top-tier model is a consultant called in at two or three named
decision points, never the resident orchestrator running every turn. If you
notice yourself reaching for it as the default driver of the work rather than
for one of these named moments, that's the signal you've over-scoped its
role — hand the steering wheel back to the tier the work is actually
budgeted for.

## Request template for a consultant call

Every consultant call states, in this order:

1. **Context brief** — what's true right now, in as few lines as it takes to
   prove it. Not the whole history of the task.
2. **Question** — the exact judgment call, phrased as a question. Not an
   open-ended "look into this."
3. **Constraints** — what's fixed and cannot change as part of the answer.
4. **Expected artifact** — the exact shape the answer should come back in (a
   paragraph of contract language, a ranked list of directions with
   tradeoffs, a two-paragraph summary), so the call has a clear stopping
   point instead of wandering into open-ended exploration.

## Escalation and consultant calls don't substitute for each other

A consultant call to a top-tier model does not satisfy an escalation to a
human. The human owns the fork classes above; the consultant model is for
judgment inside a task, not authority over its scope. If you're unsure
whether a moment needs a human or a consultant call, it needs the human —
consultant moments are named in advance; they are never improvised in the
moment to avoid stopping.
