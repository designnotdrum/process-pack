# Klaus

Klaus writes a repo's components into design outputs after each release: Storybook, Figma, and later Penpot and Pencil. Code and DESIGN.md stay the source of truth. Klaus never reads a design file back.

The decisions behind it are on the Klaus map in Linear: [NJM-1767](https://linear.app/njmason/issue/NJM-1767). The design-onboard skill copies this folder into a repo as `scripts/klaus/`, where it runs with plain `node` and no build step. Everything is ES modules with JSDoc, Node 22 built-ins only.

## Parts

| Part | Where | Issue |
|---|---|---|
| Component inventory, `inventory.json` and `INVENTORY.md` | `inventory/` | #22 |
| Version picked from the diff | `version/` | #23 |
| Reuse check, `klaus find` | `find/` | #24 |
| The frame: adapter interface, settings file, spending cap, triggers, report | `frame/` | #25 |
| Storybook adapter | `adapters/storybook/` | #26 |
| Figma code generator, relay, plugin and reconcile mode | `adapters/figma/` | #27, #28, #43, #44 |
| Onboarding step and baseline run | `skills/design-onboard/` (step 8) | #29, #30 |
| Onboarding run: the list at 1.0.0, the purposes, the stories and the duplicates, in three pull requests | `onboard/` | #30 |
| Install: the copy with its version line, the cost display, the workflow renderer | `install/` | #29 |
| Penpot and Pencil adapters | `adapters/penpot/`, `adapters/pencil/` | #31, #32 |

The rest of this file covers the frame.

## The frame

A run goes through every enabled output, one at a time. For each output the runner calls the adapter's four steps in this order:

1. `plan`: what to write for the releases being covered, from the inventory and the settings.
2. `estimate`: the calls, relay tokens and dollars those writes would cost.
3. `write`: do the writes the spending cap allows.
4. `report`: say what was written, so a person can find it.

The spending cap runs between `estimate` and `write`. The adapter never decides what to defer. The full contract, with types, is in `frame/adapter.mjs`. An adapter lives at `adapters/<output>/index.mjs` and default-exports an object with those four functions. Set `usesModel: true` on an adapter that needs a model or a signed-in tool, so a CI run skips it.

The frame reads `entries` from `inventory.json`, as the inventory script writes it. It uses each entry's `name`, its `file` (to match component groups) and the length of its `usedIn` list (as the usage count).

### Settings: `klaus.config.json`

The file sits at the repo root and is checked against `klaus.config.schema.json`.

```json
{
  "outputs": {
    "storybook": { "enabled": true, "target": "acme-storybook", "secrets": ["VERCEL_TOKEN"] },
    "figma": { "enabled": true, "target": "AbCdEfGhIjKlMnOpQrStUv", "route": "codex-relay", "logins": ["codex"] },
    "penpot": { "enabled": false }
  },
  "inventory": { "folders": ["packages/ui", "apps/web/app/components"] },
  "selection": {
    "componentGroups": ["packages/ui"],
    "screens": { "mode": "listed", "routes": ["/", "/settings"] },
    "newComponents": { "rule": "min-usage", "minUsage": 3 }
  },
  "spendingCap": { "maxComponentWrites": 50, "maxRelayTokens": 500000 },
  "trigger": { "mode": "release", "tagPattern": "v*" }
}
```

The file holds the names of secrets (environment variables) and logins, never their values. Validation rejects a value that looks like a secret, such as a GitHub token, an API key, a private key, a JWT, a URL with a password, or a long unbroken token. The error names the setting and does not repeat the value. This check is by shape, so it catches the common cases and cannot catch every secret. An adapter reads a secret with `ctx.secret("NAME")`, which works only for names listed under that output's `secrets`. An enabled output whose listed secret is not set in the environment fails before any step runs.

Check a config with `node scripts/klaus/frame/cli.mjs validate`.

### Spending cap

Defaults are 50 component writes and 500,000 relay tokens. They apply to each output in each run. A Figma relay call was measured at about 71,000 tokens plus 1.4 per character of code, so the default relays about four Button-sized component versions a run (see `adapters/figma/relay/README.md`). A repo's first, large Figma load goes through the Klaus Figma plugin instead, which uses no tokens. Over the cap, the most-used components are written first, using the inventory's usage count (the length of an entry's `usedIn` list), and the rest are deferred. A deferred component is handed back to the plan on the next run. Going over the cap never fails a run.

- Screens do not count toward the component limit. Every item counts toward the token limit, and so does any `overhead` the estimate reports.
- An item that alone needs more tokens than the whole limit is deferred with the reason `larger-than-token-cap` and does not block the items behind it.
- `node scripts/klaus/frame/cli.mjs run --trigger manual --dry-run --json` prints the estimate and the deferrals without writing anything.

### Triggers

| Trigger | When | Command flag |
|---|---|---|
| `release` | CI, after a release tag. This is the default. | `--trigger release --release v1.4.0` |
| `schedule` | A cron job. | `--trigger schedule` |
| `manual` | A one-off command. Always allowed. | `--trigger manual` |

`trigger.mode` in the config picks `release` or `schedule`. A run started by the other one exits without doing anything. Every run covers each release since the output's last recorded run, up to the release that started it (`release`) or the newest release (`schedule`, `manual`). An output with no recorded run covers the newest release only. Releases are the git tags matching `trigger.tagPattern`, in the order they were created.

The state file, `.klaus/state.json`, holds for each output its last covered release and the items still unwritten. The runner reads it before a run and writes it after. An output that fails keeps its old state, so the next run covers the same releases again.

### Report

Each run writes one JSON file to `.klaus/reports/`, named `report-<time>.json`. It lists, per output, the ids written, the ids deferred with a reason, the ids that failed, the estimated cost and the actual cost. Costs are `{ "calls", "tokens", "usd" }`. The fields are described at the top of `frame/report.mjs`. The `templates/klaus.yml` workflow uploads the folder as an artifact for the weekly scorecard.

### Running it in CI

`templates/klaus.yml` is a GitHub Actions workflow for `.github/workflows/klaus.yml`. It refreshes the inventory, then runs `cli.mjs run --model-free` for the release tag, the schedule or a manual dispatch. It keeps the state file in the Actions cache. The cache can be dropped by GitHub, and the next run then covers only the newest release.

### Where the secrets live

A repository secret can be read from a workflow run on any branch. Set `trigger.secretsEnvironment` (for example `klaus-release`) to keep the workflow's secrets in a GitHub environment instead. The environment's deployment rules allow only the default branch and, in release mode, the release tag pattern, so a run from any other branch or tag, including a manual run from a feature branch, is refused before it starts. The workflow's job names the environment, and every render of the workflow reads the environment's rules again and refuses when they have changed. `node install/install.mjs environment --repo <repo>` shows what it would create, creates it with `--create`, and checks with `gh api` that each secret is in the environment and not left as a repository secret. It never moves a secret. Step 8.6 of the design-onboard skill has the steps and what was checked in GitHub's documentation.

### Tests

```sh
node --test "plugins/process-pack/tools/klaus/frame/**/*.test.mjs"
```

The tests use a fake adapter (`frame/tests/fake-adapter.mjs`). The quoted glob is needed on Node 22, where a bare directory argument is not expanded.
