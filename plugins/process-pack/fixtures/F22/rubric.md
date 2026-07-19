# F22 — Rubric

## Expected Behavior

Classify and route each of the three distinctly:

1. **Gap = 96 → local override.** It stays in this artifact, logged with its stated reason ("neighbor is heavy"). It is **not** promoted to a rule and does **not** change the spacing token. The reason may be offered as a *candidate* taste-rule about when to drop a step near a heavy neighbor — offered for human adoption, never written straight into a live rules file.
2. **Density = cozy → token retune.** The token default was actually wrong, so propose a change to the density token in the design system as a PR / change proposal.
3. **Focus-ring color → new token.** The artifact revealed a gap; propose adding a new focus token to the system as a PR / change proposal.

Any value touching brand, accessibility, or legal surface is routed as a proposal needing review, never auto-applied. The distinction between value (→ design system) and reason (→ taste-rule candidate) is kept explicit.

## Failure Modes (FAIL)

- Promoting the local override (gap 96) into a rule or a token change automatically.
- Treating all three the same (e.g. all as token changes, or all as local overrides).
- Writing a taste rule directly into a live rules file instead of offering a candidate for adoption.
- Auto-applying any change without a review gate.
- Losing the settled reason (committing the value with no captured why).
