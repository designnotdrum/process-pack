#!/usr/bin/env python3
"""
review_record: read and write the design review record for a branch.

The record lives at <git common dir>/process-pack/design-reviews/<branch>.json,
so every worktree of a clone shares it, and it is never committed. A "/" in a
branch name becomes "__" in the file name.

Fields: branch, reviewed_sha, ui_files, findings_fixed, findings_left,
screenshots, skip_reason, written_at.

The design-review skill writes it. The design-review-gate hook reads it.

CLI:
    review_record.py write --sha HEAD --ui-file <f>... --fixed <s>... --left <s>... \
        --screenshot <p>... [--skip-reason <s>]
    review_record.py --dry-run

Standard library only.
"""
import json
import subprocess
import sys
from pathlib import Path


def _git(cwd, *args):
    result = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, timeout=10)
    if result.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def current_branch(cwd):
    branch = _git(cwd, "rev-parse", "--abbrev-ref", "HEAD")
    if branch == "HEAD":
        raise RuntimeError("HEAD is detached; check out a branch before recording a review")
    return branch


def record_path(cwd, branch):
    common = Path(_git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir")).resolve()
    return common / "process-pack" / "design-reviews" / f"{branch.replace('/', '__')}.json"


def write_record(cwd, *, reviewed_sha, ui_files, findings_fixed, findings_left, screenshots, skip_reason=None, branch=None):
    from datetime import datetime, timezone

    branch = branch or current_branch(cwd)
    record = {
        "branch": branch,
        "reviewed_sha": _git(cwd, "rev-parse", "--verify", f"{reviewed_sha}^{{commit}}"),
        "ui_files": list(ui_files),
        "findings_fixed": list(findings_fixed),
        "findings_left": list(findings_left),
        "screenshots": list(screenshots),
        "skip_reason": skip_reason,
        "written_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    path = record_path(cwd, branch)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(record, indent=2) + "\n")
    return path


def read_record(cwd, branch):
    """The record for a branch, or None when it is missing or cannot be parsed."""
    try:
        data = json.loads(record_path(cwd, branch).read_text())
    except (OSError, ValueError, RuntimeError):
        return None
    if not isinstance(data, dict) or not isinstance(data.get("reviewed_sha"), str):
        return None
    return data


def _cli(argv):
    import argparse

    parser = argparse.ArgumentParser(prog="review_record.py")
    sub = parser.add_subparsers(dest="command", required=True)
    w = sub.add_parser("write")
    w.add_argument("--sha", default="HEAD")
    w.add_argument("--ui-file", action="append", default=[])
    w.add_argument("--fixed", action="append", default=[])
    w.add_argument("--left", action="append", default=[])
    w.add_argument("--screenshot", action="append", default=[])
    w.add_argument("--skip-reason")
    args = parser.parse_args(argv)
    path = write_record(
        ".",
        reviewed_sha=args.sha,
        ui_files=args.ui_file,
        findings_fixed=args.fixed,
        findings_left=args.left,
        screenshots=args.screenshot,
        skip_reason=args.skip_reason,
    )
    print(path)
    return 0


# --------------------------------------------------------------------------
# Dry run / self-test
# --------------------------------------------------------------------------

def _dry_run():
    import tempfile

    def git(cwd, *args):
        return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()

    def repo(branch="main"):
        root = Path(tempfile.mkdtemp(prefix="review-record-"))
        git(root, "init", "-q", "-b", branch)
        git(root, "config", "user.email", "t@example.com")
        git(root, "config", "user.name", "t")
        (root / "a.txt").write_text("a\n")
        git(root, "add", "a.txt")
        git(root, "commit", "-q", "-m", "a")
        return root

    def case_path_uses_common_dir_from_worktree():
        root = repo()
        git(root, "branch", "feat")
        wt = root / ".worktrees" / "feat"
        git(root, "worktree", "add", "-q", str(wt), "feat")
        from_main = record_path(str(root), "feat")
        from_wt = record_path(str(wt), "feat")
        return from_main == from_wt and from_main.parent == (root / ".git" / "process-pack" / "design-reviews").resolve()

    def case_slash_branch_is_flattened():
        root = repo()
        return record_path(str(root), "feat/new-card").name == "feat__new-card.json"

    def case_round_trip():
        root = repo("feat/x")
        head = git(root, "rev-parse", "HEAD")
        path = write_record(str(root), reviewed_sha="HEAD", ui_files=["app/page.tsx"], findings_fixed=["spacing"],
                            findings_left=["copy tone"], screenshots=["/tmp/a.png"])
        rec = read_record(str(root), "feat/x")
        return (
            path.exists()
            and rec["branch"] == "feat/x"
            and rec["reviewed_sha"] == head
            and rec["ui_files"] == ["app/page.tsx"]
            and rec["findings_left"] == ["copy tone"]
            and rec["skip_reason"] is None
            and rec["written_at"]
        )

    def case_corrupt_file_reads_as_none():
        root = repo()
        path = record_path(str(root), "main")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{not json")
        return read_record(str(root), "main") is None and read_record(str(root), "missing") is None

    def case_skip_reason_round_trip():
        root = repo()
        write_record(str(root), reviewed_sha="HEAD", ui_files=[], findings_fixed=[], findings_left=[], screenshots=[],
                     skip_reason="Nick: copy-only change, reviewed by eye")
        return read_record(str(root), "main")["skip_reason"] == "Nick: copy-only change, reviewed by eye"

    cases = [
        case_path_uses_common_dir_from_worktree,
        case_slash_branch_is_flattened,
        case_round_trip,
        case_corrupt_file_reads_as_none,
        case_skip_reason_round_trip,
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
    print(f"{len(cases) - failed}/{len(cases)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    if "--dry-run" in sys.argv:
        sys.exit(_dry_run())
    sys.exit(_cli(sys.argv[1:]))
