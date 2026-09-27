# Design Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan one task at a time. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the design onboarding feature in process-pack 1.5.0: a design taste file, the `design-onboard` and `design-review` skills, the `design-reviewer` agent, two hooks, a Jev client for three checks, and the stack reference files for Tailwind, plain CSS and SwiftUI.

**Architecture:** Impeccable stays the design engine; process-pack orchestrates it. Skills are markdown. Every check a hook or a repo relies on is a small script with its own tests: Python standard library for the hooks and the SwiftUI checks, zero-dependency Node for the web guardrails that get copied into a consuming repo. One JSON file, `stacks.json`, is the machine-readable part of the stack reference files, so the skill and both hooks read the same UI file patterns.

**Tech Stack:** Python 3 (standard library; PyYAML optional), Node 22 (`node:test`, no packages), JSON Schema 2020-12, Claude Code plugin `hooks/hooks.json` and `agents/`.

**Spec:** `docs/superpowers/specs/2026-09-26-design-onboarding-design.md`

## Global Constraints

- Work only in `/Users/nick/workspace/code/process-pack/.worktrees/design-onboarding`, branch `design-onboarding`. The main checkout has an unrelated uncommitted edit.
- All plugin paths are under `plugins/process-pack/` unless stated.
- Hooks are Python, standard library only, like `hooks/stub-guard/stub_guard.py`. Each ships `README.md`, an example config, and a `--dry-run` self-test that builds throwaway git repos.
- The nudge never blocks. The gate blocks only `gh pr create`.
- Any hook error (not a git repo, git missing, unreadable config) fails open: allow, with one warning line on stderr.
- Impeccable is the only writer of DESIGN.md. `ibelick/create-design-md` is not used.
- Impeccable minimum version for preflight: 4.3.
- The design taste file lives at `~/.config/process-pack/design-taste.yaml` and is never committed. Onboarding copies rules into the repo; it never links to the home-directory file.
- UI Skills are found with `npx ui-skills list` and installed with `npx skills@1.7.0 add <owner>/<repo>#<sha> --skill <name> --agent claude-code codex opencode pi --copy -y`. Never fetched from `main` at run time. No hand-written downloader.
- Portability (spec section 6): skills name no Claude-only tool as the only way to do a step; the reviewer method lives in a skill file any agent can follow; each hook keeps its decision in a function separate from the Claude Code input and output layer.
- Review record path: `<git common dir>/process-pack/design-reviews/<branch>.json`, never committed.
- Plugin version goes from 1.4.0 to 1.5.0 in both `plugins/process-pack/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` (both entries).
- Written artifacts: no em dashes, no coined terms reused, one idea per sentence.
- Machine: one heavy command at a time; at most 3 subagents that can run Bash; set `model` on every Agent call; never `fable`.
- Commit on the branch after each task.

## Decisions this plan makes that the spec leaves open

Nick, confirm or change these when you review.

1. **Hooks are registered by the plugin.** A new `hooks/hooks.json` wires both hooks with `${CLAUDE_PLUGIN_ROOT}`, the way impeccable 4.0.4 does. The two existing hooks in `hooks/stub-guard/` and `hooks/wall-guard/` stay hand-wired. Reason: the gate has to run in Cyrus sessions without anyone editing the box's `settings.json`.
2. **`stacks.json` is the machine-readable half of the stack reference files.** The spec says UI file patterns come from the stack reference file. Markdown is not a reliable input for a hook, so the patterns live in `skills/design-onboard/stacks/stacks.json` and each stack's markdown file points at its entry.
3. **The Tailwind check that blocks hardcoded colors is a zero-dependency Node script, not an ESLint rule.** It is wired into the repo's `lint` script. Reason: pepino uses Biome, so an ESLint rule would not cover the repos this is for. This is replaced by an impeccable custom rule if Task 1 finds that possible.
4. **The contrast check is a `node:test` file ported from Meridian's Jest test.** It needs no test runner in the consuming repo. It must parse oklch, because shadcn on Tailwind v4 writes oklch tokens (unverified; confirm in Task 3).
5. **The `skills` CLI version is pinned to 1.7.0** in every command, because that is the version evaluated on 2026-09-26 (spec, External tools). Its `skills-lock.json` is the only record of each skill's commit; `.process/repo.yaml` records only why each skill was picked. Every install runs with `DO_NOT_TRACK=1 DISABLE_TELEMETRY=1`; whether that stops the telemetry request is unverified.
6. **The review record lives under the git common dir**, so every worktree of a clone shares it. Branch names have `/` replaced by `__` in the file name.
7. **The escape hatch is a record with `skip_reason`.** When Nick says to skip the review in the session, the `design-review` skill writes a record for `HEAD` with his reason. The gate treats it like a review of that commit.
8. **`.process/repo.yaml` gets a `design` block** in `repo.schema.json`. The gate reads `design.ui_globs` from it when PyYAML is importable; without PyYAML it uses `stacks.json` and says so on stderr.

## Review Focus

1. **Branch names with slashes and worktrees.** `feat/x` on a worktree must find the record written from the main checkout. Test: `gate_record_found_from_worktree`, `gate_branch_with_slash` in Task 9.
2. **Rebased or amended branch.** If the reviewed SHA is no longer an ancestor of `HEAD`, the record is stale and the gate blocks with a message that says the branch was rewritten. Test: `gate_blocks_when_reviewed_sha_not_ancestor` in Task 9.
3. **Command shapes.** `cd app && gh pr create --fill`, `gh pr create -B develop`, and `GH_TOKEN=x gh pr create` all trigger the gate; `gh pr create --help`, `gh pr list` and `echo "gh pr create"` do not. Test: `gate_command_matching` in Task 9.
4. **Monorepo DESIGN.md.** UI in `apps/web` with `apps/web/DESIGN.md` present is silent; a root DESIGN.md also counts; a second app with UI and no DESIGN.md nudges and names that app. Test: `nudge_monorepo_cases` in Task 8.
5. **Hook failure must not block work.** Outside a git repo, with no `origin`, or with a corrupt record, the nudge is silent and the gate allows with a stderr warning. Tests: `nudge_not_a_repo`, `gate_fails_open_on_corrupt_record`, `gate_no_base_branch` in Tasks 8 and 9.

---

### Task 1: Update impeccable on the laptop and settle the rule-engine question

**Files:**
- Create: `docs/superpowers/notes/2026-09-26-impeccable-4.3.1.md`

**Interfaces:**
- Produces: a yes or no on "impeccable accepts custom rules from outside the plugin", with the file and API that proves it. Task 3 reads this to decide where the hardcoded-color check lives.

- [ ] **Step 1: Record the before state.** Run `python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.claude/plugins/installed_plugins.json')))['plugins']['impeccable@impeccable'])"`. Expected: `version` `4.0.4`.
- [ ] **Step 2: Update.** Find the update command with `claude plugin --help` (the exact subcommand is unverified). Run it for `impeccable@impeccable`. Expected: the same check reports `4.3.1` and an install path ending `/4.3.1`.
- [ ] **Step 3: Check whether 4.4.0 has shipped.** Run `gh api repos/pbakaus/impeccable/releases --jq '.[0].tag_name'`. If it is newer than `skill-v4.3.1`, stop and tell Nick, because the spec says preflight's minimum is revisited then.
- [ ] **Step 4: Read the rule API.** In the 4.3.1 install, grep for the 4.2.0 change ("downstream package can add its own rules") in `CHANGELOG*`, `skills/impeccable/scripts/`, and `reference/`. Answer three questions in the note: does the Claude plugin load rules from a path outside itself; what file or config names that path; does the PostToolUse edit hook run those rules.
- [ ] **Step 5: Write the note** with the three answers and the file paths that prove each one. List the Fedora box update as a step for Nick. Do not ssh to the box.
- [ ] **Step 6: Commit.** `git add docs/superpowers/notes && git commit -m "docs: record impeccable 4.3.1 update and rule API finding"`

### Task 2: Design taste file: schema, example, and Nick's seeded file

**Files:**
- Create: `plugins/process-pack/constants/schemas/design-taste.schema.json`
- Create: `plugins/process-pack/constants/examples/design-taste.yaml`
- Create: `plugins/process-pack/constants/tests/test_design_taste_schema.py`
- Create outside the repo: `~/.config/process-pack/design-taste.yaml`

**Interfaces:**
- Produces: top-level keys `version`, `looks_to_avoid`, `craft_floor`, `color_discipline`, `accessibility_floor`, `copy`, `critique_method`. Each of the first five is a list of rules. A rule is `{id, default_stance, applicability_gate, named_exceptions: [str], escape_hatch}`, all required. `copy` also has `points_at: [str]`. `critique_method` is `{dimensions: [8 names], each_point_needs_fix: true}`.

- [ ] **Step 1: Write the failing test** in `test_design_taste_schema.py` using `jsonschema` and PyYAML:
  - `test_example_validates`: the example validates.
  - `test_rule_missing_escape_hatch_fails`: a copy of the example with one rule's `escape_hatch` deleted fails.
  - `test_eight_dimensions`: `critique_method.dimensions` equals `["hierarchy", "identity", "containment and space", "typography", "color", "density and rhythm", "motion and state", "consistency"]`.
  - `test_real_file_validates`: skipped when `~/.config/process-pack/design-taste.yaml` does not exist; validates it when it does.
- [ ] **Step 2: Run it.** `python3 -m pytest plugins/process-pack/constants/tests -q`. Expected: FAIL, schema file missing.
- [ ] **Step 3: Write the schema** matching the Interfaces block, `additionalProperties: false` at every level, like `repo.schema.json`.
- [ ] **Step 4: Write the anonymized example.** It carries the six sections of spec component 1 with the spec's rule content, in taste-rules anatomy. `copy.points_at` is `["patterns-sentence-case-ui-copy", "voice-guide", "ui-copy"]`. No product names, no Meridian brand values.
- [ ] **Step 5: Run the test.** Expected: 3 pass, 1 skipped.
- [ ] **Step 6: Seed the real file.** Read Meridian's `PRODUCT.md`, the principles section of `DESIGN.md`, `.claude/skills/design-first/SKILL.md`, and `.claude/skills/ui-copy/SKILL.md` in `/Users/nick/workspace/code/component-monkey-app` (read only). Keep every rule that is not Meridian's brand: drop its palette, typeface, product names, and domain terms. Write `~/.config/process-pack/design-taste.yaml` with mode 0644. Beside each rule, add a YAML comment naming the Meridian file it came from.
- [ ] **Step 7: Run the test.** Expected: 4 pass.
- [ ] **Step 8: Commit** the schema, example and test (the real file is outside the repo). `git commit -m "feat(constants): add design taste schema and example"`
- [ ] **Step 9: STOP. Nick reviews `~/.config/process-pack/design-taste.yaml`.** Show him the file and a list of what was dropped as brand. No later task reads the file until he approves it.

### Task 3: Tailwind guardrails, `stacks.json`, and the `design` block in the repo schema

**Files:**
- Create: `plugins/process-pack/skills/design-onboard/stacks/stacks.json`
- Create: `plugins/process-pack/skills/design-onboard/assets/web/check-design-tokens.mjs`
- Create: `plugins/process-pack/skills/design-onboard/assets/web/design-tokens-contrast.test.mjs`
- Create: `plugins/process-pack/skills/design-onboard/assets/web/contrast-pairs.example.json`
- Create: `plugins/process-pack/skills/design-onboard/assets/web/tests/check-design-tokens.test.mjs`
- Create: `plugins/process-pack/skills/design-onboard/assets/web/tests/contrast.test.mjs`
- Create: `plugins/process-pack/skills/design-onboard/assets/web/tests/fixtures/` (see steps)
- Modify: `plugins/process-pack/constants/schemas/repo.schema.json` (add `design`)
- Modify: `plugins/process-pack/constants/examples/repo.example.yaml` (add a `design` example)
- Test: `plugins/process-pack/constants/tests/test_repo_schema_design.py`

If Task 1 found that impeccable accepts custom rules, `check-design-tokens.mjs` is written as an impeccable rule instead, at the path the note names, with the same tests. Everything else in this task stays.

**Interfaces:**
- Produces `stacks.json`:
  ```json
  {
    "version": "1",
    "exclude_globs": ["**/*.md", "**/*.mdx", "docs/**", "**/*.test.*", "**/*.spec.*", "**/__tests__/**", "**/*.config.*", "**/*.json", "**/*.yaml", "**/*.yml", "**/*.lock"],
    "stacks": [
      { "id": "tailwind", "reference": "tailwind.md",
        "detect": { "files_any": ["tailwind.config.js", "tailwind.config.ts", "tailwind.config.mjs", "tailwind.config.cjs"], "package_deps_any": ["tailwindcss"] },
        "ui_globs": ["**/*.tsx", "**/*.jsx", "**/*.css", "**/*.html"] }
    ]
  }
  ```
  Task 6 appends `css`, `swiftui`, and a final `other` entry. `other` has `ui_globs` for `*.html`, `*.vue`, `*.svelte`, `*.astro`, `*.swift` and an empty `detect`.
- Produces `check-design-tokens.mjs`: CLI `node check-design-tokens.mjs --tokens <file> [--root <dir>] [--glob <g>]...`. Exit 0 when clean. Exit 1 and print `path:line: <match> (<reason>)` per hit. Flags Tailwind palette-shade classes (`(bg|text|border|ring|fill|stroke|from|via|to|outline|decoration|divide|placeholder|shadow|accent|caret)-<palette color>-<50..950>`), arbitrary color classes (`-[#…]`, `-[rgb(…)]`), and hex, `rgb()`, `hsl()` and `oklch()` literals in `.ts`, `.tsx`, `.js`, `.jsx`, `.css` files. The `--tokens` file is exempt. A line containing `design-tokens-allow: <reason>` is exempt.
- Produces `design-tokens-contrast.test.mjs`: reads `DESIGN_TOKENS_FILE` (default `app/globals.css`) and `CONTRAST_PAIRS_FILE` (default `.process/contrast-pairs.json`, shape `[{ "fg": "--foreground", "bg": "--background", "min": 4.5 }]`). Parses custom properties per theme block (`:root`, `.dark`, `@theme`, `[data-theme=…]`). Accepts hex, `rgb()`, `hsl()`, bare shadcn HSL triplets like `222 47% 11%`, and `oklch()`. One test per pair per theme, named `<theme> <fg> on <bg> >= <min>`.
- Produces `repo.schema.json` `design` object: `onboarded_at` (date), `impeccable_version`, `stack`, `path` (enum `greenfield`, `lean-in`, `polish-hard`, `new-direction`), `ui_globs` (string array, optional override), `ui_skills` (array of `{name, source, reason}`, all required; the commit lives in `skills-lock.json`). `additionalProperties: false`.

- [ ] **Step 1: Write fixtures.** Under `assets/web/tests/fixtures/`: `tokens.css` (a `:root` and a `.dark` block, one pair in oklch and one in hex); `clean/Button.tsx` (token classes only); `dirty/Card.tsx` (`text-orange-600`, `bg-[#ff0000]`, a `"#333"` style value, and one line with `design-tokens-allow: brand logo`); `pairs.json` with one passing pair and one failing pair.
- [ ] **Step 2: Write the failing tests.**
  - `check-design-tokens.test.mjs`: `clean exits 0`; `dirty reports exactly 3 hits with line numbers`; `allow comment is exempt`; `tokens file is exempt`.
  - `contrast.test.mjs`: `oklch(0.145 0 0) on oklch(1 0 0) is about 18.9` (within 0.2); `#777777 on #ffffff is 4.48`; `hsl triplet parses`; `failing pair fails with both colors and the ratio in the message`.
  - `test_repo_schema_design.py`: `test_example_with_design_validates`; `test_design_bad_path_enum_fails`; `test_ui_skill_needs_reason`.
- [ ] **Step 3: Run them.** `node --test plugins/process-pack/skills/design-onboard/assets/web/tests/` and `python3 -m pytest plugins/process-pack/constants/tests -q`. Expected: FAIL, modules missing.
- [ ] **Step 4: Port the contrast logic.** Start from Meridian's `packages/ui/src/__tests__/design-tokens-contrast.test.ts` (read only). Keep its WCAG relative luminance math. Add oklch to sRGB conversion per CSS Color 4 (oklch to oklab to linear sRGB, then clamp) if Meridian lacks it.
- [ ] **Step 5: Implement `check-design-tokens.mjs`, the schema change, and the example.**
- [ ] **Step 6: Run the tests.** Expected: all pass.
- [ ] **Step 7: Commit.** `git commit -m "feat(design-onboard): add web guardrails, stacks.json, and repo design schema"`

### Task 4: The Jev client

**Files:**
- Create: `plugins/process-pack/tools/jev/jev_client.py`
- Create: `plugins/process-pack/tools/jev/README.md`
- Test: the `--dry-run` inside `jev_client.py`

**Interfaces:**
- Produces `ask(state: str, questions: dict, *, timeout: float = 20.0) -> dict`. A question is `{"type": "noul", "instructions": str}` or `{"type": "choice", "instructions": str, "criteria": {option: description}}`, the shapes Meridian's `scripts/lane-label.ts` sends. The return value is `{"source": "typesafe" | "openrouter" | "none", "answers": {id: {"type": "noul", "noul": float} | {"type": "choice", "choice": str, "probabilities": {option: float}, "confidence": float}}, "reason": str | None}`. On `none`, `answers` is `{}` and `reason` says why.
- Route: `TYPESAFE_API_KEY` set means `POST https://api.typesafe.ai/v1/systemone` with body `{"model": "jev-latest", "state", "questions"}`. Else `OPENROUTER_API_KEY` set means `POST https://openrouter.ai/api/v1/chat/completions` with model `typesafe/jev-router` and a system message asking for a JSON object in the same `answers` shape. Else `none` with no network call.
- `JEV_TYPESAFE_URL` and `JEV_OPENROUTER_URL` override the two URLs, for the tests only.
- Produces `prepare_state(text: str) -> str`: drops diff sections for `.env*`, `**/secrets/**`, `*.lock`, `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, then caps the result at 8192 bytes.
- CLI: `jev_client.py ask --state-file <f> --questions-file <json>` prints the return value as JSON and always exits 0. `jev_client.py --dry-run`.

- [ ] **Step 1: Write the dry-run cases** against a local `http.server` stub started on a free port: `typesafe_answer`; `openrouter_answer_when_only_that_key`; `typesafe_preferred_when_both_keys`; `no_key_makes_no_request` (the stub counts zero requests); `timeout_returns_none`; `http_500_returns_none`; `malformed_reply_returns_none`; `probability_out_of_range_returns_none`; `choice_not_in_criteria_returns_none`; `lockfile_section_dropped`; `state_capped_at_8192_bytes`.
- [ ] **Step 2: Run** `python3 plugins/process-pack/tools/jev/jev_client.py --dry-run`. Expected: FAIL.
- [ ] **Step 3: Implement** with `urllib.request`. Validate every answer before returning it: probabilities in [0, 1], a `choice` inside its `criteria`.
- [ ] **Step 4: Run.** Expected: every case PASS.
- [ ] **Step 5: One live call per route whose key is available** (`TYPESAFE_API_KEY` is set in the laptop shell; the OpenRouter key is read with `op read` only if it exists in 1Password). One `noul` question: "This text describes a change to a user interface." over a two-line state. Record each result and its `source` in the Task 11 evidence note. Say which route did not run and why.
- [ ] **Step 6: Write the README:** the three routes, that every call on the first two is billed, and that the OpenRouter route's probabilities are the chosen model's own estimate, not Jev's.
- [ ] **Step 7: Commit.** `git commit -m "feat(tools): add Jev client with TypeSafe and OpenRouter routes"`

### Task 5: The `design-onboard` skill and the Tailwind reference file

**Files:**
- Create: `plugins/process-pack/skills/design-onboard/SKILL.md`
- Create: `plugins/process-pack/skills/design-onboard/stacks/tailwind.md`

**Interfaces:**
- Consumes: `stacks.json`, the three web assets from Task 3; the design taste schema from Task 2; `jev_client.py` from Task 4.
- Produces: the skill name `design-onboard`, which the nudge text in Task 8 names.

- [ ] **Step 1: Write `SKILL.md`** with frontmatter `name: design-onboard` and a description that triggers on "onboard design", a repo with UI and no DESIGN.md, and the nudge text. Body sections, in spec order:
  - Preflight: read the impeccable version from `~/.claude/plugins/installed_plugins.json`; stop below 4.3 with the update instruction. Detect stack from `stacks.json`, app or site, each monorepo app (`pnpm-workspace.yaml`, `turbo.json`, `apps/*`), and whether UI exists.
  - Product truth: impeccable's init writes or updates PRODUCT.md.
  - Greenfield steps 3 to 6 exactly as spec component 2, including 6 to 10 references with one line each, 2 or 3 HTML mocks under `docs/design/onboarding/`, screenshots, and Nick's pick as the only required stop (worded as "ask Nick to pick", with `AskUserQuestion` named as the Claude Code way).
  - Existing-UI steps 3 to 5 exactly as spec component 2, with the three-branch table and the contents of `docs/design/evolution/README.md`.
  - Guardrails step 7: copy the stack's checks; pick 3 to 5 UI Skills with `npx ui-skills list --category <c>`, always one accessibility scan skill; for each, get the SHA with `git ls-remote https://github.com/<owner>/<repo> refs/heads/main` and install with the pinned `skills add` command from Global Constraints; skip any pick not hosted on GitHub; commit the skill directories and `skills-lock.json`; add a design section to AGENTS.md whose hard rules point at the design skills; write the `design` block to `.process/repo.yaml`; commit.
  - A rule that the skill copies taste rules into PRODUCT.md and AGENTS.md and never links to `~/.config`.
  - A rule that impeccable is the only writer of DESIGN.md.
  - Mock taste check (spec section 7), before Nick's pick: for each mock, run `jev_client.py ask` with the mock's HTML and CSS as the state and one `noul` question per rule in the design taste file's section on looks to avoid. At or above 0.5, re-render once naming the rule; if still flagged, show the mock with the flag. Record the threshold and each result in the onboarding output. With `source: none`, say the check was skipped.
  - Branch second opinion (spec section 7), after the audit: one `choice` question over the audit summary with the three branches as options and the table's "When it fits" text as criteria. Show the agent's pick, Jev's pick with confidence and source, and say plainly when they differ.
- [ ] **Step 2: Write `stacks/tailwind.md`.** Four answers from spec component 3: detection (points at the `tailwind` entry in `stacks.json`), where tokens go (v3 `tailwind.config` plus CSS variables, v4 `@theme`), what blocks hardcoded colors (copy `check-design-tokens.mjs` to `scripts/`, add it to the `lint` script), and how contrast is checked (copy the contrast test and the pairs example, add a `test:contrast` script running `node --test`).
- [ ] **Step 3: Check the skill against the spec.** For each numbered step in spec component 2, name the SKILL.md heading that carries it. Any gap gets fixed now.
- [ ] **Step 4: Commit.** `git commit -m "feat(design-onboard): add the onboarding skill and Tailwind reference"`

### Task 6: Plain CSS and SwiftUI reference files

**Files:**
- Create: `plugins/process-pack/skills/design-onboard/stacks/css.md`
- Create: `plugins/process-pack/skills/design-onboard/assets/web/stylelint.design.json`
- Create: `plugins/process-pack/skills/design-onboard/stacks/swiftui.md`
- Create: `plugins/process-pack/skills/design-onboard/assets/swiftui/swiftlint.design.yml`
- Create: `plugins/process-pack/skills/design-onboard/assets/swiftui/asset_catalog_contrast.py`
- Create: `plugins/process-pack/skills/design-onboard/assets/swiftui/tests/test_swiftui_checks.py` and fixtures
- Create: `plugins/process-pack/skills/design-onboard/stacks/other.md`
- Modify: `stacks.json` (add `css`, `swiftui`, `other`)

**Interfaces:**
- `css` entry: detect `package_deps_any: ["vue", "svelte", "@sveltejs/kit", "astro"]` or `files_any: ["*.css"]` at the root; `ui_globs` `**/*.css`, `**/*.scss`, `**/*.vue`, `**/*.svelte`, `**/*.astro`, `**/*.html`.
- `swiftui` entry: detect `files_any: ["Package.swift", "*.xcodeproj"]`; `ui_globs` `**/*.swift`, `**/*.xcassets/**`.
- `asset_catalog_contrast.py <Assets.xcassets> --pairs <json>`: reads each `*.colorset/Contents.json` (sRGB components as floats or `0x` hex, `any` and `dark` appearances), prints one line per pair per appearance, exits 1 on any failure.
- `swiftlint.design.yml`: a `custom_rules.no_color_literals` regex matching `Color(red:`, `Color(.sRGB`, `Color(hue:`, `Color(white:`, `UIColor(red:`, `#colorLiteral`, and `Color(hex:`.

- [ ] **Step 1: Write the failing SwiftUI tests.** `test_contrast_pass_and_fail` over two fixture colorsets; `test_dark_appearance_checked`; `test_swiftlint_regex_matches` over 7 literal lines and `test_swiftlint_regex_ignores` `Color("brand")` and `Color.accentColor`. The regex test loads the pattern from the YAML file, because SwiftLint is not installed on the laptop.
- [ ] **Step 2: Run.** `python3 -m pytest plugins/process-pack/skills/design-onboard/assets/swiftui/tests -q`. Expected: FAIL.
- [ ] **Step 3: Implement the script and the SwiftLint file.**
- [ ] **Step 4: Run.** Expected: pass.
- [ ] **Step 5: Write `stylelint.design.json`** with `color-no-hex: true`, `color-named: "never"`, and `function-disallowed-list` for `rgb`, `rgba`, `hsl`, `hsla`, `oklch`, `lab`, `lch`, and an `ignoreFiles` entry for the tokens file. These rule names are unverified; check them in Step 6.
- [ ] **Step 6: Run Stylelint once against the Task 3 fixtures.** `npx -y stylelint@16 --config stylelint.design.json "tests/fixtures/**/*.css"` from `assets/web`. Expected: hits on literal colors, none in `tokens.css`. This is the one heavy command in this task.
- [ ] **Step 7: Write `css.md`, `swiftui.md`, and `other.md`** with the same four answers as `tailwind.md`. `other.md` says plainly that there is no check that blocks hardcoded colors and no contrast check.
- [ ] **Step 8: Commit.** `git commit -m "feat(design-onboard): add plain CSS, SwiftUI, and fallback stack references"`

### Task 7: The reviewer method, the `design-review` skill, the Claude Code agent wrapper, and the review record

**Files:**
- Create: `plugins/process-pack/skills/design-review/reviewer.md`
- Create: `plugins/process-pack/agents/design-reviewer.md`
- Create: `plugins/process-pack/skills/design-review/SKILL.md`
- Create: `plugins/process-pack/skills/design-review/scripts/review_record.py`
- Test: the `--dry-run` inside `review_record.py`

**Interfaces:**
- Produces `review_record.py`, importable by the gate:
  - `record_path(cwd: str, branch: str) -> Path`: `<git rev-parse --git-common-dir>/process-pack/design-reviews/<branch with / replaced by __>.json`.
  - `write_record(cwd, *, reviewed_sha, ui_files, findings_fixed, findings_left, screenshots, skip_reason=None) -> Path`. Writes `{branch, reviewed_sha, ui_files, findings_fixed, findings_left, screenshots, skip_reason, written_at}`.
  - `read_record(cwd, branch) -> dict | None`. Returns `None` for missing or unparseable files.
  - CLI: `review_record.py write --sha HEAD --ui-file <f>... --fixed <s>... --left <s>... --screenshot <p>... [--skip-reason <s>]` and `review_record.py --dry-run`.
- Consumes: the accessibility skill's name from `.process/repo.yaml` `design.ui_skills`, installed under `.agents/skills/`.

- [ ] **Step 1: Write the dry-run cases first** in `review_record.py`: `path_uses_common_dir_from_worktree`, `slash_branch_is_flattened`, `round_trip`, `corrupt_file_reads_as_none`, `skip_reason_round_trip`. Each builds a temp repo, and the worktree case adds one with `git worktree add`.
- [ ] **Step 2: Run** `python3 review_record.py --dry-run`. Expected: FAIL for each case.
- [ ] **Step 3: Implement** the three functions and the CLI. Resolve `HEAD` to a full SHA before writing.
- [ ] **Step 4: Run.** Expected: 5 PASS.
- [ ] **Step 5: Write `skills/design-review/reviewer.md`.** Read Meridian's `.claude/agents/design-reviewer.md` (read only). Keep its method. Replace Meridian specifics (its tokens, product names, package paths) with reads of the target repo's DESIGN.md, PRODUCT.md, and AGENTS.md design rules. No Claude-only tool names.
- [ ] **Step 5b: Write `agents/design-reviewer.md`** as a Claude Code wrapper: frontmatter, then one instruction to follow `skills/design-review/reviewer.md`. Keep Meridian's `model` frontmatter value if it sets one.
- [ ] **Step 6: Write `skills/design-review/SKILL.md`** with the six steps of spec component 4 in order: read the three docs; find touched screens and run the app with the `run` skill or a preview URL; screenshot desktop (1440 wide) and mobile (390 wide); run impeccable's critique and the installed accessibility skill by following `reviewer.md` (in Claude Code, through the `design-reviewer` agent); fix, at most two rounds, list the rest; write the record with `review_record.py write` and hand the summary and screenshots to `qa-brief`. Add a section for the escape hatch: only when Nick says to skip in the session, write the record with `--skip-reason "<his words>"`.
- [ ] **Step 7: Commit.** `git commit -m "feat(design-review): add reviewer agent, review skill, and review record"`

### Task 8: `hooks/design-onboard-nudge` (SessionStart)

**Files:**
- Create: `plugins/process-pack/hooks/design-common/design_common.py`
- Create: `plugins/process-pack/hooks/design-onboard-nudge/design_onboard_nudge.py`
- Create: `plugins/process-pack/hooks/design-onboard-nudge/README.md`
- Create: `plugins/process-pack/hooks/design-onboard-nudge/design-onboard-nudge.config.example.json`

**Interfaces:**
- Produces `design_common.py`, used by both hooks:
  - `glob_match(path: str, pattern: str) -> bool`. `**/` matches zero or more directories; `*` does not cross `/`. Python 3.11 has no `PurePath.full_match`, so this is hand-written.
  - `load_stacks() -> dict` from `../../skills/design-onboard/stacks/stacks.json` relative to the hook file.
  - `detect_stack(root: Path) -> dict`: the first `stacks.json` entry whose `detect` matches, else `other`.
  - `ui_globs(root: Path) -> list[str]`: `.process/repo.yaml` `design.ui_globs` when PyYAML imports and the key exists, else the detected stack's globs.
  - `is_ui_file(path: str, globs: list[str], exclude: list[str]) -> bool`.
  - `app_roots(root: Path) -> list[Path]`: the root, plus each `apps/*` and `packages/*` that has its own `package.json` or `Package.swift`.
- Produces the nudge output on stdout, exit 0:
  `{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "This repo has UI files and no DESIGN.md (<app paths>). Run the design-onboard skill before any UI work."}}`

- [ ] **Step 1: Write the dry-run cases,** structured like the `--dry-run` in `hooks/stub-guard/stub_guard.py`: `nudge_ui_without_design_md`; `nudge_silent_with_design_md`; `nudge_silent_without_ui`; `nudge_monorepo_cases` (app DESIGN.md silences that app, root DESIGN.md silences all, second app without one is named); `nudge_not_a_repo` (silent, exit 0); `nudge_only_tracked_files_count` (an untracked `.tsx` does not trigger it). Add `glob_match` unit cases in `design_common.py --dry-run`: `**/*.tsx` matches `a.tsx` and `x/y/a.tsx`; `docs/**` matches `docs/a/b.md`; `*.md` does not match `x/a.md`.
- [ ] **Step 2: Run both dry runs.** Expected: FAIL.
- [ ] **Step 3: Implement.** UI files come from `git ls-files`. Any exception exits 0 with nothing on stdout and one line on stderr.
- [ ] **Step 4: Run both dry runs.** Expected: all PASS.
- [ ] **Step 5: Write the README** with the same sections as `hooks/stub-guard/README.md` (Why, Install, Config, Override, Dry run), and the example config holding only an `enabled` flag and the `ui_globs` override note.
- [ ] **Step 6: Commit.** `git commit -m "feat(hooks): add design-onboard-nudge SessionStart hook"`

### Task 9: `hooks/design-review-gate` (PreToolUse on `gh pr create`)

**Files:**
- Create: `plugins/process-pack/hooks/design-review-gate/design_review_gate.py`
- Create: `plugins/process-pack/hooks/design-review-gate/README.md`
- Create: `plugins/process-pack/hooks/design-review-gate/design-review-gate.config.example.json`

**Interfaces:**
- Consumes: `design_common` (Task 8), `review_record.read_record` and `record_path` (Task 7), `jev_client.ask` (Task 4).
- Produces `decide(cwd: str, command: str) -> dict`, returning `{"action": "allow"}` or `{"action": "block", "reason": str}`. `decide` reads no hook payload and prints nothing; `main()` is the Claude Code layer that parses the payload and writes the output. The nudge follows the same split with `nudge_text(cwd: str) -> str | None`.
- Block output: the reason on stderr, `{"decision": "block", "reason": ...}` on stdout, exit 2. Reasons, exact text:
  - No record: `This branch changes UI files (<n> files) and has no design review. Run the design-review skill, then retry gh pr create.`
  - Stale: `This branch changed UI files after the design review at <short sha>: <up to 5 files>. Run the design-review skill again, then retry gh pr create.`
  - Rewritten: `The design review was for <short sha>, which is no longer in this branch's history. Run the design-review skill again, then retry gh pr create.`

- [ ] **Step 1: Write the dry-run cases.** Each builds a repo with a bare `origin`, a `main`, and a feature branch.
  - `gate_blocks_ui_change_without_record`
  - `gate_blocks_stale_record` (record at commit A, UI file changed in commit B)
  - `gate_passes_docs_only_diff` (only `README.md` and `docs/x.md`)
  - `gate_passes_tests_and_config_only` (`a.test.tsx`, `tailwind.config.ts`)
  - `gate_passes_fresh_record` (record at `HEAD`)
  - `gate_passes_record_then_non_ui_commit` (record at A, only `README.md` changed after)
  - `gate_passes_skip_record` (record at `HEAD` with `skip_reason`)
  - `gate_blocks_when_reviewed_sha_not_ancestor` (record SHA from an amended commit)
  - `gate_branch_with_slash` and `gate_record_found_from_worktree`
  - `gate_command_matching`: triggers on `gh pr create`, `cd app && gh pr create --fill`, `GH_TOKEN=x gh pr create`, `gh pr create -B develop`; no trigger on `gh pr create --help`, `gh pr list`, `echo "gh pr create"`
  - `gate_uses_base_flag` (`-B develop` diffs against `develop`)
  - `gate_no_base_branch` (no `origin`, no `main`: allow with a warning)
  - `gate_shadow_logs_one_line_per_attempt` (Jev stub answers; `jev-gate.jsonl` gains one line with `probability`, `source`, and the file-pattern result)
  - `gate_decision_same_without_keys` (both keys unset: the same decisions as with a stub answer, and the log line has `source: none`)
  - `gate_does_not_wait_for_jev` (the stub sleeps 5 seconds; the gate returns in under 1 second)
  - `gate_fails_open_on_corrupt_record` (unparseable record: treated as no record, so it blocks; an exception inside `decide` allows)
- [ ] **Step 2: Run** `python3 design_review_gate.py --dry-run`. Expected: FAIL.
- [ ] **Step 3: Implement.** Base branch: `--base`/`-B` value, else `git symbolic-ref refs/remotes/origin/HEAD`, else `origin/main`, else `main`. Diff: `git diff --name-only $(git merge-base <base> HEAD)..HEAD`. Staleness: `git merge-base --is-ancestor <reviewed_sha> HEAD`, then `git diff --name-only <reviewed_sha>..HEAD` filtered to UI files. The command regex follows `COMMIT_RE` in `hooks/stub-guard/stub_guard.py`: match at line start or after `;`, `&`, `|`, allow `VAR=value` prefixes, and skip a match inside quotes by requiring balanced quotes before it.
- [ ] **Step 4: Run.** Expected: every case PASS.
- [ ] **Step 5: Write the README and example config.** The README says the gate is separate from `~/.claude/hooks/pr-review-gate.sh`, which is unchanged.
- [ ] **Step 6: Commit.** `git commit -m "feat(hooks): add design-review-gate PreToolUse hook"`

### Task 10: Hook registration, version bump, README

**Files:**
- Create: `plugins/process-pack/hooks/hooks.json`
- Modify: `plugins/process-pack/.claude-plugin/plugin.json` (`version` to `1.5.0`)
- Modify: `.claude-plugin/marketplace.json` (both `version` fields to `1.5.0`)
- Modify: `README.md` (a section after "What's in the box")

- [ ] **Step 1: Write `hooks.json`.** `SessionStart` runs `python3 "${CLAUDE_PLUGIN_ROOT}/hooks/design-onboard-nudge/design_onboard_nudge.py"` with timeout 5. `PreToolUse` with matcher `Bash` runs `python3 "${CLAUDE_PLUGIN_ROOT}/hooks/design-review-gate/design_review_gate.py"` with timeout 10. The two existing hooks are not added.
- [ ] **Step 2: Check the JSON parses and every path exists.** A `python3 -c` one-liner that loads `hooks.json`, substitutes the plugin root, and asserts each script file exists. Expected: no output, exit 0.
- [ ] **Step 3: Bump both versions.** `grep -rn '"version"' plugins/process-pack/.claude-plugin/plugin.json .claude-plugin/marketplace.json`. Expected: three lines, all `1.5.0`.
- [ ] **Step 4: Write the README section** "Design onboarding": what the two skills do, the two hooks and that they register themselves, where the taste file lives, the three stacks covered, and that enforcement is Claude Code only.
- [ ] **Step 5: Run every test in the branch once, one at a time.** The four dry runs, `node --test` for the web assets, and `pytest` for the two Python test folders. Expected: all pass.
- [ ] **Step 6: Commit.** `git commit -m "feat: register design hooks and release process-pack 1.5.0"`

### Task 11: Verification runs

All scratch work lives under `/Users/nick/scratch/process-pack-design-onboarding/`. Evidence goes in `docs/superpowers/notes/2026-09-26-design-onboarding-verification.md` in the worktree.

- [ ] **Step 1: Load the worktree plugin into a session.** Find the flag with `claude --help` (a `--plugin-dir` option is unverified). Confirm with a headless run in the scratch repo that the nudge line appears. If no such flag exists, run the hooks by piping the exact payload JSON to them, and say so in the evidence.
- [ ] **Step 2: Greenfield dry run.** `npx create-next-app@latest greenfield --ts --tailwind --app --no-src-dir --use-pnpm --yes` in the scratch folder (flags unverified; check `--help`). Run `design-onboard` end to end. **STOP at the direction pick: Nick chooses.** Evidence: the commit listing PRODUCT.md, DESIGN.md, the tokens file, the two checks passing, `skills-lock.json` with a `ref` per skill, and `.process/repo.yaml`.
- [ ] **Step 3: Existing-UI dry run on pepino, read only.** Record `git -C ~/workspace/code/pikl/pepino status --porcelain | shasum` and `git rev-parse HEAD` before. Run the audit and recommendation with every output written to `/Users/nick/scratch/process-pack-design-onboarding/pepino-audit/`, never into pepino. Stop before any change. Record the same two values after. Expected: identical.
- [ ] **Step 4: Gate run in the greenfield repo.** Create a branch, change one screen's `.tsx`, commit. Add a bare local repo as `origin` so `gh pr create` has something to diff against and cannot publish anything. Attempt `gh pr create --fill`. Expected: blocked with the no-record reason. Run `design-review`. Attempt again. Expected: the gate allows it, and `gh` then fails on its own because the remote is not on GitHub. Record both outputs.
- [ ] **Step 5: Hook and client test evidence.** Paste the dry-run outputs of both hooks, the review record, and the Jev client into the evidence note. Add the Jev answers from Steps 2 to 4, each with its `source`, and the gate's `jev-gate.jsonl` lines.
- [ ] **Step 6: Commit the evidence note.**

### Task 12: Draft PR and hand-off

- [ ] **Step 1: Push and open a draft PR** against `main` on `designnotdrum/process-pack` with a body that lists each verification item and its evidence. End it with the Claude Code attribution line.
- [ ] **Step 2: Link it** with `link_pull_request`, then confirm with `list_thread_pull_requests`.
- [ ] **Step 3: Report what is left for Nick:** the Fedora box impeccable update, PyYAML on the box for the `ui_globs` override (unverified whether it is installed), anything the dry runs surfaced, and the Meridian adoption PR the spec lists as out of scope.
