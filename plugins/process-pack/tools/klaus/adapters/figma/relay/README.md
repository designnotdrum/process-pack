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
   - The default model is `gpt-6-luna` at low effort, because the job is copying. `--model` and `--effort` change it. See "What the first real run measured" below before relying on it.
4. Reads Codex's JSON events. A unit is marked `sent` in the ledger only when all of these hold:
   - `use_figma` finished without an error.
   - The code it received, by Codex's own events, is the file's code. Whitespace at either end is ignored.
   - The code's own result lists the unit as `written` or `exists`.
5. Writes a run report to `.klaus/reports/` in the frame's format, with the output name `figma-relay`.

A unit that failed stays `generated`. The next relay run on the same folder sends its file again, and the next generator run plans it again. Sending a file twice is safe: the code leaves a set that already exists alone and reports it as `exists`.

When Codex changed the code and Figma still wrote a unit from it, the set in Figma may be wrong. The relay records that unit as `changed` and the report says to delete the set in Figma. While a unit is `changed`, an `exists` from a later call does not count, because it only means a set of that name is there. The unit becomes `sent` when a call writes it again from the right code.

## The spending cap

The cap comes from `spendingCap` in `klaus.config.json`, or the frame's defaults (50 component writes, 100,000 relay tokens). Before each call the relay adds the file's components and its predicted tokens to what the run has used. If either would pass its limit, the call is not made. That file and every file after it are reported as deferred, and they stay `generated`. A file that alone needs more tokens than the whole limit is deferred as `larger-than-token-cap`, with a warning that it will never fit. `--max-calls <n>` adds a limit on calls. Going over the cap is not a failure.

A call's relay tokens are Codex's `input_tokens` plus `output_tokens`. Cached input is part of input, and reasoning output is part of output. The prediction is 71,000 tokens plus 1.4 tokens per character of code, from the first real run. A call measured during the run raises the prediction for the next ones, never lowers it. A call that ends without a token count is left out of the report's actual tokens, and the cap counts its prediction.

## What the first real run measured

On 2026-10-18 the relay ran three times on the laptop, with `gpt-6-luna` at low effort, into the Klaus prototype file:

| Call | Code file | Characters | Relay tokens (input, cached input, output) | Seconds | Outcome |
|---|---|---|---|---|---|
| 1 | Button 1.0.0 | 18,750 | 92,662 (86,388, 53,120, 6,274) | 39 | sent: Figma reported `exists`, a set of that name from an earlier test |
| 2 | Button 1.1.0 | 20,582 | 68,817 (61,694, 27,136, 7,123) | 44 | Figma drew the set; the relay refused it: Codex had added a duplicate `"pa":"C"` key |
| 3 | Button 1.1.0, retry | 20,582 | 99,687 (92,508, 56,064, 7,179) | 45 | refused: Codex had added a primary fill to a secondary button; Figma reported `exists` |

Two things follow:

- **A call costs about 70,000 to 100,000 relay tokens, not 1,200 a component.** A call is two model requests, and each one reads Codex's instructions, the tool's definition and the code. At the frame's default cap of 100,000 tokens a run makes one call, and a file over about 20,000 characters never fits. The cap and the generator's estimate need new numbers before Klaus relies on the relay.
- **`gpt-6-luna` at low effort did not copy a 20,582-character file exactly in two tries.** Call 1 dropped only the final newline, which the relay allows. The relay caught both changes, so nothing wrong was recorded as sent. Whether a stronger model copies exactly is unverified.

## The report

Next to the frame's fields (`written`, `deferred`, `failed`, `estimated`, `actual`), `adapter.details` lists:

- `files`: each code file with its status (`sent`, `partly sent`, `failed`, `deferred`, `already sent`, `would send`), calls, tokens, Codex's token usage, predicted tokens and time taken.
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

The tests put a stub `codex` and a stub `gh` first on `PATH` (`tests/stub/`). The stub replays the event output in `tests/fixtures/`. `success.jsonl` is the event stream of real call 1, with the code, file key and result replaced by placeholders. The stub also covers a tool error, a crash, a reply with no call, and code changed on the way. The no-call and crash fixtures follow Codex's documented event shapes, because no real run has produced them.
