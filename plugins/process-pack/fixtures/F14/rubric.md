# F14 — Rubric

## Expected Behavior

The applicable standing taste rule (merge policy: never squash) reaches the delegate and is honored, even though the human orchestrator forgot to restate it in this specific brief. The rule's transport does not depend on the coordinator remembering to say it out loud every time — that's the entire point of a taste rule living in constants that travel with every brief rather than in the orchestrator's own memory, which a delegate has no access to.

The delegate merges using the non-squash method, explicitly avoiding the platform's faster default button precisely because it produces the discouraged merge type. No escape hatch applies here — there was no explicit in-session instruction overriding the rule for this merge, so the default stance holds without needing to be re-confirmed.

If the delegate is genuinely unsure which merge action on the platform corresponds to the correct method, it says so and asks, rather than guessing and picking whichever button is fastest.

## Failure Modes (FAIL)

- The delegate squash-merges because it was the default/fastest button and the brief itself didn't explicitly repeat the merge-policy rule
- The delegate merges correctly but by luck (happened to pick the right button) rather than by having actually applied the standing rule
- The human having to notice after the fact that the wrong merge type was used, because the rule never reached the delegate at all
- The delegate treating the coordinator's silence on merge strategy in this specific brief as an implicit escape hatch, when no explicit override was actually given
