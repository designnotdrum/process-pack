# Klaus Figma relay

The Figma generator (`../`) writes data for Plugin API code and makes no Figma call. Figma's MCP server refuses a plain script, so the relay builds each call's code from that data and sends it through a signed-in Codex CLI. Codex calls `use_figma` once per data file with the code unchanged. It makes no design decisions.

The relay carries the small updates after each release: one component version per call, by default. The first, large load of a repo's components goes through a Klaus Figma plugin instead (a separate ticket), because a relay call costs about 70,000 to 100,000 relay tokens.

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
3. Builds each call's code from its data file and the runtime in this checkout (`../codegen.mjs` `codeFor`). Code in the artifact is never read.
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

500,000 relay tokens is about six Button-sized component versions at the measured average of about 83,000 a call. The cap counts the prediction, about 100,000 for such a version, so a run sends five. A version with more variants costs more, and the rest wait for the next run.

 Before each call the relay adds the file's components and its predicted tokens to what the run has used. If either would pass its limit, the call is not made. That file and every file after it are reported as deferred, and they stay `generated`. A file that alone needs more tokens than the whole limit is deferred as `larger-than-token-cap`, with a warning that it will never fit. `--max-calls <n>` adds a limit on calls. Going over the cap is not a failure.

A call's relay tokens are Codex's `input_tokens` plus `output_tokens`. Cached input is part of input, and reasoning output is part of output. The prediction is 71,000 tokens plus 1.4 tokens per character of code, from the real runs. The generator's `estimate` uses the same rate (`relayCallTokens` in `../settings.mjs`), so the frame's cap and the relay's cap count the same thing. A call measured during the run raises the prediction for the next ones, never lowers it. A call that ends without a token count is left out of the report's actual tokens, and the cap counts its prediction.

## What the real runs measured

On 2026-10-18 the relay ran six times on the laptop, at low effort, into the Klaus prototype file. Each call carried one component version. Calls 1 to 4 ran before the relay built the code itself, when the artifact held the code.

| Call | Code file (calls 1 to 3 on `gpt-6-luna`) | Characters | Relay tokens (input, cached input, output) | Seconds | Outcome |
|---|---|---|---|---|---|
| 1 | Button 1.0.0 | 18,750 | 92,662 (86,388, 53,120, 6,274) | 39 | sent: Figma reported `exists`, a set of that name from an earlier test |
| 2 | Button 1.1.0 | 20,582 | 68,817 (61,694, 27,136, 7,123) | 44 | Figma drew the set; the relay refused it: Codex had added a duplicate `"pa":"C"` key |
| 3 | Button 1.1.0, retry | 20,582 | 99,687 (92,508, 56,064, 7,179) | 45 | refused: Codex had added a primary fill to a secondary button; Figma reported `exists` |
| 4 | Button 1.1.0, on `gpt-5.6-terra` | 20,582 | 70,639 (62,657, 33,280, 7,982) | 130 | sent: the code arrived exactly, apart from the final newline; Figma reported `exists` |
| 5 | Button 1.1.0 with icons, on `gpt-5.6-terra`, built from data | 20,208 | 72,533 (63,262, 33,280, 9,271) | 51 | refused: Codex dropped every backslash (46 in the SVG markup, 7 in the runtime), so `use_figma` could not parse the code and nothing was drawn |
| 6 | the same, after the backslash fix | 20,329 | 27,193 (27,045, 5,888, 148) | 10 | failed: the model had no `use_figma` tool and said so; nothing reached Figma |

What follows from it:

- **A call costs about 70,000 to 100,000 relay tokens.** The prototype's estimate was 1,200 a component. A call is two model requests, and each one reads Codex's instructions, the tool's definition and the code.
- **Most of a file is the shared runtime.** The runtime is 14,821 characters in every file. The Button's own data is 3,929 characters for 18 variants and 5,761 for 30, about 155 a variant.
- **A call can run without the tool.** In call 6 the model said it could not access `use_figma`, and the call cost 27,193 tokens. The cause is unverified: either the stored Figma sign-in needed renewing, or the server did not list its tools within Codex's startup timeout. The relay now gives the server 60 seconds and names both causes in the error.
- **A model drops backslashes.** In call 5 terra turned every `\"` in the SVG markup into `"`, every `\d` into `d`, and `"\n"` into a line break. The code built from data now holds no backslash where it can avoid one: the runtime is written without them, and SVG markup goes into template literals. The Button with icons now comes to 20,329 characters and no backslash. This has not been run in Figma yet.
- **`gpt-6-luna` at low effort did not copy the 20,582-character file exactly in two tries. `gpt-5.6-terra` did, in one.** Both dropped only the final newline, which the relay allows. Terra took about two minutes against luna's 45 seconds. The relay caught luna's changes, so nothing wrong was recorded as sent. One terra call is one sample.

## The report

Next to the frame's fields (`written`, `deferred`, `failed`, `estimated`, `actual`), `adapter.details` lists:

- `files`: each data file with its status (`sent`, `partly sent`, `failed`, `deferred`, `already sent`, `would send`), calls, tokens, Codex's token usage, predicted tokens and time taken.
- `units`: each unit with its status, what Figma reported, and its share of its file's call and tokens. A file's call is shared evenly among its units.

Exit code 1 means a unit failed. Exit code 2 means something to fix before a run, such as the Figma sign-in.

## Limits

- Screenshot uploads go through another tool, which the relay does not call yet. They are reported as deferred with the reason `upload-not-supported`, and so is the retention file.
- `templates/klaus.yml` does not upload `.klaus/figma/` as an artifact yet. `--run` expects an artifact, named `klaus-figma` unless `--artifact` says otherwise, that holds a release folder.
- Run one relay at a time for a ledger. The relay re-reads the ledger just before each write and keeps marks written since, but it takes no lock.
- The report's `usd` is always 0, because the relay spends the ChatGPT plan's Codex quota, not money per call.
- The ledger must be where both the generator and the relay read it. When the generator runs in CI and the relay runs elsewhere, the relay updates its own repo's ledger, not CI's.

## Tests

```sh
node --test "plugins/process-pack/tools/klaus/adapters/figma/relay/**/*.test.mjs"
```

The tests put a stub `codex` and a stub `gh` first on `PATH` (`tests/stub/`). The stub `gh` answers the run, repo and compare reads and the download. The stub `codex` keeps what it was given, so a test can check the code that would have reached Figma. The stub replays the event output in `tests/fixtures/`. `success.jsonl` is the event stream of real call 1, with the code, file key and result replaced by placeholders. The stub also covers a tool error, a crash, a reply with no call, and code changed on the way. `no-call.jsonl` is the real call 6. The crash fixture follows Codex's documented event shapes, because no real run has produced one.
