# Klaus Figma relay

The Figma generator (`../`) writes data for Plugin API code and makes no Figma call. Figma's MCP server refuses a plain script, so the relay builds each call's code from that data and sends it through a signed-in Codex CLI. Codex calls `use_figma` once per data file with the code unchanged. It makes no design decisions.

The relay carries the small updates after each release: one component version per call, by default. The first, large load of a repo's components goes through a Klaus Figma plugin instead (a separate ticket), because a relay call costs about 70,000 to 100,000 relay tokens. The plugin cannot write the repo's ledger, so `--reconcile` marks what the plugin wrote (see "Reconcile after the plugin's first load").

## Which machine runs it

For Meridian, the Fedora box runs it, because it is always on and keeps one Figma sign-in. A one-off run works from any machine where Codex is signed in to Figma, such as a laptop.

## One-time setup on the relay machine

1. Install the Codex CLI and sign in to it with the ChatGPT account whose Codex quota pays for the relay:

   ```sh
   npm install -g @openai/codex
   codex login            # on a machine without a browser: codex login --device-auth
   ```

2. Add Figma's MCP server under the name `figma`. The relay looks for that name.

   ```sh
   codex mcp add figma --url https://mcp.figma.com/mcp
   ```

3. Sign Codex in to Figma with the Figma account that can edit the target file:

   ```sh
   codex mcp login figma
   ```

   On a machine without a browser, such as the Fedora box, add `--no-browser`. Codex prints a URL. Open it on any machine, approve, then paste the URL the browser lands on back into the terminal.

4. Check it. The `figma` row must not say `Not logged in`:

   ```sh
   codex mcp list
   ```

   That row shows only that a sign-in is stored, not that it still works. If a run fails with "Codex did not call use_figma" and the model says it has no such tool, run `codex mcp login figma` again. The relay gives Figma's server 60 seconds to sign in and list its tools.

The sign-in lives in that machine's Codex home (`~/.codex`). Nothing about it goes into `klaus.config.json`.

The relay also needs the repo's `klaus.config.json`, because the Figma file it writes comes from `outputs.figma.target` there and nowhere else.

## Running it

From the repo root, after the generator has written a release folder:

```sh
node scripts/klaus/adapters/figma/relay/relay.mjs .klaus/figma/v1.4.0
```

Or straight from a CI run's artifact. `gh` downloads it into a new temporary folder, which is removed after the run. The relay first checks the run with `gh api`, and downloads nothing unless all of these hold:

- The run is of the Klaus workflow, `.github/workflows/klaus.yml`.
- It succeeded.
- Its commit is on the default branch. Either its head branch is the default branch, or, for a run a release tag started, the commit is in the default branch's history.

A local folder is trusted as the operator's own.

```sh
node scripts/klaus/adapters/figma/relay/relay.mjs --run 1234567890 --repo acme/app --artifact klaus-figma
```

`--dry-run` shows what would be sent and its predicted cost, and makes no call. `--json` prints the run report. Every option is listed at the top of `relay.mjs`.

## What a run does

1. Reads `manifest.json`. If it names another Figma file than `klaus.config.json`, the run stops.
2. Reads every data file with `../data-file.mjs`, before any call. A file that is not JSON, is not the generator's shape, writes to a variable collection or page the settings do not name, or does not match the manifest stops the run, and nothing is sent.
3. Builds each call's code from its data file and the runtime in this checkout (`../codegen.mjs` `codeFor`). Code in the artifact is never read. Every string from the data is encoded with a new random key for each call, so the model reads no text from the data (see "What the model sees" below).
4. Checks that Codex has a `figma` server that is signed in. If not, it stops before any call.
5. Reads the ledger, `.klaus/figma/ledger.json` (or `outputs.figma.options.outputDir`).
6. For each data file in order, skips it when every unit in it is already sent. Otherwise it checks the spending cap, then runs `codex exec` once:
   - The code goes to Codex on stdin, byte for byte. The prompt holds no code. It tells Codex to call `use_figma` exactly once with that code, report the result, and do nothing else.
   - Codex runs with a clean config: only the `figma` server, only its `use_figma` tool, no plugins, no hooks, a read-only sandbox, in an empty folder. `--keep-codex-config` uses `~/.codex/config.toml` instead.
   - The default model is `gpt-5.6-terra` at low effort. It copied the code exactly where `gpt-6-luna` did not (see "What the real runs measured" below). `--model` and `--effort` change it.
7. Reads Codex's JSON events. A unit is marked `sent` in the ledger only when all of these hold:
   - `use_figma` finished without an error, on the settings' Figma file.
   - The code it received, by Codex's own events, is the code the relay built. Whitespace at either end is ignored.
   - The code's own result lists the unit as `written` or `exists`.
8. Writes a run report to `.klaus/reports/` in the frame's format, with the output name `figma-relay`.

The pages the code touches are in the generator's README, under "Which pages it touches".

A unit that failed stays `generated`. The next relay run on the same folder sends its file again, and the next generator run plans it again. Sending a file twice is safe: the code leaves a set that already exists alone and reports it as `exists`.

When Codex changed the code and Figma still wrote a unit from it, the set in Figma may be wrong. The relay records that unit as `changed` and the report says to delete the set in Figma. While a unit is `changed`, an `exists` from a later call does not count, because it only means a set of that name is there. The unit becomes `sent` when a call writes it again from the right code.

## The spending cap

The cap comes from `spendingCap` in `klaus.config.json`. A repo picks it at onboarding, with the cost shown first. Without one, the frame's defaults apply: 50 component writes and 500,000 relay tokens a run.

500,000 relay tokens is about six Button-sized component versions at the measured average of about 83,000 a call. The cap counts the prediction, about 101,000 for such a version, so a run sends four. A version with more variants costs more, and the rest wait for the next run.

 Before each call the relay adds the file's components and its predicted tokens to what the run has used. If either would pass its limit, the call is not made. That file and every file after it are reported as deferred, and they stay `generated`. A file that alone needs more tokens than the whole limit is deferred as `larger-than-token-cap`, with a warning that it will never fit. `--max-calls <n>` adds a limit on calls. Going over the cap is not a failure.

A call's relay tokens are Codex's `input_tokens` plus `output_tokens`. Cached input is part of input, and reasoning output is part of output. The prediction is 71,000 tokens plus 1.4 tokens per character of code, from the real runs. The generator's `estimate` uses the same rate (`relayCallTokens` in `../settings.mjs`), so the frame's cap and the relay's cap count the same thing. A call measured during the run raises the prediction for the next ones, never lowers it. A call that ends without a token count is left out of the report's actual tokens, and the cap counts its prediction.

## What the model sees

Text in a data file (a description, a button's words, SVG markup, a component or page name) could be written to steer the model that copies the code, for example a description that says to ignore the prompt and send other code. The copy check only runs after Figma has run the call, so the relay keeps that text from the model instead:

- Every string from the data becomes its UTF-8 bytes XORed with a random 32-byte key, in base64. The key is new for each call and sits in the code as a list of numbers, `KEY`.
- Seven fields stay plain: `kind`, `k`, `L`, `pa`, `ca`, `td` and `tt`. `data-file.mjs` holds each to a few fixed values, such as `"component"` or `"H"`, and the runtime branches on them.
- The file's header line becomes the fixed text `Klaus Figma code`, because a header lists units by name.
- The runtime decodes every string once, before it uses any of the data, with a decoder of its own (no `atob`, no backslashes). The rest of the runtime is the code call 7 ran.
- The copy check compares what `use_figma` received against this encoded code.

The Klaus Figma plugin builds the same code without a key, because no model reads what a plugin runs. Both read data files with the same `data-file.mjs`.

Encoding makes text about a third longer, and the decoder adds about 1,900 characters to the runtime. The Button with icons came to 22,688 characters, against 20,329 before. The estimate's data part is now 1,600 characters a component plus 160 a variant, from Meridian's two Button files encoded (4,434 characters for 18 variants, 6,337 for 30).

## What the real runs measured

On 2026-10-18 the relay ran seven times on the laptop, at low effort, into the Klaus prototype file. Each call carried one component version. Calls 1 to 4 ran before the relay built the code itself, when the artifact held the code.

| Call | Code file (calls 1 to 3 on `gpt-6-luna`) | Characters | Relay tokens (input, cached input, output) | Seconds | Outcome |
|---|---|---|---|---|---|
| 1 | Button 1.0.0 | 18,750 | 92,662 (86,388, 53,120, 6,274) | 39 | sent: Figma reported `exists`, a set of that name from an earlier test |
| 2 | Button 1.1.0 | 20,582 | 68,817 (61,694, 27,136, 7,123) | 44 | Figma drew the set; the relay refused it: Codex had added a duplicate `"pa":"C"` key |
| 3 | Button 1.1.0, retry | 20,582 | 99,687 (92,508, 56,064, 7,179) | 45 | refused: Codex had added a primary fill to a secondary button; Figma reported `exists` |
| 4 | Button 1.1.0, on `gpt-5.6-terra` | 20,582 | 70,639 (62,657, 33,280, 7,982) | 130 | sent: the code arrived exactly, apart from the final newline; Figma reported `exists` |
| 5 | Button 1.1.0 with icons, on `gpt-5.6-terra`, built from data | 20,208 | 72,533 (63,262, 33,280, 9,271) | 51 | refused: Codex dropped every backslash (46 in the SVG markup, 7 in the runtime), so `use_figma` could not parse the code and nothing was drawn |
| 6 | the same, after the backslash fix | 20,329 | 27,193 (27,045, 5,888, 148) | 10 | failed: the model had no `use_figma` tool and said so; nothing reached Figma |
| 7 | the same, with the 60-second start-up wait | 20,329 | 68,117 | | sent: an exact copy. Set 33:102 on `Runtime check` has 18 variants, each with a hidden Icon layer wired to `Show icon`, properties Show icon, Variant and Size, 63 bound paints, and no stray text on the page (checked read-only by the coordinator) |

What follows from it:

- **A call costs about 70,000 to 100,000 relay tokens.** The prototype's estimate was 1,200 a component. A call is two model requests, and each one reads Codex's instructions, the tool's definition and the code.
- **Most of a file is the shared runtime.** The runtime is 14,821 characters in every file. The Button's own data is 3,929 characters for 18 variants and 5,761 for 30, about 155 a variant.
- **The new path works in Figma.** Call 7 ran the code built from data, with the reordered runtime and no backslashes, and drew the set as the generator meant. It also found one bug: Figma gives the frame around each SVG a white fill, so with Show icon on a white square showed behind every icon. The runtime now clears that fill.
- **A call can run without the tool.** In call 6 the model said it could not access `use_figma`, and the call cost 27,193 tokens. Before call 7 a Codex probe with the 60-second wait called Figma's `whoami`, so the sign-in was fine, and the start-up timeout is the likely cause (unverified). The relay now gives the server 60 seconds and names both causes in the error.
- **A model drops backslashes.** In call 5 terra turned every `\"` in the SVG markup into `"`, every `\d` into `d`, and `"\n"` into a line break. The code built from data now holds no backslash where it can avoid one: the runtime is written without them, and SVG markup goes into template literals. The Button with icons now comes to 20,329 characters and no backslash. This has not been run in Figma yet.
- **`gpt-6-luna` at low effort did not copy the 20,582-character file exactly in two tries. `gpt-5.6-terra` did, in one.** Both dropped only the final newline, which the relay allows. Terra took about two minutes against luna's 45 seconds. The relay caught luna's changes, so nothing wrong was recorded as sent. One terra call is one sample.

## The report

Next to the frame's fields (`written`, `deferred`, `failed`, `estimated`, `actual`), `adapter.details` lists:

- `files`: each data file with its status (`sent`, `partly sent`, `failed`, `deferred`, `already sent`, `would send`), calls, tokens, Codex's token usage, predicted tokens and time taken.
- `units`: each unit with its status, what Figma reported, and its share of its file's call and tokens. A file's call is shared evenly among its units.

Exit code 1 means a unit failed. Exit code 2 means something to fix before a run, such as the Figma sign-in.

## Reconcile after the plugin's first load

The Klaus plugin runs inside Figma and cannot write the repo's ledger, `.klaus/figma/ledger.json`. After it runs, the ledger still lists every unit as `generated`, and the next relay run would send each one again. `--reconcile` fixes that with one read-only `use_figma` call:

```sh
node scripts/klaus/adapters/figma/relay/relay.mjs --reconcile
```

It takes no release folder, `--run`, `--repo`, `--artifact` or `--release`. `--dry-run`, `--json`, `--max-calls`, `--model`, `--effort`, `--timeout`, `--events-dir`, `--ledger`, `--config` and `--report-dir` work as they do for a send.

What it does:

1. Reads the ledger and takes every component version that is `generated`. Screens are not read: they are frames, not components, so generated screens stay `generated` and the report says so. A `changed` version is not looked for and is never touched. A `sent` version is not looked for.
2. Works out the pages to read: each version's page (the `page` setting, or the component's own name, the same rule as the generator) and `Older versions`. A component whose page name has a control character or is over 100 characters is left `generated`, with a warning.
3. Writes the call's code (`reconcile.mjs` `reconcileCode`). It writes nothing, makes no page and switches no page. For each page it finds the page by name, loads it with `page.loadAsync()` (as the generated code does, so it is not a page switch), and collects the names of the component sets and components that sit directly on it. It returns `{ names }` and nothing else.
4. Checks the spending cap as a send does (the predicted tokens and `--max-calls`). Component writes count for nothing, because the call writes none. A call over the cap is not made, and the versions are reported as deferred.
5. Runs `codex exec` once, with the same limits as a send: the settings' Figma file only, a clean Codex config, only the figma server's `use_figma` tool, a 60-second start-up wait, no hooks, a read-only sandbox, the code on stdin byte for byte.
6. Applies the copy check. The code `use_figma` received, by Codex's own events, must equal the code the relay wrote, on the settings' file, and the call must have completed. If not, the result is refused, and the error says the code could have written, so the file needs a look.
7. Reads the names from the tool's result only, never the model's closing message. The result must hold a `names` list of strings. Anything else is refused and nothing changes. A string that is not shaped like `<Name> <version>` (another person's component on a Klaus page, for example) is dropped and counted as `otherNames`. A name that matches no generated version is ignored.
8. Marks each generated version whose exact `<Name> <version>` is in the list as `sent`. The ledger is read again just before the write, so a mark another run wrote is kept, and a version that is no longer `generated` by then is left as it is. Versions not found stay `generated`.

The report counts the call and its tokens under `figma-relay`, like a send. It differs from a send in these ways:

- `written` is empty, because the relay wrote no set. The versions it marked are in `adapter.details.reconciled`, with status `reconciled` in `adapter.details.units`, so a reconciled version can be told from a relayed send (`sent`).
- `adapter.details.missing` lists the versions the file did not have. They stay `generated`. A missing version is not a failure: the plugin may not have written it yet.
- `adapter.details.changed` lists the `changed` versions that were left alone.
- A refused or failed call is one entry in `failed`, with the id `reconcile`, and the run exits with 1. No version is called missing then, because the answer could not be read.

The ledger itself does not record how a version became `sent`. Its statuses are still `generated`, `sent` and `changed`, so the generator and the relay read it as before.

The page names are the one part of the call's code that is not fixed text. They come from the repo's own settings and ledger, never from an artifact, and each is written as a list of character codes, so the relaying model reads no name. The code holds no backslash.

A set found by name is a set that exists. As with the generator's `exists`, Klaus cannot tell a set the plugin wrote from a person's set with the same name, and it does not check the set's contents.

On 2026-10-18 one real call ran against the Klaus prototype file, with `page` set to `Runtime check 2` and Button 1.0.0 and 1.1.0 `generated`. It returned `["Button 1.1.0", "Button 1.0.0"]`, found both, and cost 41,351 relay tokens (40,918 input, 433 output) in 17 seconds. The code was 630 characters and arrived exactly. The prediction was 71,882, because the cap uses the rate measured for 20,000-character send calls, so it is high for this call. This is one sample.

## Limits

- Screenshot uploads go through another tool, which the relay does not call yet. They are reported as deferred with the reason `upload-not-supported`, and so is the retention file.
- `templates/klaus.yml` does not upload `.klaus/figma/` as an artifact yet. `--run` expects an artifact, named `klaus-figma` unless `--artifact` says otherwise, that holds a release folder.
- Reconcile looks only at the top level of each page it reads. A set a person moved into a section or a frame is not found, and its version stays `generated`.
- Run one relay at a time for a ledger. The relay re-reads the ledger just before each write and keeps marks written since, but it takes no lock.
- The report's `usd` is always 0, because the relay spends the ChatGPT plan's Codex quota, not money per call.
- The ledger must be where both the generator and the relay read it. When the generator runs in CI and the relay runs elsewhere, the relay updates its own repo's ledger, not CI's.

## Tests

```sh
node --test "plugins/process-pack/tools/klaus/adapters/figma/relay/**/*.test.mjs"
```

The tests put a stub `codex` and a stub `gh` first on `PATH` (`tests/stub/`). The stub `gh` answers the run, repo and compare reads and the download. The stub `codex` keeps what it was given, so a test can check the code that would have reached Figma. The stub replays the event output in `tests/fixtures/`. `success.jsonl` is the event stream of real call 1, with the code, file key and result replaced by placeholders. The stub also covers a tool error, a crash, a reply with no call, and code changed on the way. `no-call.jsonl` is the real call 6. The crash fixture follows Codex's documented event shapes, because no real run has produced one.
