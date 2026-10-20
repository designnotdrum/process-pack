# Klaus Figma adapter

Turns a release's planned writes into the data for Figma Plugin API code. It uses no model and makes no Figma call. The relay (`relay/`) builds each call's code from that data and the runtime in its own checkout, and sends it through a signed-in agent, because Figma's MCP server refuses a plain script. The Figma plugin (`plugin/`) applies a whole release's data in one run, for the first large load.

The values come from the browser's computed styles, not from the CSS files. On Meridian's Button the CSS file says an 8px radius and the browser draws 6px, because Tailwind's `rounded-md` wins. The text size of the large Button differs the same way: the browser draws 14px where the CSS file says 16px.

## What a run does

| Step | What the adapter does |
|---|---|
| `plan` | Lists the components whose current version is not sent yet, and the screens to write for this release. A component with no story in the Storybook build is left out. It counts a version as sent when its own ledger or the `KLAUS_FIGMA_LEDGER` variable says so (see "The ledger"). |
| `estimate` | Costs a component version at the relay's measured rate: 71,000 relay tokens a call plus 1.4 a character of code, about 100,000 for a Button-sized version, and one call. The code's size is the runtime plus about 1,600 characters and 160 a variant, as the relay encodes it. A screenshot upload and an editable screen are costed apart (unverified, there is no measurement). |
| `write` | Reads each story in a static Storybook build, builds the data, packs it into files of one component version each (`componentsPerCall`) whose code is at most 50,000 characters, and lists the screenshots to upload. It sends nothing. |
| `report` | Says where the files are and links the Figma file. |

## What the relay finds

`write` leaves a folder per release, `.klaus/figma/<release>/` by default:

| File | Holds |
|---|---|
| `figma-001.json`, `figma-002.json`, ... | Data, no code. Each file is one `use_figma` call and holds one component version, unless `componentsPerCall` says more. |
| `manifest.json` | The file key, each data file with the length of its code and its units, the ledger entry of each unit, the uploads, the retention file, and warnings. `firstLoad: true` on a first load (see "The first load"). |
| `figma-retention.json` | Present when there are screenshots. Run it after the uploads. It keeps the last N versions of each screen. |

A data file holds the call's variable collection, its colour tokens and its units, as JSON (`codegen.mjs` `dataFor`). Whatever sends it reads it with `data-file.mjs`, which refuses anything that is not the generator's shape, checks that it writes only to the collection and pages the repo's settings name, and builds the code with `codegen.mjs` `codeFor`. So an artifact from CI never supplies code. The relay passes `codeFor` a key, which encodes every string in the data so the relaying model cannot read it; the plugin passes none.

An entry in `uploads` has the image path, the page, and the name the frame must have: `<route> <release>`. The retention code reads that name, so the relay must keep it.

The code built from each data file returns, for every unit, `written`, `exists` or `failed` with an error. A set that fails is removed again and the next unit still runs. The relay reports failures back to Klaus.

### The ledger

`.klaus/figma/ledger.json` records each component version and screen release as `generated` when its data file exists, and as `sent` once the relay has seen `use_figma` report it written or already there. A run plans every unit that is not sent, so a unit whose relay call failed is generated and sent again. A unit Figma drew from code the relaying model changed is `changed` until a person deletes the set and the relay writes it again. The manifest's `ledgerEntries` tell the relay which version each unit is. If the ledger is lost, the next run plans everything again. The code leaves a set that already exists alone, so the only cost is relay tokens. The relay is in [`relay/`](relay/README.md).

The relay runs on another machine than CI and keeps its own ledger. It publishes its sent and changed marks to the repository Actions variable `KLAUS_FIGMA_LEDGER` after each run that sends or reconciles, and the Klaus workflow passes that variable to this adapter in the environment. `plan` merges it into the ledger it reads, for the versions CI's own ledger lists, which is every version CI generated: a version `sent` or `changed` in either counts as that, and `sent` wins over `changed`. A mark for a version CI's ledger does not list is ignored and named in a warning and in `details.sharedLedger.ignoredInVariable`, so a mark for a made-up older version cannot get a new component past `selection.newComponents`. The variable is read for planning only and never written into CI's ledger. Anyone who can write a repository variable can write it, so every version the plan leaves out only because the variable marks it sent is named in the report: a warning, a sentence in the summary, and `details.sharedLedger.sentOnlyInVariable`. A missing or malformed variable, or one for another Figma file, is a warning in the run report, and the run plans as if the relay had sent nothing. The relay README has the details, including who can write the variable and its 48 KB limit (`relay/README.md`, "What the relay sent: KLAUS_FIGMA_LEDGER").

## The Figma plugin

A Figma plugin in [`plugin/`](plugin/) applies a whole release's data in one run. It is for the first, large load of a repo's components. The relay carries the small updates after each release, because one relay call costs about 70,000 to 100,000 relay tokens. The plugin uses no model and makes no network request: its manifest sets `networkAccess` to `{ "allowedDomains": ["none"] }`.

### Install it once

1. Use the Figma desktop app, which exists for Mac and Windows. Figma's docs say development plugins need it.
2. Open a design file you can edit. In the menu choose Plugins, Development, Import new plugin from manifest. Pick `scripts/klaus/adapters/figma/plugin/manifest.json` in your repo (`plugin/manifest.json` in this folder).
3. Leave `manifest.json`, `code.js` and `ui.html` together in that folder. Figma runs them from there.

### Does a development plugin need a paid plan?

No. Figma's Help Center says creating a plugin for development is "supported on any team or plan": [Create a classic plugin for development](https://help.figma.com/hc/en-us/articles/360042786733-Create-a-plugin-for-development). Running it needs a seat that can use plugins in Figma Design files: a Starter plan, or a Full seat on a paid plan. Dev, Collab and View seats cannot: [Use plugins in files](https://help.figma.com/hc/en-us/articles/360042532714-Run-plugins-in-files).

Nick's account is on the Professional plan (tier `pro`) with a Full seat, from Figma's `whoami` on 2026-10-18. The table on the second page lists the Full seat as allowed in Figma Design, so a development plugin should run. That is read from the docs, not tried: the page's own heading says "Starter plan or a paid seat in an organization or enterprise" and does not name Professional. Two more things are unverified. The page says organization admins can limit plugins to approved ones, which the docs tie to organizations and not to Professional. And `manifest.json` carries a placeholder `id`, because the docs describe `id` as the ID to publish updates to; whether the import accepts it was not tried, because an agent cannot click in the desktop app. The first real click is in the onboarding run (#30).

### The first load

The workflow's `figma_first_load` input (run the Klaus workflow by hand) runs the frame with `--first-load figma`: the Figma output covers the newest release even when the state says that release is covered, and the spending cap does not apply, so the `klaus-figma` artifact holds data for every planned component. The cap exists to bound relay spend, and the plugin spends nothing. The manifest says `firstLoad: true`, the run report says it is a first load for the plugin and costs it at no relay calls or tokens, and the relay refuses to send it. Versions `KLAUS_FIGMA_LEDGER` marks sent are left out, because they are in Figma already.

The first setup, in order: dispatch the workflow with `figma_first_load` on, apply that run's `.zip` with the plugin, run `relay.mjs --reconcile --run <that run's id> --repo <owner/name>` on the relay machine, then run the relay nightly. The relay README explains each step (`relay/README.md`, "The first setup").

### Apply a release

1. Get the release's data: the `.zip` of the CI artifact, or the folder `.klaus/figma/<release>/`.
2. Choose Plugins, Development, Klaus: apply a release.
3. Choose the `.zip`, or `manifest.json` together with the `figma-001.json` files, or drop them on the window. The window opens only `manifest.json` and the `figma-NNN.json` files. Everything else in a zip, such as screenshots, is not opened.
4. The window lists the units and says which variable collection and pages the release writes to. Check them.
5. Choose Apply to this file. Every unit is listed as `written`, `exists` (already in the file, left alone) or `failed` with the error. A unit that fails leaves nothing behind, and the units after it still run. Applying the same release again changes nothing.

The rules from "What lands in Figma" hold: earlier versions move to `Older versions` and are frozen, and nothing is overwritten.

### What it does

- **No code from the files runs.** The window sends file text to the plugin's main thread. `plugin/src/release.mjs` reads it with `data-file.mjs` `readData`, the same reader the relay uses, so a file that is not JSON or not generator data is refused with a plain message and nothing is applied. The values reach the bundled runtime as the arguments of a function, never as text that is run. There is no `eval` and no `new Function`, and a test fails if either appears in `code.js` or `ui.html`.
- **The runtime is `runtime.js` word for word.** `node plugin/build.mjs` (from this folder) writes `plugin/code.js` and `plugin/ui.html` from `runtime.js`, `data-file.mjs` and the sources in `plugin/src/`. A test fails while the committed files differ from what the build makes, so run it after changing any of them. `node plugin/build.mjs --check` reports without writing.
- **The zip is read in the window.** `plugin/src/sources.mjs` reads the zip's central directory and unpacks only the files it needs, with the browser's `DecompressionStream`. It adds no npm dependency. It refuses an encrypted or Zip64 zip, and any file over 1 MB.
- **One run for the whole release.** The data files go to the runtime together, in the manifest's order, with their tokens joined by name. A token colour that changed is then written after every older set in the release has been frozen. The relay sends one file at a time, so it holds changed token values back until the call that sends the release's last component unit (see `relay/README.md`, "Token values wait for the release's last call"). The fake Plugin API shows both in `plugin/tests/apply.test.mjs` and `relay/tests/token-order.test.mjs`; neither is checked in real Figma.
- **No settings file.** The relay holds a release to the collection and page names in `klaus.config.json`. The plugin has no such file. It takes the collection from the data and shows it, treats the components' own names (or the one page they all share) as the page setting, and still runs `checkTargets`, which keeps earlier versions on `Older versions`, keeps components off `Older versions` and `Screens`, and keeps screens on `Screens`.
- **Not applied here.** Screenshot uploads and the retention file go through the relay. The window says how many there are.

### What was checked

The plugin tests (`plugin/tests/`) cover: reading a zip with data descriptors, a zip of stored entries and loose files; refusing code, unknown keys and other files that are not generator data; the bundled runtime matching `runtime.js`; and Button 1.0.0 then 1.1.0 giving 18 and 30 variants with 1.0.0 frozen on `Older versions`. Run `node plugin/build.mjs` before them if `runtime.js` changed.

On 2026-10-18 one `use_figma` call ran `plugin/code.js`'s `applyRelease` with Button 1.1.0 (icons on) in the prototype file: it wrote the 30 variants to a new page, `Plugin test`, and 8 variables to `Meridian tokens (plugin test)`. That call stands in for the click. The window itself (`ui.html`) has not been opened in Figma.

## Which pages it touches

The code touches three kinds of page, all found or created by name: the page a component goes on (the `page` setting, or the component's name), `Older versions`, and `Screens`. It touches no other page. Figma puts every new node on the person's current page, so the code appends each node to its parent in the same step, and a unit that fails leaves nothing behind. The variables it writes are in the collection the `collectionName` setting names.

Klaus cannot tell a page it made from a page a person made with the same name, because `use_figma` does not support plugin data. A person's own page named like a component, or named `Older versions` or `Screens`, is treated as Klaus's. Then a set on it named `<component> <version>` can move to `Older versions`, and on `Screens` an old frame named `<route> <release>` can be removed. In a file with pages of its own, set `page` to a page only Klaus uses.

## What lands in Figma

- One variable collection, `Tokens` by default, with one mode and one colour variable per token the components use. Each variable has the CSS variable as its WEB code syntax, for example `hsl(var(--primary))`. Which token a colour comes from is found by changing each token on the page and seeing which colours move, so two tokens with the same colour stay two variables.
- One component set per component version, named `Button 1.1.0`, with variants named `Variant=primary, Size=md`. Fills, strokes and text fills are bound to the variables. Layout is auto layout, as the prototype's.
- When a new version is written, the previous set moves to the `Older versions` page. A set is never overwritten and never deleted. A version lower than the latest goes straight to `Older versions`. A pre-release such as `1.1.0-rc.1` is lower than `1.1.0`.
- A set that moves to `Older versions` is frozen first. Every fill and stroke bound to a variable, on the set and on everything inside it, becomes the plain colour it has at that moment, so a later token change does not touch it. The set's description gets a line: `Frozen when 1.1.0 shipped; colours are the values at that time.` Klaus never changes an earlier version.
- A changed token colour is written through to its variable, because the variables hold the app's current tokens. The current version on the component's page stays bound and follows it. The write happens after every set in the file has been moved and frozen, so a frozen set keeps the colour it shipped with. The relay writes it in the release's last call and not before (`TOKEN_VALUES` in `runtime.js`).
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
| `componentsPerCall` | `1` | Components in one data file, and so in one relay call. A bulk load can set up to 50. A file is also cut where its code would pass 50,000 characters. |
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
