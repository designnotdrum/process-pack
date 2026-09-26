---
name: design-review
description: Use before opening a pull request that changes UI files, when the design review gate blocks `gh pr create`, or when asked to review the design of a branch. Screenshots the changed screens, runs the design reviewer method, impeccable's critique and the repo's accessibility scan, fixes what it finds in at most two rounds, and writes the review record the gate checks.
---

# Design review

## Overview

UI changes get a design review before they reach a pull request, so Nick is not the first reviewer. This skill runs the review, fixes what it can, and writes a record for the branch. The `design-review-gate` hook reads that record and lets `gh pr create` through once the record covers the branch's latest UI commit.

The review method itself lives in `reviewer.md` next to this file. In Claude Code, the `design-reviewer` agent runs it in a separate context. Any other agent follows `reviewer.md` inline.

## Steps

### 1. Read the repo's design rules

Read DESIGN.md, PRODUCT.md, and the `## Design` section of AGENTS.md. If the repo has no DESIGN.md, stop and run the `design-onboard` skill first.

### 2. Find the screens the diff touches

1. List the UI files the branch changed: `git diff --name-only $(git merge-base <base> HEAD)..HEAD`, where `<base>` is the pull request's base branch (usually `origin/main`). Keep files that match the stack's `ui_globs` in the design-onboard skill's `stacks/stacks.json` (or `design.ui_globs` in `.process/repo.yaml`) and are not in its `exclude_globs`.
2. Map each file to the screens that render it: a route file is its own screen, and a shared component maps to the screens that import it.
3. Run the app locally with the `run` skill, or use the branch's preview URL.

### 3. Screenshot each screen

Capture every touched screen at desktop width (1440) and mobile width (390), in each theme the product ships. Include empty, loading, and error states where the change touches them. Save them under `/tmp/design-review/<branch>/`.

### 4. Review

Run the method in `reviewer.md` with the screenshots and the list of changed files. In Claude Code, dispatch the `design-reviewer` agent and pass it the absolute path to `reviewer.md`. The method includes impeccable's critique and the accessibility scan skill installed in this repo.

### 5. Fix

Fix the findings, highest leverage first. At most two rounds: fix, re-capture the affected screens, and re-run the review once. Anything still open after the second round goes on the "left" list. Nothing is dropped silently.

### 6. Write the record and hand off

1. Commit the fixes.
2. Write the record for the current commit, from the repo root:

   ```bash
   python3 <process-pack>/skills/design-review/scripts/review_record.py write --sha HEAD \
     --ui-file <file> ... --fixed "<finding>" ... --left "<finding>" ... --screenshot <path> ...
   ```

   The record goes to `<git common dir>/process-pack/design-reviews/<branch>.json`. It is local to the clone and never committed.
3. Hand the summary (what was fixed, what is left) and the screenshots to the `qa-brief` skill for the pull request body.

A UI commit made after the record makes it stale, and the gate blocks again. Run this skill again after any later UI change.

## Skipping the review

Only when Nick says in the session that this change skips design review. Record his words as the reason:

```bash
python3 <process-pack>/skills/design-review/scripts/review_record.py write --sha HEAD --skip-reason "Nick: <his words>"
```

Never write a skip record on your own judgment, and never write one to get past the gate.
