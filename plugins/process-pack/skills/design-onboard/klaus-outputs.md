# Klaus outputs: route, credential and platform limits

Step 8 of the design-onboard skill shows one of these per screen, next to the cost lines that `install.mjs costs` prints. The cost lines come from the adapters' estimate steps. Nothing in this file is a cost estimate. It holds what the estimate cannot: how an output is reached, who must sign in, and the platform's own limits. Each limit names where it was read and when. A limit marked unverified was not settled by any source.

When a limit here is older than a month, or the person asks, check the platform's current page before quoting it. Say that you did.

## Storybook

- **Route:** the Vercel CLI, run in CI. One deployment for each release, kept under its own address, plus an index page.
- **Credential:** `VERCEL_TOKEN` as a CI secret. `VERCEL_ORG_ID` too when a Vercel team owns the project. The config holds the names only.
- **Where the credential lives:** a repository secret is readable from a workflow run on any branch. Klaus offers to keep it in a GitHub environment that only the default branch and the release tags can use (step 8.6 of the skill). A private repo needs GitHub Pro, Team or Enterprise for that, and a public repo needs any current plan. Source: GitHub's "Managing environments for deployment", read 2026-10-19.
- **Needs first:** the Vercel project must exist (`vercel project create <name>`), and the repo's own install must run before Klaus. Storybook must already be in the repo. Klaus does not install it.
- **Who can open it:** with Vercel's default protection the release addresses ask for a Vercel login, and the index page at the project address opens for anyone. It lists release names, short commit ids and dates. Source: the Storybook adapter's README, checked 2026-10-18.
- **Limits:** none published for this use. Vercel keeps every release, so storage grows with each one. Source: the Storybook adapter's README.

## Figma

- **Route, two parts.** The Klaus plugin does the first, large load. The relay does the updates after each release.
  - The plugin runs inside the Figma desktop app, uses no model and makes no network request. A person imports it once (Plugins, Development, Import plugin from manifest) and applies each release's data files from a zip or folder. Source: `adapters/figma/README.md`.
  - The relay sends one component version per call through a signed-in Codex CLI, because Figma's server refuses a plain script. It spends the ChatGPT plan's Codex quota, not money. Source: `adapters/figma/relay/README.md`.
  - Afterwards the relay's reconcile mode (`relay.mjs --reconcile`) marks what the plugin wrote, so the relay does not send it again. It takes no release folder, `--run` or `--artifact`, and `--dry-run` shows its predicted cost. One read-only call. It measured 41,351 relay tokens on 2026-10-18, on an earlier version of its code, one sample (`adapters/figma/relay/README.md`). `relay.mjs --reconcile --dry-run` predicts the current code's cost once the onboarding run has written data files.
- **Credential:** none in CI. The Codex CLI's Figma sign-in is done once by a person and lives on the machine that runs the relay (the Fedora box for Meridian, or any signed-in laptop for a one-off). The config names the login (`codex`), never a token. The relay machine needs the Codex CLI, a ChatGPT sign-in whose quota pays, and `codex mcp add figma`, `codex mcp login figma`. The steps are in `adapters/figma/relay/README.md`.
- **In CI:** the generator runs in the workflow. It reads each component from a static Storybook build in a browser and writes data files, and calls no tool. The workflow uploads them as the `klaus-figma` artifact. The relay never runs in CI.
- **Needs first:** a Storybook with a story for each component (a component with none is left out), `@playwright/test` in the repo, and a Figma file the person can edit.
- **Plan and seat:** Figma's help pages say a development plugin can be made on any plan, and that running one needs a Starter plan or a Full seat on a paid plan. Dev, Collab and View seats cannot run plugins. The page does not name the Professional plan, so a first real import on Professional is unverified. Source: `adapters/figma/README.md`, read 2026-10-18.
- **Limits:** canvas writes are free in Figma's beta and become usage-based afterwards, with no price published. Figma's read tools allow 200 a day and 10 a minute on Pro. Whether `use_figma` counts against that is unverified. Source: Klaus research ticket NJM-1768 in Linear, 2026-10-18.

## Penpot

- **Route:** the backend API with a personal access token. No adapter exists yet (process-pack issue #31), so there is no estimate and it cannot be turned on.
- **Credential:** a personal access token as a CI secret. Self-hosted Penpot needs `enable-access-tokens`.
- **Limits:** the cloud has a USD 0 tier and self-hosting is free. Rate limits are not published. Source: Klaus research ticket NJM-1769 in Linear, 2026-10-18.

## Pencil (pen.dev)

- **Route:** the `pen` CLI in headless mode. No adapter exists yet (issue #32), so it cannot be turned on.
- **Credential:** `PEN_CLI_KEY` as a CI secret. Organization CI keys are on the Pro plan, USD 16 per user per month as displayed. Node 22.19 or later.
- **Limits:** the Free plan allows 5 days a month designing with an agent. Source: Klaus research ticket NJM-1769 in Linear, 2026-10-18.

## Claude Design: cannot run unattended

- **Why:** its output is HTML artboards, and no documented route writes without a person approving. `/design-sync` needs a login and an approved plan, and artifacts are off by default in `claude -p`, the Agent SDK and the GitHub Action.
- **Cost:** it shares the Claude plan's usage limits. No per-call price or numeric limit is published.
- **After 2026-12-14:** it lives inside Claude as artifacts. Whether sync still writes after that is unverified. Klaus builds a ready bundle for it in a later issue (#33), not before 2026-12-15.
- Source: Klaus research ticket NJM-1768 in Linear, 2026-10-18.

## Paper: cannot run unattended

- **Why:** its MCP server is part of Paper Desktop, which must be open with a file loaded. There is no token and no REST API. Running without a display is unverified.
- **Limits:** the Free plan allows 100 MCP tool calls a week, and Pro allows 1,000,000 a week at USD 20 per editor per month. Source: Klaus research ticket NJM-1769 in Linear, 2026-10-18.
- Klaus has no Paper ticket until Paper offers an unattended route.
