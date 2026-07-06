---
name: lane-planner
description: Use before dispatching more than one delegate against the same repo, or whenever a work list has more than two items. Produces the lane table — ownership, phase, and merge order — that has to exist before any dispatch happens, not after a collision is discovered.
---

# Lane Planner: Wave Decomposition With File Ownership

## Default stance

Before dispatching more than one delegate against a repo, produce a lane table. The table is the plan; it exists before the first delegate starts, not as a retrospective explanation of what went wrong.

A lane table has, per lane: **lane name → model tier → owned files/dirs → dependency phase → merge order.** One owner per file or directory, no exceptions — if two lanes' work would touch the same file, that is not two lanes, it is a phase-ordering problem or a single lane.

## Applicability gate

This triggers whenever more than one delegate is about to run against the same repo concurrently, or whenever a work list has more than two items — even if you intend to run them one at a time in a single delegate. A serial work list still needs the ownership map if any two items would touch the same file; write the table before the first dispatch either way.

## The rules

- **Shared clone → every lane gets its own worktree, always.** A shared clone with two lanes writing into it is a collision waiting to happen, not a resource optimization. No lane starts without an isolated worktree.
- **One owner per file, no exceptions.** If a file is genuinely needed by two lanes, that is a signal to either merge them into one lane, or split the work into sequential phases so the second lane only starts once the first has merged its change to that file.
- **Phase gating.** Phase N+1 dispatches only once phase N has merged — not once phase N's delegate has *reported* done, once its change actually landed. A delegate's self-report is not the gate; the merge is.
- **One PR per lane.** Each lane produces its own pull request, following the same one-PR-per-unit-of-work convention as everything else — don't bundle two lanes' changes into a single PR because they happened to land around the same time.

## Wave patterns that hold up in practice

- **Instant-wins phase first.** Put the fast, low-risk, high-confidence lanes in phase 1 — they clear the board, build momentum, and surface any shared-file surprises early while the cost of re-planning is still low.
- **The riskiest change earns live verification.** The lane most likely to be wrong is the one you watch land end-to-end yourself, not the one you delegate furthest and check on last.
- **Keep the review lane separate from the build lanes.** A lane that reviews or red-teams another lane's output is its own lane with its own phase — it does not run inside the same worktree or the same dispatch as the work it's reviewing.

## Exceptions

A work list of two items or fewer with zero file overlap may collapse the formal table into a single line: lane, tier, files, done. The ownership check still has to happen — you're skipping the table's ceremony, not the judgment behind it.

## Escape hatch

An explicit, in-session acknowledgment of collision risk for a specific one-off dispatch — stating which file might be touched twice and why you're accepting that risk anyway — is permitted. An unstated assumption that "it'll probably be fine" is not; that's the exact failure mode this skill exists to catch.

## Red flags — you are failing this skill

- Two lanes are about to write into the same clone.
- A file appears under more than one lane's ownership in the table, or under no lane's ownership at all.
- A later phase is dispatched because an earlier phase's delegate *said* it was done, before its PR actually merged.
- A review lane is folded into the same dispatch as the work it's supposed to be reviewing.
- There's a work list bigger than two items and no table exists yet.
