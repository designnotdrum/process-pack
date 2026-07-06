---
name: lane-board
description: Use any time more than one lane of work (delegate, agent, or workstream) is active against the same project. Maintains board.json as the single source of truth for lane state — written on every lane transition, not batched — so status reporting, "what's running", handoffs, and kill decisions are all queries against one file instead of reconstructed from memory.
---

# Lane Board: Standing State That Survives Compaction

## Overview

When more than one lane of work is running, "what's going on" has to be answerable without replaying the whole conversation. This skill makes a lane's current state a file, not a memory: `board.json` is the contract between the orchestrator and everyone who steps away — a person checking in, a handoff reader, a rendered view. Anything that reads board state is a consumer; only the orchestrator writes it.

## The Board Is the Contract, Not the Viz

- `board.json` is the source of truth. A rendered view — a table pasted into chat, a static HTML page, a richer viewer — is a read-only projection of it, never the other way around. If a rendered view and the file disagree, the file is right and the view is stale.
- Write on every lane transition, immediately, not batched at the end of a session. A transition is: a lane starts, changes phase, becomes blocked, opens a review, merges, finishes, or is killed. If a transition happened and the file doesn't reflect it yet, the board is already wrong — fix that before doing anything else with the lane.
- Schema: see the board schema shipped in this pack's constants. Each lane carries an id, a title, an owner (agent or human), a model (when the owner is an agent), a state (`planned` / `running` / `blocked` / `review` / `merged` / `done` / `killed`), a phase, its dependencies, an associated change request if one exists, what it's blocked on if anything, start and last-updated timestamps, and what's next for it. Board-level fields: a session identifier, a last-updated timestamp, and freeform notes.
- Keep state values to the fixed enum. A lane that doesn't fit an existing state is a sign the lane needs splitting, not a sign the enum needs a value invented on the spot.

## The "What's Running / Kill X" Query Pattern

Both questions are answered by querying the board, not by running a fresh sweep:

- **What's running:** filter lanes to `state == running` (and worth surfacing alongside them: `blocked`, since a blocked lane is still occupying attention). Report owner, model, phase, and time since last update — a lane whose `updatedAt` is stale relative to its expected cadence is itself a finding, independent of whatever it last claimed.
- **Kill X:** look up the lane, read its owner and dispatch mechanism off the board entry, stop the underlying work through whichever mechanism actually owns it (a background task, a headless run, a remote session — the specific stop action lives with whatever dispatched it, not with this skill), then immediately write the lane's state to `killed` with a timestamp and a one-line reason in notes. A kill that doesn't update the board leaves evidence of work that no longer exists.
- A lane missing from the board entirely is a gap to fix, not a null result — anything running against the project should get an entry the moment it's dispatched.
- For work that never got a board entry (a genuine one-off task, or a project with no board yet), fall back to a direct sweep of whatever's actually running — but treat that as the exception path, not the default.

## Reporting Off the Board

When status is requested, or delivered unprompted, pull it from the board and shape it for a person, not a machine:

- Lead with outcome, then impact, then what's next: what happened, what it means for whoever's waiting, and who's doing what next and when they'll hear back. Skip internal lane ids, phase numbers, and any jargon that requires having read the board schema.
- If a decision is needed, put every open question in one block at the end of the message, each with options and a recommended one marked — never drip questions across turns, and never let one go unanswered without resurfacing it.
- Once direction is set on a lane, don't re-ask for confirmation on low-stakes, reversible, in-scope continuations — the board already recorded the decision.

## Handoff Consumes the Board

A handoff or checkpoint no longer reconstructs "what's done, what's in flight" from scratch — it reads the board. Writing a checkpoint becomes: point to the board (or attach it) plus the parts a board can't hold on its own — the literal next command or edit to perform on resume, decisions made and why, open questions, and outstanding verification steps. On resume, read the board first; it should already answer "what's done" and "what's still going" before any other file gets opened. A handoff whose board is stale at write time is not ready to ship — update the board first, then write the handoff.

Keep the surrounding mechanics of the ceremony as they were: where a checkpoint lives (a stable, documented location — never a scratch or temp path), what it must contain besides the board (state, next action, paths, decisions and why, open questions, verification still owed), and always surfacing the full path back to whoever is waiting, as its own line, unprompted. The board changes what "state" means inside the ceremony; it doesn't change the rest of it.

## Attention and Timing

The board tells you what's running and for how long; it doesn't by itself tell you how to manage a person's attention around that wait. That protocol — estimating durations, front-loading questions, confirming handoffs, batching updates, running a queue when more than one thread is active — is a compact sibling reference in this skill's own directory: see `attention-protocol.md`. Apply it whenever a lane, or the board as a whole, represents meaningful wait time for whoever is watching it.

## Red Flags (fail conditions)

- A lane transition happened and the board wasn't updated before the next dispatch
- A rendered view trusted over the board file when the two disagreed
- "What's running" answered from memory or recall instead of a board query
- A kill executed without the board being updated to `killed`
- A handoff written while the board it points to was stale
- A lane state value invented outside the fixed enum
- Status reported with lane ids, phase numbers, or schema jargon left in for a non-technical reader
