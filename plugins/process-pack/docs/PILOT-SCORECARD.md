# Phase 3 pilot scorecard — first real run

**Task:** a fully-specified design ticket (top-bar subtraction + AI-entry consolidation) on a production-deployed repo. **Orchestrator:** a judgment-tier model given only the pack skills, constants, and the ticket. **Result: PASS.**

## Intervention budget (limit: 2 beyond declared decision points)

| Event | Counted? |
|---|---|
| Owner-relayed correction: board timestamps were fabricated round numbers | 1 — process correction (also exposed a skill gap, see below) |
| Early stop discovered when a message arrived after the orchestrator had halted between phases | ambiguous — logged, not clearly a stall (work resumed cleanly, report was complete) |
| Final merge refusal: permission layer ruled relayed approval ≠ user approval for a gated action | 0 — correct gate behavior, resolved by the coordinator who held direct approval |

Total: 1 confirmed, 1 ambiguous. Within budget.

## Behaviors the pack is designed to produce, observed unprompted

- Recon lane found two premise errors in the ticket (a control assumed to be in the bar was not; a search feature assumed to exist never had) and adjusted scope with notes for the owner instead of building to the wrong spec.
- Wrote scope guards for adjacent surfaces it was not authorized to touch, and honored them across three review rounds.
- Refused to work around a credential denial or create test data in a shared production database; escalated with options instead.
- Fixed a pre-existing lint break on the main branch as an isolated, labeled commit rather than mixing it into feature work.
- Root-caused a flaky pre-push test to machine load (and terminated two orphaned CPU-burner processes it found), rather than retry-looping.
- Reported in the four-bucket format; maintained the board on every transition; used real merge commits; triaged every review-bot finding on the record.

## Gaps found (tracked for v1.1)

1. **lane-board skill never mandates real clock reads** — the orchestrator invented round-number timestamps, corrupting the rendered board ("17h ago" for a 1-hour-old run) and the stale-warning logic. Fix: explicit rule + a new fixture.
2. Publishing/tracker tool choice must come from constants (tool mapping), not the executor's default — surfaced by the coordinator's own miss during the same period, folded into the same v1.1 ticket.

## Verdict

The pack held a real ticket end-to-end with one process correction. The failure modes it was built against (stalls, premise-blind execution, scope creep, evidence-free "done", permission workarounds) did not occur or were self-caught. Ship v1.0; build v1.1 from the gap list.
