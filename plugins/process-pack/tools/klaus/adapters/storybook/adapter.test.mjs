/**
 * The Storybook adapter run by the frame's runner, with a fake in place of git,
 * Storybook and Vercel. The fake Vercel keeps what was deployed and answers
 * `vercel list` from it, so a second run sees the release the first one made.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runKlaus } from "../../frame/runner.mjs";
import { configOf, inventoryOf } from "../../frame/tests/fake-adapter.mjs";
import { ASSUMED_BUILD_BYTES, createStorybookAdapter, STORAGE_USD_PER_GB_MONTH } from "./index.mjs";

const TOKEN = "vcp_test_token_1234567890";

/** A repo with Storybook installed in packages/ui, as a monorepo has it. */
function repo() {
  const root = mkdtempSync(path.join(tmpdir(), "klaus-sb-adapter-"));
  mkdirSync(path.join(root, "packages/ui/.storybook"), { recursive: true });
  mkdirSync(path.join(root, "packages/ui/node_modules/.bin"), { recursive: true });
  writeFileSync(path.join(root, "packages/ui/node_modules/.bin/storybook"), "");
  return root;
}

/** Stands in for git, the storybook command and `npx vercel`. */
function fakeWorld({ buildBytes = 2_000_000, failOn } = {}) {
  const calls = [];
  const deployments = [];
  const exec = async (file, args, options = {}) => {
    calls.push({ file, args, options });
    if (file === "git") {
      assert.deepEqual(args, ["rev-parse", "HEAD"]);
      return { stdout: "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432\n", stderr: "" };
    }
    if (args[0] === "build") {
      const out = args[args.indexOf("--output-dir") + 1];
      mkdirSync(out, { recursive: true });
      writeFileSync(path.join(out, "index.html"), "x".repeat(buildBytes));
      return { stdout: "", stderr: "" };
    }
    const sub = args[2]; // after "--yes vercel@64.5.0"
    if (failOn === sub) throw new Error(`${sub} refused`);
    const meta = Object.fromEntries(args.flatMap((a, i) => (args[i - 1] === "--meta" ? [a.split(/=(.*)/s).slice(0, 2)] : [])));
    if (sub === "deploy") {
      const dir = args[3];
      const files = Object.fromEntries(readdirSync(dir).map((name) => [name, readFileSync(path.join(dir, name), "utf8")]));
      const n = deployments.length + 1;
      const prod = args.includes("--prod");
      deployments.push({ n, meta, prod, files, createdAt: Date.UTC(2026, 9, 18, 6, n) });
      const body = { id: `dpl_${n}`, url: `https://acme-${n}.vercel.app`, readyState: "READY", productionUrl: prod ? "https://acme-storybook.vercel.app" : null };
      return { stdout: JSON.stringify({ status: "ok", deployment: body }), stderr: "" };
    }
    if (sub === "list") {
      // With --meta Vercel lists only the deployments that carry it. Without it, every deployment, up to --limit.
      const filtered = args.includes("--meta") ? deployments.filter((d) => d.meta.klausKind === "storybook-release") : deployments;
      const listed = filtered
        .map((d) => ({ url: `acme-${d.n}.vercel.app`, state: "READY", target: d.prod ? "production" : null, createdAt: d.createdAt, meta: d.meta }))
        .reverse()
        .slice(0, Number(args[args.indexOf("--limit") + 1]));
      return { stdout: JSON.stringify({ deployments: listed, pagination: { next: null } }), stderr: "" };
    }
    return { stdout: "", stderr: "" }; // alias set
  };
  return { exec, calls, deployments };
}

const vercelCalls = (calls) => calls.filter((c) => c.file === "npx").map((c) => c.args[2]);

function configWith(settings = {}) {
  return configOf({ outputs: { storybook: { enabled: true, target: "acme-storybook", secrets: ["VERCEL_TOKEN"], ...settings } } });
}

function clock() {
  let t = Date.UTC(2026, 9, 18, 6, 0, 0);
  return () => new Date((t += 1000));
}

// Later than every deployment the fake Vercel creates, as real time is later than the releases before it.
const afterDeployments = () => new Date(Date.UTC(2026, 9, 18, 7, 0, 0));

async function run({ world, root, config = configWith(), releases = ["v1.0.0"], release = releases.at(-1), state, dryRun = false, env = { VERCEL_TOKEN: TOKEN }, inventory }) {
  const adapter = createStorybookAdapter({ exec: world.exec, cwd: () => root, now: afterDeployments });
  return runKlaus({
    config,
    inventory: inventory ?? { ...inventoryOf({ Button: 3 }), folders: [{ path: "packages/ui/src", role: "shared" }] },
    adapters: { storybook: adapter },
    releases,
    trigger: "release",
    release,
    state,
    dryRun,
    env,
    now: clock(),
  });
}

test("a dry run makes no Vercel call and reports the storage cost", async () => {
  const world = fakeWorld();
  const { report } = await run({ world, root: repo(), dryRun: true, env: {} });

  assert.equal(report.status, "ok");
  const out = report.outputs[0];
  assert.equal(out.status, "dry-run");
  assert.deepEqual(world.calls, []);
  const perRelease = (ASSUMED_BUILD_BYTES / 1e9) * STORAGE_USD_PER_GB_MONTH;
  assert.equal(out.estimated.usd, perRelease);
  assert.equal(out.estimated.tokens, 0);
  assert.equal(out.estimated.calls, 5);
  assert.match(out.adapter.summary, /Would deploy Storybook for v1\.0\.0 to the Vercel project acme-storybook\. The release would add about \$0\.0015 a month in deployment storage, for an assumed 15\.0 MB at \$0\.10 per GB-month\./);
  assert.equal(out.adapter.details.storageUsdPerGbMonth, 0.1);
});

test("in an empty project an empty index goes to production first, then the release, its address, and the full index", async () => {
  const world = fakeWorld({ buildBytes: 2_000_000 });
  const root = repo();
  const { report } = await run({ world, root });

  const out = report.outputs[0];
  assert.equal(out.status, "ok");
  assert.deepEqual(out.written, ["v1.0.0"]);
  assert.deepEqual(vercelCalls(world.calls), ["list", "deploy", "list", "deploy", "alias", "deploy"]);
  assert.deepEqual(world.calls.map((c) => c.file), ["git", path.join(root, "packages/ui/node_modules/.bin/storybook"), ...Array(6).fill("npx")]);

  const [empty, release, index] = world.deployments;
  assert.equal(empty.prod, true);
  assert.equal(empty.meta.klausKind, "storybook-index");
  assert.ok(empty.files["index.html"].includes("No releases yet."));
  assert.equal(release.prod, false);
  assert.deepEqual(release.meta, {
    klausKind: "storybook-release",
    klausRelease: "v1.0.0",
    klausAlias: "acme-storybook-v1-0-0.vercel.app",
    klausCommit: "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432",
  });
  assert.equal(index.prod, true);
  assert.equal(index.meta.klausKind, "storybook-index");
  assert.deepEqual(Object.keys(index.files).sort(), ["index.html", "versions.json"]);
  assert.ok(index.files["index.html"].includes("https://acme-storybook-v1-0-0.vercel.app/"));

  const alias = world.calls.find((c) => c.args[2] === "alias");
  assert.deepEqual(alias.args.slice(2, 6), ["alias", "set", "acme-2.vercel.app", "acme-storybook-v1-0-0.vercel.app"]);
  assert.equal(alias.options.env.VERCEL_TOKEN, TOKEN);
  assert.ok(world.calls.every((c) => !c.args.join(" ").includes(TOKEN)));

  assert.equal(out.actual.calls, 6);
  assert.ok(out.actual.usd > 0.0002 && out.actual.usd < 0.0003); // 2 MB at $0.10 per GB-month
  assert.deepEqual(out.adapter.links, [
    { label: "Version index", url: "https://acme-storybook.vercel.app" },
    { label: "Storybook v1.0.0", url: "https://acme-storybook-v1-0-0.vercel.app/" },
  ]);
  assert.match(out.adapter.summary, /^Deployed Storybook for v1\.0\.0 to the Vercel project acme-storybook\. The release adds about \$0\.000\d a month in deployment storage, for 2\.0 MB at \$0\.10 per GB-month\.$/);
});

test("a second release is added to the index next to the first, and both addresses are linked", async () => {
  const world = fakeWorld();
  const root = repo();
  const first = await run({ world, root, releases: ["v1.0.0"] });
  const second = await run({ world, root, releases: ["v1.0.0", "v1.1.0"], state: first.state });

  assert.deepEqual(second.report.outputs[0].releases, ["v1.1.0"]);
  // The project already has deployments, so there is no empty index this time.
  assert.deepEqual(world.calls.slice(-5).filter((c) => c.file === "npx").map((c) => c.args[2]), ["list", "list", "deploy", "alias", "deploy"]);
  const index = world.deployments.filter((d) => d.meta.klausKind === "storybook-index").at(-1);
  const html = index.files["index.html"];
  assert.ok(html.includes('<a href="https://acme-storybook-v1-0-0.vercel.app/">v1.0.0</a>'));
  assert.ok(html.includes('<a href="https://acme-storybook-v1-1-0.vercel.app/">v1.1.0</a>'));
  assert.ok(html.indexOf("v1.1.0") < html.indexOf("v1.0.0"));
  const versions = JSON.parse(index.files["versions.json"]);
  assert.deepEqual(versions.releases.map((r) => r.release), ["v1.1.0", "v1.0.0"]);
  assert.equal(second.report.outputs[0].adapter.details.releasesInIndex, 2);
});

test("one checkout builds one Storybook, so earlier releases in the same run are named as not deployed", async () => {
  const world = fakeWorld();
  const { report } = await run({ world, root: repo(), releases: ["v1.0.0", "v1.1.0", "v1.2.0"] });

  const out = report.outputs[0];
  assert.deepEqual(out.releases, ["v1.2.0"]); // no earlier state: the first run covers the newest only
  const again = await run({ world: fakeWorld(), root: repo(), releases: ["v1.0.0", "v1.1.0", "v1.2.0"], state: { version: 1, outputs: { storybook: { lastRelease: "v1.0.0", lastRunAt: "2026-10-01T00:00:00.000Z", unwritten: [] } } } });
  const covered = again.report.outputs[0];
  assert.deepEqual(covered.releases, ["v1.1.0", "v1.2.0"]);
  assert.deepEqual(covered.written, ["v1.2.0"]);
  assert.deepEqual(covered.adapter.details.notDeployed, ["v1.1.0"]);
  assert.match(covered.adapter.summary, /v1\.1\.0 did not get a deployment of its own\.$/);
});

test("the design-tool selection does not change what Storybook shows", async () => {
  const worldA = fakeWorld();
  const worldB = fakeWorld();
  const selected = configWith();
  const narrow = configOf({
    outputs: { storybook: { enabled: true, target: "acme-storybook", secrets: ["VERCEL_TOKEN"] } },
    selection: { componentGroups: ["packages/other"], screens: { mode: "listed", routes: ["/"] }, newComponents: { rule: "none" } },
  });
  const a = await run({ world: worldA, root: repo(), config: selected });
  const b = await run({ world: worldB, root: repo(), config: narrow });
  assert.deepEqual(a.report.outputs[0].written, ["v1.0.0"]);
  assert.deepEqual(vercelCalls(worldA.calls), vercelCalls(worldB.calls));
  assert.deepEqual(b.report.outputs[0].written, ["v1.0.0"]);
});

test("the component write limit does not stop a release from being deployed", async () => {
  const config = configOf({
    outputs: { storybook: { enabled: true, target: "acme-storybook", secrets: ["VERCEL_TOKEN"] } },
    spendingCap: { maxComponentWrites: 0 },
  });
  const { report } = await run({ world: fakeWorld(), root: repo(), config });
  assert.deepEqual(report.outputs[0].written, ["v1.0.0"]);
  assert.deepEqual(report.outputs[0].deferred, []); // a component item would be deferred as "write-cap" at this limit
});

test("a team id listed under secrets becomes the scope of every Vercel call", async () => {
  const world = fakeWorld();
  await run({ world, root: repo(), config: configWith({ secrets: ["VERCEL_TOKEN", "VERCEL_ORG_ID"] }), env: { VERCEL_TOKEN: TOKEN, VERCEL_ORG_ID: "team_abcdef123456" } });
  const vercel = world.calls.filter((c) => c.file === "npx");
  assert.equal(vercel.length, 6);
  for (const call of vercel) assert.equal(call.args[call.args.indexOf("--scope") + 1], "team_abcdef123456");
});

test("a failed Vercel call leaves the release unwritten with the reason, and keeps the token out of the report", async () => {
  const world = fakeWorld({ failOn: "alias" });
  const { report, state } = await run({ world, root: repo() });

  const out = report.outputs[0];
  assert.equal(report.status, "failed");
  assert.deepEqual(out.written, []);
  assert.deepEqual(out.failed, [{ id: "v1.0.0", error: "vercel alias set failed: alias refused" }]);
  // The build was deployed before the alias failed, and Vercel keeps it, so its storage still counts.
  assert.ok(out.actual.usd > 0.0001 && out.actual.usd < 0.0003);
  assert.deepEqual(state.outputs.storybook.unwritten, ["v1.0.0"]);
  assert.match(out.adapter.summary, /^Storybook for v1\.0\.0 was not deployed: vercel alias set failed: alias refused/);
  assert.ok(!JSON.stringify(report).includes(TOKEN));
});

test("a retry after a failure deploys the same release again from the unwritten list", async () => {
  const root = repo();
  const failing = await run({ world: fakeWorld({ failOn: "alias" }), root });
  const world = fakeWorld();
  const retry = await run({ world, root, state: failing.state });
  assert.deepEqual(retry.report.outputs[0].written, ["v1.0.0"]);
  assert.equal(world.deployments.find((d) => d.meta.klausKind === "storybook-release").meta.klausRelease, "v1.0.0");
});

test("fails before any call when the project, the token or the Storybook folder is missing", async () => {
  const noTargetWorld = fakeWorld();
  const noTarget = await run({ world: noTargetWorld, root: repo(), config: configOf({ outputs: { storybook: { enabled: true, secrets: ["VERCEL_TOKEN"] } } }), dryRun: true, env: {} });
  assert.match(noTarget.report.outputs[0].error, /needs a "target" in klaus\.config\.json: the name of its Vercel project/);
  assert.equal(noTarget.report.outputs[0].failedStep, "plan");
  assert.deepEqual(noTargetWorld.calls, []);

  const world = fakeWorld();
  const noSecretListed = await run({ world, root: repo(), config: configWith({ secrets: [] }), env: {} });
  assert.equal(noSecretListed.report.outputs[0].failedStep, "write");
  assert.match(noSecretListed.report.outputs[0].error, /"VERCEL_TOKEN" is not listed under secrets/);
  assert.deepEqual(vercelCalls(world.calls), []);

  const emptyRoot = mkdtempSync(path.join(tmpdir(), "klaus-sb-empty-"));
  const noStorybookWorld = fakeWorld();
  const noStorybook = await run({ world: noStorybookWorld, root: emptyRoot, dryRun: true, env: {} });
  assert.match(noStorybook.report.outputs[0].error, /No \.storybook folder was found/);
  assert.deepEqual(noStorybookWorld.calls, []);
});

test("a release whose address another release already has is not deployed, so the first keeps its address", async () => {
  const world = fakeWorld();
  const root = repo();
  const first = await run({ world, root, releases: ["v1.0.0"] });
  // "v1-0-0" and "v1.0.0" both become acme-storybook-v1-0-0.vercel.app.
  const second = await run({ world, root, releases: ["v1.0.0", "v1-0-0"], state: first.state });

  const out = second.report.outputs[0];
  assert.deepEqual(out.written, []);
  assert.match(out.failed[0].error, /The address acme-storybook-v1-0-0\.vercel\.app already belongs to release v1\.0\.0, so v1-0-0 cannot use it\./);
  assert.equal(world.deployments.filter((d) => d.meta.klausRelease === "v1-0-0").length, 0);
});

test("a build that cannot run reports that and deploys nothing", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "klaus-sb-nobin-"));
  mkdirSync(path.join(root, ".storybook"));
  const world = fakeWorld();
  const { report } = await run({ world, root, inventory: { ...inventoryOf({ Button: 1 }), folders: [] } });
  assert.match(report.outputs[0].failed[0].error, /The storybook command is not installed in the repo root or above it/);
  assert.deepEqual(vercelCalls(world.calls), []);
});

test("the adapter satisfies the frame's interface and needs no model", async () => {
  const { default: adapter } = await import("./index.mjs");
  const { assertAdapter } = await import("../../frame/adapter.mjs");
  assert.doesNotThrow(() => assertAdapter("storybook", adapter));
  assert.equal(adapter.usesModel, false);
  for (const step of ["plan", "estimate", "write", "report"]) assert.equal(typeof adapter[step], "function", `missing ${step}`);
});
