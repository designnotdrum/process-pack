#!/usr/bin/env python3
"""
stub-guard: PreToolUse hook for the Bash tool.

Blocks a `git commit` when its staged diff adds a declared local-only stub
marker — a pattern the repo's constants list as never allowed into a real
commit (see verification-gates: a temporary path with no removal criterion
is not temporary, it is permanent scaffolding).

No third-party dependencies: standard library only.

Stub patterns are never hardcoded here. They live in a small JSON config
file at <repo-root>/.process/stub-guard.config.json, meant to be generated
from, or kept in sync with, the stub declarations in the repo's own
constants. A repo with no such file has nothing checked — silence means the
repo declared no stub patterns, not that the hook is broken.

Exit codes: 0 = allow, 2 = block (with a JSON reason on stdout).

Dry run / self-test (builds a throwaway git repo, no live session or
settings.json wiring required):
    python3 stub_guard.py --dry-run
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

CONFIG_ENV_VAR = "STUB_GUARD_CONFIG"
CONFIG_RELATIVE_PATH = ".process/stub-guard.config.json"
DEFAULT_OVERRIDE_VAR = "PROCESS_PACK_ALLOW_STUB_COMMIT"

# Matches a `git commit` invocation anywhere in a command line, including
# chained forms ("git add -A && git commit -m ...") and a leading `-C <dir>`.
# Deliberately does not try to parse the full shell grammar — this only
# needs to decide "should we look at the staged diff," and a false positive
# here costs one extra diff read, not a wrong block.
COMMIT_RE = re.compile(r"(?:^|[;&|]\s*)(?:\S+=\S+\s+)*git(?:\s+-C\s+\S+)?\s+commit(?:\s|$)")


def is_commit_command(command):
    return bool(COMMIT_RE.search(command or ""))


def run_git(args, cwd, timeout=10):
    try:
        return subprocess.run(
            ["git"] + args, cwd=cwd or ".", capture_output=True, text=True, timeout=timeout
        )
    except Exception:
        return None


def repo_root(cwd):
    result = run_git(["rev-parse", "--show-toplevel"], cwd, timeout=5)
    if result is None or result.returncode != 0:
        return None
    root = result.stdout.strip()
    return root or None


def find_config_path(cwd):
    override = os.environ.get(CONFIG_ENV_VAR)
    if override:
        return Path(override).expanduser()
    root = repo_root(cwd)
    if not root:
        return None
    return Path(root) / CONFIG_RELATIVE_PATH


def load_config_or_none(path):
    if path is None or not path.exists():
        return None
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        print(
            f"[stub-guard] WARNING: could not read config at {path}: {e}. Allowing.",
            file=sys.stderr,
        )
        return None


def staged_diff(cwd):
    result = run_git(["diff", "--cached", "--unified=0", "--no-color"], cwd)
    if result is None or result.returncode != 0:
        return ""
    return result.stdout


def added_lines_by_file(diff_text):
    """Yield (file_path_or_None, added_line_text) for every added line."""
    current_file = None
    for line in diff_text.splitlines():
        if line.startswith("+++ "):
            path = line[4:].strip()
            if path.startswith("b/"):
                path = path[2:]
            current_file = None if path == "/dev/null" else path
            continue
        if line.startswith("---"):
            continue
        if line.startswith("+"):
            yield current_file, line[1:]


def find_stub_matches(diff_text, patterns, exclude_paths=None):
    """
    exclude_paths skips files that are expected to contain the pattern text
    itself (the stub-guard config file declares the raw patterns as its own
    content, which would otherwise self-match every time it's part of the
    same commit).
    """
    exclude = set(exclude_paths or [])
    compiled = []
    for p in patterns:
        try:
            compiled.append((p, re.compile(p)))
        except re.error:
            compiled.append((p, re.compile(re.escape(p))))

    hits = {}  # file label -> set of patterns matched
    for path, text in added_lines_by_file(diff_text):
        if path and path in exclude:
            continue
        label = path or "(unknown file)"
        for raw, rx in compiled:
            if rx.search(text):
                hits.setdefault(label, set()).add(raw)
    return hits


def build_reason(hits, override_var):
    files = "\n".join(
        f"  - {f} (matched: {', '.join(sorted(ps))})" for f, ps in sorted(hits.items())
    )
    return (
        "This commit's staged diff adds a declared local-only stub marker. "
        "These patterns are not allowed into a real commit in this repo:\n"
        f"{files}\n"
        "Revert the stub before committing, or if it is genuinely meant to "
        f"ship, set {override_var}=1 for this commit."
    )


def decide(diff_text, cfg, exclude_paths=None):
    """
    Core policy decision, independent of I/O. Returns:
        {"action": "allow"} or {"action": "block", "reason": <str>}
    """
    patterns = cfg.get("stub_patterns", [])
    if not patterns:
        return {"action": "allow"}

    override_var = cfg.get("override_env_var", DEFAULT_OVERRIDE_VAR)
    if os.environ.get(override_var):
        return {"action": "allow"}

    hits = find_stub_matches(diff_text, patterns, exclude_paths=exclude_paths)
    if not hits:
        return {"action": "allow"}

    return {"action": "block", "reason": build_reason(hits, override_var)}


def read_hook_payload():
    """Same convention as wall-guard's hook — see that script for the shapes accepted."""
    raw = os.environ.get("CLAUDE_TOOL_INPUT")
    if raw:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {}

    try:
        raw = sys.stdin.read()
    except Exception:
        raw = ""
    if not raw.strip():
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    if isinstance(data.get("tool_input"), dict):
        return data["tool_input"]
    return data


def extract_command(payload):
    return payload.get("command", "") or ""


def extract_cwd(payload):
    return payload.get("cwd") or os.getcwd()


def config_relative_path(config_path, cwd):
    """
    The config file's own path relative to the repo root, git-diff style
    (forward slashes). It declares the raw pattern strings as its own
    content, so it must be excluded from the scan or it always self-matches
    when staged in the same commit.
    """
    if config_path is None:
        return None
    root = repo_root(cwd)
    if not root:
        return None
    try:
        rel = os.path.relpath(str(config_path.resolve()), root)
    except (OSError, ValueError):
        return None
    return rel.replace(os.sep, "/")


def main():
    payload = read_hook_payload()
    command = extract_command(payload)

    if not is_commit_command(command):
        sys.exit(0)

    cwd = extract_cwd(payload)
    config_path = find_config_path(cwd)
    cfg = load_config_or_none(config_path)
    if cfg is None:
        sys.exit(0)  # repo declared no stub patterns, nothing to check

    exclude_paths = []
    rel = config_relative_path(config_path, cwd)
    if rel:
        exclude_paths.append(rel)

    diff_text = staged_diff(cwd)
    result = decide(diff_text, cfg, exclude_paths=exclude_paths)
    if result["action"] == "block":
        print(json.dumps({"decision": "block", "reason": result["reason"]}))
        sys.exit(2)
    sys.exit(0)


# --------------------------------------------------------------------------
# Dry run / self-test
# --------------------------------------------------------------------------

def self_test():
    import tempfile

    passed = 0
    failed = 0

    def check_case(label, condition):
        nonlocal passed, failed
        status = "PASS" if condition else "FAIL"
        print(f"[{status}] {label}")
        if condition:
            passed += 1
        else:
            failed += 1

    check_case("recognizes a plain git commit", is_commit_command('git commit -m "msg"'))
    check_case(
        "recognizes commit chained after add",
        is_commit_command('git add -A && git commit -m "msg"'),
    )
    check_case("does not misfire on git log", not is_commit_command("git log --oneline"))
    check_case("does not misfire on git commit-graph", not is_commit_command("git commit-graph write"))

    with tempfile.TemporaryDirectory() as td:
        run_git(["init", "-q"], td)
        run_git(["config", "user.email", "test@example.invalid"], td)
        run_git(["config", "user.name", "test"], td)

        (Path(td) / "notify_stub.py").write_text(
            "# LOCAL-ONLY-STUB: fake push notification, revert before shipping\n"
            "print('stub')\n"
        )
        (Path(td) / "real.py").write_text("print('real code, no markers')\n")

        run_git(["add", "notify_stub.py", "real.py"], td)
        diff_text = staged_diff(td)

        cfg = {
            "stub_patterns": ["LOCAL-ONLY-STUB"],
            "override_env_var": "STUB_GUARD_TEST_OVERRIDE",
        }

        result = decide(diff_text, cfg)
        check_case(
            "blocks a commit whose staged diff adds a declared stub marker",
            result["action"] == "block" and "notify_stub.py" in (result.get("reason") or ""),
        )
        check_case(
            "block reason does not list the clean file",
            "real.py" not in (result.get("reason") or ""),
        )

        os.environ["STUB_GUARD_TEST_OVERRIDE"] = "1"
        try:
            result2 = decide(diff_text, cfg)
        finally:
            os.environ.pop("STUB_GUARD_TEST_OVERRIDE", None)
        check_case("override env var allows the same commit through", result2["action"] == "allow")

        run_git(["reset"], td)
        run_git(["add", "real.py"], td)
        clean_diff = staged_diff(td)
        result3 = decide(clean_diff, cfg)
        check_case("a diff with no stub marker -> allow", result3["action"] == "allow")

    missing_cfg = load_config_or_none(Path("/nonexistent/stub-guard.config.json"))
    check_case("missing config file -> None (caller allows)", missing_cfg is None)

    # End-to-end: invoke the real hook entry point as a subprocess, exactly as
    # a harness would, in a repo where the config file itself (which contains
    # the raw pattern strings as its own content) is staged in the same
    # commit as a real stub file.
    with tempfile.TemporaryDirectory() as td:
        run_git(["init", "-q"], td)
        run_git(["config", "user.email", "test@example.invalid"], td)
        run_git(["config", "user.name", "test"], td)

        process_dir = Path(td) / ".process"
        process_dir.mkdir()
        (process_dir / "stub-guard.config.json").write_text(
            json.dumps({"stub_patterns": ["LOCAL-ONLY-STUB"]})
        )
        (Path(td) / "notify_stub.py").write_text("# LOCAL-ONLY-STUB: revert before shipping\n")

        run_git(["add", ".process", "notify_stub.py"], td)

        payload = json.dumps({"command": 'git commit -m "add feature"', "cwd": td})
        proc = subprocess.run(
            [sys.executable, str(Path(__file__).resolve())],
            input=payload,
            capture_output=True,
            text=True,
            timeout=15,
        )
        check_case("end-to-end: exits 2 (block) via the real entry point", proc.returncode == 2)
        stdout_reason = proc.stdout
        check_case(
            "end-to-end: block reason names the stub file", "notify_stub.py" in stdout_reason
        )
        check_case(
            "end-to-end: config file excluded from its own scan (not self-matched)",
            "stub-guard.config.json" not in stdout_reason,
        )

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    if "--dry-run" in sys.argv[1:] or "--self-test" in sys.argv[1:]:
        self_test()
    else:
        main()
