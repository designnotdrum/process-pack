# `design-review-gate`

A `PreToolUse` hook for the Bash tool. When the command is `gh pr create` and the branch changes UI files, it blocks until the `design-review` skill has written a review record that covers the branch's latest UI commit.

## Why

UI changes should reach a pull request already reviewed, so Nick is not the first design reviewer. A skill alone depends on someone remembering to run it. This gate makes the review the default path before any pull request that touches UI.

It is separate from `~/.claude/hooks/pr-review-gate.sh`, which is unchanged.

## Install

The process-pack plugin registers it in `hooks/hooks.json` with the matcher `Bash`, so installing the plugin is enough. It exits in about 40 ms for any command that is not `gh pr create`.

## What it checks

1. The command runs `gh pr create` (at the start of the command, or after `;`, `&&`, `|`, or `(`, with optional `VAR=value` prefixes). `gh pr create --help` and text inside quotes do not count.
2. The base branch is the `--base` or `-B` value, else `origin/HEAD`, else `origin/main`, `main`, `origin/master`, or `master`.
3. The UI files are the files changed since the merge base that match the UI patterns (see the nudge hook's README: detection per app from `stacks.json`, or `design.ui_globs` in `.process/repo.yaml`). Docs, tests, fixtures, and config files are exempt. No UI files: allow.
4. The review record for the branch lives at `<git common dir>/process-pack/design-reviews/<branch>.json` (`/` in a branch name becomes `__`), so every worktree of a clone sees it.

It blocks, with one line on stderr, when:

- **No record:** `This branch changes UI files (<n> files) and has no design review. Run the design-review skill, then retry gh pr create.`
- **Stale record:** `This branch changed UI files after the design review at <sha>: <up to 5 files>. Run the design-review skill again, then retry gh pr create.`
- **Rewritten branch:** `The design review was for <sha>, which is no longer in this branch's history. Run the design-review skill again, then retry gh pr create.`

A record whose reviewed commit is an ancestor of `HEAD`, with no UI change after it, lets the command through.

## Override

A record with a `skip_reason` counts like a review of that commit. The `design-review` skill writes one only when Nick says in the session that the change skips design review, with his words as the reason. A later UI commit makes it stale like any other record.

## Jev shadow mode

Each time the gate runs on a `gh pr create`, it also starts a detached process that asks Jev (through `tools/jev/jev_client.py`) whether the diff changes what a user sees. The answer, its source (`typesafe`, `openrouter`, or `none`), and the file-pattern result go on one line of `<git common dir>/process-pack/jev-gate.jsonl`. This never affects the decision and adds no time to the command. Jev may affect the gate only after Nick has seen a comparison of the two results and recorded a decision in the spec.

## Failure

Any error in the gate (not a git repo, detached `HEAD`, no base branch, git failing) allows the command with one warning on stderr. An unreadable record counts as no record, so it blocks.

## Output

Block: the reason on stderr, `{"decision": "block", "reason": "..."}` on stdout, exit 2. Allow: exit 0.

## Portability

`decide(cwd, command)` holds the whole decision and reads no hook payload. `main()` is the Claude Code layer. Another harness adds its own small layer around `decide`.

## Dry run / self-test

```bash
python3 design_review_gate.py --dry-run
```

Builds throwaway git repos with a local bare `origin` and a local Jev stub, and prints PASS or FAIL for 17 cases, including the four in the spec: no record blocks, stale record blocks, docs-only diff passes, fresh record passes.
