---
name: feedback-triage
description: Use when receiving a design or code review to execute, or when writing a review someone else will execute. Splits every review item into one of four buckets before any work starts, so parked items don't get silently rebuilt and outgoing reviews arrive pre-executable.
---

# Feedback Triage: Review In, Review Out

## Overview

A review arrives as a flat list of comments. Treating every comment as "go fix it" burns time on decisions nobody has actually made yet, and it silently re-opens scope that was deliberately parked. This skill sorts every review item into a bucket before any work begins — whether the review is coming in or going out — and makes sure the reasoning behind a "not now" survives long enough to matter.

## The Four Buckets

Every review item gets exactly one, no exceptions:

1. **Fix-now** — small, unambiguous, no open question. Do it directly.
2. **Delegate-mechanical** — well-specified and mechanical, but more than a one-line fix. Hand it to a delegate with a normal brief.
3. **Needs-decision** — a real fork exists. Present the options with their tradeoffs; do not start building any of them until someone picks.
4. **Parked-with-reason** — explicitly not being done now, and why.

## Scope Guards Flow Into Briefs

A scope guard is a short, quotable sentence written at triage time: "do not restyle X until Y is decided." Every parked item gets one. The guard is not reconstructed later from memory — it is copied verbatim into any dispatch brief for work touching the same area, so a delegate working nearby sees the guard directly instead of rediscovering, the hard way, why that area is off-limits.

## Outgoing Reviews Use the Same Buckets

When writing a review for someone else to execute, sort your own comments into the same four buckets before sending. A review that arrives pre-bucketed is pre-executable: the recipient doesn't have to re-triage your comments from scratch, and a needs-decision item is visibly flagged as a question rather than disguised as an instruction to just go build it.

## Mid-Flight Bucket Changes Trigger a Descope Message

A bucket assignment is not permanent. When new information supersedes an earlier call — research answers a needs-decision item, a parked item's blocking decision finally lands, a fix-now turns out to hide a real decision — send an explicit descope or rescope message to every lane whose work depends on the old bucket, immediately, not folded into the next routine status update. Silence at this moment is how a lane burns real time building against a bucket assignment that no longer holds.

## Companion: Standing Review Responses

Some reviewer objections are predictable and already have a pre-authorized answer on file — for example, an automated reviewer flags a breaking change as risky on a project whose standing policy is to roll forward without a compatibility shim. Before triaging a repeat or automated reviewer's comment into needs-decision, check the project's standing-responses list (kept with its other standing corrections, in the project's own constants). If the objection matches an entry there, the right bucket is fix-now-with-a-reasoned-reply: post the standing response with its reasoning attached. Don't silently comply against standing policy just because a reviewer asked, and don't silently dismiss the comment either — the response goes on the record either way. Only genuinely new objections go to needs-decision.

## Red Flags (fail conditions)

- A review item acted on before it was bucketed
- A parked item with no written scope guard
- A scope guard that existed at triage time but didn't make it into a later brief touching the same area
- A bucket that changed mid-flight with no descope message sent to affected lanes
- An outgoing review sent as a flat comment list instead of four labeled buckets
- A standing-response-eligible reviewer comment either silently complied with or silently dismissed instead of answered on the record
