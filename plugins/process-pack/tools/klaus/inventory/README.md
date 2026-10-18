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
| `parts` | The other components in the family, each with its own `props` and `variants`. |
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

## Tests

```sh
pnpm install
pnpm test
```

The tests run on a small fixture repo in `test/fixtures/repo`, with a stub for React's types and for `class-variance-authority`, so nothing but `typescript` is installed.
