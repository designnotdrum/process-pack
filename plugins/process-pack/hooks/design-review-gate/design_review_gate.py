#!/usr/bin/env python3
"""
design-review-gate: PreToolUse hook for the Bash tool.

When the command is `gh pr create` and the branch's diff against its base
touches UI files, the gate needs a design review record that covers the
branch's latest UI commit. With no record, a stale record, or a record for a
commit that is no longer in the branch's history, it blocks with one line
naming the design-review skill.

Named exceptions: a diff that touches only docs, tests, or config passes.
Escape hatch: a record written with a skip reason, which the design-review
skill writes only when Nick says so in the session.

It also runs Jev in shadow mode: a detached process asks Jev whether the diff
changes what a user sees, and appends the answer next to the file-pattern
result in <git common dir>/process-pack/jev-gate.jsonl. That never affects
the decision and adds no time to `gh pr create`.

Any error inside the gate allows the command, with one warning on stderr.

Standard library only.

Exit codes: 0 = allow, 2 = block (reason on stderr, JSON decision on stdout).

Dry run / self-test (builds throwaway git repos and a local Jev stub):
    python3 design_review_gate.py --dry-run
"""
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parent.parent
sys.path.insert(0, str(HERE.parent / "design-common"))
sys.path.insert(0, str(PLUGIN / "skills" / "design-review" / "scripts"))
sys.path.insert(0, str(PLUGIN / "tools" / "jev"))

import design_common  # noqa: E402
import review_record  # noqa: E402

JEV_QUESTION = {"ui_visible": {"type": "noul", "instructions": "This change alters what a user sees or does in the interface."}}


# `gh pr create` at the start of a command, or after ; & | ( or a newline, with
# optional VAR=value prefixes. Like stub-guard's commit pattern, it does not
# parse full shell grammar: text inside a quoted string (echo "gh pr create")
# does not start a command, so it does not match.
PR_CREATE_RE = re.compile(r"(?:^|[;&|(\n])\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*gh\s+pr\s+create\b([^;&|\n]*)")
HELP_RE = re.compile(r"(?:^|\s)(?:--help|-h)(?:\s|$)")
BASE_RE = re.compile(r"(?:^|\s)(?:--base(?:=|\s+)|-B\s*)([^\s'\"]+)")


def pr_create_args(command):
    """The argument text of a `gh pr create` in the command line, or None when there is none to gate."""
    for match in PR_CREATE_RE.finditer(command or ""):
        args = match.group(1)
        if not HELP_RE.search(args):
            return args
    return None


def _git(root, *args):
    result = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, timeout=10)
    return result.stdout.strip() if result.returncode == 0 else None


def _resolve_base(root, args):
    flag = BASE_RE.search(args or "")
    candidates = []
    if flag:
        candidates += [flag.group(1), f"origin/{flag.group(1)}"]
    else:
        head = _git(root, "symbolic-ref", "--short", "refs/remotes/origin/HEAD")
        if head:
            candidates.append(head)
        candidates += ["origin/main", "main", "origin/master", "master"]
    for ref in candidates:
        if _git(root, "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}"):
            return ref
    return None


def _ui_changes(root, is_ui, since):
    names = _git(root, "diff", "--name-only", f"{since}..HEAD")
    return [p for p in (names or "").splitlines() if p and is_ui(p)[0]]


def decide(cwd, command):
    """
    The decision only: reads no hook payload and prints nothing.
    Returns {"action": "allow" | "block", "reason"?, "warning"?, and context for the shadow log}.
    """
    args = pr_create_args(command)
    if args is None:
        return {"action": "allow", "gated": False}
    try:
        root = design_common.repo_root(cwd)
        if root is None:
            return {"action": "allow", "gated": False, "warning": "not a git repo"}
        branch = _git(root, "rev-parse", "--abbrev-ref", "HEAD")
        if not branch or branch == "HEAD":
            return {"action": "allow", "gated": False, "warning": "HEAD is detached"}
        base = _resolve_base(root, args)
        if base is None:
            return {"action": "allow", "gated": False, "warning": "no base branch found to diff against"}
        merge_base = _git(root, "merge-base", base, "HEAD")
        if merge_base is None:
            return {"action": "allow", "gated": False, "warning": f"no merge base with {base}"}

        is_ui = design_common.ui_matcher(root)
        ui_files = _ui_changes(root, is_ui, merge_base)
        head = _git(root, "rev-parse", "HEAD")
        context = {"gated": True, "root": str(root), "branch": branch, "base": base, "merge_base": merge_base, "head": head, "ui_files": ui_files}
        if not ui_files:
            return {"action": "allow", **context}

        rec = review_record.read_record(str(root), branch)
        if rec is None:
            reason = (f"This branch changes UI files ({len(ui_files)} files) and has no design review. "
                      "Run the design-review skill, then retry gh pr create.")
            return {"action": "block", "reason": reason, **context}

        reviewed = rec["reviewed_sha"]
        ancestor = subprocess.run(["git", "merge-base", "--is-ancestor", reviewed, "HEAD"], cwd=root, capture_output=True, timeout=10)
        if ancestor.returncode != 0:
            reason = (f"The design review was for {reviewed[:7]}, which is no longer in this branch's history. "
                      "Run the design-review skill again, then retry gh pr create.")
            return {"action": "block", "reason": reason, **context}

        after = _ui_changes(root, is_ui, reviewed)
        if after:
            reason = (f"This branch changed UI files after the design review at {reviewed[:7]}: {', '.join(after[:5])}. "
                      "Run the design-review skill again, then retry gh pr create.")
            return {"action": "block", "reason": reason, **context}
        return {"action": "allow", **context}
    except Exception as e:  # fail open: a broken gate must not stop work
        return {"action": "allow", "gated": False, "warning": f"gate error: {type(e).__name__}: {e}"}


def _read_payload():
    try:
        data = json.loads(sys.stdin.read() or "{}")
    except ValueError:
        return "", os.getcwd()
    if not isinstance(data, dict):
        return "", os.getcwd()
    tool_input = data.get("tool_input") if isinstance(data.get("tool_input"), dict) else data
    return tool_input.get("command", "") or "", data.get("cwd") or os.getcwd()


def _start_shadow(result):
    """Hands the Jev shadow check to a detached process, so gh pr create never waits on it."""
    fd, path = tempfile.mkstemp(prefix="jev-gate-", suffix=".json")
    with os.fdopen(fd, "w") as f:
        json.dump(result, f)
    subprocess.Popen(
        [sys.executable, str(Path(__file__).resolve()), "--jev-shadow", path],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def _jev_shadow(path):
    """Asks Jev about the diff and appends one line to jev-gate.jsonl. Never affects the gate."""
    from datetime import datetime, timezone

    import jev_client

    try:
        result = json.loads(Path(path).read_text())
    finally:
        Path(path).unlink(missing_ok=True)
    root = result["root"]
    # Diff and log the commit the gate decided on, not whatever HEAD is by now.
    diff = _git(root, "diff", f"{result['merge_base']}..{result['head']}") or ""
    answer = jev_client.ask(diff, JEV_QUESTION)
    line = {
        "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "branch": result["branch"],
        "head": result["head"],
        "base": result["base"],
        "file_pattern_ui": bool(result["ui_files"]),
        "ui_file_count": len(result["ui_files"]),
        "decision": result["action"],
        "source": answer["source"],
        "probability": answer["answers"].get("ui_visible", {}).get("noul"),
        "reason": answer["reason"],
    }
    log = review_record.record_path(root, "x").parent.parent / "jev-gate.jsonl"
    log.parent.mkdir(parents=True, exist_ok=True)
    with open(log, "a") as f:
        f.write(json.dumps(line) + "\n")


def main():
    """The Claude Code layer: read the PreToolUse payload, print the decision, exit 0 or 2."""
    command, cwd = _read_payload()
    result = decide(cwd, command)
    if result.get("warning"):
        print(f"[design-review-gate] allowing: {result['warning']}", file=sys.stderr)
    if result.get("gated"):
        try:
            _start_shadow(result)
        except Exception:
            pass
    if result["action"] == "block":
        print(result["reason"], file=sys.stderr)
        print(json.dumps({"decision": "block", "reason": result["reason"]}))
        sys.exit(2)
    sys.exit(0)


# --------------------------------------------------------------------------
# Dry run / self-test
# --------------------------------------------------------------------------

def _dry_run():
    import http.server
    import threading
    import time

    class Stub:
        delay = 0.0
        requests = 0

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            Stub.requests += 1
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            time.sleep(Stub.delay)
            body = json.dumps({"answers": {"ui_visible": {"type": "noul", "noul": 0.9}}}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    jev_url = f"http://127.0.0.1:{server.server_address[1]}/v1/systemone"

    def git(cwd, *args):
        return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()

    def commit(root, files, message):
        for rel, content in files.items():
            path = Path(root) / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        git(root, "add", "-A")
        git(root, "commit", "-q", "-m", message)
        return git(root, "rev-parse", "HEAD")

    def repo(branch="feat", origin=True):
        root = Path(tempfile.mkdtemp(prefix="gate-")) / "repo"
        root.mkdir()
        git(root, "init", "-q", "-b", "main")
        git(root, "config", "user.email", "t@example.com")
        git(root, "config", "user.name", "t")
        commit(root, {"package.json": json.dumps({"devDependencies": {"tailwindcss": "^4"}}), "app/page.tsx": "v1", "README.md": "r"}, "base")
        if origin:
            bare = root.parent / "origin.git"
            git(root.parent, "clone", "-q", "--bare", str(root), str(bare))
            git(root, "remote", "add", "origin", str(bare))
            git(root, "fetch", "-q", "origin")
        git(root, "checkout", "-q", "-b", branch)
        return root

    def record(root, sha="HEAD", skip=None):
        review_record.write_record(str(root), reviewed_sha=sha, ui_files=["app/page.tsx"], findings_fixed=[],
                                   findings_left=[], screenshots=[], skip_reason=skip)

    CMD = "gh pr create --fill"

    def case_gate_blocks_ui_change_without_record():
        root = repo()
        commit(root, {"app/page.tsx": "v2"}, "ui")
        r = decide(str(root), CMD)
        return r["action"] == "block" and "no design review" in r["reason"] and "(1 files)" in r["reason"]

    def case_gate_blocks_stale_record():
        root = repo()
        commit(root, {"app/page.tsx": "v2"}, "ui a")
        record(root)
        commit(root, {"app/card.tsx": "c"}, "ui b")
        r = decide(str(root), CMD)
        return r["action"] == "block" and "after the design review" in r["reason"] and "app/card.tsx" in r["reason"]

    def case_gate_passes_docs_only_diff():
        root = repo()
        commit(root, {"README.md": "r2", "docs/x.md": "d"}, "docs")
        return decide(str(root), CMD)["action"] == "allow"

    def case_gate_passes_tests_and_config_only():
        root = repo()
        commit(root, {"app/a.test.tsx": "t", "tailwind.config.ts": "c"}, "tests and config")
        return decide(str(root), CMD)["action"] == "allow"

    def case_gate_passes_fresh_record():
        root = repo()
        commit(root, {"app/page.tsx": "v2"}, "ui")
        record(root)
        return decide(str(root), CMD)["action"] == "allow"

    def case_gate_passes_record_then_non_ui_commit():
        root = repo()
        commit(root, {"app/page.tsx": "v2"}, "ui")
        record(root)
        commit(root, {"README.md": "r2"}, "docs")
        return decide(str(root), CMD)["action"] == "allow"

    def case_gate_passes_skip_record():
        root = repo()
        commit(root, {"app/page.tsx": "v2"}, "ui")
        record(root, skip="Nick: copy-only change")
        return decide(str(root), CMD)["action"] == "allow"

    def case_gate_blocks_when_reviewed_sha_not_ancestor():
        root = repo()
        commit(root, {"app/page.tsx": "v2"}, "ui")
        record(root)
        git(root, "commit", "-q", "--amend", "-m", "ui amended")
        r = decide(str(root), CMD)
        return r["action"] == "block" and "no longer in this branch's history" in r["reason"]

    def case_gate_branch_with_slash():
        root = repo(branch="feat/new-card")
        commit(root, {"app/page.tsx": "v2"}, "ui")
        before = decide(str(root), CMD)["action"]
        record(root)
        return before == "block" and decide(str(root), CMD)["action"] == "allow"

    def case_gate_record_found_from_worktree():
        root = repo(branch="scratch")
        git(root, "checkout", "-q", "-b", "feat/wt")
        commit(root, {"app/page.tsx": "v2"}, "ui")
        record(root)
        git(root, "checkout", "-q", "scratch")
        wt = root / ".worktrees" / "wt"
        git(root, "worktree", "add", "-q", str(wt), "feat/wt")
        return decide(str(wt), CMD)["action"] == "allow"

    def case_gate_command_matching():
        yes = ["gh pr create", "cd app && gh pr create --fill", "GH_TOKEN=x gh pr create", "gh pr create -B develop",
               "git push -u origin feat; gh pr create --draft"]
        no = ["gh pr create --help", "gh pr list", 'echo "gh pr create"', "gh pr view 3", "ls"]
        return all(pr_create_args(c) is not None for c in yes) and all(pr_create_args(c) is None for c in no)

    def case_gate_uses_base_flag():
        root = repo()
        git(root, "checkout", "-q", "-b", "develop", "main")
        commit(root, {"app/page.tsx": "v2"}, "ui on develop")
        git(root, "checkout", "-q", "-b", "feat2")
        commit(root, {"README.md": "r2"}, "docs")
        against_develop = decide(str(root), "gh pr create -B develop")["action"]
        against_main = decide(str(root), "gh pr create")["action"]
        return against_develop == "allow" and against_main == "block"

    def case_gate_no_base_branch():
        root = Path(tempfile.mkdtemp(prefix="gate-")) / "repo"
        root.mkdir()
        git(root, "init", "-q", "-b", "trunk")
        git(root, "config", "user.email", "t@example.com")
        git(root, "config", "user.name", "t")
        commit(root, {"app/page.tsx": "v1"}, "base")
        r = decide(str(root), CMD)
        return r["action"] == "allow" and "base" in r.get("warning", "")

    def case_gate_fails_open_on_corrupt_record():
        root = repo()
        commit(root, {"app/page.tsx": "v2"}, "ui")
        path = review_record.record_path(str(root), "feat")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{not json")
        corrupt = decide(str(root), CMD)["action"]
        broken = decide("/nonexistent/path", CMD)["action"]
        return corrupt == "block" and broken == "allow"

    def run_main(root, env_keys):
        env = {k: v for k, v in os.environ.items() if k not in ("TYPESAFE_API_KEY", "OPENROUTER_API_KEY")}
        env.update(env_keys)
        env["JEV_TYPESAFE_URL"] = jev_url
        start = time.time()
        proc = subprocess.run(
            [sys.executable, str(Path(__file__).resolve())],
            input=json.dumps({"tool_name": "Bash", "tool_input": {"command": CMD}, "cwd": str(root)}),
            capture_output=True,
            text=True,
            env=env,
        )
        return proc, time.time() - start

    def wait_for_log(root, count, timeout=8.0):
        log = review_record.record_path(str(root), "x").parent.parent / "jev-gate.jsonl"
        end = time.time() + timeout
        while time.time() < end:
            if log.exists():
                lines = [json.loads(l) for l in log.read_text().splitlines() if l.strip()]
                if len(lines) >= count:
                    return lines
            time.sleep(0.1)
        return []

    def case_gate_shadow_logs_one_line_per_attempt():
        Stub.delay = 0.0
        root = repo()
        commit(root, {"app/page.tsx": "v2"}, "ui")
        first, _ = run_main(root, {"TYPESAFE_API_KEY": "k"})
        second, _ = run_main(root, {"TYPESAFE_API_KEY": "k"})
        lines = wait_for_log(root, 2)
        return (
            first.returncode == 2 and second.returncode == 2
            and len(lines) == 2
            and lines[0]["source"] == "typesafe" and lines[0]["probability"] == 0.9
            and lines[0]["file_pattern_ui"] is True and lines[0]["decision"] == "block"
        )

    def case_gate_decision_same_without_keys():
        root = repo()
        commit(root, {"app/page.tsx": "v2"}, "ui")
        with_key, _ = run_main(root, {"TYPESAFE_API_KEY": "k"})
        without, _ = run_main(root, {})
        lines = wait_for_log(root, 2)
        sources = sorted(l["source"] for l in lines)
        return with_key.returncode == without.returncode == 2 and sources == ["none", "typesafe"]

    def case_gate_does_not_wait_for_jev():
        Stub.delay = 5.0
        root = repo()
        commit(root, {"app/page.tsx": "v2"}, "ui")
        proc, seconds = run_main(root, {"TYPESAFE_API_KEY": "k"})
        Stub.delay = 0.0
        return proc.returncode == 2 and seconds < 1.0

    def case_gate_shadow_records_head_at_decision():
        Stub.delay = 1.0
        root = repo()
        decided = commit(root, {"app/page.tsx": "v2"}, "ui")
        run_main(root, {"TYPESAFE_API_KEY": "k"})
        commit(root, {"README.md": "moved on"}, "later")
        lines = wait_for_log(root, 1)
        Stub.delay = 0.0
        return len(lines) == 1 and lines[0]["head"] == decided

    cases = [
        case_gate_shadow_records_head_at_decision,
        case_gate_blocks_ui_change_without_record,
        case_gate_blocks_stale_record,
        case_gate_passes_docs_only_diff,
        case_gate_passes_tests_and_config_only,
        case_gate_passes_fresh_record,
        case_gate_passes_record_then_non_ui_commit,
        case_gate_passes_skip_record,
        case_gate_blocks_when_reviewed_sha_not_ancestor,
        case_gate_branch_with_slash,
        case_gate_record_found_from_worktree,
        case_gate_command_matching,
        case_gate_uses_base_flag,
        case_gate_no_base_branch,
        case_gate_fails_open_on_corrupt_record,
        case_gate_shadow_logs_one_line_per_attempt,
        case_gate_decision_same_without_keys,
        case_gate_does_not_wait_for_jev,
    ]
    failed = 0
    for case in cases:
        try:
            ok = bool(case())
        except Exception as e:
            ok = False
            print(f"  {case.__name__}: {type(e).__name__}: {e}")
        print(f"{'PASS' if ok else 'FAIL'} {case.__name__[5:]}")
        failed += 0 if ok else 1
    server.shutdown()
    print(f"{len(cases) - failed}/{len(cases)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    if "--dry-run" in sys.argv:
        sys.exit(_dry_run())
    if len(sys.argv) == 3 and sys.argv[1] == "--jev-shadow":
        _jev_shadow(sys.argv[2])
        sys.exit(0)
    main()
