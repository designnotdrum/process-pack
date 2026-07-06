# Case Studies

**NON-NORMATIVE.** These are real debugging sessions, kept here as worked examples for the `root-cause-first` and `verification-gates` skills. They teach; they do not govern. Nothing in this file is a rule — the skills are the rules. Unlike the SKILL.md files, this document may use concrete, specific detail (proper nouns for tools/technologies are fine here); it still avoids naming people.

Each case follows the same shape: symptom → wrong hypothesis → mechanism → fix → proof.

---

## Case 1: The six-week-old sync-effect regression

**Symptom.** A collaborative editing feature had been silently dropping remote edits for roughly six weeks before anyone noticed. Add and remove operations from other users rendered correctly and looked fine in every manual check. Edits to the content of an existing item did not show up for other users until a full page reload.

**Wrong hypothesis.** The first theory was a stale-cache problem: the client was reading a cached copy of the document instead of the live one. Forcing a cache-bust on every read changed nothing — the drop persisted.

**Mechanism.** The sync effect responsible for applying remote changes to local state used a count-based guard: it compared the number of items before and after an incoming update to decide whether the update was a no-op worth skipping. Add and remove operations always change the count, so they always passed the guard and re-rendered. An edit to an existing item changes content, not count, so it was silently classified as a no-op and dropped. The guard had been added long before the regression, as a performance optimization, and was doing exactly what it was written to do — just on a signal that could not detect the one kind of change that mattered most.

**Fix.** The first attempt widened the effect's dependency array to include the full item list, so any content change (not just a count change) would re-trigger the comparison. That surfaced a second problem: the wider dependency array caused a render loop, because the comparison itself produced a new array reference on every render, which looked like a change even when nothing had. The fix was revised to gate on a value-comparable signature of the items — a stable, content-derived key — instead of the count or the raw object reference. That reacted correctly to real content changes without re-triggering on identity changes alone.

**Proof.** With the count-guard replaced by the signature-based guard, an edit to an existing item propagated to other clients in the same reproduction that had previously shown a silent drop. Add, remove, and edit were each exercised in sequence and all three rendered correctly, with no render-loop regression across repeated edits.

---

## Case 2: The lint OOM that wasn't the parser

**Symptom.** A lint run in CI started running out of memory. Type-aware linting — a parsing mode known to be memory-hungry — had been enabled shortly before the failures started, so it was blamed and became the assumed root cause.

**Wrong hypothesis.** Type-aware parsing was consuming too much memory across a large codebase; the proposed plan was to disable it, or split the run into smaller chunks to reduce parser memory pressure.

**Mechanism.** Profiling actual rule-execution time showed that four specific lint rules accounted for roughly 57% of total rule-execution time, for a combined yield of 4 findings out of 5,691 findings across the whole run — a wildly disproportionate cost-to-value ratio. But the rules themselves were not the OOM trigger. The real trigger was that lint was invoked once per package, and multiple per-package lint processes were being run concurrently, each holding its own heap for the same expensive rules; the heaps stacked until the container's memory ceiling was hit. Type-aware parsing was expensive, but it was not what was pushing the process over the limit — the concurrency was.

**Fix.** The four expensive, low-yield rules were disabled, documented with their finding counts as the record of what was traded away, and the per-package lint invocations were serialized instead of run concurrently, so heaps no longer stacked on top of each other. A heap-size flag that had been bumped earlier as a band-aid was kept, but lowered, using the newly measured peak-memory margin as the justification for the smaller number instead of the original arbitrary bump.

**Proof.** The same CI lint run, re-executed with the four rules disabled and invocations serialized, completed without hitting the memory ceiling, with measured peak memory showing real headroom against the new, lower heap flag.

---

## Case 3: The flaky perf test that was racing wall-clock noise

**Symptom.** A performance regression test failed intermittently in CI, roughly one run in five, with no code change that correlated with the failures.

**Wrong hypothesis.** The initial assumption was environmental noise on the CI runner — a "noisy neighbor" problem — and the proposed fix was a retry wrapper around the test.

**Mechanism.** The test measured two operations, each taking on the order of 0.05 milliseconds, using wall-clock timers, and asserted that one was reliably faster than the other. At that timescale, the difference between the two operations was smaller than the scheduler noise and timer resolution of the environment running the test, so the assertion was, in effect, a coin flip dressed up as a performance check. The runner was not unusually noisy; the test's own premise — that a sub-millisecond wall-clock comparison is a meaningful, repeatable signal — was the defect.

**Fix.** The timing-based comparison was replaced with structural assertions on the output shape: checking that each operation produced the correct number and kind of results, rather than which one finished first. This tests the actual behavior the operations are supposed to guarantee, with no dependency on timing at all.

**Proof.** The revised test was run 25 times locally with no failures, then re-run 25 times under artificial CPU load (to simulate a noisy runner) with no failures, confirming the flake had been fully eliminated rather than merely made rarer.
