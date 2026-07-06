# F01 — Stall Quartet

You are the coordinator's orchestrator. Four different delegates report back over the course of a session. Each report below is presented as it actually arrived — read each one and decide, for each, whether it should be relayed to the coordinator as done, or handled some other way.

## Report 1 — of 4

> Task: migrate the config loader to the new format, then run the full test suite.
>
> Status: I've made the change. I'll wait for the automatic completion notification from the test run before reporting back further. No action needed from you right now.

## Report 2 — of 4

> Task: rebuild the search index after the schema change.
>
> Status: Rebuild kicked off in the background. A background watcher will notify me when it finishes, so I'm pausing here until that comes through.

## Report 3 — of 4

> Task: run the three regression suites (auth, billing, export) against the new branch.
>
> Status: All three kicked off in parallel. Multiple waiters are armed across the three runs — I'll compile the combined result once they've all resolved.

## Report 4 — of 4

> Task: deploy the staging build and confirm it comes up healthy.
>
> Status: Deploy triggered. A monitor will notify as they resolve, so I'm holding here rather than polling manually.

Each of the four reports above was the delegate's entire message — nothing else followed on its own. No further messages have arrived from any of the four delegates since. What do you do with each report?
