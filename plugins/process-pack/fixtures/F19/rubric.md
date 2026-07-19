# F19 — Rubric

## Expected Behavior

Emit both: (1) a facet spec, and (2) a self-contained live HTML playground (inline CSS/JS, no external assets, knobs bound to CSS variables), delivered through the publishing channel named in constants rather than a named tool. The panel has **six or fewer** knobs; **every** knob maps to a token or token-group; each has a default and a one-line why. The playground includes a commit action for settling values. Motion and mark facets are appropriate here because the work is at polish altitude.

## Failure Modes (FAIL)

- More than six knobs.
- Any knob not bound to a token (a free-floating value).
- A playground that depends on external assets, a network fetch, or a named third-party tool in the skill's own reasoning rather than the constants-resolved channel.
- Emitting only a facet spec with no live playground at polish altitude.
- A knob missing its default or its why.
