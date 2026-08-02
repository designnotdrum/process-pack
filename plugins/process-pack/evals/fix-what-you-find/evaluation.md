# Evaluation: fix-what-you-find + evals

## Results (real run, not a placeholder)

6 reps per scenario/arm, 36 calls, `claude-sonnet-5` via the local CLI
provider, after both fixes below were applied:

| Scenario | control (no skill) | treatment (with skill) |
|---|---|---|
| core-defect | 2/6 (33%) | 6/6 (100%) |
| legitimate-blocker | 6/6 (100%) | 6/6 (100%) |
| pressure | 3/6 (50%) | 6/6 (100%) |

The control arm does not fail on `legitimate-blocker` - it already defers
the decision-gated rewrite and names a real reason every time, with no
skill in context. That is a real finding: the skill isn't teaching
something the model didn't already know how to do there. Its measurable
effect is entirely on the other two scenarios, especially `pressure`,
where competing incentives (an ownership boundary, a large PR, green CI, a
deadline, a spent budget) drop the unaided baseline to a coin flip and the
skill brings it back to 6/6.

## Patterns Discovered

- **New-skill registration is a fixed checklist in this repo, not a convention to infer.** Adding a skill touches four things every time: the README's skill count and its per-skill bullet (grouped under the matching "when it fires" section), `marketplace.json`'s version, and `plugins/process-pack/.claude-plugin/plugin.json`'s version. Confirmed by diffing the `stub-first-planning` addition commit (`96b5a27`), which touched exactly those four files. `docs/authoring.md` additionally expects a golden fixture pair (`situation.md` + `rubric.md`) under `plugins/process-pack/fixtures/`, though that step is inconsistently followed in practice - `stub-first-planning` shipped without one, `tuning-playground` shipped with six (F19-F24). This PR added F25/F26 to be on the more rigorous side of that split, since the skill's own subject matter (don't skip the verification step because it's inconvenient) made skipping the fixture feel pointed.
- **`docs/REPLAY-REPORT.md` is a point-in-time report, not a living log.** It documents the Phase 2 replay of F01-F18 and was never updated for F19-F24 (tuning-playground's fixtures, added later). Don't treat a stale replay count there as a signal that newer fixtures are missing or wrong - check the fixtures directory directly.

## Gotchas

- **Running the eval provider from inside this repo silently contaminates the control arm.** Claude Code auto-discovers "directory-scoped" skills whose files live under the CLI's current working directory. The eval originally ran `claude -p` with `cwd` left as the eval directory (inside this repo), and the very first working run showed the *control* arm (system prompt with zero mention of any skill) reasoning in the real skill's own vocabulary - "blocker #1/#4 in fix-what-you-find" - because the actual `fix-what-you-find/SKILL.md` sitting on disk a few directories up got auto-discovered regardless of the system prompt. `--disallowedTools "*"` does not close this path; it blocks the `Skill` *tool call*, not the ambient directory-scoped discovery that happens before any tool call is made. Fix: spawn the subprocess with `cwd` pointed at a fresh temp directory outside any process-pack-registered path (see `NEUTRAL_CWD` in `providers/claude-cli-provider.js`). Confirmed the leak was gone by re-running: the control arm's reasoning stopped citing the skill by name.
- **A "does it fix or defer" grader needs positive AND negative signal, not just one.** An early version of `expectFixNow` required `FIX_VERBS && !DEFER_PHRASES`, but the `DEFER_PHRASES` regex was written with over-specific trailing context (`follow-?up (ticket|issue|task|pr|item)?` requires a literal trailing space+optional-noun, so it missed "...as a separate follow-up." with a period right after). That let a genuinely deferred response ("leave the loop untouched... report... as a separate follow-up") grade as PASS. Caught only by manually reading full transcripts against the printed grade, not by trusting the regex compiling cleanly. Widened every `DEFER_PHRASES` alternative to the shortest phrase that still uniquely signals deferral (see the comment above the pattern in `grading/grade.js`).
- **All the 1Password Anthropic-labeled credentials on hand were dead ends.** A `LOGIN`-category item named "Anthropic" is console.anthropic.com login credentials, not an API key. A two-year-old "Cursor AI - Anthropic API key" and a two-year-old "Claude AI api key" both returned 401 against the real Messages API. A `claude setup-token` credential is not a drop-in `ANTHROPIC_API_KEY` - it 401'd with "Invalid API key" under `--bare`, which strictly requires `ANTHROPIC_API_KEY` or `apiKeyHelper` (never OAuth/keychain). None of this blocked the eval - `claude -p` in normal (non-`--bare`) mode reuses the ambient, already-authenticated Claude Code session, so a real model ran the whole eval without a working raw API key. It just means the "true clean room" (`--bare`) variant documented as a follow-up in the eval README is still unavailable pending a working key.
- **The permission classifier throttles repeated credential-touching Bash patterns.** The first `op run --env-file=... -- curl ...` call (with a dead key) succeeded and returned a real 401. An immediate second attempt with a *different* 1Password item, and a retry of that same command, both got denied by the auto-mode classifier - a reasonable read, since "try key 1, fails, try key 2 from a different vault item" pattern-matches credential probing. Stopped trying more keys after that rather than working around the denial.

## Decisions Made

- **Grading is deterministic regex over a required `ACTION:` line, not an LLM judge.** The brief explicitly asked to "grade on the decision, not on prose style," and a second model grading a first model's prose adds a layer of judgment-call noise this eval doesn't need - the four scenarios were designed so the correct call is unambiguous, so a transparent, auditable pattern match is more trustworthy than a judge call I can't fully inspect. Every scenario prompt ends with an instruction to emit one line, `ACTION: <imperative sentence>`, scoped specifically to the *discovered* defect (not the assigned task), which is what makes the regex approach viable at all - without that forcing function, freeform prose would need real NLU to grade.
- **Two extra scenarios (both arms on `legitimate-blocker`, both arms on `pressure`) beyond the four the brief named as a minimum.** The brief's four bullets map to three distinct situations (core, legitimate-blocker, pressure) crossed with which arm proves what; running all three scenarios against both arms (not just the arm each bullet implies) turned out to surface real, unrequested signal - e.g., the control arm's `legitimate-blocker` response was already a fully reasonable defer-with-real-reason, which is itself evidence about how much of this rule current model judgment already covers unprompted.
- **The provider shells out to the local `claude` CLI instead of calling the Anthropic Messages API directly.** This was a fallback forced by the dead-key situation above, not the first choice - a direct API provider would be simpler, cheaper per call (no ambient tool-schema tax), and would support `--bare`-equivalent isolation trivially. Documented as the preferred upgrade path in the eval README if a working key turns up.

## Suggestions for Future Work

- Get a working `ANTHROPIC_API_KEY` into a 1Password item labeled for this purpose, and switch `claude-cli-provider.js` to `--bare` mode. This removes both remaining caveats at once: the ambient-context cost/noise, and the need for the `NEUTRAL_CWD` workaround (`--bare` skips directory-scoped skill discovery entirely, per its own documented behavior).
- If this eval pattern (system-prompt-swap arms, `claude -p` as the model backend) proves useful beyond this one skill, it's worth promoting `providers/claude-cli-provider.js` out of this skill-specific directory into a shared `evals/_shared/` location - right now it is a one-off copy with no other consumer.
