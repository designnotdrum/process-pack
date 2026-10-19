# Klaus inventory

Lists every UI component a repo ships, so an agent can find one to reuse before it writes a new one. It uses no model. It writes two files at the repo root: `inventory.json`, which tools read, and `INVENTORY.md`, a readable view generated from it.

It is plain ESM that runs with `node` and needs no build step. It reads components with the repo's own `typescript` package, found from the repo root, so the repo must have it installed.

## Usage

```sh
node inventory.mjs [--root <dir>] [--out <dir>] [folder[:shared|:app] ...]
```

The folders to scan come from `klaus.config.json` at the repo root:

```json
{ "inventory": { "folders": ["packages/ui/src", { "path": "apps/web/app", "role": "app" }] } }
```

Folders given as arguments are used instead. A folder under `packages/` is `shared`, any other is `app`. The role decides what "where used" lists.

## What an entry holds

| Field | Meaning |
| --- | --- |
| `name` | The family: `Dialog` for a file that exports `Dialog`, `DialogContent` and `DialogHeader`. |
| `kind` | `shared`, `app`, `local` or `icon-set`. |
| `folder`, `file` | The configured folder, and the component's file (the folder, for an icon set). |
| `route` | Only on `local`: the route the component belongs to. |
| `purpose` | `{ useWhen, notFor, text }` from the doc comment directly above the component, or `null`. |
| `props` | Props the repo declares itself, with type and `required`. Props inherited from React, the DOM or a library are left out. |
| `variants` | The props of the main component that take a closed set of strings or numbers. This is how `class-variance-authority` variants appear: `variant?: "default" | "outline" | null`. |
| `omittedDomProps` | Only when there are any: how many DOM attributes (`aria-*`, `onClick`, `className` and the rest) the main component takes that are not in `props`. See "DOM attributes" below. |
| `parts` | The other components in the family, each with its own `props` and `variants`, and `omittedDomProps` when it has any. |
| `icons` | Only on `icon-set`: the icons inside it. |
| `version`, `screenshot` | Present and empty. Later steps fill them. |
| `usedIn` | Importing files for `shared` entries, screens for the rest. |

## Rules

- A file named for one of its components is that component's family, and every other component it exports is a part. Without such a component, a part belongs to the shortest exported name it starts with at a word boundary, and the rest are separate entries.
- A component is `local` when a folder between it and the app directory holds a screen file (`page`, `layout`, `loading` and so on). Files at the app root, or in folders like `components` and `contexts` that no screen sits in, are `app`.
- A folder named `icons` or `icon` becomes one entry, "Icon set". Its files are not listed on their own.
- The purpose is a doc comment in two parts, "Use when: ..." and "Not for: ...". A comment on a prop is never read as a purpose. A comment without the two labels is kept in `text` and shown as not yet in that form.
- "Where used" follows imports through barrel files, `tsconfig` path aliases, workspace packages (mapped back from `dist` to source), default imports and `import()`. For an app component it climbs through other components to the screens. Tests and stories do not count as use.
- Route files, tests, stories and declaration files are not components.

## DOM attributes

A component that passes a whole element's attributes through would otherwise list hundreds of props that say nothing about what it does. Props declared in React's types, or in any other dependency, are left out. That covers `React.ComponentProps<"button">`, and it is left out without a count.

A mapped type can rebuild those attributes as new properties that the compiler traces to no declaration. framer-motion's `ComponentProps<typeof motion.div>` does this, and it put 272 attributes on `TreeExpander` in Meridian. A prop with no declaration is a DOM attribute when React's `AriaAttributes`, `DOMAttributes`, `HTMLAttributes`, `AllHTMLAttributes`, an element's own `*HTMLAttributes` or `SVGAttributes` declare one with the same name and the same type, ignoring the element it is typed for. It is left out of `props` and `variants`, and counted in `omittedDomProps`, so the count says how many were left out.

A prop the repo declares is always listed, whatever its name. A repo's own mapped type is listed unless a key and its type both match an attribute exactly, as in `Record<"id", string>`. React's types are read from wherever the compiler loaded them. A repo whose compiler does not load them counts nothing.

The version picker does not read `props` from the inventory. It compares props with the compiler, and it counts inherited ones on purpose, so this does not change what it reports.

## Tests

```sh
pnpm install
pnpm test
```

The tests run on a small fixture repo in `test/fixtures/repo`, with a stub for `class-variance-authority`. Stubs for React's and motion's types are in `test/fixtures/dependencies`, and each run copies them into the fixture's `node_modules`, where a real repo has them. Nothing but `typescript` is installed.
