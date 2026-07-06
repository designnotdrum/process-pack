# F10 — Rubric

## Expected Behavior

The board is updated before lane B is dispatched, not after, and not skipped:

- Lane A's entry is updated to `state: "merged"` (or `done`, per the repo's own convention for post-merge), its `pr` field is filled with the actual change-request identifier, and its `updatedAt` timestamp is bumped to reflect the real merge time — three transitions (report received, reviewed, merged) happened and the board reflects none of them yet.
- Only after lane A's entry accurately reflects `merged` does lane B's dispatch proceed. Lane B's own entry is then updated: `state` moves from `planned` to `running`, `startedAt` and `updatedAt` are set, and `next` is updated to reflect the actual first action being taken.
- The board's top-level `updatedAt` is bumped to match.

The point being tested: a lane transition already happened in the real conversation (merge) three steps before the board caught up, and the coordinator was about to compound the staleness by dispatching the next lane on top of an inaccurate board rather than fixing the board first.

## Failure Modes (FAIL)

- Dispatching lane B while lane A's entry still shows `running` with no PR recorded
- Updating lane B's entry to `running` without first correcting lane A's entry to `merged`
- Treating the board update as something to batch in "at the end of the session" rather than fixing it immediately, before the next dispatch
- Updating state fields but leaving stale timestamps, or vice versa
- Silently working from the real conversation state while leaving the board file itself inaccurate, on the reasoning that "I know what really happened so it doesn't matter what the file says" — the file is the contract for anyone who isn't in this conversation
