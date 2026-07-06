---
name: taste-rules
description: Use whenever writing a delegate brief, triaging an automated review, or about to do something a standing correction already covers — a compatibility shim, a squash merge, unlabeled jargon, reinventing an existing pattern, or a judgment call a hook could verify instead. Reads the standing taste rules from constants and carries them into the brief or the review response.
---

# Taste Rules

## What this closes

Corrections a person gives an orchestrator across many sessions live in that
orchestrator's memory. Memory does not travel with a delegate — a subagent, a
CLI-based coding tool, a peer on another machine, or a fresh context after
compaction starts with none of it. Taste rules move a standing correction out
of memory and into a file that ships with every brief and every context, so a
delegate honors it without the person having to re-state it every time.

## Where rules live

Taste rules are declared in a constants file: a flat list of rules, each
following the anatomy below. A person, repo, or org can add rules on top of
the pack's worked examples — the list is never meant to be exhaustive; it
grows as corrections repeat.

## Required rule anatomy

Every rule states, in this order:

1. **Default stance** — what happens with no further judgment applied. Plain
   and enforceable ("no", "always", "never"), not a vague preference.
2. **Applicability gate** — the concrete, checkable condition that justifies
   the strong-form default. Not a vibe: a fact you can look up (a version
   tag, a file's existence, a config value), not a feeling about how mature
   something seems.
3. **Named exceptions** — the specific, enumerated cases where the default
   doesn't hold, stated in advance. An exception invented in the moment to
   excuse an inconvenient default is not a named exception.
4. **Escape hatch** — how someone overrides the rule anyway: express,
   in-session permission, stated explicitly — never inferred from silence or
   from "they'd probably be fine with it."

A rule missing any of the four parts is a preference, not a taste rule —
round it out before relying on it, or hold it as a candidate until it's
decided enough to state a real default.

## Injection into briefs

Before dispatching, scan the applicable rules against the task: does this
brief touch anything a rule's applicability gate names? Every rule that
applies gets quoted into the brief verbatim — at minimum the default stance
and the applicability gate — so the delegate can check itself against the
actual rule instead of trusting a paraphrase. A delegate that violates a rule
which should have been in its brief is a briefing failure, not a delegate
failure.

## Standing review responses

Automated reviewers repeat the same objections across many changes — a
request for a compatibility adapter, a note to "consider adding tests" where
equivalent tests already exist elsewhere, a style nit a project has already
decided against. For any taste rule that predicts a specific recurring
objection, write the standing response once: the reasoning that answers it,
ready to post as-is. When that objection shows up, the reply carries the
reasoning instead of silent compliance (which quietly abandons the rule) or
silent dismissal (which leaves no record for the next reviewer, or the next
person reading the thread, to check). The response goes on the record even
when the objection was already covered by policy — silence reads the same as
agreement to whoever reads it next.

## Escape hatch discipline

"Someone might want this someday" is not in-session permission. The escape
hatch requires the actual person, in the actual session, saying yes to this
specific instance. Anything short of that keeps the default in force —
including a case that feels obviously safe to bend.

## Worked examples

`constants/examples/taste-rules.yaml` in this pack ships several rules built
to this anatomy: a writing-style rule, a merge-policy rule, a
reuse-before-invent rule, a hookify-what's-verifiable rule, and one adapted
from a published rule about compatibility scaffolding in single-deployment
tools (credited in the file). Use them as the template shape for new rules,
not as an exhaustive or final list — the strongest sign a rule belongs here
is that the same correction has already been given more than once.
