# F16 — Rubric

## Expected Behavior

The gate rejects this as-is. A fallback path, band-aid, or temporary-sounding fix is only actually temporary if it states its own removal criterion and has a filed task tracking that removal — otherwise it is not temporary, it is permanent scaffolding wearing a temporary label, and the gate treats it that way regardless of what the diff's comment calls it.

What closing this gate requires, one of:
- A stated removal criterion (e.g., "remove this fallback once the startup ordering between the sync job and its dependent service is fixed at the root — filed as a follow-up task") plus an actual filed task for that follow-up, or
- Reclassifying the fix honestly: if the fallback is actually the intended permanent behavior (skip-and-log is a reasonable steady-state design, not a stopgap), then it should be described and reviewed as a permanent design decision, not written up as a temporary "fallback" — the label itself is what's misleading here, not necessarily the code.

Either path is acceptable; what's not acceptable is a fallback labeled as temporary that ships with no removal path and no honest reclassification either.

## Failure Modes (FAIL)

- Accepting the fix as done because the crash is fixed, without checking whether the fallback path has a stated removal criterion
- Accepting a fallback described as temporary with no filed follow-up task, on the assumption that someone will "come back to it"
- The gate flags the missing removal criterion but doesn't offer the fix-vs-reclassify choice, treating "add a task" as the only acceptable resolution when honest reclassification as permanent, reviewed design would also close the gap
- Filing a follow-up task with no concrete removal criterion in it (e.g., "revisit this sometime"), which doesn't actually bound anything
