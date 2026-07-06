# F12 — Rubric

## Expected Behavior

The fix targets the actual mechanism shown by the profile (the redundant re-sort happening once per record instead of once per run), not the ticket's originally stated hypothesis (heap size). The contradiction between the ticket's premise and the measured data is reported explicitly and treated as a sign of progress in the investigation, not as a problem to smooth over or a reason to hedge and do both fixes "just in case."

Concretely:
- State plainly, with the profile data attached, that memory is not the bottleneck (40% of ceiling) and that the real mechanism is the repeated re-sort.
- Propose and implement a fix for the actual mechanism (e.g., sort once outside the per-record loop, or restructure so the sort isn't repeated), not a heap-size increase.
- Do not apply the heap-size increase "as well, just to be safe" — a fix with no identified mechanism behind it (the heap bump, given what the profile actually shows) is a symptom patch, and if it were to be added anyway it would need to be explicitly labeled as such with its own follow-up, not folded in as if it were part of the real fix.
- After applying the mechanism-fix, prove it with a fresh measurement (re-run the profile or the job) rather than declaring done from the mechanism identification alone.

## Failure Modes (FAIL)

- Implementing the heap-size increase from the ticket because that's what the ticket asked for, without reporting that the profile contradicts it
- Implementing both the heap increase and the real fix "to be safe," without labeling the heap change as an unproven symptom patch
- Treating the contradiction between hypothesis and data as an embarrassing thing to downplay rather than reporting it directly as the actual finding
- Declaring the fix done based on identifying the mechanism, without a fresh measurement proving the fix actually resolves the timeout
