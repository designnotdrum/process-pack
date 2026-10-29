# process-pack

process-pack is a Claude Code plugin for running work across several agents at once. Your agents get skills for writing delegate briefs, giving each file one owner, checking evidence before work is called done, and stopping at billing or permission walls instead of working around them. It also sets up a design system in a new repo, and can keep Storybook and Figma in step with your components after each release.

Everything specific to you, such as git identities, model tiers, your tracker and a repo's known hazards, goes in small constants files you generate once. The skills name no person, repo or company, so the same pack works for anyone who installs it.

**Status:** version 1.5.0. A pilot took one production ticket from recon through three review rounds to merge, with one process correction ([`PILOT-SCORECARD.md`](plugins/process-pack/docs/PILOT-SCORECARD.md)). There are 26 test fixtures. F01 to F18 have a recorded replay pass; F19 to F26 were added later and have not been replayed ([`REPLAY-REPORT.md`](plugins/process-pack/docs/REPLAY-REPORT.md)).

## Install

1. Add the marketplace and install the plugin in Claude Code:

   ```
   /plugin marketplace add designnotdrum/process-pack
   /plugin install process-pack@process-pack
   ```

   You can install it into more than one config directory, for example separate personal and work setups.

2. Generate your constants by asking your agent:

   ```
   Use the pp-init skill to set up my constants.
   ```

   `pp-init` reads what it can from the repo you point it at (git identities, remotes, tracker references, CI check names, lint config) and asks you to confirm each answer instead of asking from scratch. It takes about ten minutes and writes three files:

   | File | Covers | Location | Committed? |
   |---|---|---|---|
   | `personal.yaml` | you | `~/.config/process-pack/` | never |
   | `org.yaml` | your org | `~/.config/process-pack/` | never |
   | `.process/repo.yaml` | one repo | inside that repo | yes, it describes the repo |

3. Work as you normally do. The skills start on their own triggers. When you ask for a delegate, `dispatch-brief` writes the brief. When you run two lanes, `lane-planner` builds the ownership table. When you call something done, `verification-gates` checks the evidence.

Run `pp-init` again for a repo when its hazards change. It also reads your repeated corrections and proposes them as new standing rules.

## How skills read your constants

A skill says "file work through the tracker in your constants." Your constants say "tickets are in Linear, workspace `acme`." The skill never names Linear, so it works unchanged for the next person, and your constants never leave your machine.

- Skills look in `.process/repo.yaml` in the current repo first, then in `~/.config/process-pack/*.yaml`.
- [`constants/schemas/`](plugins/process-pack/constants/schemas/) holds the exact shape of each file. `pp-init` checks your drafts against them before writing.
- [`constants/examples/`](plugins/process-pack/constants/examples/) holds a filled-in example of every field, with made-up names.
- Constants hold names and labels only, never secrets.

## What the skills do

There are 17 skills. They are grouped here by the problem they solve.

### Hand work to delegates without collisions

- **`lane-planner`**: before more than one delegate works in a repo, builds the table of who owns which files, which phase each lane is in, and the merge order.
- **`dispatch-brief`**: writes the brief for any delegate. It covers isolation, checking before acting, what never to wait on, merge policy, what to do instead of stalling, the report format and what is out of scope.
- **`stub-first-planning`**: before a long spec or plan goes to a person for approval, writes a short version with five problems and five solutions. The person approves that, then the full version is written and reviewed.
- **`resource-wall-preflight`**: before any command that touches an external account or billing, confirms which wallet, org and identity it will use. It stops at the wall instead of finding a way around it.

### Know the real state of every lane

- **`lane-board`**: keeps `board.json` as the one record of lane state, written on every change. It survives context compaction and works as a standup summary.
- **`notification-triage`**: sorts each delegate completion into done with evidence, stalled, failed or suspect before anything is reported as done. A delegate that says "waiting for my monitor" is resumed, not reported as finished.
- **Board viewer** ([`board-viewer/`](plugins/process-pack/board-viewer/)): shows one `board.json` as a Gantt chart of lanes over time and as a Kanban board by state. It can be published as a single file to check from a phone.

### Ship only what is verified

- **`root-cause-first`**: no fix ships without a stated cause. A disproved hypothesis counts as progress.
- **`verification-gates`**: defines done for each kind of work: a CI change, a flaky test fix, a design round, a UI change, a removal or migration. It also requires an adversarial review before merge. A UI change needs a narrated recording showing the reported problem no longer happens, on a pinned deployment, with readiness checked on the feature itself.
- **`feedback-triage`**: sorts every review item into one of four buckets before work starts, so parked items are not quietly rebuilt.
- **`fix-what-you-find`**: when a defect turns up in work that is already open, fixes it there instead of filing a ticket. Filing is allowed only for a human decision, missing access, a lane collision or real size. "Out of scope", "pre-existing" and "non-blocking" do not count.
- **`escalation-policy`**: names the decisions that always stop for a person, and how to bring in a top-tier model for one named decision instead of running the whole session on it.
- **Evidence recorder** ([`tools/evidence-recorder/`](plugins/process-pack/tools/evidence-recorder/)): records a browser scenario as narrated video for a pull request, which is what `verification-gates` asks for on a UI change. Each scenario must define a `ready()` check that only the working feature can pass. If it fails, the recorder saves a failure frame and refuses to record, so you never get a video of a loading screen. Run `examples/demo.scenario.ts` against the bundled page to see a finished recording in about a minute, with no sign-in.

### Keep your standards from one session to the next

- **`taste-rules`**: reads your standing corrections from constants (merge policy, style rules, reuse existing patterns) and adds them to every brief and review.
- **`tuning-playground`**: when a design direction is at the polish stage, turns the prototype's tokens into a small panel of controls a designer adjusts by eye. What they settle on goes back into the tokens and the taste rules.
- **`desk-research`**: before you commit to a technical or design direction, gathers prior art into a source list, a summary and candidate directions.
- **`pp-init`**: the setup interview above, plus the step that turns repeated corrections into proposed rules.

### Start a repo with a real design system

UI work in a new repo tends to look like library defaults for its first several sessions, with each screen picking its own values and nobody reviewing the result. These pieces fix that in any repo, with [impeccable](https://github.com/pbakaus/impeccable) as the design engine.

- **Your design rules, written once.** `~/.config/process-pack/design-taste.yaml` holds looks to avoid, a quality floor, color rules, an accessibility floor, copy rules and a critique method. Schema: `constants/schemas/design-taste.schema.json`. Example: `constants/examples/design-taste.yaml`. Onboarding copies the rules into each repo, so cloud agents that cannot read your home directory still follow them.
- **`design-onboard`** runs impeccable's setup, then one of two paths.
  - A repo with no UI gets references, impeccable's direction round (a proposed direction, alternatives and impeccable's own pick on a decision page) and a DESIGN.md with real tokens.
  - A repo with UI gets an audit, a benchmark and a recommendation: keep the current look, polish it, or change direction with a written case for the change.
  - Both paths end with guardrails: a check that blocks hardcoded colors, a contrast test, 3 to 5 UI Skills installed at a pinned commit with the `skills` CLI, and design rules in AGENTS.md. The last step offers Klaus (below).
- **`design-review`** screenshots the screens a branch changes, runs the review method, impeccable's critique and the repo's accessibility scan, fixes what it finds in at most two rounds, and writes a review record.
- **Jev** ([`tools/jev/`](plugins/process-pack/tools/jev/)) gives a second opinion in three places: which path an existing UI should take, whether a direction mock uses a look your rules ban, and, in shadow mode only, whether a diff changes what users see. It uses `TYPESAFE_API_KEY`, falls back to OpenRouter's `typesafe/jev-router` when only `OPENROUTER_API_KEY` is set, and makes no call when neither is set.

Stacks with automated checks: Tailwind and shadcn, plain CSS (with Vue, Svelte and Astro), and SwiftUI. Any other stack gets a DESIGN.md without the checks, and onboarding says so.

### Keep Storybook and Figma in step with your components

Klaus ([`tools/klaus/`](plugins/process-pack/tools/klaus/)) keeps a list of every UI component a repo ships. After each release it writes those components to Storybook and Figma. Your code and DESIGN.md stay the source of truth. `design-onboard` offers Klaus as its last, optional step, shows every cost before anything is turned on, and copies it into the repo as `scripts/klaus/`, where it runs with plain `node` and no build step.

- **Agents reuse components instead of making duplicates.** `klaus find "<what the component is for>"` lists what the repo already has for that purpose before an agent writes a new one. It uses no model.
- **A baseline in three pull requests.** The onboarding run opens three stacked pull requests: the component list with likely duplicates and the questions it cannot settle, a purpose comment on each component, and a story for each component that has none. Nothing is merged for you. Rerun it with `--refresh` after the first pull request merges.
- **Every release gets versions.** Klaus picks a version for each component from what changed in the release, using the diff and a pixel comparison of the stories. It uses no model.
- **Storybook stays current.** After each release it builds Storybook and deploys it to Vercel.
- **Figma gets a component set per version.** Each Storybook story becomes a variant, with shadows, gradients, filters, open overlays and the component's own padding drawn as the browser drew them. A repo's first large load goes through the Klaus Figma plugin, which uses no tokens. Later releases go through a relay that sends each version through a signed-in agent. Older versions move to an `Older versions` page with their colors frozen.
- **Spending has a cap.** Each output in each run defaults to 50 component writes and 500,000 relay tokens. Over the cap, the most-used components go first and the rest wait for the next run. Going over never fails a run. `--dry-run` prints the estimate without writing anything.
- **It runs in CI.** A GitHub Actions template runs Klaus after each release tag, on a schedule or by hand. Secrets can be kept in a GitHub environment that only the default branch and release tags can use.

Penpot and Pencil outputs are planned and not built yet ([#31](https://github.com/designnotdrum/process-pack/issues/31), [#32](https://github.com/designnotdrum/process-pack/issues/32)). Each part has its own README under `tools/klaus/`.

## Hooks

Hooks enforce rules the model cannot skip.

| Hook | Runs on | What it does | How it is registered |
|---|---|---|---|
| `wall-guard` | `PreToolUse`, Bash | Blocks a command that uses one config directory's runtime from another's session, such as personal from work. An allowlist covers real exceptions. | by hand in `settings.json` |
| `stub-guard` | `PreToolUse`, `git commit` | Searches the staged diff for the local-only stub markers your repo declares and blocks the commit with the list of files. | by hand in `settings.json` |
| `design-onboard-nudge` | `SessionStart` | In a repo with UI files and no DESIGN.md, tells the agent to run `design-onboard` first. Never blocks. | automatically, by the plugin |
| `design-review-gate` | `PreToolUse`, `gh pr create` | Blocks a pull request that changes UI files until `design-review` has recorded a review of the branch's latest UI commit. Applies only in repos onboarded for design, so client and open-source repos are never blocked. | automatically, by the plugin |

Each hook's README under [`plugins/process-pack/hooks/`](plugins/process-pack/hooks/) has its setup.

Enforcement works in Claude Code only, on a laptop or in Cyrus. The skills, scripts and hook decisions are written so that Codex, OpenCode or pi can be added later with a small adapter each.

## Requirements

- **Claude Code**, or any harness that loads Claude Code plugins and skills.
- **Python 3** for the hooks.
- **impeccable 4.3 or later** for `design-onboard`. It stops and tells you how to update when it finds an older version.
- **Node 22 and git** for Klaus. The Figma output needs a Figma seat that can run plugins in Design files ([`adapters/figma/README.md`](plugins/process-pack/tools/klaus/adapters/figma/README.md)). The Storybook output needs a Vercel project.
- **Playwright** for the evidence recorder.
- **A capable reasoning model.** The skills do not assume a specific model. The pilot ran on a top-tier model, with cheaper models doing the delegated work.

## Adding or changing a skill

Read [`docs/authoring.md`](plugins/process-pack/docs/authoring.md) first. Three rules matter most.

1. **No proper nouns in skill text.** If a sentence stops making sense when you swap in a different person, repo or org, it belongs in a constants file.
2. **A skill ships only when it passes its fixtures.** A top-tier model, given only the skill's text and a test fixture, has to make the call the rubric expects. If it does not, change the skill, never the fixture.

3. **Docs follow [`docs/agents/docs-voice.md`](docs/agents/docs-voice.md).** In Claude Code, Codex and OpenCode, a check in this repo blocks `gh pr create` until the docs have been checked against your branch.

More docs:

- [`docs/case-studies.md`](plugins/process-pack/docs/case-studies.md): real sessions kept as worked examples.
- [`docs/migration-notes.md`](plugins/process-pack/docs/migration-notes.md): which earlier standalone skills this pack replaces.
- [`docs/PILOT-SCORECARD.md`](plugins/process-pack/docs/PILOT-SCORECARD.md): the first real run, scored.
- [`docs/REPLAY-REPORT.md`](plugins/process-pack/docs/REPLAY-REPORT.md): F01 to F18, replayed and scored.
