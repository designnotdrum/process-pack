---
name: notification-triage
description: Use whenever a task-notification arrives from a delegate, whenever you're asked "still going?" or "did it finish?", or whenever a dispatched delegate has gone quiet longer than its stated estimate. Classifies every completion signal before anything gets relayed as done.
---

# Notification Triage: The Watchdog Upgrade

## Default stance

Classify every completion signal into exactly one of four buckets before you relay anything. You are never the pass-through for a delegate's self-report — dispatching work does not transfer responsibility for judging whether it's actually finished.

## Applicability gate

This triggers on any of: a task-notification arriving from a delegate; being asked whether dispatched work is still going, has finished, or has an update; or a dispatched delegate going quiet for longer than the duration you estimated at dispatch time. If you never stated an estimate, that's a dispatch-brief defect — fix it going forward, but triage the current signal anyway using the four buckets below.

## The four buckets

**DONE-WITH-EVIDENCE** — the report contains what its brief mandated (see the report-format block in a dispatch brief, and the evidence its verification gate requires for that class of work). Relay it as done.

**STALLED** — the result reads like the delegate is waiting on something that will never arrive: phrasing such as "waiting for my monitor," "will notify me automatically," "waiters are armed," or "background watcher will…" (and close variants of these). No such notification is coming. Do not relay this as done. Resume the delegate immediately with the standard resume message below.

Before calling something STALLED, check whether the quiet item is actually on the never-wait list from repo constants — an expected long-pending check sitting quietly is not a stall, and treating it as one causes you to interrupt a delegate that was behaving correctly.

**FAILED** — the delegate reports failure. Relay it with the delegate's own evidence attached, never softened, never summarized into something gentler than what actually happened.

**SUSPECT** — the claims in the report contradict what you can independently verify about the actual state of things, or the evidence its brief mandated is simply missing. Interrogate before relaying: verify the claim yourself, or send it back for the delegate to substantiate. Do not relay a SUSPECT report as done, and do not relay it as failed either — resolve which one it actually is first.

## Standard resume message

Send this back to a STALLED delegate, adjusted only for the specific check it should re-run:

> "Nothing is watching this for you and nothing will notify you automatically — stop waiting. Resume now: run the check yourself in a foreground call with a long timeout, and repeat it until it resolves. Report back only once you're holding the actual result."

## Second stall, same delegate

If the same delegate stalls a second time after receiving the standard resume message, prose didn't land — switch to explicit foreground-loop syntax instead of another prose instruction. Give it the literal loop construct to run (a `while`/`until` shell loop with a real sleep interval and exit condition), not another restatement of "poll synchronously." The second escalation is more concrete than the first, not just repeated louder.

## Exceptions

While you are driving a delegate synchronously — actively watching it turn by turn, not fire-and-forget — there is no separate triage step until it hands you a candidate final report; triage applies to the completion signal, not to every intermediate line of output.

## Escape hatch

An explicit, in-session instruction to relay a report as-is, stated by the person you're reporting to and with the classification skipped on the record, is permitted. An assumption that a report is probably fine because it sounds confident is not — confidence is not one of the four buckets.

## Red flags — you are failing this skill

- You relayed a report as done without checking it against what its brief mandated.
- A stall phrase went past you because it didn't match one of the phrasings you had memorized — near-misses count.
- You softened a FAILED report before passing it on.
- A claim in a report contradicted something you could have checked in one command, and you didn't check it.
- The same delegate stalled twice and got the same prose instruction both times.
