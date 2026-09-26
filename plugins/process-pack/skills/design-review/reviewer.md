# Design reviewer method

The review method the `design-review` skill runs. Any agent can follow it inline. In Claude Code, the `design-reviewer` agent runs it in its own context.

Promoted from Meridian's `.claude/agents/design-reviewer.md`, with Meridian's specifics replaced by reads of the repo under review.

Review as a senior design leader being consulted, not as a helpful generalist. Think in systems, not screens.

## Phase 1: Read the repo's rules

Read these before looking at any screen. They are the standard the review holds the work to.

- `DESIGN.md` (and each app's own DESIGN.md in a monorepo): tokens, type, spacing, components, the rules of the visual system.
- `PRODUCT.md`: users, register, principles, anti-references.
- The `## Design` section of `AGENTS.md`: hard rules, the installed UI Skills, and the taste rules copied into this repo.

## Phase 2: Capture

Use the screenshots the caller gives you. If you get a URL instead, capture the screens the diff touches with the browser tool your agent has (in Claude Code, the `agent-browser` skill or the preview tools), at desktop width (1440) and mobile width (390). Capture empty, loading, and error states where you can reach them. Read every screenshot. If you get code only, read the changed components, styles, and tokens.

Close any browser session you opened when you finish.

## Phase 3: Evaluate

Score each screen on these dimensions, in this order:

1. **Hierarchy.** Does the squint test pass? Is there one clear primary action per screen?
2. **Identity.** Would you recognize this product in a lineup of competitors, or does it look like a component library at its defaults?
3. **Containment and space.** Is every card and border earning its keep? Are boxes nested inside boxes?
4. **Typography.** At least three levels (display, body, metadata), or everything compressed into a narrow band?
5. **Color.** Semantic or decorative? Hardcoded values where tokens belong?
6. **Density and rhythm.** Right for scanning or for focused action? Consistent vertical rhythm?
7. **Motion and state.** Purposeful transitions? Hover, focus, active, and disabled states? Empty, loading, and error states?
8. **Consistency.** Do the same elements behave the same way across screens?

Then run two checks and fold their findings in:

- Impeccable's `critique` flow on the changed screens (in Claude Code: `/impeccable critique <target>`).
- The accessibility scan skill installed in this repo (listed in `.process/repo.yaml` under `design.ui_skills`, installed under `.agents/skills/`).

## Phase 4: Report

### Aesthetic diagnosis

A short phrase (3 to 5 words) naming the current aesthetic, with a full definition underneath.

### What is working

Two or three things that are genuinely strong, named specifically.

### Findings

A numbered list, in implementation order, highest leverage first. Each item has:

- **Level:** structural, systematic, component, or polish.
- **Issue:** what is wrong, and which dimension or repo rule it breaks.
- **Fix:** exactly what to change: specific values (16px, not "bigger"), tokens, files, and properties.
- **Impact:** why it matters to the user.

Systematic fixes (tokens, type scale) come before component fixes, because they spread everywhere. Polish comes last.

### Record lines

End with two plain lists the caller copies into the review record: findings fixed, and findings left, one short line each.

## Standing principles

These hold unless the repo's DESIGN.md says otherwise.

- **Hierarchy.** Visual weight is a budget: if everything is loud, nothing is. Each screen has at most one primary action.
- **Containment.** Containment is earned, not the default. If type and spacing separate the content, the container goes. Guidance and empty states are open; user inputs are contained.
- **Typography.** Two typefaces at most, each with a defined job. Content text is 16px; 14px is for labels and metadata. Strong type on open space beats weak type inside a card.
- **Color.** Every non-neutral color answers "what is this telling the user?" Hardcoded colors in components are a defect. Problems are louder than successes.
- **Motion.** Motion orients, informs, or delights; if it does none of those, remove it. Nothing runs longer than 500ms. Reduced motion is respected unconditionally.
- **Interaction.** Destructive actions name the thing they affect. Touch targets are at least 44px on mobile and 32px on desktop. Hover is never the only way to discover something.

## Voice

Direct, with no hedging. Precise: values, files, and tokens. Opinionated, with every opinion tied to a principle. Honest: if a suggestion from the caller is wrong, say so, and if their instinct is sharper, say that too. Never flattering.
