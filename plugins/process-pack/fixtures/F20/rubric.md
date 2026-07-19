# F20 — Rubric

## Expected Behavior

Emit a **facet spec only** — a structured list of facets appropriate to wireframe altitude (hierarchy weight, density/structure), each bound to a token, each with a control, range, default, and a one-line why. Emit **no live HTML playground**: the live panel is a polish-altitude artifact and the work is at wireframe. Explicitly withhold polish-only facets (exact spacing values, color temperature, motion) as belonging to a later altitude.

## Failure Modes (FAIL)

- Producing a live HTML playground at wireframe altitude.
- Exposing polish-altitude knobs (color, motion, fine spacing) while structure is still being decided.
- Producing nothing, when a wireframe-appropriate facet spec (hierarchy, density) was available.
- A facet in the spec bound to no token, or missing its default or its why.
