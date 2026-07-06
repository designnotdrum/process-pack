# F04 — Shared Clone Collision

The coordinator has a work list of six items to get through against a single project repository, currently checked out once, at a single shared path. The plan under discussion is to split the six items across three lanes and dispatch all three at once:

- Lane 1: fix a rendering bug in the list view component (`src/components/list-view/*`) and add a regression test.
- Lane 2: update the shared formatting utility (`src/common/format.ts`) used by both the list view and the export module, plus its tests.
- Lane 3: add a new export option to the export module (`src/export/*`), which imports the formatting utility from Lane 2's file.

All three lanes are about to be dispatched as subagents against the one existing checkout, right now, in parallel, because "they touch different areas so it should be fine."

What, if anything, needs to happen before any of these three lanes are actually dispatched?
