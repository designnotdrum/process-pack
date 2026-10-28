#!/usr/bin/env python3
"""
docs-refresh-gate: PreToolUse hook for the Bash tool, registered in this
repo's .claude/settings.json.

When the command is `gh pr create` and the branch differs from its base, the
gate needs a docs refresh record that names the branch's current HEAD. With
no record, or a record for an older commit, it blocks and tells the agent to
update the docs by docs/agents/docs-voice.md, commit, and record.

The record is one line, a commit sha, in <git dir>/docs-refresh-ok. Each
worktree has its own git dir, so records never cross branches. Write it with:
    python3 .claude/hooks/docs_refresh_gate.py --record

Escape hatch: `DOCS_REFRESH_SKIP=1 gh pr create ...`, used only when the user
says so in the session.

Any error inside the gate allows the command, with one warning on stderr.

Standard library only.

Exit codes: 0 = allow, 2 = block (reason on stderr).

Self-test (builds a throwaway git repo):
    python3 .claude/hooks/docs_refresh_gate.py --self-test
"""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

PR_CREATE = re.compile(r"(^|[\s;&|(])gh\s+pr\s+create\b")
SKIP = re.compile(r"(^|[\s;&|(])DOCS_REFRESH_SKIP=1\s")
RECORD_NAME = "docs-refresh-ok"

BLOCK_MESSAGE = """BLOCKED: refresh the docs for this branch before opening the pull request.

1. Read docs/agents/docs-voice.md.
2. Follow its "Updating docs for a change" section against `git diff {base}...HEAD`.
3. Commit any doc edits.
4. Run `python3 .claude/hooks/docs_refresh_gate.py --record`, then retry.

If nothing needed changing, step 4 alone is enough. Say in the pull request
body which docs you changed, or that none needed changes."""


def git(cwd, *args):
    out = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, timeout=2)
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip() or f"git {' '.join(args)} failed")
    return out.stdout.strip()


def record_path(cwd):
    return Path(cwd) / git(cwd, "rev-parse", "--git-path", RECORD_NAME)


def base_ref(cwd):
    for ref in ("origin/HEAD", "origin/main", "main"):
        try:
            git(cwd, "rev-parse", "--verify", "--quiet", ref)
            return ref
        except RuntimeError:
            continue
    return None


def decide(command, cwd):
    """Return None to allow, or the block message."""
    if not PR_CREATE.search(command) or SKIP.search(command):
        return None
    base = base_ref(cwd)
    if base is None or not git(cwd, "diff", "--name-only", f"{base}...HEAD"):
        return None
    head = git(cwd, "rev-parse", "HEAD")
    path = record_path(cwd)
    if path.exists() and path.read_text().strip() == head:
        return None
    return BLOCK_MESSAGE.format(base=base)


def record(cwd):
    head = git(cwd, "rev-parse", "HEAD")
    record_path(cwd).write_text(head + "\n")
    print(f"docs refresh recorded for {head[:12]}")


def self_test():
    with tempfile.TemporaryDirectory() as tmp:
        def run(*args):
            subprocess.run(["git", *args], cwd=tmp, check=True, capture_output=True)

        run("init", "-q", "-b", "main")
        run("config", "user.email", "t@example.com")
        run("config", "user.name", "t")
        Path(tmp, "a.txt").write_text("a\n")
        run("add", ".")
        run("commit", "-qm", "base")
        run("checkout", "-qb", "feature")

        cases = []
        cases.append(("no diff allows", decide("gh pr create --fill", tmp) is None))
        Path(tmp, "b.txt").write_text("b\n")
        run("add", ".")
        run("commit", "-qm", "change")
        cases.append(("other commands allow", decide("gh pr view 3", tmp) is None))
        cases.append(("no record blocks", decide("gh pr create --fill", tmp) is not None))
        cases.append(("chained command blocks", decide("git push && gh pr create", tmp) is not None))
        cases.append(("skip allows", decide("DOCS_REFRESH_SKIP=1 gh pr create", tmp) is None))
        record(tmp)
        cases.append(("record allows", decide("gh pr create --fill", tmp) is None))
        Path(tmp, "c.txt").write_text("c\n")
        run("add", ".")
        run("commit", "-qm", "later")
        cases.append(("stale record blocks", decide("gh pr create --fill", tmp) is not None))

    failed = [name for name, ok in cases if not ok]
    for name, ok in cases:
        print(("ok   " if ok else "FAIL ") + name)
    return 1 if failed else 0


def main():
    if "--self-test" in sys.argv:
        return self_test()
    if "--record" in sys.argv:
        try:
            record(".")
        except Exception as exc:
            print(f"docs-refresh-gate: could not record: {exc}", file=sys.stderr)
            return 1
        return 0
    try:
        payload = json.load(sys.stdin)
        if payload.get("tool_name") != "Bash":
            return 0
        command = payload.get("tool_input", {}).get("command", "")
        reason = decide(command, payload.get("cwd") or ".")
    except Exception as exc:  # fail open
        print(f"docs-refresh-gate: allowed after an error: {exc}", file=sys.stderr)
        return 0
    if reason:
        print(reason, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
