#!/usr/bin/env python3
"""
design-onboard-nudge: SessionStart hook.

If the repo has tracked UI files and no DESIGN.md, adds one line of context
telling the agent to run the design-onboard skill before UI work. Silent
otherwise. Never blocks, and any error is silent apart from one stderr line.

In a monorepo, each app (the root, apps/*, packages/* with their own
package.json or Package.swift) is checked on its own. A DESIGN.md in the app
or at the repo root covers that app.

Turn it off for a repo with {"enabled": false} in
.process/design-onboard-nudge.config.json.

Standard library only.

Dry run / self-test (builds throwaway git repos):
    python3 design_onboard_nudge.py --dry-run
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "design-common"))

import design_common  # noqa: E402

CONFIG_RELATIVE_PATH = ".process/design-onboard-nudge.config.json"


def _enabled(root):
    try:
        cfg = json.loads((Path(root) / CONFIG_RELATIVE_PATH).read_text())
    except (OSError, ValueError):
        return True
    return not (isinstance(cfg, dict) and cfg.get("enabled") is False)


def nudge_text(cwd):
    """The context line to add, or None. The decision only: reads no hook payload and prints nothing."""
    root = design_common.repo_root(cwd)
    if root is None or not _enabled(root):
        return None
    is_ui = design_common.ui_matcher(root)
    apps_with_ui = set()
    for path in design_common.tracked_files(root):
        ui, app = is_ui(path)
        if ui:
            apps_with_ui.add(app)
    if (root / "DESIGN.md").exists():
        return None
    missing = sorted(
        "repo root" if app == root else app.relative_to(root).as_posix()
        for app in apps_with_ui
        if not (app / "DESIGN.md").exists()
    )
    if not missing:
        return None
    return (
        f"This repo has UI files and no DESIGN.md ({', '.join(missing)}). "
        "Run the design-onboard skill before any UI work."
    )


def _read_cwd():
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except ValueError:
        payload = {}
    cwd = payload.get("cwd") if isinstance(payload, dict) else None
    return cwd or os.getcwd()


def main():
    """The Claude Code layer: read the SessionStart payload, print hookSpecificOutput JSON, always exit 0."""
    try:
        text = nudge_text(_read_cwd())
    except Exception as e:  # never break session start
        print(f"[design-onboard-nudge] skipped: {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(0)
    if text:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": text}}))
    sys.exit(0)


# --------------------------------------------------------------------------
# Dry run / self-test
# --------------------------------------------------------------------------

def _dry_run():
    import subprocess
    import tempfile

    def git(cwd, *args):
        subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True)

    def repo(files):
        root = Path(tempfile.mkdtemp(prefix="nudge-"))
        git(root, "init", "-q", "-b", "main")
        git(root, "config", "user.email", "t@example.com")
        git(root, "config", "user.name", "t")
        for rel, content in files.items():
            path = root / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        git(root, "add", "-A")
        git(root, "commit", "-q", "-m", "init", "--allow-empty")
        return root

    tailwind_pkg = json.dumps({"devDependencies": {"tailwindcss": "^4"}})

    def case_nudge_ui_without_design_md():
        root = repo({"package.json": tailwind_pkg, "app/page.tsx": "export default 1"})
        text = nudge_text(str(root))
        return text is not None and "design-onboard" in text and "DESIGN.md" in text

    def case_nudge_silent_with_design_md():
        root = repo({"package.json": tailwind_pkg, "app/page.tsx": "x", "DESIGN.md": "# Design"})
        return nudge_text(str(root)) is None

    def case_nudge_silent_without_ui():
        root = repo({"package.json": tailwind_pkg, "README.md": "hi", "src/server.ts": "x", "docs/a.html": "x"})
        return nudge_text(str(root)) is None

    def case_nudge_monorepo_cases():
        base = {
            "package.json": "{}",
            "apps/web/package.json": tailwind_pkg,
            "apps/web/app/page.tsx": "x",
            "apps/web/DESIGN.md": "# Web",
            "apps/admin/package.json": tailwind_pkg,
            "apps/admin/app/page.tsx": "x",
        }
        names_admin = nudge_text(str(repo(base)))
        with_root = dict(base, **{"DESIGN.md": "# All"})
        silenced = nudge_text(str(repo(with_root)))
        return names_admin is not None and "apps/admin" in names_admin and "apps/web" not in names_admin and silenced is None

    def case_nudge_not_a_repo():
        return nudge_text(tempfile.mkdtemp()) is None

    def case_nudge_only_tracked_files_count():
        root = repo({"package.json": tailwind_pkg, "README.md": "hi"})
        (root / "app").mkdir()
        (root / "app" / "page.tsx").write_text("untracked")
        return nudge_text(str(root)) is None

    def case_nudge_disabled_by_config():
        root = repo({
            "package.json": tailwind_pkg,
            "app/page.tsx": "x",
            CONFIG_RELATIVE_PATH: json.dumps({"enabled": False}),
        })
        return nudge_text(str(root)) is None

    def case_main_prints_hook_json():
        root = repo({"package.json": tailwind_pkg, "app/page.tsx": "x"})
        proc = subprocess.run(
            [sys.executable, str(Path(__file__).resolve())],
            input=json.dumps({"cwd": str(root), "hook_event_name": "SessionStart"}),
            capture_output=True,
            text=True,
        )
        out = json.loads(proc.stdout)
        return proc.returncode == 0 and out["hookSpecificOutput"]["hookEventName"] == "SessionStart" and "design-onboard" in out["hookSpecificOutput"]["additionalContext"]

    def case_main_silent_and_exit_0_on_garbage_input():
        proc = subprocess.run([sys.executable, str(Path(__file__).resolve())], input="{not json", capture_output=True, text=True, cwd=tempfile.mkdtemp())
        return proc.returncode == 0 and proc.stdout == ""

    cases = [
        case_nudge_ui_without_design_md,
        case_nudge_silent_with_design_md,
        case_nudge_silent_without_ui,
        case_nudge_monorepo_cases,
        case_nudge_not_a_repo,
        case_nudge_only_tracked_files_count,
        case_nudge_disabled_by_config,
        case_main_prints_hook_json,
        case_main_silent_and_exit_0_on_garbage_input,
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
    main()
