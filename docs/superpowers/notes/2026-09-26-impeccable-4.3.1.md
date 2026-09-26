# Impeccable update and rule API, 2026-09-26

## What was installed

- Before: impeccable 4.0.4, commit `aee6ce9` (source: `~/.claude/plugins/installed_plugins.json`).
- Commands run: `claude plugin marketplace update impeccable`, then `claude plugin update impeccable@impeccable`.
- After: impeccable **4.4.0**, commit `9d715cc`, install path `~/.claude/plugins/cache/impeccable/impeccable/4.4.0`, engine binary version 0.1.6 (source: `installed_plugins.json` and `skills/impeccable/scripts/VERSION`).
- The spec asked for 4.3.1. The marketplace serves the tip of the repo's `main` branch, which is 4.4.0. Commit `351e7a8` on 2026-09-25 is titled "Add human component review and prepare Impeccable 4.4.0". The newest GitHub release tag is still `skill-v4.3.1` (source: `gh api repos/pbakaus/impeccable/releases` and `/commits`).
- `claude plugin update` has no option to pick a version (source: `claude plugin --help`). Going back to 4.3.1 would mean editing the plugin cache by hand.
- The session must restart before 4.4.0's hooks and skill replace 4.0.4's.

## Does impeccable accept custom rules from outside the plugin?

No, not in the way this build needs.

1. **Can the Claude plugin load rules from a path outside itself?** No. Custom rules are a Rust "rule pack": a crate that depends on the engine, implements the `RulePack` trait, and is compiled into its own binary. `docs/ENGINE.md` says the built-in rules "are compiled in and always run", and that in the browser config "a pack is a Rust value, never JSON from the page" (source: `docs/ENGINE.md` and `crates/foundation/src/rule_pack.rs` on `main`, read 2026-09-26).
2. **What names that path?** Nothing. There is no config key or directory for extra rules. `.impeccable/config.json` only turns built-in rules off or scopes them (`detector.ignoreRules`, `ignoreFiles`, `ignoreValues`) and adds file extensions (`detector.extensions`) (source: `skills/impeccable/reference/hooks.md` in 4.4.0).
3. **Does the PostToolUse edit hook run those rules?** Only if the hook runs a binary that was built with the pack. The plugin's hook runs its own downloaded binary, `skills/impeccable/scripts/impeccable hook` (source: `hooks/hooks.json` in 4.4.0).

Shipping a custom binary would mean maintaining a build of impeccable, which is close to the fork the spec rules out. So the check that blocks hardcoded colors stays in the stack tooling: the Node script for Tailwind and plain CSS, Stylelint, and SwiftLint.

## Other 4.4.0 facts that matter here

- The hook now runs on `SessionStart`, `PostToolUse` (Edit and Write), and `Stop` (source: `hooks/hooks.json`).
- The per-edit pass reports only the immediate tier (contrast, gradient text, glow shadows, design-system drift). The rest waits for a deep pass on `Stop` (source: `reference/hooks.md`).
- Impeccable installs its hook for Claude Code, Codex, Cursor, Grok Build, GitHub Copilot, and Gemini through files in the project (source: `reference/hooks.md`). That supports the portability rules in the spec.

## Left for Nick

- Update impeccable on the Fedora box for Cyrus: `claude plugin marketplace update impeccable` and `claude plugin update impeccable@impeccable`, as the user Cyrus runs under. Not done from here.
- Decide whether 4.4.0 is acceptable or whether to hold at 4.3.1.
