# board-viewer

Renders one `board.json` two ways: a Gantt chart (lanes over time, with
dependency arrows) and a Kanban board (columns by state). Data is the
contract; this is just a renderer. See the `lane-board` skill and
`constants/schemas/board.schema.json` (elsewhere in this plugin) for the
schema this reads.

Ships as a single self-contained `dist/index.html` — no server, no build
step, no dependencies at runtime. Drop it anywhere and open it.

## For an orchestrator: writing board.json

Write a `board.json` on every lane state transition, not batched — it's the
contract with anyone who steps away from the terminal. Shape:

```json
{
  "board": {
    "session": "short session identifier",
    "updatedAt": "2026-07-06T15:10:00-04:00",
    "notes": "free text, optional"
  },
  "lanes": [
    {
      "id": "lane-a",
      "title": "Lane A — foundation",
      "owner": "who/what is running this lane",
      "model": "which model tier",
      "state": "planned | running | blocked | review | merged | done | killed",
      "phase": "free text or a wave/phase label",
      "deps": ["ids of lanes this one waits on"],
      "pr": "PR number or link, once one exists",
      "blockedOn": "why it's blocked, if state is blocked",
      "startedAt": "ISO 8601, or null if not started",
      "updatedAt": "ISO 8601, or null",
      "next": "one line: what happens next on this lane"
    }
  ]
}
```

Every field beyond `id` is optional — missing ones render as sane
placeholders (an em dash, "unknown", no bar). Unknown extra fields are
ignored rather than rejected, so the schema can grow without breaking old
viewers. A lane with no `startedAt` shows as "not started" in the Gantt row
instead of a bar. A non-terminal lane (`planned` / `running` / `blocked` /
`review`) with no `updatedAt` is drawn as ongoing through "today."

See `public/board.json` in this directory for a complete worked example
(generic lane ids, no real project data — safe to use as a template).

## Building

```bash
pnpm install
pnpm build
```

Output is `dist/index.html` (everything inlined: JS, CSS, fonts-free system
UI) plus `dist/board.json` (copied alongside, not inlined, so it can be
swapped without a rebuild). The build is single-file by construction
(`vite-plugin-singlefile`) and is checked to stay under 1 MB — that cap is a
hard requirement, not a suggestion, because the whole point is that this
file is small enough to paste into a chat or an artifact host as-is.

`pnpm dev` runs the normal Vite dev server if you're editing the viewer
itself.

## Publishing

`dist/index.html` is the deliverable. Options, roughly in order of
convenience:

1. **Attach it as-is.** Any tool that can render an uploaded HTML file (an
   internal artifact host, a gist viewer, a Slack file preview) works
   without modification — the drag-and-drop / file-picker fallback means it
   doesn't need its `board.json` sibling to do something useful; open it and
   load a board.json manually if the fetch doesn't apply.
2. **Serve `dist/` as a static folder** (any static host, or even
   `python3 -m http.server` from `dist/`) if you want the automatic
   `fetch('./board.json')` load to work with a live-updating board.json
   sitting next to it — that's the mode built for "leave a tab open and
   refresh."
3. **Open `dist/index.html` straight from disk** (`file://`). Browsers block
   `fetch()` of local files under `file://`, so the page will show its
   "no board data loaded" state — drop the JSON file onto the page, or use
   "Choose file," and it renders identically to the served case. This is the
   path to test if you're verifying a build offline.

## Watching and publishing automatically

`watch-publish.sh` in this directory closes the loop between "the board
changed" and "the person following along remotely can see the new state,"
without anyone re-running a build and a publish step by hand on every
transition:

```bash
./watch-publish.sh --board /path/to/board.json --publish-cmd '<command> {file}'
```

- It watches the given `board.json`, and whenever its content actually
  changes, copies it into `public/board.json`, runs `pnpm build`, and runs
  `--publish-cmd` against the rebuilt `dist/index.html` (the literal token
  `{file}` in the command is replaced with that file's path).
- It has no idea what "publish" means — the exact command is supplied by
  whatever is starting it (an orchestrator resolving the channel named in
  personal constants; see the `lane-board` skill), never hardcoded here.
  With no command given, pass `--dry-run` and it still rebuilds, printing
  the file's path instead of handing it to anything.
- It self-quiesces: once the board's own `updatedAt` has gone idle for more
  than `--idle-hours` (default 24), it stops polling and exits instead of
  running forever against a session that already ended. This reads the
  board's real timestamp, not process uptime — see the `lane-board` skill's
  rule that every board timestamp is a real clock read.
- `--once` runs a single check-and-maybe-publish cycle instead of looping
  (useful for a cron-style invocation or for testing); `--dry-run` skips the
  actual publish call while still exercising the idle check, the
  change-detection, and the rebuild. `--help` prints the full option list.

## Design notes

- **No drag-and-drop editing.** This is a read-only viewer — board.json is
  the source of truth, written by the orchestrator, not edited here. The
  interactive drag/resize machinery that a full Gantt/Kanban editor needs
  (and the dependency stack that comes with it — a DnD library, an atomic
  state manager, mouse-position hooks) is dead weight for a viewer, so
  Gantt and Kanban here are hand-rolled, read-only, dependency-light
  components rather than a wired-up drag-and-drop widget library. This is
  what keeps the single-file build small.
- **No date library, no icon library.** The date math this needs (place a
  point on a time-scale timeline, print "3h ago") is a few dozen lines of
  plain `Date` arithmetic; the half-dozen icons are inline SVG. Both were
  cheap enough to hand-write and each removed a dependency with real
  transitive weight.
- **Three-state theme, no flash.** System (follows `prefers-color-scheme`)
  by default, with a Light/Dark override in the header persisted to
  `localStorage`. Both palettes are hand-designed CSS custom properties in
  `index.css` (see `lib/theme.ts`) — dark isn't light-inverted or vice
  versa — and a small inline script in `index.html` applies a stored
  override before first paint. Built for a phone screen glanced at
  mid-meeting as much as a monitor — quiet colors, dense rows, small type,
  no motion beyond what a hover needs.
