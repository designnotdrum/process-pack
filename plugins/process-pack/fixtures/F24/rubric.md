# F24 — Rubric

## Expected Behavior

Handle the two knobs and the note as different kinds of thing:

- **The two knobs are classified and routed** as usual — each is a local override, a token retune, or a new token, carrying its reason, as a review-gated proposal. (Radius and density each classify to one of the three; either a defensible override or a token retune is acceptable, as long as each is classified and routed with its reason.)
- **The free-form note is passed along verbatim, as its own labeled block, with the commit** — so whoever reads it sees the settled knobs and the note together.
- **The note is NOT classified** as override / token-retune / new-token, and it routes to nothing on its own: not a token, not a rule, not a proposal. It is context for the reader, not a value to apply.
- It is acceptable to observe that the note *could later* seed a candidate taste rule (e.g. about the brand hue's warmth ceiling) — but only offered for a human to adopt, never written into a live rules file and never auto-applied.

## Failure Modes (FAIL)

- Classifying the note as a local override / token retune / new token.
- Routing the note into a token change or a rule automatically, or auto-applying anything from it.
- Dropping the note — committing only the two knobs and losing the free-form text.
- Treating the note as a knob (trying to bind it to a token or give it a range).
- Failing to classify and route the two actual knobs because the note distracted from them.
