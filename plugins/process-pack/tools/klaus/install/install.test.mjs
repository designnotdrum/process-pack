/**
 * The install step: the copy with its version line, the cost estimate taken from
 * the adapters, and the rendered workflow.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveConfig } from "../frame/config.mjs";
import { copyKlaus, listFiles, SOURCE_ROOT, versionLine } from "./copy.mjs";
import { estimateOutputs, formatCosts } from "./costs.mjs";
import { lintWorkflow, renderWorkflow, writeWorkflow } from "./workflow.mjs";

const tempDir = () => mkdtempSync(path.join(tmpdir(), "klaus-install-"));
const write = (file, text) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
};

const CONFIG = {
  outputs: {
    storybook: { enabled: true, target: "acme-storybook", secrets: ["VERCEL_TOKEN", "VERCEL_ORG_ID"] },
    figma: { enabled: true, target: "AbCdEfGhIjKlMnOpQrStUv", route: "codex-relay", logins: ["codex"] },
    penpot: { enabled: false },
  },
  inventory: { folders: ["packages/ui/src"] },
  selection: { componentGroups: ["packages/ui/src"], screens: { mode: "none" }, newComponents: { rule: "all" } },
  trigger: { mode: "release", tagPattern: "v*" },
};

const TEMPLATE = readFileSync(path.join(SOURCE_ROOT, "templates", "klaus.yml"), "utf8");
const render = (config, options = {}) => renderWorkflow({ template: TEMPLATE, config: resolveConfig(config), install: "pnpm install --frozen-lockfile", storybookBuild: "pnpm build-storybook -o storybook-static", ...options });

/** A repo with a Storybook folder and an inventory of three components. */
function sampleRepo() {
  const repo = tempDir();
  mkdirSync(path.join(repo, ".storybook"));
  write(path.join(repo, "klaus.config.json"), JSON.stringify(CONFIG));
  const entry = (name, usedIn, variants = {}) => ({ name, file: `packages/ui/src/${name.toLowerCase()}.tsx`, folder: "packages/ui/src", kind: "shared", variants, version: "", screenshot: "", usedIn });
  write(path.join(repo, "inventory.json"), JSON.stringify({
    schemaVersion: 1,
    entries: [
      entry("Button", ["a.tsx", "b.tsx", "c.tsx"], { variant: ["default", "outline", "ghost"], size: ["sm", "md"] }),
      entry("Badge", ["a.tsx"], { tone: ["info", "warn"] }),
      entry("Card", ["a.tsx", "b.tsx"]),
    ],
  }));
  return repo;
}

test("copy leaves out tests, fixtures and the lockfile, keeps what runs, and writes a version line", () => {
  const repo = tempDir();
  const result = copyKlaus({ repo });
  const files = listFiles(path.join(repo, "scripts/klaus"), { filter: false });
  assert.ok(files.includes("frame/cli.mjs"));
  assert.ok(files.includes("inventory/inventory.mjs"));
  assert.ok(files.includes("version/version.mjs"));
  assert.ok(files.includes("adapters/figma/plugin/manifest.json"));
  assert.ok(files.includes("adapters/figma/plugin/code.js"));
  assert.ok(files.includes("klaus.config.schema.json"));
  assert.equal(files.filter((f) => /(^|\/)(tests?|fixtures|templates|install|node_modules)\//.test(f) || /\.test\.mjs$|package\.json$|pnpm-lock/.test(f)).length, 0);
  const version = readFileSync(path.join(repo, "scripts/klaus/VERSION.txt"), "utf8");
  assert.match(version, /^klaus \S+ from process-pack \S+, files [0-9a-f]{12}\n$/);
  assert.equal(version.trim(), result.line);
  assert.equal(version.trim(), versionLine());
});

test("copy a second time changes nothing, and refuses to overwrite an edited copy", () => {
  const repo = tempDir();
  copyKlaus({ repo });
  const again = copyKlaus({ repo });
  assert.deepEqual([again.added, again.changed, again.removed], [[], [], []]);

  write(path.join(repo, "scripts/klaus/frame/cli.mjs"), "// edited by hand\n");
  assert.throws(() => copyKlaus({ repo }), /edited after it was copied/);
  const forced = copyKlaus({ repo, force: true });
  assert.deepEqual(forced.changed, ["frame/cli.mjs"]);
});

test("copy removes a file the new copy no longer has, and refuses a folder it did not make", () => {
  const repo = tempDir();
  copyKlaus({ repo });
  const stale = path.join(repo, "scripts/klaus/old.mjs");
  write(stale, "export {};\n");
  assert.throws(() => copyKlaus({ repo }), /edited after it was copied/);
  assert.deepEqual(copyKlaus({ repo, force: true }).removed, ["old.mjs"]);
  assert.equal(existsSync(stale), false);

  const other = tempDir();
  write(path.join(other, "scripts/klaus/mine.txt"), "mine\n");
  assert.throws(() => copyKlaus({ repo: other }), /Klaus did not put them there/);
  assert.throws(() => copyKlaus({ repo: other, to: "../outside" }), /not inside the repo/);
});

test("the installed copy runs: the config check passes on a valid file and fails on a secret", () => {
  const repo = sampleRepo();
  copyKlaus({ repo });
  const run = () => spawnSync(process.execPath, ["scripts/klaus/frame/cli.mjs", "validate"], { cwd: repo, encoding: "utf8" });
  assert.equal(run().status, 0);
  write(path.join(repo, "klaus.config.json"), JSON.stringify({ outputs: { storybook: { enabled: true, target: ["gh", "p_", "a1B2c3D4".repeat(5)].join("") } } }));
  assert.equal(run().status, 2);
});

test("costs come from the adapters' estimates and follow the cap", async () => {
  const repo = sampleRepo();
  const options = { repo, config: path.join(repo, "klaus.config.json"), inventory: path.join(repo, "inventory.json") };
  const [storybook, figma, penpot] = await estimateOutputs({ ...options, outputs: ["storybook", "figma", "penpot"] });

  const sb = await import(pathToFileURL(path.join(SOURCE_ROOT, "adapters/storybook/index.mjs")).href);
  assert.equal(storybook.items.length, 1);
  assert.equal(storybook.items[0].usd, (sb.ASSUMED_BUILD_BYTES / 1e9) * sb.STORAGE_USD_PER_GB_MONTH);

  const settings = await import(pathToFileURL(path.join(SOURCE_ROOT, "adapters/figma/settings.mjs")).href);
  assert.deepEqual(figma.items.map((item) => item.id).sort(), ["Badge", "Button", "Card"]);
  for (const item of figma.items) assert.ok(item.tokens > settings.CALL_BASE_TOKENS, `${item.id} costs more than the call itself`);
  const button = figma.items.find((item) => item.id === "Button");
  const badge = figma.items.find((item) => item.id === "Badge");
  assert.ok(button.tokens > badge.tokens, "a component with more variants costs more");
  assert.equal(figma.allowed.length, 3);
  assert.equal(figma.estimatedUncapped.tokens, figma.items.reduce((sum, item) => sum + item.tokens, 0));

  assert.equal(penpot.adapter, false);

  // A cap that fits two of the three versions defers the least-used one.
  write(options.config, JSON.stringify({ ...CONFIG, spendingCap: { maxRelayTokens: button.tokens + badge.tokens + 10 } }));
  const [, capped] = await estimateOutputs({ ...options, outputs: ["storybook", "figma"] });
  assert.deepEqual(capped.allowed, ["Button", "Card"].filter((id) => capped.allowed.includes(id)));
  assert.equal(capped.allowed.length + capped.deferred.length, 3);
  assert.ok(capped.deferred.length >= 1);
});

test("the cost text has a block for every output and shows the onboarding run", async () => {
  const repo = sampleRepo();
  const results = await estimateOutputs({ repo, config: path.join(repo, "klaus.config.json"), inventory: path.join(repo, "inventory.json") });
  const text = await formatCosts(results);
  for (const name of ["Storybook", "Figma", "Penpot", "Pencil"]) assert.match(text, new RegExp(`^${name}$`, "m"));
  assert.match(text, /Through the plugin: 0 relay tokens/);
  assert.match(text, /Each release: 2 Vercel calls/);
  assert.match(text, /no adapter yet/);
  assert.equal(text.includes(String.fromCharCode(0x2014)), false, "no em dash in the cost text");

  const enabledOnly = await estimateOutputs({ repo, config: path.join(repo, "klaus.config.json"), inventory: path.join(repo, "inventory.json"), onlyEnabled: true });
  assert.deepEqual(enabledOnly.map((r) => r.output), ["storybook", "figma"]);
});

test("an output that cannot be planned says why", async () => {
  const repo = sampleRepo();
  const noStorybook = tempDir();
  write(path.join(noStorybook, "klaus.config.json"), JSON.stringify(CONFIG));
  write(path.join(noStorybook, "inventory.json"), readFileSync(path.join(repo, "inventory.json"), "utf8"));
  const [storybook] = await estimateOutputs({ repo: noStorybook, config: path.join(noStorybook, "klaus.config.json"), inventory: path.join(noStorybook, "inventory.json"), outputs: ["storybook"] });
  assert.match(storybook.error, /No \.storybook folder/);
  assert.match(await formatCosts([storybook]), /No estimate: No \.storybook folder/);
});

test("the workflow keeps one trigger, the repo's install, the secrets and the Figma parts", () => {
  const { text, kept, secrets } = render(CONFIG);
  assert.deepEqual(kept.sort(), ["figma-artifact", "figma-build", "release"]);
  assert.deepEqual(secrets, ["VERCEL_TOKEN", "VERCEL_ORG_ID"]);
  assert.match(text, /^ {2}push:\n {4}tags:\n {6}- "v\*"$/m);
  assert.doesNotMatch(text, /schedule:/);
  assert.match(text, /- name: Install the repo's dependencies\n {8}run: "pnpm install --frozen-lockfile"/);
  assert.match(text, /VERCEL_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN \}\}\n {10}VERCEL_ORG_ID: \$\{\{ secrets\.VERCEL_ORG_ID \}\}/);
  assert.match(text, /INVENTORY_FOLDERS: "packages\/ui\/src"/);
  assert.match(text, /run: "pnpm build-storybook -o storybook-static"/);
  assert.match(text, /\.klaus\/inventory\.versioned\.json/);
  assert.match(text, /\.klaus\/figma\/ledger\.json/);
  assert.match(text, /path: \.klaus\/figma\//);
  assert.doesNotMatch(text, /# klaus:/);
});

test("state is kept in an artifact, not the Actions cache, and every upload includes hidden files", () => {
  const { text } = render(CONFIG);
  // A tag run cannot restore a cache made for another tag (GitHub's caching reference, read 2026-10-19).
  assert.doesNotMatch(text, /actions\/cache/);
  assert.match(text, /permissions:\n {2}contents: read\n {2}actions: read/);
  assert.match(text, /name: klaus-state\n/);
  assert.match(text, /gh run download "\$run_id" --name klaus-state --dir \.klaus/);
  // Everything under .klaus is hidden to upload-artifact, which skips hidden files unless told not to.
  const uploads = text.match(/uses: actions\/upload-artifact@/g).length;
  assert.equal(text.match(/include-hidden-files: true/g).length, uploads);
  assert.equal(uploads, 3);
});

test("the Figma artifact is named the way the relay downloads it", () => {
  const relay = readFileSync(path.join(SOURCE_ROOT, "adapters/figma/relay/relay.mjs"), "utf8");
  const expected = /DEFAULT_ARTIFACT = "([^"]+)"/.exec(relay)?.[1];
  assert.ok(expected, "relay.mjs names a default artifact");
  assert.match(render(CONFIG).text, new RegExp(`name: ${expected}\\n`));
});

test("without Figma the workflow has no Storybook build, browser or Figma artifact", () => {
  const config = { ...CONFIG, outputs: { storybook: CONFIG.outputs.storybook, figma: { enabled: false } } };
  const { text, kept } = render(config, { storybookBuild: undefined });
  assert.deepEqual(kept, ["release"]);
  assert.doesNotMatch(text, /playwright install|build-storybook|name: klaus-figma/);
});

test("a schedule keeps the cron and drops the tag trigger; a captures file is passed on", () => {
  const { text } = render({ ...CONFIG, trigger: { mode: "schedule", cron: "30 5 * * 2" } }, { captures: ".klaus/captures.json" });
  assert.match(text, /- cron: "30 5 \* \* 2"/);
  assert.doesNotMatch(text, /push:/);
  assert.match(text, /CAPTURES: "\.klaus\/captures\.json"/);
  assert.match(text, /Put the step that writes the captures file/);
});

test("the install can be steps copied from the repo's workflow, with corepack first", () => {
  const dir = tempDir();
  write(path.join(dir, "steps.yml"), "- uses: pnpm/action-setup@aaaa # v4\n- run: pnpm install --frozen-lockfile\n");
  const { text } = render(CONFIG, { install: undefined, installSteps: path.join(dir, "steps.yml") });
  assert.match(text, /# The repo's own install steps, from steps\.yml\.\n {6}- uses: pnpm\/action-setup@aaaa # v4\n {6}- run: pnpm install --frozen-lockfile/);
  const withCorepack = render(CONFIG, { corepack: true, install: "npm ci" }).text;
  assert.match(withCorepack, /- name: Enable corepack\n {8}run: "corepack enable"\n {6}- name: Install the repo's dependencies\n {8}run: "npm ci"/);
});

test("the workflow refuses to render without the repo's install, or Figma without a Storybook build", () => {
  assert.throws(() => render(CONFIG, { install: undefined }), /--install/);
  assert.throws(() => render(CONFIG, { storybookBuild: undefined }), /--storybook-build/);
  assert.throws(() => render({ ...CONFIG, inventory: { folders: [] } }), /inventory\.folders/);
});

test("a written workflow passes actionlint when it is installed", (t) => {
  const repo = sampleRepo();
  const result = writeWorkflow({ repo, install: "pnpm install --frozen-lockfile", storybookBuild: "pnpm build-storybook -o storybook-static" });
  assert.equal(result.destination, path.join(repo, ".github/workflows/klaus.yml"));
  if (result.lint.tool !== "actionlint") t.skip(`actionlint is not installed (${result.lint.tool} ran instead)`);
  assert.equal(result.lint.ok, true, result.lint.message);
  assert.equal(lintWorkflow(result.destination).ok, true);
});
