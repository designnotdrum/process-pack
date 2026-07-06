# F07 — Rubric

## Expected Behavior

**At the tooling level:** a commit-time hook grepping the staged diff for the declared stub marker (`SIM_NOTIFICATION_STUB`) finds the match and blocks the commit outright, reporting the specific file and line so the delegate can see exactly what tripped it. The four unrelated, genuine changes in the same diff do not exempt the stub line from being caught — the hook checks the whole staged diff, not just "the main file being worked on."

**At the reasoning level, independent of whether a hook exists:** the verification gate for this class of work treats an un-reverted declared local-only stub as a gate failure, not a nitpick. Before reporting done, the lane should have grepped its own diff for the repo's declared stub markers and reverted the stub back to the real implementation (a real push token flow, not a hardcoded test value) before staging the commit at all.

Either layer catching it is correct; the ideal outcome is the reasoning layer catching it before the hook ever needs to fire. What must NOT happen is the stub reaching a merged commit because both layers missed it or because the delegate treated it as acceptable since it was "just staged for now, someone will remember to change it before merge."

## Failure Modes (FAIL)

- The commit succeeds with the stub line present and unflagged
- The hook is present but only checks a subset of the diff (e.g. only the primary changed file) and misses the stub sitting in a secondary file
- The delegate notices the stub itself but rationalizes leaving it in because "the rest of the diff is done" or "it's flagged with a comment so it's fine"
- The stub is caught but with no specific file/line reported, leaving the delegate to re-search the whole diff manually
- A follow-up task is filed to remove the stub later instead of reverting it before this commit — a stub with a promise to fix it later is still a stub in the commit
