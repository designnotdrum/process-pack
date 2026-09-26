# `design-onboard-nudge`

A `SessionStart` hook. When the repo has tracked UI files and no DESIGN.md, it adds one line of context telling the agent to run the `design-onboard` skill before any UI work. Otherwise it prints nothing. It never blocks.

## Why

A new repo's UI work looks like library defaults until the repo has product truth, a design system, and guardrails. The `design-onboard` skill sets those up, but only if someone remembers to run it. This hook reminds the agent at the start of every session until the repo has a DESIGN.md.

## Install

The process-pack plugin registers it in `hooks/hooks.json`, so installing the plugin is enough. To wire it by hand, run `python3 /absolute/path/to/design_onboard_nudge.py` on session start, with the session payload (JSON with a `cwd` field) on stdin.

## What counts as UI

The hook uses `hooks/design-common/design_common.py`, which reads the design-onboard skill's `stacks/stacks.json`:

- Each app is checked on its own: the repo root, plus each `apps/*` and `packages/*` directory with its own `package.json` or `Package.swift`.
- Each app's stack is detected from its top-level files and `package.json` dependencies. The stack's `ui_globs` decide which tracked files are UI. Docs, tests, fixtures, and config files are excluded.
- A `design.ui_globs` list in `.process/repo.yaml` replaces the stack patterns for the whole repo (read only when PyYAML is installed).
- Only files tracked by git count. A new untracked file does not trigger the nudge.

A DESIGN.md covers every UI file in its folder and the folders below it, wherever it sits. A DESIGN.md at the repo root covers the whole repo.

## Config

Nothing to configure for normal use. To turn the nudge off for one repo, copy the example config into `<repo-root>/.process/` without `.example` in its name; it holds `"enabled": false`.

## Output

```json
{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "This repo has UI files and no DESIGN.md (apps/admin). Run the design-onboard skill before any UI work."}}
```

Any error (not a git repo, git missing, a malformed payload) prints nothing to stdout, one line to stderr, and exits 0.

## Portability

`nudge_text(cwd)` holds the whole decision and reads no hook payload. `main()` is the Claude Code layer. Another harness adds its own small layer that calls `nudge_text` and delivers the line its own way.

## Dry run / self-test

```bash
python3 design_onboard_nudge.py --dry-run
python3 ../design-common/design_common.py --dry-run
```

Both build throwaway git repos and print PASS or FAIL per case.
