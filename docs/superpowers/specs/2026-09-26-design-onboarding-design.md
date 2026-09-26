# Design onboarding for new and existing repos

Date: 2026-09-26. Status: approved in conversation, awaiting review of this written spec.

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

## External tools

- **Impeccable** (`pbakaus/impeccable`). Installed: 4.0.4. Latest release: `skill-v4.3.1`, 2026-09-09; a 4.4.0 is being prepared (source: `gh api repos/pbakaus/impeccable/releases` and its latest commit, read 2026-09-26). Relevant changes since 4.0.4: in 4.2.3, monorepo hooks use each app's own DESIGN.md; in 4.2.0, "a downstream package can add its own rules without forking". Whether the Claude plugin exposes that rule API is unverified.
- **Inspo MCP** (`Nutlope/inspo`, MIT). 2,320 pages across 832 real sites, each with an extracted DESIGN.md, 68 reference components, and a `recommend(brief)` tool. Install with `npx -y inspo-mcp install` or `claude mcp add --transport http inspo https://inspomcp.dev/api/mcp` (source: the repo README, read 2026-09-26). Strongest for marketing and site pages.
- **Refero and Mobbin MCPs**, already configured on the laptop. Strongest for app screens and flows.
- **UI Skills** (`ui-skills.com`). A registry of 315 third-party skills. CLI: `npx ui-skills start`, `categories`, `list --category <c>`, `get <slug>`. A plain registry at `/skills/registry.txt` maps each slug to a raw GitHub URL on the author's `main` branch. There is also an MCP server. Its router skill `ibelick/ui-skills-root` prefers one skill per task and never more than three (source: ui-skills.com `llms.txt`, `/cli`, and `registry.txt`, read 2026-09-26).

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
5. **Directions.** Render 2 or 3 direction mocks as HTML under `docs/design/onboarding/`, screenshot them, and ask Nick to pick through `AskUserQuestion`. This is the only required stop.
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

7. **Guardrails.** Apply the stack reference file's check that blocks hardcoded colors, and its contrast check. Pick 3 to 5 UI Skills for the stack and product, always including an accessibility scan skill, and vendor each one into `.claude/skills/vendor/<slug>/` at a pinned commit. Add a design section to AGENTS.md whose hard rules point at the design skills. Record the onboarding date, impeccable version, branch taken, and each vendored skill with its commit and the reason it was picked in `.process/repo.yaml`. Commit all of it.

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

- `agents/design-reviewer.md`, promoted from Meridian's `.claude/agents/design-reviewer.md` with Meridian specifics removed.
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

## Out of scope

- Enforcement in Codex cloud, Cursor, or any harness other than Claude Code. No GitHub Action.
- Forking or patching impeccable.
- Adopting this in Meridian. That is a later PR in the Meridian repo: the review gate, the Tailwind check that blocks hardcoded colors across all app code, and deleting Meridian's local `design-reviewer` copy.

## Open items

- Whether impeccable's rule engine accepts custom rules from outside the plugin. Decides where the check that blocks hardcoded colors lives.
- Whether impeccable 4.4.0 ships before the build ends. If it does, preflight's minimum version is revisited.

Size: L.
