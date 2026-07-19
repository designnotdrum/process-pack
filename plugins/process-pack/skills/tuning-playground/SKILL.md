---
name: tuning-playground
description: Use at the polish stage of a design direction, once structure is settled, to turn a prototype's own tokens into a small panel of eye-decidable knobs a designer drives by hand, and to route what they settle back into the token system and the taste rules. Emits an altitude-appropriate facet spec, and at polish a self-contained tunable playground. Skip it when the artifact has no eye-tunable surface.
---

# Tuning Playground

## Overview

A design direction that has been researched still has a last mile: the values a person settles with their eye, not with a rule. This skill turns that last mile into a small panel of knobs the artifact itself earned, so a designer tunes by hand instead of re-prompting in prose, and so what they settle is captured instead of lost. It emits an altitude-appropriate artifact (a facet spec, and at the polish stage a live playground), and routes settled values back into the token system and settled reasons back into the taste rules.

It is optional by construction. A panel is proposed only when the artifact has an eye-tunable surface, and skipped, out loud, when it does not.

## When a panel applies

Default stance: propose a tuning panel for a design direction only when it has at least one token-bound, eye-decidable facet at the current altitude. Otherwise produce no panel and say why.

Applicability gate: check, concretely, whether the artifact has a visual surface governed by tokens the eye would settle — spacing, density, color, motion, mark style, typographic scale. An artifact whose open questions are states, transitions, data flow, or copy alone (a flow diagram, a state machine, a schema, a copy deck) has no such surface and gets no panel.

Named exceptions: none. "The person asked for a panel" is not a reason to produce one; check the surface, not the request. If they ask and there is no surface, say the surface is not there yet and what would have to exist for a panel to make sense.

Escape hatch: a person may, in the moment, name a specific facet they want a knob for even when the gate would skip it; honor that single named request, and still skip everything else.

## Choosing facets

Before proposing any knob, read the token system already in play — the project's design doc, its token files, its existing CSS variables — the same way this pack checks a project's own spec before reaching outward. Facet selection is a token audit, not a matter of taste, and it answers three questions about this artifact:

- Which governing tokens are **settled**? Leave them alone; they are not knobs.
- Which are in play and **need tuning here**? These are candidate knobs.
- Which are **missing**, where this artifact exposes the gap? Propose a new token, not a loose value.

A facet earns a knob only if it passes all four tests:

1. **Token-bound.** The knob maps to a token or a token-group. A knob that would set a free-floating pixel value bound to no token is disqualified — surface it as a missing token instead.
2. **Composite where the facet is.** When a facet is really a cluster the token system binds together — a density that moves spacing step, line-height, and control-height at once — the knob drives the cluster, not one lone property. A knob that tunes one property of a bound cluster in isolation is the wrong cut.
3. **Eye-decidable.** The eye settles it better than a rule can (optical gap, motion feel, mark style, density). Anything a rule already settles deterministically — a contrast ratio, a minimum hit-target size — is a check, not a knob, and never appears as a slider.
4. **Bounded and named.** The knob has a sane default (the current best guess) and a range or enum, plus one line naming what moving it trades. A facet with no defensible default is not ready to be a knob; hold it.

Cap the panel at six knobs. It is a focusing tool, not a mixing board. Needing more than six is itself a finding: the direction is not resolved enough to tune, and that is what to report instead of a crowded panel.

### Three worked archetypes (reason from these, do not look up from them)

- **A data-visualization.** Governing tokens cluster around marks and motion: mark style (enum), mark size (range), inter-mark gap (range), entrance motion (enum), stagger and duration (ranges), easing (enum). Six or fewer, each bound to a token, each eye-decidable.
- **A form.** Governing tokens cluster around density and rhythm: field density (a composite of row spacing, label gap, control height), label placement (enum), and validation-reveal timing (range). Contrast and hit-target size are checks, not knobs, and stay out.
- **An onboarding flow at polish.** Governing tokens cluster around pacing and emphasis: step-transition motion (enum), progress-emphasis weight (range), and copy density (a composite). Step count and dead-end handling belong to an earlier altitude and are not knobs here.

These are shapes to reason from. The specific token names always come from the project, never from this list.

## Red flags (fail conditions)

- A panel produced for an artifact with no eye-tunable surface (a flow diagram, a state machine, a copy deck).
- A knob bound to no token — a free-floating value dressed as a slider.
- A knob that tunes one property of a token-group the system binds together, breaking the cluster.
- More than six knobs on one panel.
- A knob with no default, or no one-line statement of what it trades.
