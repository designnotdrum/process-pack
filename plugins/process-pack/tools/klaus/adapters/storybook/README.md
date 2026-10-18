# Klaus Storybook adapter

Builds the repo's Storybook after each release and publishes it to Vercel. Every release keeps its own address, and an index page links all of them. It uses no model, so the CI workflow runs it.

Storybook shows every component that has a story. It ignores the design-tool selection in `klaus.config.json` (component groups, screens, new components).

## Set up once

1. Create the Vercel project: `vercel project create <name>`. Leave deployment protection at Vercel's default. The adapter does not create the project, because `vercel deploy --project` fails on one that does not exist.
2. Add the output to `klaus.config.json`:

   ```json
   {
     "outputs": {
       "storybook": { "enabled": true, "target": "acme-storybook", "secrets": ["VERCEL_TOKEN", "VERCEL_ORG_ID"] }
     }
   }
   ```

   `target` is the Vercel project name. `VERCEL_TOKEN` is required. `VERCEL_ORG_ID` is optional: when it is listed, its value is the team id or slug passed as `--scope`. Without it the token's own account is used.
3. Install the repo's dependencies before the run. The adapter runs the `storybook` command that is already installed. It looks in the folder that holds `.storybook` and in the folders above it, and installs nothing.

The adapter finds `.storybook` in the repo root, then in each inventory folder and the folders above it, so a monorepo with Storybook in `packages/ui` is found from the inventory's `packages/ui/src`.

The adapter starts `npx vercel@64.5.0` for every Vercel call. The version is pinned because the token is in the command's environment and the parsers read the JSON it prints. `fixtures/` holds the output of `vercel deploy --json` and `vercel list --json` captured from that version. To move to a newer version, change `VERCEL_CLI_VERSION` in `vercel.mjs` and capture the fixtures again. A deploy whose output does not match fails the run with "did not report a ready deployment" instead of passing quietly.

## What a run does

1. `plan`: one item, the newest release covered. No network.
2. `estimate`: the Vercel calls and the monthly storage cost.
3. `write`:
   1. Builds Storybook into a temporary folder.
   2. In an empty project, deploys an empty index to production first (see "Who can open it").
   3. Deploys the build with `vercel deploy --meta`, then gives it the address `<project>-<release>.vercel.app` with `vercel alias set`. Vercel keeps a deployment that has an alias.
   4. Lists the release deployments with `vercel list --meta`, writes `index.html` and `versions.json` from them, and deploys those to production.
4. `report`: the index address, the release address, and the storage cost.

The deployment metadata is `klausKind`, `klausRelease`, `klausAlias` and `klausCommit`. A release that is deployed twice appears once in the index, with its newest deployment.

One checkout builds one Storybook. A run that covers several releases deploys the newest and names the others in the report as not deployed. Run Klaus once per release tag, at that tag, to get one deployment for each.

## Estimate

Vercel charges $0.10 per GB-month of deployment storage. The estimate runs before anything is built, so it assumes 15 MB for each release, which is $0.0015 a month. The run report shows the real size and cost after the write. Vercel keeps every release, so the project's monthly bill grows by that amount with each release. The price comes from the Klaus Storybook hosting research (NJM-1770) and has not been re-checked against Vercel's billing.

A Meridian `packages/ui` build measured 12.7 MB (12,665,190 bytes) on 2026-10-18.

## Who can open it

With Vercel's default protection, the release addresses ask for a Vercel login. The project's production address, where the index is, opens for anyone (checked on 2026-10-18: 302 for a release address, 200 for the index). The index lists release names, short commit ids and dates.

Vercel makes a project's first deployment its production deployment, whatever its target. In an empty project the adapter therefore deploys an empty index first, so the first release is a protected preview deployment.

## Tests

```sh
node --test "plugins/process-pack/tools/klaus/adapters/storybook/**/*.test.mjs"
```

The tests replace git, Storybook and Vercel with a fake. The fake Vercel remembers what was deployed and answers `vercel list` from it, so a second run sees the release the first one made.
