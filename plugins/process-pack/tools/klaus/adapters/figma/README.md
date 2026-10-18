# Klaus Figma adapter

Turns a release's planned writes into Figma Plugin API code. It uses no model and makes no Figma call. A separate relay (issue #28) sends the code through a signed-in agent, because Figma's MCP server refuses a plain script.

The values come from the browser's computed styles, not from the CSS files. On Meridian's Button the CSS file says an 8px radius and the browser draws 6px, because Tailwind's `rounded-md` wins. The text size of the large Button differs the same way: the browser draws 14px where the CSS file says 16px.

## What a run does

| Step | What the adapter does |
|---|---|
| `plan` | Lists the components whose current version is not written yet, and the screens to write for this release. A component with no story in the Storybook build is left out. |
| `estimate` | Costs a component version at 1,200 relay tokens and a tenth of a call, as the prototype measured. A screenshot upload and an editable screen are costed apart (unverified, there is no measurement). |
| `write` | Reads each story in a static Storybook build, builds the code, packs it into files of at most 50,000 characters, and lists the screenshots to upload. It sends nothing. |
| `report` | Says where the files are and links the Figma file. |

## What the relay finds

`write` leaves a folder per release, `.klaus/figma/<release>/` by default:

| File | Holds |
|---|---|
| `figma-001.js`, `figma-002.js`, ... | Plugin API code. Each file is one `use_figma` call and holds about ten components. |
| `manifest.json` | The file key, each code file with its character count and units, the ledger entry of each unit, the uploads, the retention file, and warnings. |
| `figma-retention.js` | Present when there are screenshots. Run it after the uploads. It keeps the last N versions of each screen. |

An entry in `uploads` has the image path, the page, and the name the frame must have: `<route> <release>`. The retention code reads that name, so the relay must keep it.

Each code file returns, for every unit, `written`, `exists` or `failed` with an error. A set that fails is removed again and the next unit still runs. The relay reports failures back to Klaus.

`.klaus/figma/ledger.json` records each component version and screen release as `generated` when its code file exists, and as `sent` once the relay has seen `use_figma` report it written or already there. A run plans every unit that is not sent, so a unit whose relay call failed is generated and sent again. The manifest's `ledgerEntries` tell the relay which version each unit is. If the ledger is lost, the next run plans everything again. The code leaves a set that already exists alone, so the only cost is relay tokens. The relay is in [`relay/`](relay/README.md).

## What lands in Figma

- One variable collection, `Tokens` by default, with one mode and one colour variable per token the components use. Each variable has the CSS variable as its WEB code syntax, for example `hsl(var(--primary))`. Which token a colour comes from is found by changing each token on the page and seeing which colours move, so two tokens with the same colour stay two variables.
- One component set per component version, named `Button 1.1.0`, with variants named `Variant=primary, Size=md`. Fills, strokes and text fills are bound to the variables. Layout is auto layout, as the prototype's.
- When a new version is written, the previous set moves to the `Older versions` page. A set is never overwritten and never deleted. A version lower than the latest goes straight to `Older versions`. A pre-release such as `1.1.0-rc.1` is lower than `1.1.0`.
- A set that moves to `Older versions` is frozen first. Every fill and stroke bound to a variable, on the set and on everything inside it, becomes the plain colour it has at that moment, so a later token change does not touch it. The set's description gets a line: `Frozen when 1.1.0 shipped; colours are the values at that time.` Klaus never changes an earlier version.
- A changed token colour is written through to its variable, because the variables hold the app's current tokens. The current version on the component's page stays bound and follows it. The write happens after every set in the file has been moved and frozen, so a frozen set keeps the colour it shipped with.
- Screens are screenshot images by default. Dieter leaves one PNG per screen in `.klaus/screens/`, named after the route (`/settings` is `settings.png`, `/` is `home.png`), and the relay uploads them. Each screen keeps its last 20 versions.
- Editable screens are the opt-in alternative. They are read from the running app and written as frames, text and icons placed by position.

## Settings

All of them sit under `outputs.figma.options` in `klaus.config.json` and all have a default. The adapter names a wrong setting in its error.

| Setting | Default | Meaning |
|---|---|---|
| `storybookDir` | `storybook-static` | A static Storybook build, relative to the repo root. |
| `collectionName` | `Tokens` | The variable collection. It has one mode, `Light`. |
| `page` | empty | One page for every component. Empty gives each component a page named after it. |
| `axes` | `["variant", "size"]` | The inventory variant props that become Figma variant properties, in order. |
| `states` | `[]` | `"loading"` and `"disabled"` add a `State` property. It is off by default so the variants keep the prototype's `Variant=..., Size=...` names. |
| `icons` | `false` | Adds a hidden icon layer behind a `Show icon` property, from the icon a story draws. |
| `label` | `true` | Puts the component's name in the text layer. |
| `stories` | `{}` | Story ids by component name, when the automatic pick is wrong. |
| `componentsPerCall` | `10` | Components in one code file. A file is also cut at 50,000 characters. |
| `editableScreens` | `false` | Write screens as editable layers. Needs `screensBaseUrl`. |
| `screensBaseUrl`, `screensStorageState` | empty | The running app, and a Playwright storage state for a signed-in app. |
| `screenshotsDir` | `.klaus/screens` | Where Dieter leaves the screenshots. |
| `screenVersionsKept` | `20` | Versions of each screen that stay in the file. |
| `outputDir` | `.klaus/figma` | Where `write` leaves its files and the ledger. |

## Limits

- Playwright is resolved from the repo the build is for, so the repo must have `@playwright/test` and a browser installed.
- A component is drawn from one story that renders from its args, with its variant props set from the story URL. Add a story like that, or name one in `stories`, for a component that has none.
- Only the light theme is read. A repo with a dark theme gets one mode.
- Background images and gradients are left out, and a warning says so.
- A set may have at most 256 variants. A file may hold at most 50,000 characters, so a component that needs more fails with its name.

## Tests

```sh
node --test "plugins/process-pack/tools/klaus/adapters/figma/**/*.test.mjs"
```

The tests run the generated code against a small stand-in for the Plugin API (`tests/fake-figma.mjs`). One test reads a real Storybook build in a real browser when `KLAUS_TEST_STORYBOOK` points at a build and `KLAUS_TEST_REPO` at a repo with Playwright installed. Without them it is skipped.
