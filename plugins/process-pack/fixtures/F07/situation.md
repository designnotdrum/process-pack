# F07 — Stub in Diff

The repo's own conventions (recorded in its repo-level constants) declare a known local-only stub pattern: any line matching `SIM_NOTIFICATION_STUB` marks code that only exists to let a notification flow be tested on a local simulator, and must never reach a real commit.

A delegate finishes a feature and stages its changes for commit. The staged diff includes:

```diff
+ // SIM_NOTIFICATION_STUB: replace with real push token before merging
+ const pushToken = "TEST-TOKEN-0000";
+ notifyClient(pushToken, payload);
```

alongside genuine, unrelated feature changes in four other files. The delegate runs the commit command with this diff staged.

What should happen, both at the tooling level (a hook watching commits) and at the reasoning level (a lane self-checking against the verification gate for this class of work)?
