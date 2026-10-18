# Klaus Figma relay

The Figma generator (`../`) writes Plugin API code and makes no Figma call. Figma's MCP server refuses a plain script, so the relay sends each code file through a signed-in Codex CLI. Codex calls `use_figma` once per file with the file's code unchanged. It makes no design decisions.

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

The sign-in lives in that machine's Codex home (`~/.codex`). Nothing goes into `klaus.config.json`.

## Running it

From the repo root, after the generator has written a release folder:

```sh
node scripts/klaus/adapters/figma/relay/relay.mjs .klaus/figma/v1.4.0
```

Or straight from a CI run's artifact. `gh` downloads it into a new temporary folder, which is removed after the run:

```sh
node scripts/klaus/adapters/figma/relay/relay.mjs --run 1234567890 --repo acme/app --artifact klaus-figma
```

`--dry-run` shows what would be sent and its predicted cost, and makes no call. `--json` prints the run report. Every option is listed at the top of `relay.mjs`.

## What a run does

1. Checks that Codex has a `figma` server that is signed in. If not, it stops before any call.
2. Reads `manifest.json` and the ledger, `.klaus/figma/ledger.json` (or `outputs.figma.options.outputDir`).
3. For each code file in order, skips it when every unit in it is already sent. Otherwise it checks the spending cap, then runs `codex exec` once:
   - The code goes to Codex on stdin, byte for byte. The prompt holds no code. It tells Codex to call `use_figma` exactly once with that code, report the result, and do nothing else.
   - Codex runs with a clean config: only the `figma` server, only its `use_figma` tool, no plugins, no hooks, a read-only sandbox, in an empty folder. `--keep-codex-config` uses `~/.codex/config.toml` instead.
   - The default model is `gpt-6-luna` at low effort, because the job is copying. `--model` and `--effort` change it.
4. Reads Codex's JSON events. A unit is marked `sent` in the ledger only when all of these hold:
   - `use_figma` finished without an error.
   - The code it received, by Codex's own events, is the file's code. Whitespace at either end is ignored.
   - The code's own result lists the unit as `written` or `exists`.
5. Writes a run report to `.klaus/reports/` in the frame's format, with the output name `figma-relay`.

A unit that failed stays `generated`. The next relay run on the same folder sends its file again, and the next generator run plans it again. Sending a file twice is safe: the code leaves a set that already exists alone and reports it as `exists`.

## The spending cap

The cap comes from `spendingCap` in `klaus.config.json`, or the frame's defaults (50 component writes, 100,000 relay tokens). Before each call the relay adds the file's components and its predicted tokens to what the run has used. If either would pass its limit, the call is not made. That file and every file after it are reported as deferred, and they stay `generated`. `--max-calls <n>` adds a limit on calls. Going over the cap is not a failure.

A call's relay tokens are Codex's `input_tokens` plus `output_tokens`. Cached input is part of input. The prediction for the first call is a fixed cost plus a cost per character of code. A call measured during the run raises the prediction for the next ones, never lowers it. A call that ends without a token count is left out of the report's actual tokens, and the cap counts its prediction.

## The report

Next to the frame's fields (`written`, `deferred`, `failed`, `estimated`, `actual`), `adapter.details` lists:

- `files`: each code file with its status (`sent`, `partly sent`, `failed`, `deferred`, `already sent`), calls, tokens, Codex's token usage, predicted tokens and time taken.
- `units`: each unit with its status, what Figma reported, and its share of its file's call and tokens. A file's call is shared evenly among its units.

Exit code 1 means a unit failed. Exit code 2 means something to fix before a run, such as the Figma sign-in.

## Limits

- Screenshot uploads go through another tool, which the relay does not call yet. They are reported as deferred with the reason `upload-not-supported`, and so is the retention file.
- `templates/klaus.yml` does not upload `.klaus/figma/` as an artifact yet. `--run` expects an artifact, named `klaus-figma` unless `--artifact` says otherwise, that holds a release folder.
- The ledger must be where both the generator and the relay read it. When the generator runs in CI and the relay runs elsewhere, the relay updates its own repo's ledger, not CI's.

## Tests

```sh
node --test "plugins/process-pack/tools/klaus/adapters/figma/relay/**/*.test.mjs"
```

The tests put a stub `codex` and a stub `gh` first on `PATH` (`tests/stub/`). The stub replays the event output in `tests/fixtures/`: a success, a tool error, a crash, a reply with no call, and code changed on the way.
