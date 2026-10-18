/**
 * The Vercel command wrapper, with a fake in place of npx.
 * Run with: node --test "plugins/process-pack/tools/klaus/adapters/storybook/**\/*.test.mjs"
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { aliasFor, createVercel, KINDS, META, slug } from "./vercel.mjs";

/** A fake exec that records each call and answers from a queue of replies. */
function fakeExec(replies) {
  const calls = [];
  const exec = async (file, args, options) => {
    calls.push({ file, args, options });
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return { stdout: reply ?? "", stderr: "" };
  };
  return { exec, calls };
}

const ready = (extra = {}) =>
  JSON.stringify({ status: "ok", deployment: { id: "dpl_1", url: "https://acme-abc.vercel.app", readyState: "READY", productionUrl: null, ...extra } });

test("an address is the project and the release, as one DNS label", () => {
  assert.equal(slug("Release/2026-10-18_RC.1"), "release-2026-10-18-rc-1");
  assert.equal(aliasFor("acme-storybook", "v1.4.0"), "acme-storybook-v1-4-0.vercel.app");
  assert.equal(aliasFor("My_Project", "v1.4.0"), "my-project-v1-4-0.vercel.app");
});

test("a long address is cut to 63 characters and keeps a hash, so two long names differ", () => {
  const a = aliasFor("a".repeat(60), "v1.0.0");
  const b = aliasFor("a".repeat(60), "v1.0.1");
  const label = (alias) => alias.replace(/\.vercel\.app$/, "");
  assert.ok(label(a).length <= 63 && label(b).length <= 63);
  assert.notEqual(a, b);
  assert.match(label(a), /^a+-[0-9a-f]{6}$/);
  assert.equal(aliasFor("a".repeat(60), "v1.0.0"), a);
});

test("deploy names the project, sends metadata with --meta and keeps the token out of the arguments", async () => {
  const { exec, calls } = fakeExec([ready()]);
  process.env.VERCEL_ORG_ID = "team_web_app";
  process.env.VERCEL_PROJECT_ID = "prj_web_app";
  try {
    const vercel = createVercel({ exec, token: "tok-secret-1234", project: "acme-storybook", scope: "team_abc" });
    const deployed = await vercel.deploy("/tmp/build", { meta: { [META.kind]: KINDS.release, [META.release]: "v1.4.0" } });

    assert.deepEqual(deployed, { id: "dpl_1", url: "https://acme-abc.vercel.app", productionUrl: null });
    const [call] = calls;
    assert.equal(call.file, "npx");
    assert.deepEqual(call.args.slice(0, 5), ["--yes", "vercel@latest", "deploy", "/tmp/build", "--project"]);
    assert.ok(call.args.includes("acme-storybook"));
    assert.ok(call.args.join(" ").includes("--meta klausKind=storybook-release --meta klausRelease=v1.4.0"));
    assert.ok(call.args.join(" ").includes("--scope team_abc"));
    assert.ok(!call.args.includes("--prod"));
    assert.ok(!call.args.join(" ").includes("tok-secret-1234"));
    assert.equal(call.options.env.VERCEL_TOKEN, "tok-secret-1234");
    // A workflow that deploys the web app sets these. They must not point this command at it.
    assert.equal(call.options.env.VERCEL_ORG_ID, undefined);
    assert.equal(call.options.env.VERCEL_PROJECT_ID, undefined);
  } finally {
    delete process.env.VERCEL_ORG_ID;
    delete process.env.VERCEL_PROJECT_ID;
  }
});

test("deploy --prod is used for the index, and the production address is returned", async () => {
  const { exec, calls } = fakeExec([ready({ productionUrl: "https://acme-storybook.vercel.app" })]);
  const vercel = createVercel({ exec, token: "tok", project: "acme-storybook" });
  const deployed = await vercel.deploy("/tmp/index", { meta: { [META.kind]: KINDS.index }, prod: true });
  assert.equal(deployed.productionUrl, "https://acme-storybook.vercel.app");
  assert.ok(calls[0].args.includes("--prod"));
  assert.ok(!calls[0].args.includes("--scope"));
});

test("deploy fails when the deployment is not ready or the output is not JSON", async () => {
  const notReady = createVercel({ exec: fakeExec([ready({ readyState: "ERROR" })]).exec, token: "tok", project: "p" });
  await assert.rejects(notReady.deploy("/tmp/x", { meta: {} }), /did not report a ready deployment \(state: ERROR\)/);
  const noJson = createVercel({ exec: fakeExec(["Error: nope"]).exec, token: "tok", project: "p" });
  await assert.rejects(noJson.deploy("/tmp/x", { meta: {} }), /did not print JSON. It printed: Error: nope/);
});

test("a failed command names the step and carries the command's own message", async () => {
  const vercel = createVercel({ exec: fakeExec([new Error("The domain is not available")]).exec, token: "tok", project: "p" });
  await assert.rejects(vercel.alias("https://x-abc.vercel.app", "p-v1.vercel.app"), /vercel alias set failed: The domain is not available/);
});

test("alias set uses the host of the deployment, not its URL", async () => {
  const { exec, calls } = fakeExec([""]);
  await createVercel({ exec, token: "tok", project: "p" }).alias("https://acme-abc.vercel.app/", "acme-storybook-v1-4-0.vercel.app");
  assert.deepEqual(calls[0].args.slice(2, 5), ["alias", "set", "acme-abc.vercel.app"]);
  assert.equal(calls[0].args[5], "acme-storybook-v1-4-0.vercel.app");
});

test("hasDeployments asks for one deployment of any kind", async () => {
  const { exec, calls } = fakeExec([JSON.stringify({ deployments: [] }), JSON.stringify({ deployments: [{ url: "x.vercel.app", meta: {} }] })]);
  const vercel = createVercel({ exec, token: "tok", project: "p" });
  assert.equal(await vercel.hasDeployments(), false);
  assert.equal(await vercel.hasDeployments(), true);
  assert.deepEqual(calls[0].args.slice(2, 8), ["list", "p", "--json", "--limit", "1", "--non-interactive"]);
  assert.ok(!calls[0].args.includes("--meta"));
});

test("listReleases follows the pages and reads release, address, commit and time from the metadata", async () => {
  const page = (releases, next) =>
    JSON.stringify({
      deployments: releases.map((release, i) => ({
        url: `x${i}.vercel.app`,
        createdAt: 1000 + i,
        meta: { [META.kind]: KINDS.release, [META.release]: release, [META.alias]: `p-${release}.vercel.app`, [META.commit]: "abc1234" },
      })).concat([{ url: "other.vercel.app", createdAt: 1, meta: {} }]),
      pagination: { next },
    });
  const { exec, calls } = fakeExec([page(["v2", "v1"], 999), page(["v0"], null)]);
  const vercel = createVercel({ exec, token: "tok", project: "p" });
  const found = await vercel.listReleases();

  assert.deepEqual(found.map((f) => f.release), ["v2", "v1", "v0"]);
  assert.deepEqual(found[0], { release: "v2", alias: "p-v2.vercel.app", commit: "abc1234", createdAt: 1000 });
  assert.ok(calls[0].args.join(" ").includes(`--meta klausKind=storybook-release`));
  assert.ok(calls[0].args.join(" ").includes("--status READY"));
  assert.ok(!calls[0].args.includes("--next"));
  assert.equal(calls[1].args[calls[1].args.indexOf("--next") + 1], "999");
  assert.equal(vercel.calls(), 2);
});
