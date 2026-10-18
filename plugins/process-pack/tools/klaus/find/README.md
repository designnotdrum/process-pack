# Klaus find

Before an agent writes a new UI component, `find` shows it what the repo already has for the purpose. It matches words in `inventory.json` and uses no model. `SKILL.md` in this folder is the skill that tells agents to run it; design-onboard copies that into the repo.

## Usage

```sh
node find.mjs [--root <dir>] [--inventory <file>] [--vocabulary <file>] "<what the new component is for>"
node find.mjs --case "<what the new component is for>"
```

- Without `--case` it prints the five closest components, each with its score, where it lives, and its "Use when" and "Not for". If the best score is under 0.20 it says "Nothing fits" and still lists the closest, which a case needs.
- With `--case` it prints the PR body line `Klaus: new component, see case` and a "New component case" section: the purpose as Use when and Not for, the five closest components each with three things to fill in (why it fails as it is, as a new variant, composed), the new component's name, whether it is shared or app-level, and the DESIGN.md change for a shared one. Everything Klaus cannot know is marked `[fill in: ...]`.
- `--root` is the repo and defaults to the current directory. `--inventory` defaults to `<root>/inventory.json`, which `inventory/inventory.mjs` writes.
- Exit 0 when it printed an answer, "Nothing fits" included. Exit 2 when there is something to fix, such as a missing inventory.

## How it ranks

Each component gets a bag of words, and each word in the purpose is looked up in it. The score is the weight found, over what a good match on every word would have given, from 0 to 1.

| Where the word is | Weight |
| --- | --- |
| "Use when" text | 4 |
| Name of the component | 2 |
| Name of a part, a prop, a variant, an icon | 1 |
| A comment not in the Use when / Not for form (first sentence only) | 1 |
| "Not for" text | -3 |

- A word that is not found directly can be found through a synonym, at 0.6 of the weight. The built-in list is short and common to most UIs. A synonym word of the component is credited once, however many words of the purpose lead to it.
- Names are split at capitals, so `AIChip` is "ai" and "chip". Endings are cut back, so "loading" meets "load".
- Words that say where something sits on a screen ("page", "header", "row") count 0.15. A repo adds the names of its product the same way, as `productNouns`.
- A component that lists more than 30 props is passing a whole element's props through, and its props are ignored.
- Two entries with the same name, such as a shared Skeleton and an app copy, are one candidate. The shared copy leads and the other file is named beside it.
- Ties are broken by shared before app, then the most used, then by name, so the output is the same every time.

The rules come from the prototype in the Klaus decision "What the reuse check returns for three real purposes" (NJM-1780). Two things differ because a real repo is larger than the prototype's: a comment that is not in the Use when / Not for form counts for much less, and only its first sentence is read.

## A repo's own words: `klaus.find.json`

Optional, at the repo root:

```json
{ "productNouns": ["loop", "canvas"], "synonyms": [["toggle", "segmented"]] }
```

A product noun names the product and not a part of the interface, so a question that mentions it matches on the other words first. Without these, a purpose that mentions the product matches every component named for it. A synonym row is a group of words that stand for one another in this repo.

## Tests

```sh
node --test "plugins/process-pack/tools/klaus/find/**/*.test.mjs"
```

The tests run on a small inventory in `test/fixture.mjs`. They need nothing installed.
