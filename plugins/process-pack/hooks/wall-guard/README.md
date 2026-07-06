# wall-guard

A `PreToolUse` hook for the Bash tool. Blocks a command that references a
config or runtime directory belonging to a different identity context than
the one the current session is running under — for example, a personal
session reaching into a work config directory, or the reverse.

Companion to the `resource-wall-preflight` skill: this hook catches the
path-shaped version of a wall violation before the command runs. It does not
replace the skill's three questions (which wallet, which org, which
identity) — it can only see paths, not org-scoped API calls or billing
targets with no local path involved.

## Why

An access path existing is not authorization to use it. If two contexts each
have their own config/runtime directory, a command that quietly reads or
writes across that boundary bridges a runtime that should stay separate. The
fix when you need a capability from the other side is to copy the
configuration you need, not bridge the runtime.

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
            "command": "/absolute/path/to/wall-guard/wall_guard.py"
          }
        ]
      }
    ]
  }
}
```

## Config

The hook never hardcodes a path pattern in its source. It reads a small JSON
config file:

- Default location: `wall-guard.config.json`, next to `wall_guard.py`.
- Override location: set `WALL_GUARD_CONFIG=/path/to/file.json`.

See `wall-guard.config.example.json` for the schema — copy it to
`wall-guard.config.json` and fill in every known context's config directory.
This file is meant to be generated from, or kept in sync with, the wall
declarations in your constants; regenerate it whenever those change.

Active-context detection defaults to reading `CLAUDE_CONFIG_DIR` (the
environment variable a harness typically sets to point at the config
directory in use for a given launch); both the variable name and the default
directory are config fields, not hardcoded, so a different harness or launch
convention is a config edit, not a code change.

If no config file is present, the hook allows everything — nothing has been
declared, so there is nothing to check.

## Override

For a genuinely intended cross-context command, set the override variable
named in your config (default `PROCESS_PACK_ALLOW_CROSS_CONFIG=1`) for that
one command.

## Dry run / self-test

```bash
python3 wall_guard.py --dry-run
```

Builds a throwaway pair of context directories in a temp dir, exercises the
exact `decide()` function the live hook calls against them, and prints
PASS/FAIL per case. No real config file, live session, or `settings.json`
wiring required.
