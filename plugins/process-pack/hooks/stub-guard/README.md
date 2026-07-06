# stub-guard

A `PreToolUse` hook for the Bash tool. When the command is a `git commit`,
greps the staged diff for declared local-only stub markers and blocks the
commit with the file list if any are found.

Flagship case: a local-only stub (a fake notification, a hardcoded fixture,
a bypassed check) that's meant to make one machine's dev loop work, and gets
committed by accident because it looked like the rest of the working tree.

## Why

Done means the temporary thing is gone before it ships — a stub with no
removal criterion isn't temporary, it's permanent scaffolding wearing a
temporary label. This hook is the mechanical backstop for that rule: if a
repo declares a marker as never allowed into a real commit, this catches it
at commit time instead of relying on someone remembering to grep for it.

## Install

Add to your harness settings (`settings.json`):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/absolute/path/to/stub-guard/stub_guard.py"
          }
        ]
      }
    ]
  }
}
```

The hook is a no-op for every command that isn't a `git commit`, and a no-op
for any repo that hasn't declared stub patterns — safe to install globally
and let each repo opt in by adding its own config.

## Config

The hook never hardcodes a pattern in its source. For a command running
inside a repo, it looks for:

- Default location: `<repo-root>/.process/stub-guard.config.json`, where
  `<repo-root>` is resolved with `git rev-parse --show-toplevel` from the
  command's working directory.
- Override location: set `STUB_GUARD_CONFIG=/path/to/file.json`.

See `stub-guard.config.example.json` for the schema — copy it into a repo at
`.process/stub-guard.config.json` and list the markers that repo never wants
committed for real (each entry is used as a regex, falling back to a literal
match if it isn't valid regex). This file is meant to be generated from, or
kept in sync with, the repo's own stub-pattern declarations in its
constants; regenerate it whenever those change.

If a repo has no config file, the hook allows every commit in that repo —
nothing has been declared there, so there is nothing to check. The config
file's own content (the pattern strings themselves) is automatically
excluded from the scan, so declaring a marker doesn't self-trigger a block
the moment the declaration is committed.

## Override

For a commit that's genuinely meant to ship a matched marker, set the
override variable named in your config (default
`PROCESS_PACK_ALLOW_STUB_COMMIT=1`) for that one commit.

## Dry run / self-test

```bash
python3 stub_guard.py --dry-run
```

Builds a throwaway git repo in a temp dir, stages a real stub marker
alongside a clean file, and both calls the core decision function directly
and invokes the script's real entry point as a subprocess (the same way a
harness would) to confirm the block, the file list, the override, the
config-exclusion, and the git-commit-command detection all work end to end.
No live session or `settings.json` wiring required.
