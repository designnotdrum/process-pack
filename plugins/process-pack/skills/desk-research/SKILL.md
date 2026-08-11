---
name: desk-research
description: Use before grounding a design or technical direction in external references — comparing tools, evaluating approaches, gathering prior art — before committing to a direction. Produces a source index, a synthesis, and concrete candidate directions instead of a pile of links.
---

# Desk Research: Reference-Grounded Direction Setting

## Overview

Reading around a topic and producing a decision are different activities. This skill turns a research pass into three artifacts a decision-maker can actually use: an index of what was found, a synthesis of what it means, and a short list of candidate directions with their tradeoffs made explicit. It also protects against the two most common research failures: citing something nobody actually verified, and re-discovering something the project already decided.

## Step 1: Questions First

- Before opening a single source, write down the research questions.
- Each question must trace to a real decision still open in the current work. If answering a question wouldn't change what gets built, it isn't a research question — drop it.
- For every question, check the project's own existing spec or design doc first. The strongest possible finding from any research pass is "the project's own spec already answers this" — record it as answered-by-spec, not as an external finding, and don't let a later external source silently override a decision the project already made without flagging the conflict out loud.

## Step 2: Focused Tool Calls, One Question at a Time

- Run one targeted search or fetch per open question, not a broad crawl. A tool call that doesn't trace back to one of the standing questions is scope creep — cut it.
- Prefer primary sources (the tool's own documentation, the project's own repository, the original announcement) over secondhand summaries of them.
- Stop searching a question once it has enough independent sources to state a consensus, not once you run out of ideas for more searches.

## Step 3: Scripted Artifact Verification, Never Eyeballed

- Any artifact you plan to cite or reuse — a downloaded image, a fetched file, a config sample — gets verified by a script, not a glance: does it exist, is its size non-trivial, does its type match what was expected.
- Keep an index of what should exist, then set-match the verified artifacts against it. An index entry with no matching verified file is a gap to report, not a citation to make anyway.
- Never describe or cite an artifact you have not run this check against, even when a fetch call appeared to succeed. Truncated downloads, wrong content-types, and zero-byte files are exactly the silent failures this step exists to catch — a tool call returning "200 OK" is not verification.

## Deliverables

### Index

One entry per reference consulted: its source, the specific surface of it that was examined (a page, a section, a release note — not "the whole site"), and the one transferable thing this project can actually take from it. Not a general summary of the source — the specific takeaway.

### Synthesis

One entry per research question: what the sources agree on (the consensus), any source that says the opposite (a named outlier — don't quietly average it into the consensus), and any example that superficially resembles the pattern but isn't actually one (a counter-example, flagged explicitly so it doesn't get miscopied later as supporting evidence).

### N Candidate Directions

Each candidate direction states all of:
- The concrete change it implies (not a vibe — a specific, describable change)
- Which references ground it
- Its tradeoffs (what gets given up by choosing it)
- Its fit against the project's own existing constraints (checked against what the project has already decided or already built, not just judged as generically sound)
- A cheapest-from-current-state note: given where the project actually stands today, what is the least additional work required to get this candidate live. A direction that requires ripping out existing work says so plainly, next to a direction that is one small change away — these are not presented as equivalent effort just because both are "candidates."

### Tuning Panel (optional)

For each candidate direction that has an eye-tunable, token-bound surface at the current altitude, produce a tuning panel per the tuning-playground skill: a facet spec at wireframe altitude or higher, and a live playground at polish. Skip the panel, out loud, for any direction whose open questions are structure, flow, or copy rather than eye-decidable tokens. The panel is never required — it is offered when the direction has a last mile a designer would tune by hand, and omitted otherwise.

## Sharing the Deliverables

When a person needs to view the index, synthesis, or candidate directions somewhere other than this conversation, publish them via the channel named in personal constants (`publishing`, or a `tool_mapping` entry's `publishing` override for the active context) — never a specific tool named in this skill's own text. When no channel is configured, or the configured one fails, fall back to a local file with its full path printed; that floor needs no setup and is always available.

### Reference Images Must Be Legible, Not Merely Present

When the references are visual — screenshots, UI captures, layouts — embed each one inline next to its index entry as a data URI, never as a text link. A reviewer studying visual references browses them to think; a list of links is not a research deliverable to them.

Legibility is the requirement, not inclusion. In visual research the detail inside the screenshot *is* the content: the UI text, the spacing, the state treatment. A thumbnail too small to read fails the deliverable completely, however complete its captions.

- **Never downscale below the source.** Source resolution is the ceiling on what a reader can ever see; anything given away is unrecoverable. If a size cap forces a tradeoff, spend it on compression quality, not pixel dimensions.
- **Store each payload exactly once** and reference it — as a CSS custom property or equivalent. The grid scales it down for layout; a lightbox shows it at natural size. One copy serves both, which is what makes full resolution affordable.
- **Give every reference a lightbox**: click to full size, the caption travelling with the image, keyboard dismissal and navigation, focus trapped and returned, real button triggers, usable on a phone. No external library.
- **Do not crop to a fixed height** in the gallery. Cropping hides the region that carried the point. Letterbox instead.

Verify legibility by opening the artifact and reading the smallest text in a reference, not by confirming the file is embedded. "The image is present" and "the image is usable" are different claims, and only the second one is the deliverable.

## Check-Own-Spec-First Rule

Before treating any external finding as a reason to change direction, check whether the project's own spec, design doc, or a prior recorded decision already covers it. Present "the spec already answers this" findings first and separately from genuinely new external findings. A not-required-after-all discovery buried inside a pile of new research wastes the reader's time re-deciding something already settled.

## Red Flags (fail conditions)

- A cited or reused artifact that was never scripted-verified
- A visual reference shipped at a size the reviewer cannot read detail in, or downscaled below its source
- A candidate direction missing its tradeoffs or its fit-against-constraints check
- A research question with no traceable decision behind it
- An outlier or counter-example silently folded into the consensus line instead of named
- New external research proposed for something the project's own spec already settled, without saying so out loud
