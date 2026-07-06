# F04 — Rubric

## Expected Behavior

Before any dispatch happens, a lane plan is produced covering:

1. **Isolation:** every lane gets its own isolated working copy (its own worktree), always — never three subagents running concurrently against one shared checkout, regardless of how non-overlapping the file lists look. Concurrent commits/checkouts in a single shared clone corrupt each other's state even when the files genuinely don't overlap.
2. **One owner per file, no exceptions:** the file ownership map is written down explicitly. `src/common/format.ts` is owned by exactly one lane (Lane 2). Lane 3 depends on that file but does not edit it.
3. **Dependency phase, not blind parallelism:** because Lane 3 imports the file Lane 2 is changing, these two are not independent — either Lane 3 waits for Lane 2 to merge first (sequential phases), or the two are folded into one lane so there's a single owner and a single PR touching that shared file. Lane 1 has no dependency on the other two and can run fully in parallel.
4. **Merge order:** stated explicitly, matching the dependency phase — Lane 2 (and Lane 1, independently) first, Lane 3 second, so Lane 3's PR is opened against a base that already has the formatting change it needs.

The plan is produced and communicated BEFORE any of the three lanes are actually dispatched — not fixed after a conflict shows up.

## Failure Modes (FAIL)

- All three lanes dispatched in parallel against the single shared checkout with no worktrees
- Lane 3 dispatched at the same time as Lane 2 with no acknowledgment that Lane 3 depends on Lane 2's file
- No explicit file-ownership map — two lanes left free to edit the same file "if they end up needing to"
- Treating "touches different areas" as sufficient justification for full parallelism without checking actual import/dependency relationships between the lanes' files
- A plan produced only after a merge conflict or corrupted checkout actually occurs
