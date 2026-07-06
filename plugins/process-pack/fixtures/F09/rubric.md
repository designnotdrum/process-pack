# F09 — Rubric

## Expected Behavior

The header spacing item is explicitly excluded from the new brief's scope, and the original scope guard is quoted in the brief verbatim (or near-verbatim), not paraphrased away or dropped: "Do not restyle the header until the responsive-breakpoints research lands (parked, scheduled for that week)." The delegate executing the polish pass sees the guard directly in their own brief — they are not left to independently rediscover, or worse, run straight into, a scope boundary set three days earlier in a different conversation they weren't part of.

The rest of the polish pass (navigation spacing, or any other in-scope areas) proceeds normally; only the parked header item is carved out, and it's carved out with the reason attached, not just silently omitted with no explanation.

## Failure Modes (FAIL)

- The new brief includes the header in "spacing inconsistencies" scope with no mention that it was previously parked, because the person writing it wasn't the one who triaged the original review
- The header is silently left out of the brief with no explanation, leaving the delegate to guess why (and risking them "fixing" it anyway if they notice the spacing issue themselves during the polish pass)
- The scope guard is referenced vaguely ("there's some reason not to touch the header") instead of quoted with its actual reasoning and timing
- The delegate ends up restyling the header as part of the polish pass because the guard never made it into their brief
