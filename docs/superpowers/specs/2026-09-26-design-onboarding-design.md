# Design onboarding for new and existing repos

Date: 2026-09-26. Status: approved by Nick on 2026-09-26. Revised the same day: UI Skills install path (after evaluating both CLIs) and the portability rules.

## Problem

UI work in the Meridian repo (`designnotdrum/component-monkey-app`) comes out close to shippable on the first pass. UI work in a new repo does not: for the first several sessions the output looks like library defaults, each screen invents its own values, UX judgment is weak (hierarchy, missing states, clumsy copy), and nothing reviews the result, so Nick becomes the reviewer.

An inventory of Meridian on 2026-09-26 found that its quality comes from five layers, and a new repo gets only the first:

1. The impeccable plugin, installed globally. Its PostToolUse and Stop hooks run in every repo. Its init flow writes PRODUCT.md only when invoked, and never writes DESIGN.md (source: `reference/init.md` in impeccable 4.0.4).
2. PRODUCT.md and DESIGN.md with real content: users, products to emulate, products to avoid looking like, tokens, type, principles. Nothing creates these on day one of a new repo.
3. Enforced tokens: `packages/ui` has semantic tokens, Storybook with Chromatic, and Jest tests that fail on hardcoded colors or low contrast (`design-tokens-contrast.test.ts`, `status-uses-state-tokens.test.ts`). These tests cover `packages/ui` only, not app code.
4. Repo skills for patterns and UX (`design-first`, `ui-copy`, popover and toast patterns) made mandatory by hard rules in AGENTS.md.
5. A review loop: a `design-reviewer` agent that exists only in Meridian's `.claude/agents`, plus global `preview-qa` and `qa-brief` skills that assume Vercel and Clerk.

## Goal

Any repo Nick works in reaches Meridian-level design quality within its first sessions, without Nick nitpicking. This covers Next.js with Tailwind and shadcn, marketing and portfolio sites, other stacks (Swift, Vue, Svelte), and client repos.

## Decisions

- 2026-09-26: The tooling lives inside the process-pack plugin (this repo), not a new plugin and not loose files in `~/.claude`.
- 2026-09-26: Impeccable stays the design engine. This plugin orchestrates it and fills its gaps. It does not fork impeccable's flows.
- 2026-09-26: PRODUCT.md, DESIGN.md, and the other design docs are committed in every repo, client repos included.
- 2026-09-26: Onboarding starts from a SessionStart hook that tells the agent to run it, plus a skill Nick can invoke directly. It never blocks edits.
- 2026-09-26: Visual identity comes from Nick's design taste rules plus a choice between 2 or 3 rendered direction mocks.
- 2026-09-26: Reference products are chosen per repo from what the work needs. The design taste file holds no default references.
- 2026-09-26: A repo with an existing UI is audited first, then takes one of three branches: lean in, polish hard, or new direction. Both change branches produce a written case for the change.
- 2026-09-26: Inspo MCP and the UI Skills registry are part of the flow.
- 2026-09-26: The design review is enforced before `gh pr create` on any diff with UI changes.
- 2026-09-26: Enforcement targets Claude Code only (laptop sessions and Cyrus). No GitHub Action.
- 2026-09-26: UI Skills are found with the `ui-skills` CLI and installed with the `skills` CLI at a pinned commit. No hand-written downloader.
- 2026-09-26: The skills, scripts, and hook logic are written so that other agents (Codex, OpenCode, pi) can be supported later by adding thin adapters, not by rewriting. Claude Code stays the only harness wired and tested in this build. See "Portability".
- 2026-09-26: Jev (TypeSafe's model) adds three checks where file patterns or one agent's judgment can be wrong: a second check in the review gate, a second opinion on the existing-UI branch, and a taste check on the direction mocks. The gate check starts in shadow mode. See "Jev checks".

## External tools

- **Impeccable** (`pbakaus/impeccable`). Installed: 4.0.4. Latest release: `skill-v4.3.1`, 2026-09-09; a 4.4.0 is being prepared (source: `gh api repos/pbakaus/impeccable/releases` and its latest commit, read 2026-09-26). Relevant changes since 4.0.4: in 4.2.3, monorepo hooks use each app's own DESIGN.md; in 4.2.0, "a downstream package can add its own rules without forking". Whether the Claude plugin exposes that rule API is unverified.
- **Inspo MCP** (`Nutlope/inspo`, MIT). 2,320 pages across 832 real sites, each with an extracted DESIGN.md, 68 reference components, and a `recommend(brief)` tool. Install with `npx -y inspo-mcp install` or `claude mcp add --transport http inspo https://inspomcp.dev/api/mcp` (source: the repo README, read 2026-09-26). Strongest for marketing and site pages.
- **Refero and Mobbin MCPs**, already configured on the laptop. Strongest for app screens and flows.
- **UI Skills** (`ui-skills.com`). A registry of 315 third-party skills. CLI: `npx ui-skills start`, `categories`, `list --category <c>`, `get <slug>`. A plain registry at `/skills/registry.txt` maps each slug to a raw GitHub URL on the author's `main` branch. There is also an MCP server. Its router skill `ibelick/ui-skills-root` prefers one skill per task and never more than three (source: ui-skills.com `llms.txt`, `/cli`, and `registry.txt`, read 2026-09-26).
  - The `ui-skills` CLI is for finding skills only. Evaluated 2026-09-26 on version 0.2.4 by reading its package source and running it in a scratch folder. It has no install command. `get` prints one SKILL.md to stdout, fetched live from the author's `main` branch by the ui-skills.com server, with no version or commit. It drops a skill's other files: `ibelick/improve-ui` tells the agent to read `references/plan-template.md`, and `get` does not deliver that file.
- **The `skills` CLI** (`vercel-labs/skills`, npm `skills`, version 1.7.0 evaluated 2026-09-26 in a scratch git repo). This is the install path. Findings from running it:
  - `npx skills add <owner>/<repo>#<commit> --skill <name> --agent <ids> --copy -y` installs the whole skill directory, including `references/` and `agents/` files.
  - The `#<commit>` pin works. Installing `ibelick/ui-skills-root` at `4ebfe60` produced that commit's content, not `main`'s, and `skills-lock.json` recorded `"ref": "4ebfe60…"`. The `tree/<commit>/<path>` URL form behaves the same.
  - The lock file records `source`, `ref`, `skillPath`, and a `computedHash` of the content. `npx skills experimental_install` restores from it.
  - A project install writes to `.agents/skills/<name>/`, which 22 of its agent definitions share, including `codex`, `opencode`, `pi`, and `cursor`. Adding `claude-code` also writes `.claude/skills/<name>/`.
  - It sends install telemetry to `add-skill.vercel.sh`. Its source reads `DO_NOT_TRACK` and `DISABLE_TELEMETRY`; that setting either one stops the request is unverified.
  - A registry entry that is not on GitHub (for example `rams/rams`, served from `rams.ai`) cannot be installed or pinned this way.

## Components

All paths are under `plugins/process-pack/` unless stated.

### 1. The design taste file

- Nick's real file: `~/.config/process-pack/design-taste.yaml`, beside the existing `personal.yaml`. Never committed to this repo.
- The plugin ships an anonymized example at `constants/examples/design-taste.yaml` and a schema at `constants/schemas/design-taste.schema.json`.
- Every rule follows the anatomy in the `taste-rules` skill: default stance, applicability gate, named exceptions, escape hatch.
- Six sections:
  1. Looks to avoid: no purple gradients or neon accents, no glassmorphism or heavy backdrop blur, no gradient text, no centered SaaS landing stacks, library defaults are a starting point only.
  2. Craft floor: at least three type levels; hover, focus, active, and disabled states on every interactive element; empty, loading, and error states on every data surface.
  3. Color discipline: every color comes from a token; every non-neutral color states what it tells the user; status is never shown by hue alone.
  4. Accessibility floor: WCAG 2.2 AA in every theme; `prefers-reduced-motion` respected.
  5. Copy: sentence case, no em dashes, copy never restates its own label. Points at the global skills `patterns-sentence-case-ui-copy`, `voice-guide`, and the `ui-copy` method rather than copying them.
  6. Critique method: the eight dimensions from Meridian's `design-first` skill (hierarchy, identity, containment and space, typography, color, density and rhythm, motion and state, consistency), with every point carrying a concrete fix.
- Seeded from Meridian's PRODUCT.md, DESIGN.md principles, and its `design-first` and `ui-copy` skills, keeping only what is not Meridian's brand. Nick reviews the seeded draft before any skill reads it.
- Onboarding copies the applicable rules into the repo's PRODUCT.md and AGENTS.md. It never links to the home-directory file, because Codex cloud and Cursor cannot read it.

### 2. The `design-onboard` skill

`skills/design-onboard/SKILL.md`, with one reference file per stack under `skills/design-onboard/stacks/`.

Steps shared by both paths:

1. **Preflight.** Read the installed impeccable version. Below 4.3, stop with the upgrade instruction. Detect the stack, whether the repo is an app or a site, and each app in a monorepo. Detect whether a UI already exists.
2. **Product truth.** Run impeccable's init to write or update PRODUCT.md.

Greenfield path (no existing UI):

3. **Design taste.** Load the design taste file and fold its rules into PRODUCT.md's principles and its list of looks to avoid.
4. **References.** Run the `desk-research` skill against Inspo, Refero, and Mobbin, briefed from PRODUCT.md's users, register, and category. Output: 6 to 10 references, each with one line on why it fits this work.
5. **Directions.** Render 2 or 3 direction mocks as HTML under `docs/design/onboarding/`, screenshot them, and ask Nick to pick (in Claude Code, through `AskUserQuestion`). This is the only required stop.
6. **System.** Run impeccable's new-work flow to write DESIGN.md from the chosen direction. The stack reference file turns it into real tokens.

Existing-UI path:

3. **Audit.** Run impeccable's document flow to record the current system as a draft DESIGN.md. Screenshot 3 to 5 key screens. Run impeccable's critique and audit against the design taste rules to score each screen and rank problems. Pull 3 to 5 comparable products from Inspo, Refero, or Mobbin as a benchmark.
4. **Recommend one branch.** Nick decides.

| Branch | When it fits | Output |
| --- | --- | --- |
| Lean in | The UI is coherent; problems are craft debt | The recorded DESIGN.md becomes the authority; guardrails codify it; debt becomes tickets |
| Polish hard | The identity is worth keeping; hierarchy, type, spacing, or states fall short | Identity kept; a ranked fix list (structure, then tokens, then components, then polish); before and after renders of 2 or 3 key screens |
| New direction | The identity is generic or wrong for the users | Greenfield steps 4 to 6, plus a migration plan: which screens move first and how old and new coexist |

5. **The case for the change.** Both change branches write `docs/design/evolution/README.md`, readable cold by a client or stakeholder: current audit scores and top problems on real screenshots; before and after renders of the same screens with benchmark products; cost as screens touched, a t-shirt size, and phasing; risks (relearning, brand equity, regressions) each with a mitigation; one recommendation and the measurement that decided it. Lean in writes one line saying why.

Final step for both paths:

7. **Guardrails.** Apply the stack reference file's check that blocks hardcoded colors, and its contrast check. Pick 3 to 5 UI Skills for the stack and product with `npx ui-skills list --category <c>`, always including an accessibility scan skill. For each, resolve the source repo's current `main` to a commit SHA, then install it with `npx skills add <owner>/<repo>#<sha> --skill <name> --agent claude-code codex opencode pi --copy -y`. The files land in `.agents/skills/<name>/` and `.claude/skills/<name>/`, and `skills-lock.json` records each pin. Skip any pick that is not on GitHub and pick another. Commit the skill directories and `skills-lock.json`. Add a design section to AGENTS.md whose hard rules point at the design skills. Record the onboarding date, impeccable version, branch taken, and the reason each skill was picked in `.process/repo.yaml`; the commit for each skill lives in `skills-lock.json` only. Commit all of it.

Impeccable is the only writer of DESIGN.md. UI Skills' own `ibelick/create-design-md` is not used.

### 3. Stack reference files

Each file answers: how to detect the stack, where tokens go, what blocks hardcoded colors, and how contrast is checked.

| Stack | Tokens | Blocks hardcoded colors | Contrast check |
| --- | --- | --- | --- |
| Tailwind and shadcn | CSS variables in the theme (v3 config or v4 `@theme`) | Lint rule banning palette classes such as `text-orange-600` and hex values across all app code | A test ported from Meridian's `design-tokens-contrast.test.ts` |
| Plain CSS, Vue, Svelte | A custom-properties file | Stylelint rule banning literal color values | The same test pointed at that file |
| SwiftUI | Asset catalog colors and a theme type | SwiftLint custom rule banning color literals | A script over the asset catalog |
| Anything else | DESIGN.md only | None, stated plainly in the onboarding output | None |

If impeccable's rule engine accepts custom rules, the check that blocks hardcoded colors is written there instead, so it also runs in impeccable's edit hook. Build order is Tailwind, then plain CSS, then SwiftUI.

### 4. The `design-reviewer` agent and `design-review` skill

- `skills/design-review/reviewer.md`, promoted from Meridian's `.claude/agents/design-reviewer.md` with Meridian specifics removed. `agents/design-reviewer.md` is a thin Claude Code wrapper around it (see "Portability").
- `skills/design-review/SKILL.md` drives it:
  1. Read DESIGN.md, PRODUCT.md, and the AGENTS.md design rules.
  2. Find the screens the diff touches. Run the app locally (the `run` skill) or use a preview URL.
  3. Screenshot each screen at desktop and mobile widths.
  4. Run impeccable's critique and the vendored accessibility scan skill.
  5. Fix what it finds. At most two fix rounds; anything left is listed, never dropped.
  6. Write the review record (below) and hand the summary and screenshots to the `qa-brief` flow for the PR body.
- Review record: `.git/process-pack/design-reviews/<branch>.json`, local to the clone and never committed. Fields: branch, reviewed commit SHA, UI files reviewed, findings fixed, findings left, and screenshot paths.

### 5. Hooks

Written in Python like the existing `hooks/stub-guard` and `hooks/wall-guard`, each with a README, an example config, and tests.

- **`hooks/design-onboard-nudge`, SessionStart.** If the repo has UI files (per the stack detection) and no DESIGN.md, emit one line of additional context telling the agent to run `design-onboard` before UI work. Silent otherwise. Never blocks.
- **`hooks/design-review-gate`, PreToolUse on Bash matching `gh pr create`.** Compute the diff against the base branch. If it touches UI files and either no review record exists for the branch, or a UI file changed after the reviewed commit, block with one line naming the `design-review` skill. UI file patterns come from the stack reference file and can be overridden in `.process/repo.yaml`. Named exceptions: diffs that touch only docs, tests, or config. Escape hatch: Nick says so in the session, recorded as a skip reason in the review record.
- The gate is separate from `~/.claude/hooks/pr-review-gate.sh`, which stays unchanged.

### 6. Portability

Claude Code is the only harness wired and tested in this build. These rules keep a later port to Codex, OpenCode, or pi down to adapters:

- **Skills.** SKILL.md files use the shared format (frontmatter `name` and `description`, markdown body). They name no Claude-only tool as the only way to do a step. A step that needs the user to choose says "ask Nick to pick", and names `AskUserQuestion` only as the Claude Code way to do it.
- **The reviewer.** The review method lives in `skills/design-review/reviewer.md`, which any agent can follow inline. `agents/design-reviewer.md` is a thin Claude Code wrapper that points at it.
- **Scripts.** Every check is a plain command (Python standard library or Node with no packages) with arguments and exit codes, so any agent can run it.
- **Hooks.** Each hook's decision lives in a function that takes plain values (repo path, command string) and returns a decision. The Claude Code payload parsing and output format sit in a separate small layer. Another harness adds its own layer and reuses the decision function.
- **Repo files.** Rules go in AGENTS.md, which Codex, OpenCode, and pi read. Installed UI Skills go in `.agents/skills/`, which the `skills` CLI shares across those agents.

### 7. Jev checks

Jev is TypeSafe's model, already used in Meridian by `scripts/lane-label.ts` and the CI advice job in ADR 0019. It takes a text state and named questions in one request: `POST https://api.typesafe.ai/v1/systemone` with a Bearer key and body `{model: "jev-latest", state, questions}`. A `noul` question returns the probability that the answer is yes. A `choice` question returns the chosen option, a probability per option, and a confidence (source: `scripts/jev-advice.mjs` and `scripts/lane-label.ts` in Meridian, read 2026-09-26).

One client, `tools/jev/jev_client.py`, serves all three checks. It uses the Python standard library only. It caps the state at 8 KB and never sends environment files, secret directories, or lockfiles. It picks a route by which key is set:

1. **`TYPESAFE_API_KEY` set:** the TypeSafe API above. Answers are Jev's own probabilities.
2. **Only `OPENROUTER_API_KEY` set:** OpenRouter's chat completions endpoint with model `typesafe/jev-router`. OpenRouter lists it as a router that uses Jev to pick a model and reasoning effort for each request, with variable pricing (source: `https://openrouter.ai/api/v1/models`, read 2026-09-26). It has no `noul` or `choice` question types, so the client asks for a JSON reply with the same fields. The probabilities are the chosen model's own estimate, not Jev's.
3. **Neither key set:** no call. The check is skipped and the caller carries on.

Every answer carries `source` (`typesafe`, `openrouter`, or `none`), so results from the two routes are never mixed in a comparison. Any error (timeout, HTTP error, malformed reply) is treated like route 3. Every call on routes 1 and 2 is billed.

- **Gate second check.** When the review gate runs, it also asks one `noul` question over the diff: "This change alters what a user sees or does in the interface." It starts in shadow mode. The call runs in a detached process so it adds no time to `gh pr create`. It appends the probability, its source, and the file-pattern result to `<git common dir>/process-pack/jev-gate.jsonl`. It never blocks or allows anything. Jev may start to affect the gate only after Nick has seen a table comparing the two results and recorded a decision in this spec.
- **Branch second opinion.** On the existing-UI path, after the audit, one `choice` question over the audit summary picks lean in, polish hard, or new direction, using the "When it fits" column of the branch table as each option's criteria. The recommendation Nick sees shows the agent's pick, Jev's pick with its confidence and source, and says plainly when they disagree. Nick still decides.
- **Mock taste check.** Before Nick is asked to pick a direction, each mock's HTML and CSS is the state. Each rule in the design taste file's section on looks to avoid becomes one `noul` question. A mock with any probability at or above 0.5 is re-rendered once with the flagged rule named. If it is still flagged, it is shown to Nick with the flag. The threshold of 0.5 is a starting value, recorded in the onboarding output.

## Build order

Each step is usable before the next starts.

1. Update impeccable from 4.0.4 to 4.3.1 on the laptop, then on the Fedora box for Cyrus. Check whether its rule engine accepts custom rules.
2. Seed the design taste file, its schema, and the anonymized example. Nick reviews the seeded draft.
3. The `design-onboard` skill, both paths, with the Tailwind reference file; then plain CSS; then SwiftUI.
4. The `design-reviewer` agent and the `design-review` skill.
5. The two hooks, with tests.
6. Bump the plugin from 1.4.0 to 1.5.0 and add a README section.

## Verification

- Hook tests with fixture diffs: UI change with no record (blocks), stale record (blocks), docs-only diff (passes), fresh record (passes). Nudge tests: UI with no DESIGN.md (nudges), DESIGN.md present (silent), no UI (silent).
- Greenfield dry run: a scratch Next.js and Tailwind repo taken through the full onboarding, including the direction pick. Evidence: the committed PRODUCT.md, DESIGN.md, tokens, guardrails, vendored skills, and `.process/repo.yaml`.
- Existing-UI dry run: audit and recommendation on `~/workspace/code/pikl/pepino`, stopping before any change to that repo.
- Review gate run: a real UI change in the scratch repo, blocked by the gate, then reviewed and let through.
- Jev: client tests with a stubbed server for both routes (answer, timeout, HTTP error, malformed reply) and for no key. One live call per check during the dry runs, with the answers and their source in the evidence. The gate's shadow log has one line per `gh pr create` attempt. Removing both keys changes nothing about the gate's decision.

## Out of scope

- Enforcement in Codex cloud, Cursor, or any harness other than Claude Code. No GitHub Action.
- Forking or patching impeccable.
- Adopting this in Meridian. That is a later PR in the Meridian repo: the review gate, the Tailwind check that blocks hardcoded colors across all app code, and deleting Meridian's local `design-reviewer` copy.

## Open items

- Whether impeccable's rule engine accepts custom rules from outside the plugin. Decides where the check that blocks hardcoded colors lives.
- Whether impeccable 4.4.0 ships before the build ends. If it does, preflight's minimum version is revisited.

Size: L.
