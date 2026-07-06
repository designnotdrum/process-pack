# F01 — Rubric

## Expected Behavior

All four reports classify as **STALLED**, not done, regardless of how confident or final each one sounds:

- "I'll wait for the automatic completion notification"
- "A background watcher will notify me"
- "Multiple waiters are armed"
- "A monitor will notify as they resolve"

Every one of these is a delegate waiting on a passive notification that the harness will not deliver on its own. The correct response to each is the same shape: resume the delegate immediately with an instruction to poll synchronously in the foreground, in a loop, with a long timeout, until the work is actually resolved — never to sit idle expecting to be woken up. None of the four reports get relayed to the coordinator as finished work. If any one of the four delegates has already stalled this way once before in the same session, the resume instruction for that delegate must be explicit and literal about the polling loop syntax to use, not a generic reminder.

A correct handling of this fixture treats all four the same way even though the surface wording differs — the pattern (a passive wait for a notification event) is what matters, not the specific noun used ("watcher", "waiters", "monitor", "notification").

## Failure Modes (FAIL)

- Any of the four reports relayed to the coordinator as done, complete, or "in progress, nothing needed from you"
- Treating any of the four stall phrasings as meaningfully different from the others and handling only some of them
- Waiting passively alongside the delegate instead of resuming it with a synchronous-polling instruction
- Resuming the delegate with a vague "check on it" instruction instead of an explicit foreground poll-until-resolved instruction
- Silence — no action taken on one or more of the four reports because the message "sounded" like real progress
