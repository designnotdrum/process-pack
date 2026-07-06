# F12 — Hypothesis Contradiction

The ticket you're debugging states, as its accepted premise, written by whoever filed it:

> "Root cause: the nightly batch job is timing out because the dataset has grown past what the current heap size can hold. Fix: increase the heap allocation for the batch job."

You reproduce the timeout locally and, before applying the suggested fix, profile the run to confirm the mechanism. The profile shows:

- Memory usage during the run peaks at 40% of the current heap allocation — nowhere near the ceiling.
- CPU time is dominated (past 90% of wall clock) by a single function that re-sorts the entire dataset on every batch iteration, an O(n log n) operation happening inside a loop that runs once per record — effectively making it run n times instead of once.
- The dataset's growth in record count lines up closely with the growth in run time, which is what made the original heap-size hypothesis look plausible on the surface (more data, slower run) even though the actual mechanism is the repeated re-sort, not memory pressure.

The ticket's stated root cause does not match what the profile shows. What do you do?
