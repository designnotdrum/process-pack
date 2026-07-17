---
name: stub-first-planning
description: Use before writing any planning artifact a human has to approve - a spec, an implementation plan, or a long dispatch brief. Gate the full artifact behind a tight stub the human will actually read, get approval on the stub, then elaborate and adversarially review the full thing.
---

# Stub-First Planning

## The problem it solves

A two-page spec is a spec nobody reads. The human skims it, rubber-stamps it, and the one load-bearing decision buried on page two ships unexamined. Length is not thoroughness, it's cover. So move the approval to the smallest thing that still carries the real decisions.

This applies to any planning artifact a human signs off on before work starts: a spec, an implementation plan, or a dispatch brief long enough that it's going to get skimmed instead of read.

## The gate

Before you write the full artifact, emit a stub and stop:

- **5 problem bullets** - what's actually wrong, what this has to solve. Root causes, not symptoms (see `root-cause-first`).
- **5 solution bullets** - the shape of the approach and the decisions that actually matter.

Five is a default, not a law. A tight, bounded stub is the point, and if the thinking doesn't fit in roughly ten bullets, it isn't done yet. Get explicit human approval on the stub before going further. Don't write the full artifact first and hand-summarize it back - the stub is the thing under review, and writing the long version first defeats the whole move.

## After the stub is approved

1. **Elaborate.** Generate the full artifact from the approved stub. The stub is now the contract: the full version fills it in, it doesn't relitigate it. If elaboration turns up a decision the stub got wrong, that's a new stub bullet to re-approve, not a quiet edit buried in the long version.
2. **Adversarially review the full artifact, scaled to stakes.** The stub gate is in front of the pack's standing pre-merge red-team (see `verification-gates`), it does not replace it.
   - **High-stakes** - contract-first builds, anything with real blast radius, security, data, or money: the complete artifact gets the full adversarial review, same as always. Gating on the stub does not buy you out of reviewing the thing that actually drives the build.
   - **Low-stakes** - reversible, small, local: the stub approval can carry most of the weight, and a light pass over the full version is enough.

   Judge stakes with the same rules the pack already uses for stopping and reviewing (see `escalation-policy`), not by feel.

## Why this isn't just "write shorter"

The stub is a gate, not a summary. It puts the human's attention at the front, where the decisions are still cheap to change, and it keeps the expensive review - human and adversarial both - off a document that was going to get skimmed anyway. Shorter is a side effect. The point is where the approval happens.

## See also

- `root-cause-first` - the 5 problem bullets are mechanisms, not symptoms.
- `dispatch-brief` - a long brief is a planning artifact; stub it before you compile the full ten-block contract.
- `verification-gates` - this is the front gate; that's the done gate.
