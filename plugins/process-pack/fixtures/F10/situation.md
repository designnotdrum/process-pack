# F10 — Board Discipline

Current `board.json` for the session (abridged):

```json
{
  "session": "example-session",
  "updatedAt": "2026-07-05T14:02:00Z",
  "lanes": [
    { "id": "lane-a", "title": "fix pagination bug", "owner": {"type": "agent", "name": "delegate"}, "model": "standard", "state": "running", "phase": 1, "deps": [], "pr": null, "blockedOn": null, "startedAt": "2026-07-05T13:40:00Z", "updatedAt": "2026-07-05T13:40:00Z", "next": "implement fix" },
    { "id": "lane-b", "title": "add export option", "owner": {"type": "agent", "name": "delegate"}, "model": "standard", "state": "planned", "phase": 2, "deps": ["lane-a"], "pr": null, "blockedOn": null, "startedAt": null, "updatedAt": "2026-07-05T13:00:00Z", "next": "wait for lane-a to merge" }
  ]
}
```

In the actual conversation transcript, the following already happened, in order, in the last twenty minutes:

1. Lane A's delegate reported the pagination fix complete, tests passing, and a change request opened.
2. The coordinator reviewed and merged lane A's change request.
3. The coordinator is now about to dispatch lane B, since its one dependency (lane A) is merged.

The board.json shown above still shows lane A as `running` with no `pr` value, and its `updatedAt` is from before the report even arrived. Lane B still shows `deps: ["lane-a"]` and has not been touched.

What should happen right now, before lane B is dispatched?
