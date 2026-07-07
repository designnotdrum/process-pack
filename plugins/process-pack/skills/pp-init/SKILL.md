---
name: pp-init
description: Use when onboarding a new person or a new repo to this pack — constants files don't exist yet, need regenerating, or a repo needs its own landmine list captured. Also use when a standing correction keeps recurring and hasn't been turned into a candidate rule yet.
---

# pp-init: onboarding interview

## Overview

This pack works by keeping every specific fact out of skill text and in
one of three constants files: personal, org, and repo (see
`constants/schemas/` for the exact shape of each, and
`constants/examples/` for a filled worked example of each). This skill is
how those files get written the first time, or regenerated when they go
stale: a short, scoped interview per file, validated against its schema
before anything is saved.

Run the personal and org interviews once per person (org optionally
shared across everyone at the same organization). Run the repo interview
once per repo, and again whenever that repo's landmines change enough
that the file feels out of date.

## Before you start

Confirm which file(s) you're generating and where they'll be written:

- Personal scope → `constants/personal.yaml` (schema:
  `constants/schemas/personal.schema.json`)
- Org scope → `constants/org.yaml` (schema:
  `constants/schemas/org.schema.json`)
- Repo scope → `<repo>/.process/repo.yaml`, or a clearly labeled section
  of that repo's own root instructions file if a whole file is overkill
  (schema: `constants/schemas/repo.schema.json`)

If a file already exists at that path, read it first and treat the
interview as an update pass: confirm what's still true, ask only about
what's missing or changed, don't re-ask settled questions.

## The refusal rule

Before writing any answer into a constants file, check which layer it
actually belongs to:

- An answer that names a specific identity, account, threshold, contact,
  or repo-specific quirk → constants. Write it.
- An answer that describes a procedure or behavior that should hold the
  same way for anyone, in any repo, regardless of who's asking → **not**
  a constants fact. Refuse to write it into the constants file being
  generated, say why, and point at a skill (existing or missing) as the
  right home for it instead.

The same check runs in reverse: if you notice a skill file contains a
specific name, account, or repo-specific detail, that's the two-layer
rule being violated somewhere else — flag it, don't silently work around
it by also duplicating the fact into a constants file.

## Infer-First: Mine Before You Ask

Whenever this interview is pointed at one or more actual repos — rather than
run with nothing to look at yet — mine what's inferable from them before
asking a single question. Whatever can be inferred, lead with it: present
every mined finding as a prefilled default, labeled as inferred, for the
person to confirm or correct, rather than asking the question cold. A
question asked blind when the repo already had the answer sitting in it is a
worse interview than one that opens with "here's what was found."

Mine, per repo pointed at:

- **Git identities and remotes.** The repo's own git config (`user.name`,
  `user.email`) and its configured remotes (which host, which account/org the
  remote path names). Prefills the matching context's identity questions
  below instead of asking them cold.
- **Tracker references.** Recent commit messages, change-request titles, and
  branch names, scanned for a recurring reference pattern — an issue-key
  format, a tracker CLI already configured in the environment. Prefills the
  tool-mapping question below.
- **CI check names.** The names of jobs/checks defined in CI workflow files
  today. Bring the full list as candidates for the never-wait question in the
  repo interview — mining surfaces names, a human still says which of them
  are actually quota-dead; it is not an auto-classification.
- **Lint/format configuration.** Whether a linter or formatter config already
  exists, and what it enforces. Its presence (or absence) is itself a partial
  answer to the repo interview's gotcha and convention questions.
- **Existing docs.** Anything already covering onboarding, architecture, or
  contribution process, read before asking a question a doc already answers.

## Wall check before writing

Mining reads identity; it does not act on it. Before writing any file,
compare the mined git identity and host account against the context the
current session is billed to. If they differ - you are onboarding one
context from a session that belongs to another (a work context from a
personal session, or the reverse) - stop and run the resource-wall
preflight before writing anything, and do not invoke the other context's
runtime or config to finish the job. Reading a repo is safe; generating
that context's constants, installing, or running under it from the wrong
session is the wall. Write the file only once the session context matches
the file's context, or the person has explicitly confirmed the
cross-context write is what they intend.

## Personal interview (≤11 questions)

Ask these, adapting wording to what you already know from the repo/session
you're in — skip any question whose answer is already evident and confirm
instead of re-asking. Where mining (above) found a prefilled default, present
it as the default and ask for confirmation or correction rather than asking
cold:

1. What contexts do you operate under (for example: a personal context
   and a separate one issued by an organization you work for)? For each,
   what name/email should commits made in that context carry, and what
   account is it attached to?
2. Do any of those contexts have their own runtime/config directory (for
   example, running the same tool twice under different accounts)?
3. Are there runtimes or tools whose billing must never cross a context
   boundary — a wall? Name each one and which context is the correct
   payer.
4. Are there account-scoped tools where the contexts must stay separate
   even though both could technically reach it (for example, an
   analytics dashboard scoped per org)? Name each.
5. Do you use tiered model routing for delegated work? If so, what
   model/tier maps to trivial, standard, and judgment-level work?
6. Is there a reserved "consultant" pattern — an expensive, top-of-line
   model used only for a small number of named decision points rather
   than as the default? Describe the pattern if so.
7. What's your default merge strategy (real merge commit vs. squash vs.
   rebase), and is it ever acceptable to deviate?
8. Do your commits carry a standing trailer (for example, a
   co-authorship line)? What's the exact text?
9. Is triaging automated review comments part of what makes a PR "done,"
   separate from checks passing?
10. Any standing communication preferences an orchestrator acting on your
    behalf should always apply (tone, when to interrupt vs. batch
    updates, how it should handle long-running async work)?
11. For each context, what do you use for tickets, docs, and comms — and
    what channel do you publish through when something needs to be viewed
    outside this conversation? Offer the standing publishing menu: a local
    file (always available, no setup required), an artifact rendered inside
    a running assistant session (only applies there), a single-file share
    host with a size cap, an agent-oriented instant-publish service (a free
    tier with a short expiry, or a permanent tier through an API key), or a
    fully custom command. Record whichever applies per context, defaulting
    to the local-file option when nothing else is configured or wanted.

## Org interview (≤10 questions)

1. What situations must always escalate to a human rather than being
   resolved autonomously (for example: architecture decisions,
   production-data mutations, spend outside a declared budget)? For each,
   who or what channel should receive the escalation?
2. Are there compliance constraints that apply across every repo in this
   organization (data handling, licensing, access scope) that a skill
   must never route around?
3. Are there billing boundaries beyond any single person's own wall —
   shared or org-scoped runtimes, seat limits, tools only certain roles
   may invoke?
4. Are there repo or branch classes, org-wide, that nobody pushes to
   directly regardless of which repo they're in?
5. Is there a standing incident or escalation channel distinct from the
   day-to-day owner of a piece of work?
6. Anything else that should stop autonomous action across every repo in
   this organization, not covered above?

## Repo interview (≤10 questions)

Before asking, mine what's inferable (see "Infer-First: Mine Before You
Ask," above): git identities and remotes, tracker references in commit/PR/
branch history, CI workflow check names, lint/format configs, package/build
scripts, existing docs, and recent PR history. Bring a draft list of
gotchas, checks, stubs, and tool-mapping candidates you already found to the
interview instead of asking blind — ask to confirm/correct/extend what you
found, not to generate it from nothing.

1. What recurring gotchas trip up a fresh contributor or agent here?
   (List each with a one-line description and, if you have one, a
   pointer to where it's evident.)
2. Are any CI checks known to be quota-dead, rate-limited, or otherwise
   unable to resolve on a useful timeline regardless of the change's
   correctness? Bring the CI check names found while mining as candidates —
   mining surfaces names, it doesn't verdict them — and name each one
   confirmed, plus what should happen when it's pending.
3. Does this repo use local-only stubs or mocks that must never reach a
   real commit? What marks them (a comment tag, a filename convention, a
   flag)?
4. Are there paths that must never be edited without explicit sign-off
   (generated output, vendored dependencies, infrastructure applied
   elsewhere)?
5. Does this repo need extra done-criteria beyond the pack's defaults for
   any work class (a CI change, a deploy-path change, a migration, a
   mobile/device feature)? What's required, specifically?
6. Does an automated reviewer here raise predictable objections that
   already have a settled, correct answer? What's the standing response
   and its reasoning?
7. Does this repo's merge policy differ from your personal default?
8. Are there shared or external resources (a database, a staging
   environment, a shared quota) that more than one lane of work could
   collide on here?
9. Anything else that would make a fresh agent's first change here go
   sideways?

## Validate before writing

After drafting a file, validate it against its schema before writing it
to disk:

1. Confirm every field marked `required` in the schema is present.
2. Confirm no field appears that the schema doesn't declare (all three
   schemas set `additionalProperties: false` — an extra field is a sign
   the answer belongs somewhere else, not a sign to loosen the schema).
3. If a schema validator is available in the environment, run the draft
   through it and treat any error as blocking. If none is available,
   do the field-by-field check by hand against the schema file — don't
   skip validation just because the tooling isn't there.

On a validation failure, don't write a partial or invalid file. Report
the specific field and go back to the relevant question instead.

## Correction-miner step

Run this after the personal interview, or on its own when asked to look
for standing corrections.

1. Scan available sources of recurring correction: a personal memory
   store, prior review comments, notes explicitly marked as "stop doing
   X" or "always do Y" moments.
2. Cluster corrections that recur — a one-off note isn't a candidate rule,
   a correction that shows up more than once across different tasks is.
3. For each cluster, draft a candidate rule in the required anatomy
   (default stance → applicability gate → named exceptions → escape
   hatch — see the authoring guide) rather than a bare restatement of the
   correction.
4. Present the candidates for review. **Never write them directly into a
   live taste-rules file yourself** — this step produces candidates, not
   adopted rules. Adoption is a separate, explicit human decision.

## Report format

When an interview finishes, report:

- Which file(s) were written and their paths.
- The field list that got filled vs. left at a default/placeholder.
- The result of schema validation (pass, or what's still missing), and
  which path produced it: an automated schema validator, or the by-hand
  field check used when no validator was installed. When it fell back to
  the hand check, say so plainly and name what to install to automate it
  next time, so a silent degrade never reads as an automated pass.
- Any answer you refused to write into constants because it was actually
  skill-layer, and where you pointed it instead.
- Which answers came from mining — presented as a prefilled default and then
  confirmed or corrected — versus asked fresh with nothing to go on, so the
  person can see what the interview figured out on its own.
- Any correction-miner candidates produced, clearly separated from the
  interview output above and marked as unadopted.
