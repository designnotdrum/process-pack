# Migration notes

Non-normative. This tracks what in this pack supersedes what, and when the
superseded originals go away. It does not govern behavior — the skills do.

## What supersedes what

| Loose skill (pre-pack) | Superseded by | Notes |
|---|---|---|
| `briefing-delegates` | `dispatch-brief` | 37-line seed expanded to the full ten-block contract, plus the relayed-authority rule the seed didn't cover. Content carried forward: the sizing distinction (inline vs. file-based vs. trivial-task brief), the "verify done-criteria yourself" rule, the red-flags list. Dropped: nothing substantive — the seed's contract items map 1:1 onto blocks 1-2-3-9-... below, just abstracted to remove the identifying references the seed carried inline (specific tool names, a specific loop-count number from a specific incident). |
| `babysit` | `notification-triage` | The seed's escalation ladder and resource-governor content is preserved conceptually; the four-way classification (DONE-WITH-EVIDENCE / STALLED / FAILED / SUSPECT) is new structure this pack adds on top of it — the seed only had "stalled or not," this pack adds the FAILED/SUSPECT split so a bad report and a suspicious report aren't both funneled through the same "stalled" handling. Dropped: the seed's specific resource-count guidance (how many heavy local processes can run at once) — that's an environment-specific number and belongs in repo/personal constants, not in generic skill prose. |
| `sitrep` + `handoff-protocol` | `lane-board` (not owned by this lane) | Absorbs the live-work-inventory use case formerly covered by a separate `fleet` skill, and references the return-briefing cadence formerly covered by a separate `mind-the-wait` skill. Out of scope here — tracked for completeness since it's part of the same supersession wave. |

`lane-planner` has no loose-skill predecessor — it's new. Nothing in the
pre-pack skill set produced a lane table with one-owner-per-file and phase
gating before dispatch; work lists were planned ad hoc.

## Deletion timing

Superseded loose-directory skills are **not** deleted on this lane landing.
They stay in place through the adversarial-review phase and the pilot task.
Only after the pilot passes against the fixture rubric do the superseded
originals get deleted from the loose skills directory — deleting early would
leave a gap if a pack skill turns out to have a fixture-revealed hole the
loose original didn't have.

## Two-layer rule reminder for anyone editing these three skills later

Skill prose here stays generic: second person, zero proper nouns, no
concrete model names, no concrete tool/product names — delegate types are
described by role ("in-session subagent," "cross-context delegate," "mesh
peer") rather than by naming a specific runtime. Anything person-, repo-, or
org-specific belongs in a constants scope and gets referenced by scope name
("the never-wait list from repo constants," "your identity constants
scope"), never inlined as a concrete value. If a future edit needs to name a
specific tool to make a rule land, that's a sign the rule belongs in a
constants file or a case study, not in skill normative text.
