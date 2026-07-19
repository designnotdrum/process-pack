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

## Altitude decides the form

Design changes shape as it climbs, and a knob offered at the wrong altitude is noise, not help. Gate the panel's form by the direction's current altitude:

Default stance: emit a facet spec once the work is at wireframe altitude or higher; emit a live playground only at polish altitude.

Applicability gate: read the direction's declared altitude (the design phase states it). At wireframe altitude, the tunable facets are structural — hierarchy weight, density, what leads. At polish altitude, they are the fine facets — exact spacing, color temperature, motion, typographic scale. A facet from a higher altitude than the work has reached is withheld and named as belonging later.

Named exceptions: none. Do not expose polish knobs at wireframe to "save a step" — a value tuned against an unsettled structure is thrown away when the structure moves.

Escape hatch: a person may explicitly ask to see a specific polish facet early; show that one, labeled as provisional against unsettled structure, and hold the rest.

## The two artifacts

**Facet spec** — emitted always, once at wireframe altitude or higher. A structured list, one row per facet:

`facet · control (slider | enum | toggle) · range or options · default · why (what moving it trades) · token(s) it binds`

It is cheap, textual, and lives inside the design deliverable. It is the whole panel at wireframe, and the source of truth the live playground renders at polish.

**Live playground** — emitted at polish altitude only. One self-contained HTML file: inline CSS and JS, no external assets, safe under a strict content-security policy. Each knob is bound to a CSS variable on a live instance of the prototype, so turning it changes the artifact in place. Deliver it through the publishing channel named in constants — read that value generically and degrade to the local-file floor when it is absent; never name a specific publishing tool here. The playground carries a **commit** action for settling values (see Loop closure).

When a frontend-polish capability is named in constants, hand the playground's craft to it; when the slot is empty, still emit a plain, functional playground yourself. The panel never blocks on a polish tool being present.

## Loop closure

The playground's **commit** action is where a settled value stops being ephemeral. For each committed knob, classify the value, then route it. Never route a value without its captured reason.

Classify each settled value as exactly one of:

- **Local override.** The eye demanded this value here, once, against the local context. It stays in the artifact, logged with its reason. It is never promoted to a rule and never changes the token — an override is a stand-in for something the eye saw, and promoting it would mistake the approximation for the point. Its *reason* may be offered as a candidate taste rule about when the override applies (see below), but the value itself stays local.
- **Token retune.** The token's default was wrong, not just wrong here. Propose the new value as a change to that token in the design system, as a reviewable change proposal — not an in-place edit.
- **New token.** The artifact exposed a gap the system had no token for. Propose adding the token to the system, as a reviewable change proposal.

Route the value to the design system (retune and new-token cases) and route the reason to the taste rules, separately: the value is *what*, the taste rule is *when and why*. A reason worth keeping becomes a **candidate** taste rule in the pack's rule anatomy (default stance, applicability gate, named exceptions, escape hatch) — offered for a human to adopt, never written straight into a live rules file. This mirrors how standing corrections are surfaced as candidates elsewhere in this pack: the skill proposes; a person adopts.

Default stance: every commit is a review-gated proposal, not an applied change.

Applicability gate: a value that touches brand, accessibility, or a legal surface is always routed as a proposal needing explicit review, regardless of how settled it seems. Read which surfaces are high-stakes from constants where the project names them.

Named exceptions: none for the high-stakes surfaces — they never auto-apply.

Escape hatch: a person with authority over the design system may, in session, accept a proposal on the spot; that acceptance is the gate being satisfied, not bypassed.

## The Swing

A panel that only tunes existing tokens can only move within the system it already has, which cannot by itself produce the move that makes work memorable. So the panel allows exactly one channel for a move that is *not* token-bound — and fences it hard, because an unprompted "make it wow" is the most reliable way to produce slop.

Default stance: propose no Swing. A Swing is offered only when a specific, grounded opportunity clears every fence below; the resting state is zero.

Applicability gate — a Swing is allowed only when all of these hold:
- **Permitted tier.** The active model tier is the one constants name as permitted to propose off-system moves (the standard-or-higher / judgment tier). On a weaker tier, no Swing is ever proposed.
- **Grounded.** It traces to a cited source — a prior-art example from this direction's own research, or the artifact's stated job — not invented novelty.
- **Cost-bearing.** It names a real trade: added complexity, off-system maintenance, brand risk, a one-off someone owns. A proposal that is all upside is disqualified.

Form and limits:
- **Not a knob.** A Swing is a bet, not a fine-tune. It lives in a Swing zone, visually and structurally separate from the token knobs, so a bet is never read as a slider.
- **Scarce.** Zero or one per artifact. More than one is a tic, not a read.
- **Human-only.** It is surfaced for a person's decision and nothing else. It never self-applies, never commits, never becomes a token or a rule.

Named exceptions: none. The fences do not relax for an idea that feels strong; a strong idea still needs the citation, the cost, and the permitted tier.

Escape hatch: a person may accept a surfaced Swing in session, which turns it into ordinary design work to be built and tested — it still does not auto-promote to a token or rule.

Keep this section separable: it is the highest-variance part of the panel and the first thing to disable if it produces noise. The token machinery works without it.

## Red flags (fail conditions)

- A panel produced for an artifact with no eye-tunable surface (a flow diagram, a state machine, a copy deck).
- A knob bound to no token — a free-floating value dressed as a slider.
- A knob that tunes one property of a token-group the system binds together, breaking the cluster.
- More than six knobs on one panel.
- A knob with no default, or no one-line statement of what it trades.
