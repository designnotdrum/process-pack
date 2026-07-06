#!/usr/bin/env python3
"""
wall-guard: PreToolUse hook for the Bash tool.

Blocks a command that references a config/runtime directory belonging to a
different identity context than the one this session is running under (for
example, a personal session reaching into a work config directory, or the
reverse). An access path existing is not authorization to use it — see the
resource-wall-preflight skill for the full rule.

No third-party dependencies: standard library only.

Config path patterns are never hardcoded here. They live in a small JSON
config file (see wall-guard.config.example.json) meant to be generated from,
or kept in sync with, the wall declarations in your constants.

Exit codes: 0 = allow, 2 = block (with a JSON reason on stdout).

Dry run / self-test (no live session or settings.json wiring required):
    python3 wall_guard.py --dry-run
"""
import json
import os
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
CONFIG_ENV_VAR = "WALL_GUARD_CONFIG"
DEFAULT_CONFIG_NAME = "wall-guard.config.json"
DEFAULT_OVERRIDE_VAR = "PROCESS_PACK_ALLOW_CROSS_CONFIG"
DEFAULT_ACTIVE_CONTEXT_ENV_VAR = "CLAUDE_CONFIG_DIR"
DEFAULT_ACTIVE_CONFIG_DIR = "~/.claude"


def expand(path):
    return str(Path(path).expanduser())


def find_config_path():
    override = os.environ.get(CONFIG_ENV_VAR)
    if override:
        return Path(override).expanduser()
    return SCRIPT_DIR / DEFAULT_CONFIG_NAME


def load_config_or_none(path):
    if path is None or not path.exists():
        return None
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        print(
            f"[wall-guard] WARNING: could not read config at {path}: {e}. Allowing.",
            file=sys.stderr,
        )
        return None


def active_config_dir(cfg):
    env_var = cfg.get("active_context_env_var", DEFAULT_ACTIVE_CONTEXT_ENV_VAR)
    default = cfg.get("default_config_dir", DEFAULT_ACTIVE_CONFIG_DIR)
    value = os.environ.get(env_var) or default
    return expand(value)


def foreign_contexts(cfg, active_dir):
    """Every known context whose config dir is NOT the active one."""
    result = []
    active_norm = os.path.normpath(active_dir)
    for ctx in cfg.get("known_contexts", []):
        config_dir_raw = ctx.get("config_dir")
        pattern = ctx.get("pattern")
        if not config_dir_raw and not pattern:
            continue
        expanded_dir = expand(config_dir_raw) if config_dir_raw else None
        if expanded_dir and os.path.normpath(expanded_dir) == active_norm:
            continue  # this is the active context's own dir, not foreign
        result.append(
            {
                "label": ctx.get("label", config_dir_raw or pattern),
                "config_dir_raw": config_dir_raw,
                "config_dir": expanded_dir,
                "pattern": pattern,
            }
        )
    return result


def path_needles(config_dir_raw, expanded_dir):
    """
    A Bash command is a literal string a shell would later expand — it may
    contain '~/...', '$HOME/...', or an already-absolute path. Build every
    form worth matching against, since the hook never sees post-expansion
    text.
    """
    needles = set()
    if config_dir_raw:
        needles.add(config_dir_raw.rstrip("/"))
    if expanded_dir:
        needles.add(expanded_dir.rstrip("/"))
        home = str(Path.home())
        if expanded_dir.startswith(home):
            suffix = expanded_dir[len(home):]
            needles.add(("$HOME" + suffix).rstrip("/"))
    return [n for n in needles if n]


def command_references_dir(command, config_dir_raw, expanded_dir):
    for needle in path_needles(config_dir_raw, expanded_dir):
        escaped = re.escape(needle)
        # path-shaped boundary: end of string, whitespace, quote, or path separator
        if re.search(escaped + r'(?:[/\s"\'`:]|$)', command) is not None:
            return True
    return False


def command_matches_context(command, ctx):
    if ctx.get("pattern"):
        try:
            if re.search(ctx["pattern"], command):
                return True
        except re.error:
            pass
    if ctx.get("config_dir") and command_references_dir(
        command, ctx.get("config_dir_raw"), ctx["config_dir"]
    ):
        return True
    return False


def check(command, cfg):
    """Return the first foreign context the command references, or None."""
    active_dir = active_config_dir(cfg)
    for ctx in foreign_contexts(cfg, active_dir):
        if command_matches_context(command, ctx):
            return ctx
    return None


def build_reason(command, ctx, cfg, override_var):
    active_dir = active_config_dir(cfg)
    where = ctx.get("config_dir") or ctx.get("pattern")
    return (
        f"This command references a config/runtime directory belonging to a "
        f"different identity context ('{ctx['label']}': {where}) than the one "
        f"this session is running under ({active_dir}). An access path existing "
        f"is not authorization to use it — copy the config you need instead of "
        f"bridging the runtime. If this cross-context call is genuinely "
        f"intended, set {override_var}=1 for this command."
    )


def decide(command, cfg):
    """
    Core policy decision, independent of I/O. Returns:
        {"action": "allow"} or {"action": "block", "reason": <str>}
    """
    if not command or not command.strip():
        return {"action": "allow"}

    override_var = cfg.get("override_env_var", DEFAULT_OVERRIDE_VAR)
    if os.environ.get(override_var):
        return {"action": "allow"}

    ctx = check(command, cfg)
    if ctx is None:
        return {"action": "allow"}

    return {"action": "block", "reason": build_reason(command, ctx, cfg, override_var)}


def read_hook_payload():
    """
    Read the tool_input payload from either the CLAUDE_TOOL_INPUT env var
    (already the tool_input object in this harness's convention) or stdin
    (either the bare tool_input object, or the full hook event with a
    tool_input key — both shapes are accepted).
    """
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


def main():
    payload = read_hook_payload()
    command = extract_command(payload)

    cfg = load_config_or_none(find_config_path())
    if cfg is None:
        sys.exit(0)  # nothing declared, nothing to check

    result = decide(command, cfg)
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

    active_env_var = "WALL_GUARD_TEST_ACTIVE_CONTEXT"

    with tempfile.TemporaryDirectory() as td:
        personal_dir = os.path.join(td, "personal-config")
        work_dir = os.path.join(td, "work-config")
        os.makedirs(personal_dir)
        os.makedirs(work_dir)

        cfg = {
            "active_context_env_var": active_env_var,
            "default_config_dir": personal_dir,
            "override_env_var": "WALL_GUARD_TEST_OVERRIDE",
            "known_contexts": [
                {"label": "personal", "config_dir": personal_dir},
                {"label": "work", "config_dir": work_dir},
            ],
        }

        def with_active(active_dir, fn):
            old = os.environ.get(active_env_var)
            os.environ[active_env_var] = active_dir
            try:
                return fn()
            finally:
                if old is None:
                    os.environ.pop(active_env_var, None)
                else:
                    os.environ[active_env_var] = old

        r1 = with_active(personal_dir, lambda: decide(f"cat {work_dir}/plugins/x.json", cfg))
        check_case("active=personal, command touches work dir -> block", r1["action"] == "block")

        r2 = with_active(personal_dir, lambda: decide(f"cat {personal_dir}/settings.json", cfg))
        check_case("active=personal, command touches own dir -> allow", r2["action"] == "allow")

        r3 = with_active(work_dir, lambda: decide(f"cat {personal_dir}/projects/foo", cfg))
        check_case("active=work, command touches personal dir -> block", r3["action"] == "block")

        r4 = with_active(work_dir, lambda: decide("echo hello world", cfg))
        check_case("active=work, unrelated command -> allow", r4["action"] == "allow")

        os.environ["WALL_GUARD_TEST_OVERRIDE"] = "1"
        try:
            r5 = with_active(personal_dir, lambda: decide(f"cat {work_dir}/plugins/x.json", cfg))
        finally:
            os.environ.pop("WALL_GUARD_TEST_OVERRIDE", None)
        check_case("override env var allows a cross-context command through", r5["action"] == "allow")

        r6 = with_active(personal_dir, lambda: decide("", cfg))
        check_case("empty command -> allow", r6["action"] == "allow")

    missing_cfg = load_config_or_none(Path("/nonexistent/wall-guard.config.json"))
    check_case("missing config file -> None (caller allows)", missing_cfg is None)

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    if "--dry-run" in sys.argv[1:] or "--self-test" in sys.argv[1:]:
        self_test()
    else:
        main()
