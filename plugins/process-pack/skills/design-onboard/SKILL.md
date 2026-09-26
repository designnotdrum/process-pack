---
name: design-onboard
description: Use when a repo has UI files and no DESIGN.md, when a session-start message says to run design-onboard before UI work, when someone asks to onboard design or set up a design system for a repo, or before the first UI work in a new or unfamiliar repo. Writes PRODUCT.md and DESIGN.md through impeccable, picks a visual direction or audits the existing one, and installs the guardrails that keep later UI work on the system.
---

# Design onboard

## Overview

A new repo's UI looks like library defaults for its first several sessions, each screen invents its own values, and nothing reviews the result. This skill closes that gap once, at the start. It leaves the repo with product truth (PRODUCT.md), a design system (DESIGN.md and real tokens), checks that block hardcoded colors and low contrast, a few pinned UI Skills, and AGENTS.md rules that point at all of it.

Impeccable is the design engine. This skill runs impeccable's flows in order and fills the gaps between them. It does not replace or fork them.

Two paths share the first two steps and the last one:

- **Greenfield:** the repo has no UI yet. Steps 1, 2, 3G to 6G, 7.
- **Existing UI:** the repo already has screens. Steps 1, 2, 3E to 5E, 7.

## Rules that hold on every path

- **Impeccable is the only writer of DESIGN.md.** Do not write it by hand, and do not use `ibelick/create-design-md` or any other skill that writes one.
- **Rules are copied, never linked.** The design taste file lives at `~/.config/process-pack/design-taste.yaml`. Copy the rules that apply into the repo's PRODUCT.md and AGENTS.md. Never link to the home-directory file: cloud agents (Codex cloud, Cursor) cannot read it.
- **Nick decides the direction.** On the greenfield path, his pick on impeccable's decision page is the design stop. When the repo already has UI, he picks the branch. Impeccable's flows ask their own questions (init, new-work, document); answer them through Nick. Everything else runs without stopping.
- **Jev answers are advice with a source.** Every Jev result carries `source` (`typesafe`, `openrouter`, or `none`). Show it next to the result. With `source: none`, say the check was skipped and carry on.

In Claude Code, "ask Nick to pick" means the `AskUserQuestion` tool. In another agent, use its own way of asking the user a question and waiting.

## Step 1. Preflight

1. **Impeccable version.** Read it from the harness's plugin record. In Claude Code that is `~/.claude/plugins/installed_plugins.json`: `plugins["impeccable@impeccable"]` is a list of install records, and the user-scope record's `version` is the one that runs. Below 4.3, stop and say: "Impeccable is <version>. Update it with `claude plugin marketplace update impeccable` and `claude plugin update impeccable@impeccable`, restart the session, then run design-onboard again." Not installed at all: stop with the same instruction.
2. **Stack.** Read `stacks/stacks.json` in this skill's directory. Detect per app, at each app's own directory (the repo root in a single-app repo; see item 4 for monorepos). Take the first entry whose `detect` matches: a name in `files_any` (globs allowed) exists in that directory, or a package in `package_deps_any` is in that directory's `package.json` dependency lists. No match means `other`. Open that entry's `reference` file; it answers the rest of the stack questions for step 7.
3. **App or site.** A site sells or explains (marketing pages, a portfolio, docs). An app is used (signed-in screens, data, forms). A repo can be both; record which surfaces are which.
4. **Monorepo apps.** With `pnpm-workspace.yaml`, `turbo.json`, or an `apps/` directory, list each app. Onboard each app users actually see. A component catalogue (Storybook) or a shared UI package follows the app it serves and gets no PRODUCT.md or DESIGN.md of its own. Where each DESIGN.md goes is impeccable's call (4.2.3 and later read each app's own file); do not move what its flows write.
5. **Existing UI.** Count tracked files that match the stack's `ui_globs` and are not in `exclude_globs` (`git ls-files`, paths taken relative to the app's directory). Any screen a user can reach means the path for existing UI. Only a starter page from a scaffold (for example `create-next-app`'s default page) counts as greenfield. Impeccable's `context` still calls a scaffold page an incumbent system; tell its new-work flow the page is a scaffold default with no visual authority.

## Step 2. Product truth

Run impeccable's `init` flow (in Claude Code: `/impeccable init`). It interviews Nick for at least one round, then writes or updates PRODUCT.md from its template. If PRODUCT.md already exists, init updates it; do not overwrite what the repo's owner wrote.

## Greenfield path

### Step 3G. Design taste

Load `~/.config/process-pack/design-taste.yaml`. Nick made these rules binding, so they go into PRODUCT.md's `## Brand Commitments` section, which impeccable's template keeps for constraints the user made binding. Do not add new top-level sections: init's template rejects visual recipes elsewhere.

- `looks_to_avoid` rules become the looks this product must not have.
- `craft_floor`, `color_discipline`, and `accessibility_floor` rules become the finish every screen reaches; the accessibility floor also goes in `## Accessibility & Inclusion`.
- `copy` rules become the voice commitments.
- Copy each rule's default stance and its named exceptions in plain words. Leave out rules whose applicability gate does not hold for this repo (for example, the AI content rule in a product with no AI content).

### Step 4G. References

Run the `desk-research` skill, briefed from PRODUCT.md's users, register, and category. Search the Inspo MCP (strongest for marketing and site pages) and the Refero and Mobbin MCPs (strongest for app screens and flows). Output 6 to 10 references, each with one line on why it fits this work. The design taste file holds no default references; pick them for this repo only.

### Step 5G. Directions

Directions come from impeccable's new-work flow, run as written: `reference/new-work.md`, section 3, "Create or replace the visual world". Do not hand-write direction mocks. Three mocks that share one layout and differ only in palette and type are the failure this step exists to prevent: the first dry run did exactly that, and Nick rejected all three.

1. **Impeccable's questions.** Ask the two or three questions new-work's step 2 asks for the surface's mode (usually Operate for an app, Persuade for a site). These are impeccable's stops, not extra ones.
2. **Candidates and roll.** Name the mechanism, the audience's scene, and the rut (the page this category always ships, and its opposite). List seven candidates from the users' own world across at least three material families. Then run `impeccable concept-seed --scope direction --mode <mode>` and follow what it prints. No direction is written before the roll.
3. **Cards.** Build the decision payload new-work describes (`impeccable serve-question --schema` prints its shape): the assigned direction with its raises, the pick card when there is one, the challengers with verdicts, re-roll, and the category standard as the quiet exit.
4. **Mock taste check (Jev).** For each full card, build the state from its thesis, palette, materials, and first viewport (and its comp or HTML when one exists). Ask one `noul` question per rule in the taste file's `looks_to_avoid` section, worded as "This direction uses <the look the rule bans>." Run:

   ```bash
   python3 <process-pack>/tools/jev/jev_client.py ask --state-file <card.txt> --questions-file <questions.json>
   ```

   A probability at or above 0.5 flags that rule. Rework the flagged card once, naming the rule. If it is still flagged, keep it and put the flag in its risk line. Record the threshold (0.5), each probability, and the source in `docs/design/onboarding/README.md`.
5. **Ask Nick to pick** on impeccable's decision page (`serve-question --start`, then `--wait`), or through the question tool when the page cannot start. Re-rolls follow new-work's rules. This is the design stop on this path.

### Step 6G. System

Continue impeccable's new-work flow from the chosen card: it commits the world, records it in DESIGN.md (and its `.impeccable/design.json` sidecar), and builds the first surface. Commit the sidecar with DESIGN.md. Then follow the stack reference file's "Where tokens go" section to turn DESIGN.md into real tokens.

## Existing UI path

### Step 3E. Audit

1. Fold the design taste rules into PRODUCT.md exactly as in step 3G.
2. Run impeccable's `document` flow to record the current system as a draft DESIGN.md. It asks Nick its own questions and writes a `.impeccable/design.json` sidecar beside DESIGN.md.
3. Screenshot 3 to 5 key screens at desktop and mobile widths. Use the `run` skill to start the app, or a preview URL. When the app cannot run (secrets, a backend, a login), use Storybook, a preview deploy, or saved screenshots, in that order, and say in the output which one and what it could not show (usually mobile widths and live states).
4. Run impeccable's `critique` and `audit` flows against those screens. Critique wants isolated reviewers per screen; stay within the machine's cap on agents that run commands (three on Nick's laptop) by batching screens, and disclose any degraded pass. Report impeccable's own scores, then score the taste file's eight dimensions and check each taste rule whose applicability gate holds (for example the AI content rule in a product with an agent). Mark any audit dimension that screenshots cannot measure (performance, responsive behavior without a mobile source) as not measured. Rank the problems.
5. Pull 3 to 5 comparable products from Inspo, Refero, or Mobbin as a benchmark.

### Step 4E. Recommend one branch

| Branch | When it fits | Output |
| --- | --- | --- |
| Lean in | The UI is coherent; problems are craft debt | The recorded DESIGN.md becomes the authority; guardrails codify it; debt becomes tickets |
| Polish hard | The identity is worth keeping; hierarchy, type, spacing, or states fall short | Identity kept; a ranked fix list (structure, then tokens, then components, then polish); before and after renders of 2 or 3 key screens |
| New direction | The identity is generic or wrong for the users | Greenfield steps 4G to 6G, plus a migration plan: which screens move first and how old and new coexist |

1. Pick the branch the audit supports, and say which measurement decided it.
2. **Branch second opinion (Jev).** Write the audit summary (scores, top problems, benchmark notes) to `docs/design/evolution/audit-summary.txt`, under 8 KB, and ask one `choice` question over it. The options are `lean-in`, `polish-hard`, and `new-direction`. Each option's criteria is its "When it fits" text from the table.
3. Show Nick both picks: yours, and Jev's with its `confidence` and source. Say plainly when they differ, and that Jev read your summary, so agreement is not independent evidence.
4. **Ask Nick to pick** the branch.

### Step 5E. The case for the change

Both change branches (polish hard, new direction) write `docs/design/evolution/README.md`, readable cold by a client or stakeholder:

- Current audit scores and top problems, on real screenshots.
- Before and after renders of the same screens, with the benchmark products.
- Cost: screens touched, a t-shirt size, and phasing.
- Risks (relearning, brand equity, regressions), each with a mitigation.
- One recommendation and the measurement that decided it.

Lean in writes one line in that file saying why the current system stays.

## Step 7. Guardrails

1. **Stack checks.** Follow the stack reference file: install the check that blocks hardcoded colors and the contrast check, and wire both into the repo's scripts. For `other`, write in the onboarding output that neither check exists for this stack.
2. **UI Skills.** Pick 3 to 5 for the stack and product with `npx ui-skills list --category <c>` (and `npx ui-skills categories`). Always include one accessibility scan skill (`ibelick/fixing-accessibility` is the default candidate). The `ui-skills` CLI only finds skills; do not use `ui-skills get` to install, because it prints only SKILL.md and drops the skill's other files. For each pick:
   1. Skip it and pick another if its source is not on GitHub.
   2. Get the commit: `git ls-remote https://github.com/<owner>/<repo> refs/heads/main`.
   3. Install it pinned:

      ```bash
      DO_NOT_TRACK=1 DISABLE_TELEMETRY=1 npx -y skills@1.7.0 add <owner>/<repo>#<sha> --skill <name> --agent claude-code codex opencode pi --copy -y
      ```

      This writes `.agents/skills/<name>/` (read by Codex and OpenCode), `.claude/skills/<name>/`, and `.pi/skills/<name>/`, and records the pin in `skills-lock.json`. Commit all three folders.
3. **AGENTS.md.** Add a `## Design` section with hard rules:
   - Read DESIGN.md and PRODUCT.md before any UI change.
   - Every color comes from a token; the repo's color check must pass.
   - Run the `design-review` skill before opening a pull request that changes UI.
   - The installed UI Skills, each named with what it is for.
   - The taste rules folded into PRODUCT.md, in plain words.
4. **`.process/repo.yaml`.** Write the `design` block (schema: `constants/schemas/repo.schema.json` in process-pack): `onboarded_at`, `impeccable_version`, `stack`, `path` (`greenfield`, `lean-in`, `polish-hard`, or `new-direction`), and `ui_skills` with each skill's `name`, `source`, and the reason it was picked. The commits live in `skills-lock.json` only.
5. **Commit** PRODUCT.md, DESIGN.md, the tokens, the checks, `docs/design/`, the skill directories, `skills-lock.json`, AGENTS.md, and `.process/repo.yaml`.

## Report

End with: the path taken, the direction or branch Nick picked, the references, the Jev results with their sources, the checks installed and whether they pass, each UI Skill with its pinned commit, and anything left open.
