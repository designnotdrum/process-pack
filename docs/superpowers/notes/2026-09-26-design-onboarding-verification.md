# Design onboarding verification evidence, 2026-09-26

All scratch work is under `/Users/nick/scratch/process-pack-design-onboarding/`.

## Hook tests over fixture diffs

Each hook's `--dry-run` builds throwaway git repos (with a local bare `origin` for the gate) and prints PASS or FAIL per case. Run on the laptop, 2026-09-26.

The four gate cases the spec names, and the three nudge cases:

```
PASS gate_blocks_ui_change_without_record
PASS gate_blocks_stale_record
PASS gate_passes_docs_only_diff
PASS gate_passes_fresh_record
PASS nudge_ui_without_design_md
PASS nudge_silent_with_design_md
PASS nudge_silent_without_ui
```

Every suite in the branch, one at a time:

```
constants schemas            7 passed
web guardrails               # fail 0   (18 tests)
swiftui guardrails           6 passed
jev client                   11/11 passed
review record                5/5 passed
design common                9/9 passed
nudge hook                   9/9 passed
review gate                  22/22 passed (after the final review fixes)
existing stub-guard          12 passed, 0 failed
existing wall-guard          7 passed, 0 failed
ALL SUITES PASS
```

## Hooks wired into a real session

`claude -p --plugin-dir <worktree>/plugins/process-pack` in the scratch Next.js repo, before onboarding, answered with the nudge line it received at session start: "This repo has UI files and no DESIGN.md (.). Run the design-onboard skill before any UI work." The "(.)" was then reworded to "(repo root)" (commit `8a3c972`).

Timing on real repos (laptop): the nudge takes about 0.1 s on pepino (659 tracked files), Meridian (2,873), and this repo. The gate adds about 40 ms to a Bash command that is not `gh pr create`.

## Jev client, live calls

- **TypeSafe route.** A two-line diff adding a heading, one `noul` question ("This text describes a change to a user interface."): `{"source": "typesafe", "answers": {"ui": {"type": "noul", "noul": 0.96}}, "reason": null}`.
- **OpenRouter route: not run live.** No `OPENROUTER_API_KEY` in the laptop shell, and 1Password was not signed in (`op whoami`: "account is not signed in"). Covered by the stubbed self-test only.

## Existing UI dry run: pepino, read-only

Run by one Opus agent with a read-only brief. Outputs: `pepino-audit/README.md` and its drafts, all in the scratch folder.

Pepino unchanged, checked by me against the record taken before the run:

| | Before | After |
| --- | --- | --- |
| HEAD | `5c56ec81fb71` | `5c56ec81fb71` |
| `git status --porcelain` hash | `c3ee2b39701a` | `c3ee2b39701a` |
| Stash count | 9 | 9 |

Result: recommended branch **polish hard**. Deciding measurement: identity averages 2.6 of 4 (worth keeping), while hierarchy averages 1.8, typography 2.0, and the two core list screens score 1 for density. Jev's second opinion: `{"source": "typesafe", "choice": "polish-hard", "confidence": 0.97}`. Jev read the agent's own summary, so the agreement is not independent evidence.

Top problems found: 440 hardcoded colors in 42 files (412 palette classes); 16 of 82 contrast checks failing (the input border at 1.20:1, white on the destructive color at 3.76:1); list screens that fit 5 to 9 records per screen; `text-sm` used 434 times against the repo's own 16px body rule; agent replies in chat with no marker that says an agent wrote them.

Screens came from saved screenshots in `portfolio-frames/`, not a live run: pepino needs a backend, secrets, and a login. No mobile source existed.

The run found 25 points of friction in the skill and scripts. The ones that were defects are fixed on the branch: the plugin record shape, black and white classes, the missing total line, rounding at the minimum, `@theme` overriding `:root`, stories and generated files counted as UI, and several places where the skill disagreed with impeccable's own flows (commits `be034b8`, `ca1ad2b`).

## Greenfield dry run

Scratch repo: `greenfield/`, created with `create-next-app@16.3.6` (Next.js 16.3.6, React 19.2.8, Tailwind v4).

1. **Preflight:** impeccable 4.4.0, stack `tailwind` detected by dependency, greenfield (starter page only).
2. **Product truth:** impeccable's `init` required one real answer round; Nick picked "freelancer invoicing". PRODUCT.md written with inferences marked.
3. **References:** 8 from Refero and Mobbin (`docs/design/onboarding/references.md`). Inspo was not connected.
4. **First direction round, rejected.** Three hand-written HTML mocks. Jev's taste check flagged all three on decorated buttons or motion (0.56 to 0.70) for a 1px button press; after removing it, every rule scored 0.17 or lower. Nick rejected all three ("lmao I hate all of those"). They shared one stat-tile layout and differed only in tokens. The spec and skill were changed so directions come from impeccable's new-work round (commit `5d4ff33`).
5. **Second round, through impeccable.** Nick's answers to new-work's questions: surface is the Overview; not a generic SaaS dashboard, not precious editorial, not accounting software; success is knowing the next money move in 5 seconds. `concept-seed` (key `5d9d28af`) assigned candidate 7, a departure board. Jev's taste check on the three full cards: every rule 0.29 or lower. On impeccable's decision page Nick picked the design tool inspector card.
6. **Build:** code-led (no image generation). Tokens in `src/app/globals.css`; the color check passes; the contrast test passes 30 of 30 pairs in light and dark; `impeccable detect` found nothing; two inspection rounds at 1440, 1280, 390, and dark.
7. **Finish review.** Impeccable's finish reviewer (Opus) returned fix three times, then ship on the fourth pass. The fixes: frames on one shared hours scale, no nested cards, no small labels above headings, drawn icons instead of Unicode glyphs, selectable invoice layers, real loading, done, error and pressed states, no invented product name, then a true mobile scale (1h is 44px, no minimum). Evidence: `greenfield/.impeccable/review/` (11 captures).
8. **DESIGN.md.** Written by impeccable's documenter (with `.impeccable/design.json`) from the shipped build. One wording fix by hand: it called the mobile scale unit a floor.
9. **Guardrails:** three UI Skills installed with `skills@1.7.0`, each pinned in `skills-lock.json`: `fixing-accessibility` at `f9515cb9`, `web-design-guidelines` at `063bee94`, `better-typography` at `267330e1`. A design section in AGENTS.md; `.process/repo.yaml` validates against the schema; `pnpm lint` passes.

The greenfield run also found a real bug: the contrast parser read no tokens from any stylesheet that starts with `@import "tailwindcss"` (fixed in `8c459e2`).

## Gate run: blocked, reviewed, let through

Scratch branch `feat/log-time-label` in `greenfield/`, one UI commit `5220cfc` (the top bar button "Log time" becomes "Start timer"). The payload is exactly what Claude Code sends for `gh pr create --fill --base main --draft`.

| Step | Gate exit | Output |
| --- | --- | --- |
| No review yet | 2 | "This branch changes UI files (1 files) and has no design review. Run the design-review skill, then retry gh pr create." |
| After the `design-review` skill wrote a record for `5220cfc` | 0 | (none) |
| After a further UI commit on top of the review | 2 | "This branch changed UI files after the design review at 5220cfc: src/app/page.tsx. Run the design-review skill again, then retry gh pr create." |

The review followed the skill: the Overview screenshotted at 1440, 390, and 1440 dark; no findings to fix; the record written with `review_record.py write` to `.git/process-pack/design-reviews/feat__log-time-label.json`.

The same gate also blocked inside a real headless session (`claude -p --plugin-dir <worktree>/plugins/process-pack`): its Jev shadow log has three block lines for that branch (Jev 0.58 to 0.68 that the diff changes what users see). That run was stopped by hand: Nick's global `~/.claude/hooks/pr-review-gate.sh` also fires on `gh pr create`, and the headless session started committing refactors to satisfy it. The branch was reset. `gh pr create` itself was not run past the gate, because the only remote is a local bare repo.

Jev shadow lines for the three direct runs: allow 0.97, then block 0.97, each with `source: typesafe`. The run also showed the shadow line recorded HEAD at the time it ran rather than the commit the gate decided on; fixed with a test in `4e5dd17`.
