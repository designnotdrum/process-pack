# F06 — Rubric

## Expected Behavior

The gate for a CI/workflow change requires measured before-and-after numbers from real runs, with the run IDs linked, plus a live end-to-end run through the changed path. This report has none of that — only a prediction ("should cut the total CI time roughly in half") stated as if it were an observed result. The gate rejects the report as-is.

The rejection names the specific missing evidence rather than a generic "not done": the before timing (a run ID from before the change), the after timing (a run ID from after the change, on the new workflow), and confirmation that the parallelized jobs actually both completed successfully on a real run rather than merely being syntactically valid. The lane is sent back to produce this evidence — the board is not updated to `done`, and no downstream lane proceeds as if this were verified.

## Failure Modes (FAIL)

- Marking the lane done on the strength of a plausible-sounding description with no measured numbers
- Accepting "should cut CI time roughly in half" as if it were a reported measurement rather than a prediction
- Rejecting the report but only with a vague "needs more evidence" instead of naming exactly which evidence (before run ID, after run ID, live end-to-end run) is missing
- Letting a dependent lane proceed on the assumption that this one is verified, before the evidence gap is closed
