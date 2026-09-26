# Stack reference: anything else

Used when no other entry in `stacks.json` matches: for example Flutter, Jetpack Compose, a server-rendered template stack, or a game UI.

## How to detect it

The `other` entry in `stacks.json` matches when nothing before it does. Its `ui_globs` are a broad guess (`.html`, `.vue`, `.svelte`, `.astro`, `.swift`, `.tsx`, `.jsx`, `.css`). Set `design.ui_globs` in `.process/repo.yaml` to the stack's real UI files, so the design hooks see the right changes. The hooks read that override only when PyYAML is installed for the `python3` they run under; without it they fall back to these globs and say so on stderr.

## Where tokens go

DESIGN.md only. Record the tokens there, and use the stack's own theming feature if it has one (for example a Flutter `ThemeData`). This skill ships no template for it.

## What blocks hardcoded colors

Nothing. Say so plainly in the onboarding output: "No check blocks hardcoded colors for this stack." The design review still looks for them by eye.

## How contrast is checked

Nothing automated. Say so plainly in the onboarding output: "No contrast check exists for this stack." The design review checks contrast on screenshots with the accessibility scan skill.
