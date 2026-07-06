#!/usr/bin/env bash
#
# watch-publish.sh — generic watch-and-publish loop for the board-viewer.
#
# Watches a board.json for changes, rebakes the single-file viewer
# (`pnpm build`) with the current data whenever the board's content
# actually changes, and runs a publish command against the rebuilt file.
# Self-quiets once the board's own `updatedAt` has gone idle for more than
# a configurable number of hours (default 24), so this never turns into a
# background poller left running against a session that already ended.
#
# This script has no idea what "publish" means. It takes the exact command
# to run as an argument (or the PUBLISH_CMD environment variable), which the
# caller resolves from personal constants (`publishing` / a `tool_mapping`
# entry's `publishing` override) one layer above this script — it never
# hardcodes a specific publisher, and it never guesses one when none is
# configured. With no publish command given, pass --dry-run: the rebuild
# still runs, and the file's path is printed instead of being handed to
# anything.
#
# Usage:
#   watch-publish.sh --board <path/to/board.json> [options]
#
# Options:
#   --board PATH          Path to the board.json to watch. Required.
#   --publish-cmd CMD     Shell command to run against the rebuilt viewer
#                          file. The literal token {file} anywhere in CMD is
#                          replaced with the rebuilt file's absolute path.
#                          Falls back to $PUBLISH_CMD if not given. Required
#                          unless --dry-run.
#   --viewer-dir PATH     Path to the board-viewer package to build.
#                         Default: this script's own directory.
#   --state-file PATH     Where to remember the last-published board hash.
#                         Default: a path under $TMPDIR derived from the
#                         board path, so no config is required to start.
#   --interval SECONDS    Poll interval while the board is active.
#                         Default: 30.
#   --idle-hours HOURS    Hours since the board's own `updatedAt` after
#                         which this script stops polling and exits instead
#                         of continuing to watch a finished run. Default: 24.
#   --once                Run a single check-and-maybe-publish cycle, then
#                         exit, instead of looping. Useful for cron-style
#                         invocation or for testing.
#   --dry-run             Do everything (idle check, change detection,
#                         rebuild) except actually run --publish-cmd; print
#                         the resolved command and file path instead.
#   -h, --help             Show this help and exit.
#
# Exit codes: 0 on a clean exit (including a self-quiesce on an idle board),
# non-zero on a usage error or a build failure.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

board_path=""
publish_cmd="${PUBLISH_CMD:-}"
viewer_dir="$script_dir"
state_file=""
interval=30
idle_hours=24
once=0
dry_run=0

print_help() {
  sed -n '2,/^set -euo pipefail/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^#\s\?//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --board) board_path="$2"; shift 2 ;;
    --publish-cmd) publish_cmd="$2"; shift 2 ;;
    --viewer-dir) viewer_dir="$2"; shift 2 ;;
    --state-file) state_file="$2"; shift 2 ;;
    --interval) interval="$2"; shift 2 ;;
    --idle-hours) idle_hours="$2"; shift 2 ;;
    --once) once=1; shift ;;
    --dry-run) dry_run=1; shift ;;
    -h|--help) print_help; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 64 ;;
  esac
done

if [ -z "$board_path" ]; then
  echo "error: --board <path/to/board.json> is required" >&2
  exit 64
fi
if [ ! -f "$board_path" ]; then
  echo "error: board file not found: $board_path" >&2
  exit 66
fi
if [ -z "$publish_cmd" ] && [ "$dry_run" -ne 1 ]; then
  echo "error: --publish-cmd (or \$PUBLISH_CMD) is required unless --dry-run is set" >&2
  exit 64
fi
if ! command -v node >/dev/null 2>&1; then
  echo "error: node is required (used to read the viewer and parse board.json)" >&2
  exit 69
fi
if ! command -v pnpm >/dev/null 2>&1; then
  echo "error: pnpm is required to rebake the viewer" >&2
  exit 69
fi

board_path="$(cd "$(dirname "$board_path")" && pwd)/$(basename "$board_path")"
viewer_dir="$(cd "$viewer_dir" && pwd)"

if [ -z "$state_file" ]; then
  board_hash_for_state="$(printf '%s' "$board_path" | shasum -a 256 | awk '{print $1}')"
  state_dir="${TMPDIR:-/tmp}/process-pack-watch-publish"
  mkdir -p "$state_dir"
  state_file="$state_dir/$board_hash_for_state.state"
fi

log() {
  printf '[watch-publish] %s\n' "$1"
}

# Reads board.board.updatedAt and prints hours-since-now (integer, floored).
# Exits non-zero if the field is missing or unparseable — treated by the
# caller as "unknown age," never as "definitely fresh."
hours_since_board_update() {
  node -e '
    const fs = require("fs");
    const raw = fs.readFileSync(process.argv[1], "utf8");
    const data = JSON.parse(raw);
    const t = data && data.board && data.board.updatedAt;
    if (!t) { process.exit(2); }
    const ms = Date.parse(t);
    if (Number.isNaN(ms)) { process.exit(3); }
    const hours = (Date.now() - ms) / (1000 * 60 * 60);
    process.stdout.write(String(hours));
  ' "$board_path"
}

current_hash() {
  shasum -a 256 "$board_path" | awk '{print $1}'
}

last_hash() {
  if [ -f "$state_file" ]; then
    cat "$state_file"
  else
    echo ""
  fi
}

rebake_and_publish() {
  log "board changed — rebaking the viewer from $board_path"
  mkdir -p "$viewer_dir/public"
  cp "$board_path" "$viewer_dir/public/board.json"

  if [ ! -d "$viewer_dir/node_modules" ]; then
    log "no node_modules in $viewer_dir — running pnpm install first"
    (cd "$viewer_dir" && pnpm install --frozen-lockfile)
  fi

  (cd "$viewer_dir" && pnpm build)

  local built_file="$viewer_dir/dist/index.html"
  if [ ! -f "$built_file" ]; then
    echo "error: expected build output missing: $built_file" >&2
    return 1
  fi

  if [ "$dry_run" -eq 1 ]; then
    if [ -n "$publish_cmd" ]; then
      local resolved="${publish_cmd//\{file\}/$built_file}"
      log "dry-run: would publish via: $resolved"
    else
      log "dry-run: no publish command configured — file is at: $built_file"
    fi
  else
    local resolved="${publish_cmd//\{file\}/$built_file}"
    log "publishing via: $resolved"
    eval "$resolved"
  fi

  current_hash > "$state_file"
}

check_once() {
  local age
  if age="$(hours_since_board_update)"; then
    local age_int="${age%.*}"
    if [ "$age_int" -ge "$idle_hours" ]; then
      log "board has been idle for ~${age_int}h (>= ${idle_hours}h) — self-quiescing, exiting clean"
      return 2
    fi
  else
    log "warning: could not read board.updatedAt — proceeding without an idle check this cycle"
  fi

  local newhash oldhash
  newhash="$(current_hash)"
  oldhash="$(last_hash)"
  if [ "$newhash" = "$oldhash" ]; then
    log "no change since last check — nothing to do"
    return 0
  fi

  rebake_and_publish
}

status=0
check_once || status=$?

if [ "$status" -eq 2 ]; then
  exit 0
elif [ "$status" -ne 0 ]; then
  exit "$status"
fi

if [ "$once" -eq 1 ]; then
  exit 0
fi

while true; do
  sleep "$interval"
  status=0
  check_once || status=$?
  if [ "$status" -eq 2 ]; then
    exit 0
  elif [ "$status" -ne 0 ]; then
    exit "$status"
  fi
done
