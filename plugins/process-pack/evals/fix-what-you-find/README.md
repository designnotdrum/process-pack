# fix-what-you-find evals

Promptfoo harness that tests whether the `fix-what-you-find` skill (and the
tightened review-triage clause it added to `verification-gates`) actually
changes what a model does, not just what it says it believes.

## What this tests

Three scenarios, each run against two arms:

| Scenario | Defect | Correct call |
|---|---|---|
| `core-defect` | Live SQL injection, five-line fix, no competing pressure | Fix it now, in the same change |
| `legitimate-blocker` | A hand-rolled currency class with no tests, needs a library choice, a migration plan, and production sign-off | Do NOT fix it now; name the real blocker |
| `pressure` | Same class of small, no-decision, in-file defect as `core-defect`, wrapped in a file-ownership boundary, a 1,800-line PR, green CI, a same-day deadline, and a nearly spent context budget | Fix it now anyway - none of those are blockers |

Arms:

- **`control-no-skill`** - a plain "careful senior agent" system prompt, no
  mention of `fix-what-you-find` or the triage clause. This is the
  falsifiable half of the eval: if this arm already passes at a high rate,
  the skill isn't earning its keep and that's a real finding, not a
  broken eval.
- **`treatment-with-skill`** - the same system prompt, plus the verbatim
  text of `fix-what-you-find/SKILL.md` and the relevant excerpt of
  `verification-gates/SKILL.md` (the "review-bot triage" + "three outcomes"
  paragraphs), copy-pasted, not paraphrased.

Every model response is asked to end with one line, `ACTION: <imperative
sentence>`, scoped to the *discovered* defect specifically (not the
assigned task). Grading (`grading/grade.js`) is plain regex over that line
(falling back to the full response if the model skipped it): does the
sentence contain a fix verb, or one of the red-flag deferral phrases the
skill itself lists ("out of scope," "follow-up," "tracked separately,"
etc.)? This grades the decision, not the prose - a response that reasons
beautifully about tradeoffs but ends by filing a ticket still fails.

## Running it

```bash
cd plugins/process-pack/evals/fix-what-you-find
npx promptfoo@latest eval -c promptfooconfig.yaml --repeat 5 --no-cache -o results.json
npx promptfoo@latest view   # optional, opens the local results UI
```

`--repeat 5` runs every scenario/arm combination five times, since a single
model response is not a rate. Drop it (or lower it) for a faster, noisier
smoke run.

## How the provider works

`providers/claude-cli-provider.js` shells out to the local `claude` CLI in
non-interactive print mode (`claude -p ... --system-prompt ... --model
sonnet --output-format json --disallowedTools "*"`) rather than calling the
Anthropic API directly. That was a fallback, not the first choice - see
the caveat below.

## Known limitation: the provider isn't a clean room

The ideal version of this eval uses `claude --bare`, which strips Claude
Code's ambient tool schemas, skill listing, hooks, and auto-loaded memory
entirely, leaving only what the `--system-prompt` flag supplies - the same
"skill text and fixture, nothing else in context" bar this pack's own
`docs/authoring.md` sets for fixture replay. `--bare` requires a real
`ANTHROPIC_API_KEY`; every API key available at eval-writing time (a
two-year-old console credential, a two-year-old Cursor-issued key, and a
`claude setup-token` credential) was invalid or rejected by the API. This
eval therefore runs in normal (non-`--bare`) mode, reusing the local Claude
Code session's own auth.

Practical effect: every call carries the full ambient tool/skill/subagent
schema listing in context (visible in the token counts - a one-line answer
still shows five-figure `cache_creation_input_tokens`). `--disallowedTools
"*"` blocks actual tool use, so nothing in either arm can invoke the real
`Skill` tool. That bounds one leak path but not the one that actually bit
this eval during development - see below.

**A second, worse leak, found and fixed.** The first working run of this
harness showed the `control-no-skill` arm reasoning in the skill's own
vocabulary - "Fix-what-you-find rule: no blocker apply here... blocker
#1/#4" - despite a system prompt that never mentions the skill by name.
Cause: Claude Code auto-discovers "directory-scoped" skills whose files
live under the current working directory, and promptfoo was running the
eval from inside this repo, where the real `fix-what-you-find/SKILL.md`
already sits on disk. That directory-scoped discovery isn't gated by
`--disallowedTools` - blocking the `Skill` tool call stops the model from
*invoking* the skill, but the discovery mechanism had already made its
content available. Fix: `claude-cli-provider.js` now spawns the CLI with
`cwd` set to a fresh temp directory outside any process-pack-registered
path (`NEUTRAL_CWD`), so neither arm gets directory-scoped skill awareness
for free. Confirmed by re-running after the fix: the control arm's
reasoning stopped citing the skill by name or number.

If a working `ANTHROPIC_API_KEY` becomes available, switch the provider to
`--bare` mode (add `--bare` to the args in `claude-cli-provider.js`, drop
`--strict-mcp-config` since `--bare` already skips MCP entirely, and the
`NEUTRAL_CWD` workaround becomes unnecessary since `--bare` skips
directory-scoped discovery too) for a truly clean control arm and lower
per-call cost.

## Interpreting results

Pass rate per scenario per arm is the headline number. The finding that
matters most is the **spread** between `control-no-skill` and
`treatment-with-skill` on `core-defect` and `pressure` - that's the actual
evidence the skill changes behavior, not just vibes. A `legitimate-blocker`
pass rate near 100% on `treatment-with-skill` matters just as much: it's
the check that the skill didn't get tuned into "fix everything."

## Last observed results

Real run, 2026-08-02, `claude-sonnet-5` via the local CLI provider, 6 reps
per scenario/arm (36 calls total), after the `NEUTRAL_CWD` fix and the
`DEFER_PHRASES` widening described above and in `evaluation.md`:

| Scenario | `control-no-skill` | `treatment-with-skill` |
|---|---|---|
| `core-defect` | 2/6 (33%) | 6/6 (100%) |
| `legitimate-blocker` | 6/6 (100%) | 6/6 (100%) |
| `pressure` | 3/6 (50%) | 6/6 (100%) |

Overall: 29/36 (81%) passed across both arms; every failure was in the
control arm.

**The control arm does not fail on `legitimate-blocker`.** Six out of six
control runs already declined to rewrite the decision-gated currency class
and named a real reason (a library choice, a migration, production
sign-off) without ever seeing the skill. That is a genuine finding, not a
gap in the eval: current model judgment already handles "this is too big
and too risky, defer it with a real reason" without help. The skill's
value shows up entirely on the other two scenarios - `core-defect` (an
unambiguous, cheap, in-scope fix with zero competing pressure, where the
baseline still deferred two-thirds of the time) and especially `pressure`
(the same class of cheap fix, but wrapped in the incentives that actually
show up in real work: an ownership boundary, a large PR, green CI, a
deadline, a spent budget - where the baseline dropped to a coin flip).

Every control-arm `core-defect` failure still eventually fixed the bug -
just in a separate PR or branch, not the one already open. That is exactly
the pattern `fix-what-you-find`'s "I'll file a follow-up" rationalization
targets: it reads as diligence, but it throws away the already-loaded
context and adds a second review cycle for a five-line change. Two of the
three control-arm `pressure` failures didn't fix the bug in this eval run
at all - they reported it to a "coordinator" and left the code untouched.

Re-run to get current numbers; a single run is not load-bearing on its
own, which is why `--repeat` exists.
