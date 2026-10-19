---
name: design-onboard
description: Use when a repo has UI files and no DESIGN.md, when a session-start message says to run design-onboard before UI work, when someone asks to onboard design or set up a design system for a repo, or before the first UI work in a new or unfamiliar repo. Writes PRODUCT.md and DESIGN.md through impeccable, picks a visual direction or audits the existing one, installs the guardrails that keep later UI work on the system, and offers Klaus, which keeps Storybook and design files in step with each release, with every cost shown before it is turned on.
---

# Design onboard

## Overview

A new repo's UI looks like library defaults for its first several sessions, each screen invents its own values, and nothing reviews the result. This skill closes that gap once, at the start. It leaves the repo with product truth (PRODUCT.md), a design system (DESIGN.md and real tokens), checks that block hardcoded colors and low contrast, a few pinned UI Skills, and AGENTS.md rules that point at all of it.

Impeccable is the design engine. This skill runs impeccable's flows in order and fills the gaps between them. It does not replace or fork them.

Two paths share the first two steps and the last two:

- **Greenfield:** the repo has no UI yet. Steps 1, 2, 3G to 6G, 7, 8.
- **Existing UI:** the repo already has screens. Steps 1, 2, 3E to 5E, 7, 8.

Step 8 sets up Klaus and is optional. The person can skip it.

`<plugin-root>` below means the process-pack plugin's folder: two folders above this skill's folder.

## Rules that hold on every path

- **Impeccable is the only writer of DESIGN.md.** Do not write it by hand, and do not use `ibelick/create-design-md` or any other skill that writes one.
- **Rules are copied, never linked.** The design taste file lives at `~/.config/process-pack/design-taste.yaml`. Copy the rules that apply into the repo's PRODUCT.md and AGENTS.md. Never link to the home-directory file: cloud agents (Codex cloud, Cursor) cannot read it.
- **The user decides the direction.** On the greenfield path, their pick on impeccable's decision page is the design stop. When the repo already has UI, they pick the branch. Impeccable's flows ask their own questions (init, new-work, document); put them to the user. Everything else runs without stopping.
- **Jev answers are advice with a source.** Every Jev result carries `source` (`typesafe`, `openrouter`, or `none`). Show it next to the result. With `source: none`, say the check was skipped and carry on.

In Claude Code, "ask the user to pick" means the `AskUserQuestion` tool. In another agent, use its own way of asking the user a question and waiting.

## Step 1. Preflight

1. **Impeccable version.** Read it from the harness's plugin record. In Claude Code that is `~/.claude/plugins/installed_plugins.json`: `plugins["impeccable@impeccable"]` is a list of install records, and the user-scope record's `version` is the one that runs. Below 4.3, stop and say: "Impeccable is <version>. Update it with `claude plugin marketplace update impeccable` and `claude plugin update impeccable@impeccable`, restart the session, then run design-onboard again." Not installed at all: stop with the same instruction.
2. **Stack.** Read `stacks/stacks.json` in this skill's directory. Detect per app, at each app's own directory (the repo root in a single-app repo; see item 4 for monorepos). Take the first entry whose `detect` matches: a name in `files_any` (globs allowed) exists in that directory, or a package in `package_deps_any` is in that directory's `package.json` dependency lists. No match means `other`. Open that entry's `reference` file; it answers the rest of the stack questions for step 7.
3. **App or site.** A site sells or explains (marketing pages, a portfolio, docs). An app is used (signed-in screens, data, forms). A repo can be both; record which surfaces are which.
4. **Monorepo apps.** With `pnpm-workspace.yaml`, `turbo.json`, or an `apps/` directory, list each app. Onboard each app users actually see. A component catalogue (Storybook) or a shared UI package follows the app it serves and gets no PRODUCT.md or DESIGN.md of its own. Where each DESIGN.md goes is impeccable's call (4.2.3 and later read each app's own file); do not move what its flows write.
5. **Existing UI.** Count tracked files that match the stack's `ui_globs` and are not in `exclude_globs` (`git ls-files`, paths taken relative to the app's directory). Any screen a user can reach means the path for existing UI. Only a starter page from a scaffold (for example `create-next-app`'s default page) counts as greenfield. Impeccable's `context` still calls a scaffold page an incumbent system; tell its new-work flow the page is a scaffold default with no visual authority.

## Step 2. Product truth

Run impeccable's `init` flow (in Claude Code: `/impeccable init`). It interviews the user for at least one round, then writes or updates PRODUCT.md from its template. If PRODUCT.md already exists, init updates it; do not overwrite what the repo's owner wrote.

## Greenfield path

### Step 3G. Design taste

Load `~/.config/process-pack/design-taste.yaml`. The user made these rules binding, so they go into PRODUCT.md's `## Brand Commitments` section, which impeccable's template keeps for constraints the user made binding. Do not add new top-level sections: init's template rejects visual recipes elsewhere.

- `looks_to_avoid` rules become the looks this product must not have.
- `craft_floor`, `color_discipline`, and `accessibility_floor` rules become the finish every screen reaches; the accessibility floor also goes in `## Accessibility & Inclusion`.
- `copy` rules become the voice commitments.
- Copy each rule's default stance and its named exceptions in plain words. Leave out rules whose applicability gate does not hold for this repo (for example, the AI content rule in a product with no AI content).

### Step 4G. References

Run the `desk-research` skill, briefed from PRODUCT.md's users, register, and category. Search the Inspo MCP (strongest for marketing and site pages) and the Refero and Mobbin MCPs (strongest for app screens and flows). Output 6 to 10 references, each with one line on why it fits this work. The design taste file holds no default references; pick them for this repo only.

### Step 5G. Directions

Directions come from impeccable's new-work flow, run as written: `reference/new-work.md`, section 3, "Create or replace the visual world". Do not hand-write direction mocks. Three mocks that share one layout and differ only in palette and type are the failure this step exists to prevent: the first dry run did exactly that, and the user rejected all three.

1. **Impeccable's questions.** Ask the two or three questions new-work's step 2 asks for the surface's mode (usually Operate for an app, Persuade for a site). These are impeccable's stops, not extra ones.
2. **Candidates and roll.** Name the mechanism, the audience's scene, and the rut (the page this category always ships, and its opposite). List seven candidates from the users' own world across at least three material families. Then run `impeccable concept-seed --scope direction --mode <mode>` and follow what it prints. No direction is written before the roll.
3. **Cards.** Build the decision payload new-work describes (`impeccable serve-question --schema` prints its shape): the assigned direction with its raises, the pick card when there is one, the challengers with verdicts, re-roll, and the category standard as the quiet exit.
4. **Mock taste check (Jev).** For each full card, build the state from its thesis, palette, materials, and first viewport (and its comp or HTML when one exists). Ask one `noul` question per rule in the taste file's `looks_to_avoid` section, worded as "This direction uses <the look the rule bans>." Run:

   ```bash
   python3 <plugin-root>/tools/jev/jev_client.py ask --state-file <card.txt> --questions-file <questions.json>
   ```

   A probability at or above 0.5 flags that rule. Rework the flagged card once, naming the rule. If it is still flagged, keep it and put the flag in its risk line. Record the threshold (0.5), each probability, and the source in `docs/design/onboarding/README.md`.
5. **Ask the user to pick** on impeccable's decision page (`serve-question --start`, then `--wait`), or through the question tool when the page cannot start. Re-rolls follow new-work's rules. This is the design stop on this path.

### Step 6G. System

Continue impeccable's new-work flow from the chosen card: it commits the world, records it in DESIGN.md (and its `.impeccable/design.json` sidecar), and builds the first surface. Commit the sidecar with DESIGN.md. Then follow the stack reference file's "Where tokens go" section to turn DESIGN.md into real tokens.

## Existing UI path

### Step 3E. Audit

1. Fold the design taste rules into PRODUCT.md exactly as in step 3G.
2. Run impeccable's `document` flow to record the current system as a draft DESIGN.md. It asks the user its own questions and writes a `.impeccable/design.json` sidecar beside DESIGN.md.
3. Screenshot 3 to 5 key screens at desktop and mobile widths. Use the `run` skill to start the app, or a preview URL. When the app cannot run (secrets, a backend, a login), use Storybook, a preview deploy, or saved screenshots, in that order, and say in the output which one and what it could not show (usually mobile widths and live states).
4. Run impeccable's `critique` and `audit` flows against those screens. Critique wants isolated reviewers per screen; stay within the machine's cap on agents that run commands (for example, the cap in the user's own instructions) by batching screens, and disclose any degraded pass. Report impeccable's own scores, then score the taste file's eight dimensions and check each taste rule whose applicability gate holds (for example the AI content rule in a product with an agent). Mark any audit dimension that screenshots cannot measure (performance, responsive behavior without a mobile source) as not measured. Rank the problems.
5. Pull 3 to 5 comparable products from Inspo, Refero, or Mobbin as a benchmark.

### Step 4E. Recommend one branch

| Branch | When it fits | Output |
| --- | --- | --- |
| Lean in | The UI is coherent; problems are craft debt | The recorded DESIGN.md becomes the authority; guardrails codify it; debt becomes tickets |
| Polish hard | The identity is worth keeping; hierarchy, type, spacing, or states fall short | Identity kept; a ranked fix list (structure, then tokens, then components, then polish); before and after renders of 2 or 3 key screens |
| New direction | The identity is generic or wrong for the users | Greenfield steps 4G to 6G, plus a migration plan: which screens move first and how old and new coexist |

1. Pick the branch the audit supports, and say which measurement decided it.
2. **Branch second opinion (Jev).** Write the audit summary (scores, top problems, benchmark notes) to `docs/design/evolution/audit-summary.txt`, under 8 KB, and ask one `choice` question over it. The options are `lean-in`, `polish-hard`, and `new-direction`. Each option's criteria is its "When it fits" text from the table.
3. Show the user both picks: yours, and Jev's with its `confidence` and source. Say plainly when they differ, and that Jev read your summary, so agreement is not independent evidence.
4. **Ask the user to pick** the branch.

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
   2. Get the commit: `git ls-remote https://github.com/<owner>/<repo> HEAD` (the default branch, whatever it is named).
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

## Step 8. Klaus

Klaus keeps a list of every component the repo ships. After each release it writes the components into the design outputs the team chose: Storybook and Figma now, Penpot and Pencil later. Its scripts and its README are in `<plugin-root>/tools/klaus/`. Below, `<klaus-src>` means that folder, and `install.mjs` means `<klaus-src>/install/install.mjs`.

Run this step after DESIGN.md exists, and run its commands from the repo root. Ask once whether to set Klaus up now. If not, skip to the report and say Klaus was skipped.

### Rules for this step

- **Cost comes first.** Until the person has seen an output's cost lines and chosen, write nothing to the repo, call no platform and read no secret. Every recurring spend (relay tokens, platform calls, storage) is a setting for this repo. Every default is only a default.
- **Cost lines come from the adapters.** `install.mjs costs` runs each adapter's plan and estimate steps and prints the lines. Show its text as printed. Do not work out a cost, and do not quote one from memory or from `klaus-outputs.md`. When it prints "No estimate", show that and the reason.
- **Limits come from `klaus-outputs.md`.** Quote the limit with its source and date. A limit older than a month is checked against the platform's own page first, and you say you did.
- **One output per screen.** Each screen shows the route, the cost lines, the limits and the default, then asks one question.
- **Secrets stay out.** The config holds names, never values. Never ask for a token and never print one. The person sets the values in the repo's CI secrets.
- **Nothing that is not on the default branch gets a secret.** The workflow refuses a commit that is not on the default branch, ignores release tags that are not, and gives the Vercel token to one step only. Release mode is not set up without the tag ruleset in 8.5.
- **This step runs no model and writes nothing to Figma.** It makes no deploy and no Codex call.

### 8.1 Preflight, read only

1. **Node and git.** Node 22 or later. A git repo, with release tags (`git tag --list`). No tags is allowed: say that Klaus counts a git tag as a release, and the first one starts it.
2. **The repo's own TypeScript.** The inventory reads components with the repo's `typescript` package. Not installed: stop and say to install it.
3. **Storybook.** Find a `.storybook` folder (`git ls-files` for `*/.storybook/*`) and the script that runs `storybook build`. Without Storybook, Storybook and Figma cannot be turned on: Figma draws each component from its story. Say that Klaus does not install Storybook.
4. **Package manager.** From the lockfile and `packageManager` in package.json. Work out the repo's install command: `pnpm install --frozen-lockfile`, `npm ci`, or `yarn install --immutable` (`--frozen-lockfile` before Yarn 2). Look at the repo's own CI workflow too. If it has install steps (a pinned `pnpm/action-setup`, for instance), copy those steps without the checkout into a file in the scratch folder and use them in place of the command.
5. **CI.** Klaus renders a GitHub Actions workflow and nothing else. Look for `.github/workflows` and a GitHub remote (`git remote -v`). If the repo is not on GitHub Actions, do everything except the workflow, and say so. Note the default branch (`gh repo view --json defaultBranchRef`): the workflow builds only commits that are on it, and treats a tag as a release only when its commit is on it.
6. **An earlier install.** If `scripts/klaus/VERSION.txt` or `klaus.config.json` exists, this is an upgrade. Show the version line, keep the existing answers as defaults, and expect `copy` to refuse a hand-edited copy.
7. Make a scratch folder with `mktemp -d`. Everything until step 8.7 goes there. After each answer in 8.3 and 8.4, update `<scratch>/klaus.config.json` (outputs on or off with their target, the cap, the selection) before you re-run the cost command, because the command reads that file.

### 8.2 Inventory folders

Ask which folders hold the repo's UI components. Offer the folders that contain `.tsx` or `.jsx` files and match common names (`packages/*/src`, `src/components`, `app/components`), with the shared UI package first. Paths have no spaces. Build the inventory into the scratch folder, so nothing lands in the repo yet:

```bash
node <klaus-src>/inventory/inventory.mjs --root <repo> --out <scratch> <folder> [<folder> ...]
```

It prints one line for each folder. A folder under `packages/` is `shared`, any other is `app`. Show those lines.

Write `<scratch>/klaus.config.json` as a draft with Storybook and Figma off, `inventory.folders`, and `selection` set to the defaults in 8.4 (`screens.mode` `none` until 8.4 asks about screens). The cost command reads it.

### 8.3 The outputs, one per screen

Run the cost command once:

```bash
node <klaus-src>/install/install.mjs costs --repo <repo> --config <scratch>/klaus.config.json --inventory <scratch>/inventory.json
```

Then show one output at a time: its block from that text, then its limits and credential from `klaus-outputs.md`, then the default and the question. Re-run the command with `--outputs <name>` when an answer changes a cost.

1. **Storybook.** Default on when the repo has Storybook, otherwise off. Ask for the Vercel project name (suggest the `name` in the root package.json without its scope, plus `-storybook`) and whether a Vercel team owns it. Secrets: `VERCEL_TOKEN`, and `VERCEL_ORG_ID` for a team. Storybook ignores the component selection and shows every component with a story.
2. **Figma.** Ask whether the team uses Figma. On only if they say yes and the repo has Storybook and `@playwright/test`. Say plainly that there are two parts: the plugin does the first load at no token cost, and the relay does the updates after each release at the cost printed. Then ask the two Figma settings:
   - the Figma file to write to (a file URL or key, in a file the person can edit), and
   - the relay's cost cap for one run, `spendingCap.maxRelayTokens`, with the default and the component limit `maxComponentWrites` shown. After the answer, re-run the cost command so the cap line says how many of the selected versions a run sends under that cap.
3. **Penpot and Pencil.** Off. Show the "no adapter yet" line and the limits. Nothing to ask. Write `{ "enabled": false }` for each, so the choice is recorded.
4. **Claude Design and Paper.** Show the reason each cannot run unattended and the limit. Nothing to ask, and they have no entry in the config.

### 8.4 Components, screens and trigger

Ask these three together, each pre-filled.

- **Components.** Default `selection.componentGroups`: every inventory folder marked `shared`, plus any folder the person names as the marketing kit or the icon set. App and local components stay in the inventory and out of the design files. Add `newComponents` with rule `all`, so a new component in a selected group joins on the release that ships it. The other rules are `min-usage` and `none`.
- **Screens.** The default is every screen the repo's visual checks capture, and only when the same workflow job can produce one PNG per route (named `home.png`, `settings.png`, in `outputs.figma.options.screenshotsDir`, `.klaus/screens` by default). Ask whether visual checks exist and where the screenshots land. If the workflow cannot produce them, set `screens.mode` to `none` and say why. A listed screen with no screenshot fails the run.
- **Trigger.** Default `release`: CI runs when a release tag is pushed, with `tagPattern` taken from the existing tags (`v*` when they look like `v1.4.0`). It needs the tag ruleset in 8.5, and the person can decline it. `schedule` takes a five-field cron in UTC and builds the newest tag whose commit is on the default branch. It needs no ruleset, because a scheduled run uses the workflow file from the default branch. A one-off run is the third choice: write no workflow, and tell the person to run `node scripts/klaus/frame/cli.mjs run --trigger manual` themselves.

If a changed selection moves a cost, re-run the cost command and show the new line.

### 8.5 Protect the release tags (release mode only)

Skip this when the trigger is a schedule or a one-off run.

A pushed tag runs the workflow file from the tagged commit, so a check inside the workflow cannot stop a hostile tag. Anyone who can push a tag matching the pattern could run their own copy of the Klaus workflow with the repo's secrets. Release mode is therefore set up only when a repository ruleset lets just maintainers create, update or delete tags matching the pattern, and that is checked, not assumed. Only a ruleset of one exact shape counts: about tags, active, including exactly the release pattern or all tags (`~ALL` or `refs/tags/*`), excluding nothing, with the creation, update and deletion rules, and with every bypass actor a repository admin or an app, team or person the user approved by name. Only this shape counts because any exclusion, even a partial one like `refs/tags/v1*`, leaves the tags it names open to everyone, and a different include may not reach the release tags, so Klaus does not try to judge other rulesets. They neither count nor block: GitHub applies the rules of every ruleset together, so the exact one still binds. `install.mjs workflow` refuses to render release mode until the check passes, and refuses again on any later render if the ruleset has gained an actor that is not on the approved list in klaus.config.json.

1. **Look.** This needs `gh` signed in with admin rights on the repo. `install.mjs ruleset --repo <repo> --tag-pattern <pattern>` reads `gh api repos/{owner}/{repo}/rulesets`, then reads every active tag ruleset in full and looks only at the ones with the exact shape. The outcomes:
   - **Protected.** A ruleset of the exact shape lets only admins and approved actors bypass it. Go on to 8.6, and record the approvals (step 6).
   - **A ruleset of the exact shape lets someone else bypass it.** The command lists each such actor: its type and id, its bypass mode, the ruleset's name and its page on GitHub. Release mode stays off. Go to step 2.
   - **No ruleset has the exact shape.** This includes a ruleset with an exclusion or a different include. The command ignores those, and shows the ruleset it would create. Go to step 3.
   - **The rulesets could not be read** (no admin rights, a bypass list that was not returned, or a plan without rulesets). Say so, do not render release mode, and offer the schedule or an admin.
2. **Show each other bypass actor, and ask.** Say what each one can do: push release tags, and so run the workflow with the secrets. The person removes it from the ruleset in GitHub, or approves it by name. To approve, run the command again with `--approve <Type>:<id>:<name>`, where the name is what the person types for that actor, read off the ruleset's page. Never approve for them and never guess a name. Everyone with a role other than admin is one actor: approving a write role approves everyone who has it, so say that. Repeat until the command says the tags are protected.
3. **Find who makes release tags today.** Look in `.github/workflows` for `git tag`, `git push --tags`, `gh release create` or a release action, and ask. The ruleset refuses everyone not on its list, including that workflow. Repository admins are always on the list. Add a GitHub App with `--bypass-app <id>:<name>` (`gh api /apps/<slug> --jq .id` finds the id) or a team with `--bypass-team <id>:<name>`; adding one is also approving it. Whether a workflow's default `GITHUB_TOKEN` can be put on the list is unverified, so a workflow that cuts the tags needs an App token, or the schedule.
4. **Show the plan and ask.** Show what the command printed: why it is needed, why only this shape counts, who can still push release tags, who is blocked, and the ruleset itself. Ask: create it, use the schedule instead, or leave release mode off.
5. **Create it only after a yes.** Run the same command with `--create` and the same bypass flags. It checks again first, and creates nothing if a ruleset now exists. Show the id it prints.
6. **Record the approvals.** When any actor besides admins is on the list (approved with `--approve`, or added with `--bypass-app` or `--bypass-team`), the command prints a line starting `Record this in klaus.config.json`. Put exactly that list under `trigger.approvedTagBypass` when you write the config in 8.7. Admins are never listed. With only admins, leave it out.
7. **On no,** set `trigger.mode` to `schedule` (ask for the cron) or to a one-off run, and say plainly that release mode was left off because the tags are unprotected.

### 8.6 Create the Vercel project

Skip this when Storybook is off. The Storybook adapter needs the project to exist before its first run, and onboarding creates it. It is the one platform call in this step, it creates an empty project, and it needs `VERCEL_TOKEN`. Ask first, once. On yes, run the command with the token in the environment of that one command, from the person's secret store, never printed. The adapter passes its token the same way, and pins the same CLI version (`VERCEL_CLI_VERSION` in `adapters/storybook/vercel.mjs`). `vercel project create <name>` and the `VERCEL_TOKEN` variable are in Vercel's CLI docs (read 2026-10-19). The command has not been run against the pinned version:

```bash
VERCEL_TOKEN=<from the secret store> npx --yes vercel@<pinned version> project create <project> [--scope <team>]
```

Leave deployment protection at Vercel's default. The adapter deploys an empty index first, so the first release is a protected preview. On no, give the command as a next step.

### 8.7 Write the files

All answers are in. Now write to the repo, in this order:

1. **`klaus.config.json`** at the repo root, with `$schema` set to `./scripts/klaus/klaus.config.schema.json`. Shape (the schema is `<klaus-src>/klaus.config.schema.json`):

   ```json
   {
     "$schema": "./scripts/klaus/klaus.config.schema.json",
     "outputs": {
       "storybook": { "enabled": true, "target": "<vercel project>", "secrets": ["VERCEL_TOKEN"] },
       "figma": { "enabled": true, "target": "<file URL or key>", "route": "codex-relay", "logins": ["codex"] },
       "penpot": { "enabled": false },
       "pencil": { "enabled": false }
     },
     "inventory": { "folders": ["<folder>"] },
     "selection": {
       "componentGroups": ["<folder>"],
       "screens": { "mode": "none" },
       "newComponents": { "rule": "all" }
     },
     "spendingCap": { "maxComponentWrites": 50, "maxRelayTokens": 500000 },
     "trigger": { "mode": "release", "tagPattern": "v*" }
   }
   ```

   In release mode, `trigger` also holds `"approvedTagBypass": [{ "type": "Integration", "id": 123, "name": "release-bot" }]` from 8.5, or nothing when only admins can bypass the ruleset.

2. **The scripts:** `node <klaus-src>/install/install.mjs copy --repo <repo>`. It copies Klaus to `scripts/klaus/` and writes `scripts/klaus/VERSION.txt`, one line with the Klaus version, the process-pack version and a hash of the files. Show that line. It refuses, even with `--force`, when `scripts/klaus`, any folder on the way to it, or any file in it is a symbolic link, because writing through a link changes a file outside the repo. Ask the person to remove the link. The same holds for the workflow file and `.github/workflows`.
3. **Check the config:** `node scripts/klaus/frame/cli.mjs validate` must print that the file is valid. Fix what it names and run it again. Its errors never repeat a secret.
4. **The workflow**, unless the trigger is a one-off:

   ```bash
   node <klaus-src>/install/install.mjs workflow --repo <repo> --install "<install command>" \
     [--corepack] [--install-steps <file>] [--node <major>] \
     [--storybook-build "<command>"] [--playwright "<command>"] [--captures <file>]
   ```

   Pass `--corepack` when package.json has `packageManager` for pnpm or Yarn and you are not using copied install steps. Pass `--node <major>` from `.nvmrc`, `.node-version` or `engines.node` when the repo has one. Leave `--playwright` out unless the default, `npx playwright install --with-deps chromium`, is wrong for the repo's package manager. `--storybook-build` is needed when Figma is on. It is the command that writes a static Storybook to `storybook-static` (or to `outputs.figma.options.storybookDir`, which you then set in the config). Read the script to see where it writes, and in a workspace run it in its package: `pnpm --filter <package> <script>`, `npm run <script> -w <package>` or `yarn workspace <package> <script>`. Do not run the build here. `--captures` names the file the version picker reads when the repo's visual checks write one. In release mode it first checks for the tag ruleset and stops without writing if there is none. The command prints the parts it kept, the ruleset that protects the tags, the secrets to set, and the result of actionlint. When actionlint is not installed it parses the YAML with python3 or ruby instead and says so. Report which check ran. If the check fails, fix the cause and render again.
5. **Housekeeping.** Add `.klaus/` to `.gitignore` unless `git check-ignore .klaus/state.json` says it is already ignored. Look at how the repo treats other copied script folders (`scripts/dieter`, for instance) in its lint, format and test configs, and treat `scripts/klaus` the same.

### 8.8 What the person does next

Show these as a short list. Do not run them.

- **What the workflow refuses.** It builds only commits on the default branch. A tag whose commit is not on it is ignored, with a warning, and a pushed tag like that fails the run. State from an earlier run is restored only from a successful run of this workflow on the default branch or at a commit on it, and only if its files have the shape Klaus writes; otherwise the run starts from the newest release. The Vercel token is on the Run Klaus step alone, and the Storybook build inside it starts without the token.
- **Push.** The workflow runs only once it is on the default branch of the GitHub repo. Push the commit and open a pull request the way the repo does for other changes.
- **State.** Each run keeps Klaus's state in the `klaus-state` artifact for up to 90 days (the repo's artifact retention may be shorter). If no release runs for longer than that, the next run starts again from the newest release.
- **Secrets** to add in the repo's settings, by name: the ones the command printed. Their values come from the person's own secret store.
- **Figma, when on.** (1) Once, in the Figma desktop app: open the target file, then Plugins, Development, Import plugin from manifest, and pick `scripts/klaus/adapters/figma/plugin/manifest.json` in the repo. (2) On the machine that will run the relay, install the Codex CLI and sign it in to Figma: the steps are in `scripts/klaus/adapters/figma/relay/README.md`. (3) After the onboarding run has written the Figma data files, apply them with the plugin ("Klaus: apply a release"), then run `relay.mjs --reconcile` once so the relay does not send what the plugin wrote.

### 8.9 The onboarding run: show the estimate and stop

Print the one-time estimate for the outputs that are on:

```bash
node <klaus-src>/install/install.mjs costs --repo <repo> --config klaus.config.json --inventory <scratch>/inventory.json --enabled
```

Commit `scripts/klaus/`, `klaus.config.json`, the workflow and `.gitignore` (when it changed) in one commit, apart from the design commits.

The onboarding run builds the baseline (process-pack issue #30). Ask the person to approve the estimate. On yes, continue with the onboarding run, which is that issue's step. When this skill has no such step yet, say so and end here: the estimate and the commit are the result, and 8.8 lists what is left.

## Report

End with: the path taken, the direction or branch the user picked, the references, the Jev results with their sources, the checks installed and whether they pass, each UI Skill with its pinned commit, and anything left open.

For Klaus, say whether it was skipped. If it was set up, give each output as on or off with its cost lines as `install.mjs costs` printed them, the spending cap, the trigger (in release mode, the tag ruleset that protects it, or why release mode was left off), the version line from `scripts/klaus/VERSION.txt`, the secrets still to set, the steps left for the person, which workflow check ran, and the onboarding run's one-time estimate.
