/** The adapter's four steps, and how it fits the frame. */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { resolveConfig, runKlaus, validateConfig } from "../../../frame/index.mjs";
import adapter, { createAdapter, DEFAULT_VERSION, fileKeyOf } from "../index.mjs";
import { readLedger } from "../ledger.mjs";
import { MAX_CODE_CHARS } from "../settings.mjs";
import { runCode } from "./fake-figma.mjs";
import { buttonCapture, newFigma } from "./helpers.mjs";

const KEY = "zSRhsvwtutOIPvHyWF9Wf2";

function tempRepo() {
  return mkdtempSync(path.join(tmpdir(), "klaus-figma-"));
}

const entry = (name, extra = {}) => ({
  name,
  kind: "shared",
  folder: "packages/ui",
  file: `packages/ui/${name}.tsx`,
  props: [],
  parts: [],
  variants: { variant: ["primary", "secondary", "destructive", "outline", "ghost", "link"], size: ["sm", "md", "lg"] },
  purpose: { useWhen: "any action a person clicks", notFor: "navigation that should be a link", text: "" },
  version: "1.0.0",
  screenshot: "",
  usedIn: ["a.tsx"],
  ...extra,
});

function context(root, { entries = [entry("Button")], options = {}, screens = { mode: "none", routes: [] }, release = "v1.0.0", unwritten = [], dryRun = false } = {}) {
  return {
    output: "figma",
    root,
    settings: { enabled: true, target: KEY, options },
    selection: { componentGroups: [], screens, newComponents: { rule: "all", minUsage: 2 } },
    inventory: { schemaVersion: 1, folders: ["packages/ui"], entries },
    trigger: "release",
    release,
    releases: [release],
    unwrittenFromLastRun: unwritten,
    dryRun,
    secret() {},
  };
}

function fakeBrowser({ capture = () => buttonCapture(), fail } = {}) {
  const seen = { requests: [], closed: 0 };
  const browser = {
    async openStorybook() {
      if (fail) throw new Error(fail);
      return { entries: [], async close() { seen.closed += 1; } };
    },
    async captureComponent(_storybook, request) {
      seen.requests.push(request);
      return capture(request);
    },
    async captureScreen({ url }) {
      seen.url = url;
      return { size: { w: 400, h: 300 }, tree: { kind: "box", tag: "body", x: 0, y: 0, w: 400, h: 300, display: "block", direction: "row", alignItems: "normal", justifyContent: "normal", gap: [0, 0], padding: [0, 0, 0, 0], borderWidth: [0, 0, 0, 0], borderStyle: "none", borderColor: [0, 0, 0, 0], radius: [0, 0, 0, 0], background: [255, 255, 255, 1], backgroundImage: false, opacity: 1, clip: false, children: [] } };
    },
  };
  return { browser, seen };
}

const outputOf = (root, release = "v1.0.0") => path.join(root, ".klaus/figma", release);

test("plan lists a component whose version is not written yet, with its page and variant axes", async () => {
  const root = tempRepo();
  const plan = await adapter.plan(context(root, { options: { page: "Generator test" } }));

  assert.equal(plan.items.length, 1);
  const [item] = plan.items;
  assert.deepEqual({ id: item.id, kind: item.kind, version: item.version, page: item.page }, { id: "Button", kind: "component", version: "1.0.0", page: "Generator test" });
  assert.deepEqual(item.axes.map((a) => [a.prop, a.name, a.values.length]), [["variant", "Variant", 6], ["size", "Size", 3]]);
  assert.equal(item.description, "Use when: any action a person clicks. Not for: navigation that should be a link.");
});

test("a component gets its own page, named after it, unless one page is set", async () => {
  const root = tempRepo();
  const plan = await adapter.plan(context(root));
  assert.equal(plan.items[0].page, "Button");
});

test("a component the versioning step has not numbered yet is written as 1.0.0", async () => {
  const plan = await adapter.plan(context(tempRepo(), { entries: [entry("Button", { version: "" })] }));
  assert.equal(plan.items[0].version, DEFAULT_VERSION);
});

test("an icon set is not a component and is left out", async () => {
  const plan = await adapter.plan(context(tempRepo(), { entries: [entry("Icon set", { kind: "icon-set" }), entry("Button")] }));
  assert.deepEqual(plan.items.map((i) => i.id), ["Button"]);
});

test("a component with no variant props is planned without axes", async () => {
  const plan = await adapter.plan(context(tempRepo(), { entries: [entry("Badge", { variants: {} })] }));
  assert.deepEqual(plan.items[0].axes, []);
});

test("the axes are the inventory props named in the settings, in that order", async () => {
  const plan = await adapter.plan(context(tempRepo(), { options: { axes: ["size", "variant", "missing"] } }));
  assert.deepEqual(plan.items[0].axes.map((a) => a.prop), ["size", "variant"]);
});

test("a component with no story in the Storybook build is left out of the plan", async () => {
  const root = tempRepo();
  mkdirSync(path.join(root, "storybook-static"));
  writeFileSync(
    path.join(root, "storybook-static/index.json"),
    JSON.stringify({ v: 5, entries: { "ui-button--primary": { id: "ui-button--primary", type: "story", title: "UI/Button", name: "Primary", importPath: "./Button.stories.tsx" } } }),
  );
  const plan = await adapter.plan(context(root, { entries: [entry("Button"), entry("Card")] }));
  assert.deepEqual(plan.items.map((i) => i.id), ["Button"]);
});

test("a story named in the settings counts as a story", async () => {
  const root = tempRepo();
  mkdirSync(path.join(root, "storybook-static"));
  writeFileSync(path.join(root, "storybook-static/index.json"), JSON.stringify({ v: 5, entries: {} }));
  const plan = await adapter.plan(context(root, { options: { stories: { Button: "weird-id--x" } } }));
  assert.deepEqual(plan.items.map((i) => i.id), ["Button"]);
});

test("screens are planned for each listed route and each release", async () => {
  const plan = await adapter.plan(context(tempRepo(), { entries: [], screens: { mode: "listed", routes: ["/settings", "/"] }, release: "v2.0.0" }));
  assert.deepEqual(plan.items.map((i) => [i.id, i.kind, i.release, i.page, i.editable]), [
    ["screen:/", "screen", "v2.0.0", "Screens", false],
    ["screen:/settings", "screen", "v2.0.0", "Screens", false],
  ]);
});

test("estimate: about 1,200 relay tokens and a tenth of a call for each component version", async () => {
  const root = tempRepo();
  const ctx = context(root, { entries: [entry("Button"), entry("Card")] });
  const plan = await adapter.plan(ctx);
  const estimate = await adapter.estimate(plan, ctx);

  assert.deepEqual(estimate.items, [
    { id: "Button", calls: 0.1, tokens: 1200, usd: 0 },
    { id: "Card", calls: 0.1, tokens: 1200, usd: 0 },
  ]);
  const five = context(root, { entries: [entry("Button")], options: { componentsPerCall: 5 } });
  assert.equal((await adapter.estimate(await adapter.plan(five), five)).items[0].calls, 0.2);
});

test("estimate: a screenshot upload and an editable screen are costed apart from a component", async () => {
  const root = tempRepo();
  const image = context(root, { entries: [], screens: { mode: "listed", routes: ["/a"] } });
  const editable = context(root, { entries: [], screens: { mode: "listed", routes: ["/a"] }, options: { editableScreens: true, screensBaseUrl: "http://localhost:3000" } });
  const [imageCost] = (await adapter.estimate(await adapter.plan(image), image)).items;
  const [editableCost] = (await adapter.estimate(await adapter.plan(editable), editable)).items;
  assert.ok(imageCost.tokens < 1200 && imageCost.tokens > 0);
  assert.ok(editableCost.tokens > 1200);
});

test("write leaves code files, a manifest and a ledger, and the next plan has nothing left", async () => {
  const root = tempRepo();
  const { browser, seen } = fakeBrowser();
  const figma = createAdapter(browser);
  const ctx = context(root, { entries: [entry("Button"), entry("Card")], options: { page: "Generator test" } });
  const plan = await figma.plan(ctx);

  const result = await figma.write(plan, ctx);

  assert.deepEqual(result.written.toSorted(), ["Button", "Card"]);
  assert.deepEqual(result.failed, []);
  assert.equal(seen.closed, 1, "the browser is closed");
  assert.deepEqual(seen.requests.map((r) => [r.name, r.label, r.states, r.icons]), [["Button", "Button", [], false], ["Card", "Card", [], false]]);

  const directory = outputOf(root);
  assert.deepEqual(readdirSync(directory).toSorted(), ["figma-001.js", "manifest.json"]);
  const code = readFileSync(path.join(directory, "figma-001.js"), "utf8");
  assert.ok(code.length <= MAX_CODE_CHARS);
  const manifest = JSON.parse(readFileSync(path.join(directory, "manifest.json"), "utf8"));
  assert.equal(manifest.fileKey, KEY);
  assert.equal(manifest.release, "v1.0.0");
  assert.deepEqual(manifest.files, [{ name: "figma-001.js", chars: code.length, units: ["Button", "Card"] }]);
  assert.deepEqual(manifest.uploads, []);
  assert.equal(manifest.afterUploads, null);

  // The cost is the code's size in relay tokens: about 3.75 characters a token.
  assert.deepEqual(result.actual, { calls: 1, tokens: Math.ceil(code.length / 3.75), usd: 0 });

  const ledger = readLedger(path.join(root, ".klaus/figma/ledger.json"));
  assert.deepEqual(ledger.components, { Button: ["1.0.0"], Card: ["1.0.0"] });
  assert.deepEqual((await figma.plan(ctx)).items, [], "a written version is not planned again");

  // The code is what use_figma runs.
  const ran = await runCode(code, newFigma());
  assert.deepEqual(ran.units.map((u) => [u.id, u.status]), [["Button", "written"], ["Card", "written"]]);
});

test("a new version of a written component is planned again", async () => {
  const root = tempRepo();
  const figma = createAdapter(fakeBrowser().browser);
  await figma.write(await figma.plan(context(root)), context(root));

  const next = context(root, { entries: [entry("Button", { version: "1.1.0" })], release: "v1.1.0" });
  const plan = await figma.plan(next);
  assert.deepEqual(plan.items.map((i) => [i.id, i.version]), [["Button", "1.1.0"]]);
});

test("a component the last run left unwritten is planned again", async () => {
  const root = tempRepo();
  const figma = createAdapter(fakeBrowser().browser);
  const ctx = context(root);
  await figma.write(await figma.plan(ctx), ctx);
  assert.equal((await figma.plan(context(root, { unwritten: ["Button"] }))).items.length, 1);
});

test("a component whose capture fails is reported failed and the others are written", async () => {
  const root = tempRepo();
  const { browser } = fakeBrowser({
    capture: (request) => {
      if (request.name === "Card") throw new Error("No story found for Card.");
      return buttonCapture();
    },
  });
  const figma = createAdapter(browser);
  const ctx = context(root, { entries: [entry("Button"), entry("Card")] });
  const result = await figma.write(await figma.plan(ctx), ctx);

  assert.deepEqual(result.written, ["Button"]);
  assert.deepEqual(result.failed, [{ id: "Card", error: "No story found for Card." }]);
  assert.deepEqual(readLedger(path.join(root, ".klaus/figma/ledger.json")).components, { Button: ["1.0.0"] }, "a failed component is not recorded");
});

test("a Storybook build that cannot be opened fails every component with the reason", async () => {
  const root = tempRepo();
  const figma = createAdapter(fakeBrowser({ fail: "No static Storybook build." }).browser);
  const ctx = context(root, { entries: [entry("Button"), entry("Card")] });
  const result = await figma.write(await figma.plan(ctx), ctx);
  assert.deepEqual(result.written, []);
  assert.deepEqual(result.failed.map((f) => [f.id, f.error]), [["Button", "No static Storybook build."], ["Card", "No static Storybook build."]]);
});

test("a component too big for one call is reported failed, by name, and the rest still pack", async () => {
  const root = tempRepo();
  const figma = createAdapter(fakeBrowser().browser);
  const big = entry("Big", { purpose: { useWhen: "", notFor: "", text: "x".repeat(60000) } });
  const ctx = context(root, { entries: [big, entry("Button")] });
  const result = await figma.write(await figma.plan(ctx), ctx);
  assert.deepEqual(result.written, ["Button"]);
  assert.equal(result.failed[0].id, "Big");
  assert.match(result.failed[0].error, /more than the 50000 one call takes/);
});

test("a set with more variants than Figma should hold is refused before the browser is used", async () => {
  const root = tempRepo();
  const { browser, seen } = fakeBrowser();
  const figma = createAdapter(browser);
  const many = entry("Many", { variants: { variant: Array.from({ length: 20 }, (_, i) => `v${i}`), size: Array.from({ length: 20 }, (_, i) => `s${i}`) } });
  const ctx = context(root, { entries: [many] });
  const result = await figma.write(await figma.plan(ctx), ctx);
  assert.match(result.failed[0].error, /would have 400 variants/);
  assert.equal(seen.requests.length, 0);
});

test("states, icons and the label are passed on to the capture", async () => {
  const root = tempRepo();
  const { browser, seen } = fakeBrowser();
  const figma = createAdapter(browser);
  const ctx = context(root, { options: { states: ["loading", "disabled"], icons: true, label: false, stories: { Button: "ui-button--primary" } } });
  await figma.write(await figma.plan(ctx), ctx);
  assert.deepEqual([seen.requests[0].states, seen.requests[0].icons, seen.requests[0].label, seen.requests[0].story], [["loading", "disabled"], true, false, "ui-button--primary"]);
});

test("screenshots become an upload list, and a retention file runs after the upload", async () => {
  const root = tempRepo();
  mkdirSync(path.join(root, ".klaus/screens"), { recursive: true });
  writeFileSync(path.join(root, ".klaus/screens/settings.png"), Buffer.alloc(64));
  const figma = createAdapter(fakeBrowser().browser);
  const ctx = context(root, { entries: [], screens: { mode: "listed", routes: ["/settings", "/billing"] }, release: "v3.0.0", options: { screenVersionsKept: 5 } });

  const result = await figma.write(await figma.plan(ctx), ctx);

  assert.deepEqual(result.written, ["screen:/settings"]);
  assert.equal(result.failed[0].id, "screen:/billing");
  assert.match(result.failed[0].error, /No screenshot of \/billing/);

  const manifest = JSON.parse(readFileSync(path.join(outputOf(root, "v3.0.0"), "manifest.json"), "utf8"));
  assert.deepEqual(manifest.uploads.map((u) => [u.id, u.frame, u.page, u.image]), [["screen:/settings", "/settings v3.0.0", "Screens", ".klaus/screens/settings.png"]]);
  assert.equal(manifest.afterUploads.name, "figma-retention.js");
  assert.deepEqual(manifest.files, []);

  const retention = readFileSync(path.join(outputOf(root, "v3.0.0"), "figma-retention.js"), "utf8");
  assert.ok(/"keep":5/.test(retention) && retention.includes('"/settings"'));
  assert.deepEqual(readLedger(path.join(root, ".klaus/figma/ledger.json")).screens, { "/settings": ["v3.0.0"] });
  // The upload costs a call, and the retention file another.
  assert.equal(result.actual.calls, 2);
});

test("editable screens are captured from the running app and written as code", async () => {
  const root = tempRepo();
  const { browser, seen } = fakeBrowser();
  const figma = createAdapter(browser);
  const ctx = context(root, {
    entries: [],
    screens: { mode: "listed", routes: ["/settings"] },
    options: { editableScreens: true, screensBaseUrl: "http://localhost:3000" },
  });
  const result = await figma.write(await figma.plan(ctx), ctx);

  assert.deepEqual(result.written, ["screen:/settings"]);
  assert.equal(seen.url, "http://localhost:3000/settings");
  const ran = await runCode(readFileSync(path.join(outputOf(root), "figma-001.js"), "utf8"), newFigma(["Screens"]));
  assert.deepEqual(ran.units.map((u) => [u.id, u.status, u.name]), [["screen:/settings", "written", "/settings v1.0.0"]]);
});

test("a rerun of a release does not leave an old file behind", async () => {
  const root = tempRepo();
  const figma = createAdapter(fakeBrowser().browser);
  const stale = path.join(outputOf(root), "figma-009.js");
  mkdirSync(outputOf(root), { recursive: true });
  writeFileSync(stale, "old");
  const ctx = context(root);
  await figma.write(await figma.plan(ctx), ctx);
  assert.equal(existsSync(stale), false);
});

test("report says where the code is and links the Figma file", async () => {
  const root = tempRepo();
  const figma = createAdapter(fakeBrowser().browser);
  const ctx = context(root);
  const plan = await figma.plan(ctx);
  const result = await figma.write(plan, ctx);

  const report = await figma.report({ written: result.written, failed: [], deferred: [], dryRun: false }, ctx);
  assert.equal(report.summary, "Figma code is ready for the relay in .klaus/figma/v1.0.0: 1 in 1 code file.");
  assert.deepEqual(report.links, [{ label: "Figma file", url: `https://www.figma.com/design/${KEY}` }]);
  assert.equal(report.details.manifest, ".klaus/figma/v1.0.0/manifest.json");

  const dry = await figma.report({ written: [], failed: [], deferred: [], dryRun: true }, context(root, { dryRun: true }));
  assert.match(dry.summary, /dry run/);
});

test("the file key comes from a key or a Figma URL", () => {
  assert.equal(fileKeyOf(KEY), KEY);
  assert.equal(fileKeyOf(`https://www.figma.com/design/${KEY}/PROTOTYPE-Klaus?node-id=0-1`), KEY);
  assert.equal(fileKeyOf("not a key"), null);
  assert.equal(fileKeyOf(undefined), null);
});

test("the frame can run it: a dry run shows the estimate, and a run writes through the cap", async () => {
  const root = tempRepo();
  const figma = createAdapter(fakeBrowser().browser);
  const config = resolveConfig({ outputs: { figma: { enabled: true, target: KEY, route: "codex-relay", logins: ["codex"], options: { page: "Generator test" } } } });
  const inventory = { schemaVersion: 1, folders: [], entries: [entry("Button"), entry("Card")] };
  const args = { config, inventory, adapters: { figma }, releases: ["v1.0.0"], trigger: "manual" };
  const cwd = process.cwd();
  process.chdir(root);
  try {
    const dry = await runKlaus({ ...args, dryRun: true, env: {} });
    assert.equal(dry.report.status, "ok");
    assert.deepEqual(dry.report.outputs[0].estimated, { calls: 0.2, tokens: 2400, usd: 0 });
    assert.equal(existsSync(path.join(root, ".klaus/figma")), false, "a dry run writes nothing");

    const real = await runKlaus({ ...args, env: {} });
    assert.deepEqual(real.report.outputs[0].written.toSorted(), ["Button", "Card"]);
    assert.equal(real.report.outputs[0].failed.length, 0);
    assert.equal(real.report.outputs[0].adapter.details.files[0].name, "figma-001.js");
  } finally {
    process.chdir(cwd);
  }
});

test("the adapter does not need a model, so a model-free run does not skip it", () => {
  assert.equal(adapter.usesModel, false);
});

test("the config accepts a block of options and rejects a secret in one", () => {
  const ok = validateConfig({ outputs: { figma: { enabled: true, target: KEY, options: { page: "Generator test", states: ["loading"], icons: true, componentsPerCall: 8 } } } });
  assert.deepEqual(ok, { ok: true, errors: [] });
  const secret = validateConfig({ outputs: { figma: { enabled: true, options: { screensStorageState: "ghp_abcdefghijklmnopqrstuvwxyz0123456789" } } } });
  assert.equal(secret.ok, false);
  assert.match(secret.errors[0], /outputs\.figma\.options\.screensStorageState/);
});
