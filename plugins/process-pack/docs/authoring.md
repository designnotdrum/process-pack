# Authoring a skill for this pack

This guide is the contract for anyone writing or editing a skill in this
pack. It is itself normative text, so it follows its own rules: second
person, zero proper nouns, no secrets.

## The two-layer rule

Skill text is generic. Constants carry the specifics.

- **Skills** describe a behavior anyone in any context should follow the
  same way: a procedure, a gate, a default stance. Written in second
  person, role-agnostic, with zero proper nouns in the normative text —
  no person names, product names, model names, repo names, or
  organization names.
- **Constants** (three scopes: personal, repo, org — see the schemas in
  `constants/schemas/`) carry every fact specific to one person, one
  repo, or one organization: identities, walls, gate extensions, escalation
  targets. Constants never contain secrets — names and labels only.

Before you write a sentence into a skill, run this test:

1. **Would this sentence still be true if you swapped in a different
   person, repo, or organization?** If yes, it belongs in the skill. If
   the sentence stops making sense without a specific name in it, it
   belongs in a constants file instead.
2. **Is this a fact about a specific entity** (an identity, an account, a
   threshold, an escalation contact, a repo's own gotcha)? That's a
   constant, never skill prose.
3. **Is this a behavior everyone should follow the same way** regardless
   of who they are or which repo they're in? That's skill prose, never a
   constant.

A skill that fails test 1 is a spec violation, not a style nit — it means
the skill only works for one person's setup and can't travel. A constants
file that fails test 3 (i.e., it encodes a generic procedure instead of a
specific fact) means you've put process where data belongs; move it into
a skill and leave the constants file holding only the fact.

## Required anatomy

Every skill that encodes a standing rule (a gate, a default behavior, a
"do this unless") states four things, in this order:

1. **Default stance** — the strong-form behavior that applies unless
   proven otherwise, in one sentence. State it as a rule, not a
   suggestion: "never squash a merge," not "squashing is usually
   discouraged."
2. **Applicability gate** — the concrete, checkable condition that
   justifies the strong form in this situation. Not "use judgment" — a
   test the reader can actually run: a file pattern, a check name, a
   declared work class, a value read from a constants file.
3. **Named exceptions** — the specific, enumerated conditions under which
   the default stance doesn't hold. Every exception is named explicitly;
   an unnamed catch-all ("unless it doesn't make sense") is not an
   exception, it's a hole. If a real exception can't be named yet, say so
   and route it to the escalation path instead of leaving it implicit.
4. **Escape hatch** — how a human grants an explicit, in-session exception
   that isn't covered by a named exception. The escape hatch requires
   explicit permission in the moment; a delegate does not infer one on
   its own from context.

Worked shape, using a merge-strategy rule as the running example (the
specific strategy itself is a constant; this is the skill-side shape
around it):

```
Default stance:      never squash a merge; use a real merge commit.
Applicability gate:  applies whenever the branch being merged came from
                     more than one commit intended to stay legible in
                     history (check: does the PR's own description or
                     commit log say so?).
Named exceptions:    a single-commit typo-fix PR where the author
                     explicitly requested squash in the PR description.
Escape hatch:        the human merging the PR states "squash this one"
                     in the merge instruction itself.
```

Workflow skills that describe a multi-step procedure rather than a single
rule (an interview flow, a research protocol) don't need all four labels
verbatim, but they still state a default path, the condition that departs
from it, and what a human can override — the anatomy is the same shape at
a coarser grain.

## Zero proper nouns

Normative skill and doc text contains zero proper nouns: no person names
(including informal or alternate names), no product or assistant names,
no model family names, no repo names, no organization names. Write in second person
("you," "your delegate") and describe roles, not identities ("the
delegate," "the orchestrator," "the reviewer") — never a real name
standing in for a role.

This rule does not apply to `constants/` (schemas describe structure only
and are already noun-free; the worked examples under `constants/examples/`
are explicitly where real names belong) or to `fixtures/` (situation
files are redacted transcripts and may reference the real names present
in the source material being replayed).

Self-check before every PR touching skill or doc text:

```
grep -riE "<term1|term2|term3|...>" plugins/process-pack/skills plugins/process-pack/docs
```

Build the alternation from every proper noun that actually appears in
your own context before running it: your name and any informal or
alternate names, the assistant/product names you use, model family
names, your organization/company names, and any repo names. The list is
instance-specific — this guide can't ship it prefilled without itself
violating the rule it's describing. A clean run returns nothing. Any hit
outside `constants/` or `fixtures/` is a violation to fix before merge,
not a warning to note and move past.

## Fixture-driven acceptance

A skill ships only when it passes replay against this pack's golden
fixtures: paired situation files (a redacted transcript excerpt or
synthetic state) and an expected-behavior rubric. The bar: a top-tier,
frontier-class reasoning model given **only** the skill's text plus the
fixture makes the rubric's call, with nothing else in context to lean
on. If it
doesn't, the skill's applicability gate or named exceptions are
underspecified — fix the skill, not the fixture.

Practical checklist for a skill PR:

- [ ] Every fixture that names this skill as relevant has been replayed
      against the skill in isolation (skill text + fixture only).
- [ ] The rubric's expected call was made, not a plausible-sounding
      adjacent call.
- [ ] A failed replay was fixed by tightening the skill's applicability
      gate or naming a missing exception — not by editing the fixture to
      match whatever the skill currently does.
- [ ] The zero-proper-nouns grep (above) is clean.
- [ ] Every fact the skill references from constants is read from a
      constants file at the correct scope, not hardcoded.
