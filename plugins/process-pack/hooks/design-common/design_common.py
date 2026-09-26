#!/usr/bin/env python3
"""
design_common: UI file detection shared by the design-onboard-nudge and
design-review-gate hooks.

Stack detection and UI file patterns come from the design-onboard skill's
stacks/stacks.json, so the skill and both hooks agree on what counts as UI.
A repo can override the patterns with design.ui_globs in .process/repo.yaml
(read only when PyYAML is importable).

Standard library only (PyYAML optional).

Self-test:
    python3 design_common.py --dry-run
"""
import fnmatch
import json
import os
import re
import subprocess
import sys
from pathlib import Path

STACKS_PATH = Path(__file__).resolve().parent.parent.parent / "skills" / "design-onboard" / "stacks" / "stacks.json"


_REGEX_CACHE = {}


def _glob_regex(pattern):
    """'**/' matches zero or more directories, a trailing '/**' matches anything below, '*' stays in one segment."""
    if pattern in _REGEX_CACHE:
        return _REGEX_CACHE[pattern]
    out = ""
    i = 0
    while i < len(pattern):
        if pattern.startswith("**/", i):
            out += "(?:.*/)?"
            i += 3
        elif pattern.startswith("/**", i) and i + 3 == len(pattern):
            out += "(?:/.*)?"
            i += 3
        elif pattern.startswith("**", i):
            out += ".*"
            i += 2
        elif pattern[i] == "*":
            out += "[^/]*"
            i += 1
        elif pattern[i] == "?":
            out += "[^/]"
            i += 1
        else:
            out += re.escape(pattern[i])
            i += 1
    compiled = re.compile(f"^{out}$")
    _REGEX_CACHE[pattern] = compiled
    return compiled


def glob_match(path, pattern):
    return bool(_glob_regex(pattern).match(path))


def load_stacks():
    return json.loads(STACKS_PATH.read_text())


def _package_deps(app_dir):
    try:
        data = json.loads((Path(app_dir) / "package.json").read_text())
    except (OSError, ValueError):
        return set()
    deps = set()
    for key in ("dependencies", "devDependencies", "peerDependencies"):
        if isinstance(data.get(key), dict):
            deps.update(data[key])
    return deps


def detect_stack(root):
    """The first stacks.json entry whose detect rule matches files at this directory's top level."""
    stacks = load_stacks()["stacks"]
    try:
        names = os.listdir(root)
    except OSError:
        names = []
    deps = _package_deps(root)
    for stack in stacks:
        detect = stack.get("detect", {})
        files_any = detect.get("files_any", [])
        deps_any = detect.get("package_deps_any", [])
        if any(fnmatch.fnmatch(name, pattern) for name in names for pattern in files_any):
            return stack
        if deps & set(deps_any):
            return stack
    return next(s for s in stacks if s["id"] == "other")


def _repo_yaml_globs(root):
    try:
        import yaml
    except ImportError:
        path = Path(root) / ".process" / "repo.yaml"
        if path.exists():
            print("[design hooks] PyYAML is not installed; ignoring design.ui_globs in .process/repo.yaml", file=sys.stderr)
        return None
    try:
        data = yaml.safe_load((Path(root) / ".process" / "repo.yaml").read_text()) or {}
    except (OSError, yaml.YAMLError):
        return None
    globs = (data.get("design") or {}).get("ui_globs") if isinstance(data, dict) else None
    return list(globs) if isinstance(globs, list) and globs else None


def ui_globs(root):
    """The repo's override from .process/repo.yaml, else the detected stack's patterns."""
    return _repo_yaml_globs(root) or detect_stack(root)["ui_globs"]


def exclude_globs():
    return load_stacks()["exclude_globs"]


def always_ui_globs():
    """UI patterns that win over exclude_globs, such as asset catalog color sets stored as JSON."""
    return load_stacks().get("always_ui_globs", [])


def is_ui_file(path, globs, exclude):
    if any(glob_match(path, p) for p in always_ui_globs()) and any(glob_match(path, p) for p in globs):
        return True
    if any(glob_match(path, pattern) for pattern in exclude):
        return False
    return any(glob_match(path, pattern) for pattern in globs)


def app_roots(root):
    """The repo root, plus each apps/* and packages/* directory with its own package.json or Package.swift."""
    root = Path(root)
    found = [root]
    for group in ("apps", "packages"):
        base = root / group
        if not base.is_dir():
            continue
        for child in sorted(base.iterdir()):
            if child.is_dir() and ((child / "package.json").exists() or (child / "Package.swift").exists()):
                found.append(child)
    return found


def ui_matcher(root):
    """
    Returns is_ui(path) -> (bool, app_dir) for repo-relative paths. Each path
    belongs to the deepest app root that contains it, and is matched against
    that app's stack patterns relative to the app. A design.ui_globs override
    in .process/repo.yaml is matched against the repo-relative path instead.
    """
    root = Path(root)
    exclude = exclude_globs()
    always = always_ui_globs()
    override = _repo_yaml_globs(root)
    apps = []
    for app in app_roots(root):
        rel = "" if app == root else app.relative_to(root).as_posix() + "/"
        apps.append((rel, app, detect_stack(app)["ui_globs"]))
    apps.sort(key=lambda a: len(a[0]), reverse=True)

    def is_ui(path):
        for prefix, app, globs in apps:
            if path.startswith(prefix):
                if override:
                    return is_ui_file(path, override, exclude), app
                inner = path[len(prefix):]
                matches = any(glob_match(inner, p) for p in globs)
                if matches and any(glob_match(inner, p) for p in always):
                    return True, app
                excluded = any(glob_match(inner, p) or glob_match(path, p) for p in exclude)
                return (not excluded and matches), app
        return False, root

    return is_ui


def covered_by_design_md(root, path):
    """True when a DESIGN.md sits in the file's folder or any folder above it, up to the repo root."""
    root = Path(root)
    folder = (root / path).parent
    while True:
        if (folder / "DESIGN.md").exists():
            return True
        if folder == root or root not in folder.parents:
            return False
        folder = folder.parent


def has_design_block(root):
    """True when .process/repo.yaml records a design onboarding (needs PyYAML; False without it)."""
    try:
        import yaml
        data = yaml.safe_load((Path(root) / ".process" / "repo.yaml").read_text()) or {}
    except Exception:
        return False
    return isinstance(data, dict) and isinstance(data.get("design"), dict)


def repo_root(cwd):
    try:
        result = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=cwd, capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    return Path(result.stdout.strip()) or None


def tracked_files(root):
    result = subprocess.run(["git", "ls-files", "-z"], cwd=root, capture_output=True, text=True, timeout=10)
    if result.returncode != 0:
        return []
    return [p for p in result.stdout.split("\0") if p]


# --------------------------------------------------------------------------
# Dry run / self-test
# --------------------------------------------------------------------------

def _dry_run():
    import tempfile

    def case_glob_double_star_matches_zero_or_more_dirs():
        return glob_match("a.tsx", "**/*.tsx") and glob_match("x/y/a.tsx", "**/*.tsx")

    def case_glob_trailing_double_star():
        return glob_match("docs/a/b.md", "docs/**") and not glob_match("src/docs.md", "docs/**")

    def case_glob_single_star_stays_in_segment():
        return glob_match("a.md", "*.md") and not glob_match("x/a.md", "*.md")

    def case_glob_middle_double_star():
        return glob_match("App/Assets.xcassets/Red.colorset/Contents.json", "**/*.xcassets/**")

    def case_excludes_tests_and_config():
        stacks = load_stacks()
        ex = stacks["exclude_globs"]
        tailwind = next(s for s in stacks["stacks"] if s["id"] == "tailwind")["ui_globs"]
        return (
            is_ui_file("app/page.tsx", tailwind, ex)
            and not is_ui_file("app/page.test.tsx", tailwind, ex)
            and not is_ui_file("tailwind.config.ts", tailwind, ex)
            and not is_ui_file("docs/x.html", tailwind, ex)
            and not is_ui_file("components/Button.stories.tsx", tailwind, ex)
            and not is_ui_file("graphql/__generated__/types.tsx", tailwind, ex)
            and not is_ui_file("lib/api.generated.ts", tailwind, ex)
        )

    def case_detects_tailwind_by_dependency():
        root = Path(tempfile.mkdtemp())
        (root / "package.json").write_text(json.dumps({"devDependencies": {"tailwindcss": "^4"}}))
        return detect_stack(root)["id"] == "tailwind"

    def case_detects_swiftui_by_glob():
        root = Path(tempfile.mkdtemp())
        (root / "Demo.xcodeproj").mkdir()
        return detect_stack(root)["id"] == "swiftui"

    def case_falls_back_to_other():
        return detect_stack(Path(tempfile.mkdtemp()))["id"] == "other"

    def case_app_roots_monorepo():
        root = Path(tempfile.mkdtemp())
        for app in ("apps/web", "apps/admin", "packages/ui", "packages/empty"):
            (root / app).mkdir(parents=True)
        for app in ("apps/web", "apps/admin", "packages/ui"):
            (root / app / "package.json").write_text("{}")
        found = sorted(str(p.relative_to(root)) for p in app_roots(root))
        return found == [".", "apps/admin", "apps/web", "packages/ui"]

    def case_nearest_design_md_covers():
        root = Path(tempfile.mkdtemp())
        (root / "frontend" / "src").mkdir(parents=True)
        (root / "frontend" / "DESIGN.md").write_text("# D")
        (root / "backend").mkdir()
        return covered_by_design_md(root, "frontend/src/App.tsx") and not covered_by_design_md(root, "backend/x.tsx")

    def case_svelte_in_tailwind_is_ui():
        stacks = load_stacks()
        tw = next(x for x in stacks["stacks"] if x["id"] == "tailwind")["ui_globs"]
        return is_ui_file("src/lib/Button.svelte", tw, stacks["exclude_globs"]) and is_ui_file("src/App.vue", tw, stacks["exclude_globs"])

    def case_colorset_is_ui_despite_json_exclude():
        stacks = load_stacks()
        sw = next(x for x in stacks["stacks"] if x["id"] == "swiftui")["ui_globs"]
        return is_ui_file("App/Assets.xcassets/Brand.colorset/Contents.json", sw, stacks["exclude_globs"])

    cases = [
        case_svelte_in_tailwind_is_ui,
        case_colorset_is_ui_despite_json_exclude,
        case_nearest_design_md_covers,
        case_glob_double_star_matches_zero_or_more_dirs,
        case_glob_trailing_double_star,
        case_glob_single_star_stays_in_segment,
        case_glob_middle_double_star,
        case_excludes_tests_and_config,
        case_detects_tailwind_by_dependency,
        case_detects_swiftui_by_glob,
        case_falls_back_to_other,
        case_app_roots_monorepo,
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
