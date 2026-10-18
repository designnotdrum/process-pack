---
name: klaus-find
description: Use before creating any new UI component file, and before adding a component to a screen that has no component for the job yet. Runs `klaus find` to see what the repo already has for the purpose, then records the choice in the PR body as a `Klaus:` line.
---

# Klaus find

## Overview

Components get duplicated when an agent writes a new one without asking what the repo already has. Klaus keeps a list of every component in `inventory.json`, each with a purpose written as "Use when / Not for". `klaus find` matches a purpose against that list and returns the five closest components.

`klaus find` is the command `node scripts/klaus/find/find.mjs "<purpose>"`, run from the repo root. It matches words and uses no model, so it can miss a component that is named and described differently. Read what it returns; do not take the order as a verdict.

It needs `inventory.json` at the repo root. If it is missing, or older than the components, write it again with `node scripts/klaus/inventory/inventory.mjs`.

## When

Run it before you create any file that holds a new component, and before you hand-build a control, chip, state or panel that may already exist. Run it again when the purpose changes.

## Steps

1. **Write the purpose.** One or two plain sentences on what the component does and where it sits. Describe the job, not the name you have in mind. "A toggle in the header row that switches between two views, with a count on one label" finds more than "ViewToggle".
2. **Run it.**

   ```sh
   node scripts/klaus/find/find.mjs "A toggle in the header row that switches between two views, with a count on one label"
   ```

3. **Read all five.** Each shows its score, where it lives, and its Use when and Not for. A "Not for" that describes your case rules the component out. A purpose marked "not yet in the Use when / Not for form" was not written to answer this question, so open the file before you decide. A component with no purpose written needs the same.
4. **Choose one of three.**
   - A component does the job as it is: use it.
   - A component nearly does it and needs a new variant, a prop or a label: extend it.
   - Nothing does it, or Klaus says "Nothing fits": make a new component, and write the case (next section).
5. **Record the choice.** Put exactly one of these lines in the PR body:

   ```
   Klaus: used SegmentedControl
   Klaus: extended AIChip
   Klaus: new component, see case
   ```

   The PR review checks that the line is there.

## When a new component needs a case

A new component needs a case when it composes nothing from the inventory, or when it uses an inventory component's own CSS classes outside that component. Layout and on-token styling on top of components it composes does not need a case.

Run the same command with `--case`:

```sh
node scripts/klaus/find/find.mjs --case "A dial that shows how confident the team is in a hypothesis, from 0 to 100"
```

It prints the `Klaus: new component, see case` line and a "New component case" section. Paste both into the PR body and replace every `[fill in: ...]`:

- the purpose of the new component, as Use when and Not for;
- for each of the five closest components, why it fails as it is, why a new variant on it does not fit, and why composing it does not fit;
- the new component's name, and whether it is shared or app-level;
- for a shared component, the change to DESIGN.md.

Leave no `[fill in: ...]` in the PR body.

## When the right component is missing from the five

Say so in the PR body under the Klaus line, name the component, and add the words that would have found it to `klaus.find.json` in the repo root:

```json
{ "productNouns": ["loop", "canvas"], "synonyms": [["toggle", "segmented"]] }
```

A product noun names the product and not a part of the interface, so a question that mentions it matches on the other words first. A synonym row is a group of words that stand for one another in this repo.
