/**
 * The install step: the copy with its version line, the cost estimate taken from
 * the adapters, and the rendered workflow.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveConfig } from "../frame/config.mjs";
import { checkState } from "../ci/check-state.mjs";
import { copyKlaus, listFiles, SOURCE_ROOT, versionLine } from "./copy.mjs";
import { estimateOutputs, formatCosts } from "./costs.mjs";
import { checkEnvironment, checkSecrets, createEnvironment, DEFAULT_ENVIRONMENT, ENVIRONMENT_DOCS, environmentBody, secretsAdvice } from "./environment.mjs";
import { assertReleasePattern, assess, checkRuleset, createRuleset, explainRuleset, parseActor, PATTERN_DOCS, protects, rulesetBody, RULESET_NAME } from "./ruleset.mjs";
import { lintWorkflow, renderWorkflow, requireEnvironment, requireTagRuleset, writeWorkflow } from "./workflow.mjs";

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

test("a .DS_Store in the copy is not an edit, and is never copied", () => {
  const repo = tempDir();
  copyKlaus({ repo });
  write(path.join(repo, "scripts/klaus/frame/.DS_Store"), "finder");
  const again = copyKlaus({ repo });
  assert.deepEqual([again.added, again.changed, again.removed], [[], [], []]);
  assert.equal(listFiles(SOURCE_ROOT).some((file) => file.endsWith(".DS_Store")), false);
});

test("copy removes a file the new copy no longer has, and refuses a folder it did not make", () => {
  const repo = tempDir();
  copyKlaus({ repo });
  const stale = path.join(repo, "scripts/klaus/old.mjs");
  write(stale, "export {};\n");
  assert.throws(() => copyKlaus({ repo }), /edited after it was copied/);
  assert.deepEqual(copyKlaus({ repo, force: true }).removed, ["old.mjs"]);
  assert.equal(existsSync(stale), false);

  write(path.join(repo, "scripts/klaus/old-layout/deep/gone.mjs"), "export {};\n");
  assert.deepEqual(copyKlaus({ repo, force: true }).removed, ["old-layout/deep/gone.mjs"]);
  assert.equal(existsSync(path.join(repo, "scripts/klaus/old-layout")), false, "the emptied folders are removed");

  const other = tempDir();
  write(path.join(other, "scripts/klaus/mine.txt"), "mine\n");
  assert.throws(() => copyKlaus({ repo: other }), /Klaus did not put them there/);
  assert.throws(() => copyKlaus({ repo: other, to: "../outside" }), /not inside the repo/);
  assert.equal(copyKlaus({ repo: tempDir(), to: "..tools/klaus" }).destination.endsWith("..tools/klaus"), true);
});

test("the installed copy runs: the config check passes on a valid file and fails on a secret", () => {
  const repo = sampleRepo();
  copyKlaus({ repo });
  const run = () => {
    const result = spawnSync(process.execPath, ["scripts/klaus/frame/cli.mjs", "validate"], { cwd: repo, encoding: "utf8" });
    assert.equal(result.error, undefined, `could not start the installed copy: ${result.error}`);
    return result;
  };
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
  // The cap ranks by usage (Button 3 files, Card 2, Badge 1), so Badge is the one that waits.
  assert.deepEqual(capped.deferred.map((item) => item.id), ["Badge"]);
  assert.deepEqual(capped.allowed, ["Button", "Card"]);
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
  assert.match(text, /gh run download "\$run_id" --name klaus-state --dir "\$dir"/);
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

test("the job names the secrets environment when one is set, in both modes, and names none otherwise", () => {
  for (const trigger of [{ mode: "release", tagPattern: "v*" }, { mode: "schedule", cron: "0 6 * * 1" }]) {
    const { text, kept } = render({ ...CONFIG, trigger: { ...trigger, secretsEnvironment: "klaus-release" } });
    assert.ok(kept.includes("environment"));
    assert.match(text, /^jobs:\n {2}klaus:\n {4}runs-on: ubuntu-latest\n(?: {4}#.*\n)+ {4}environment:\n {6}name: "klaus-release"\n {6}deployment: false\n {4}timeout-minutes: 30\n {4}steps:$/m);
    assert.equal(text.match(/^\s*environment:/gm).length, 1, "the environment is on the job, once");
    assert.doesNotMatch(text, /# klaus:/);
  }
  assert.match(render({ ...CONFIG, trigger: { mode: "release", tagPattern: "v*", secretsEnvironment: "acme.klaus_2" } }).text, /name: "acme\.klaus_2"/);

  const without = render(CONFIG);
  assert.equal(without.kept.includes("environment"), false);
  assert.doesNotMatch(without.text, /^\s*environment:|deployment: false/m);
  // The comment above the job does not claim an environment that is not there.
  assert.doesNotMatch(without.text, /secrets are kept in this environment/);

  for (const bad of ["", " ", "a b", "-x", ".x", "../x", "a/b", "x".repeat(65), "\"quoted\"", "a\nb"]) {
    assert.throws(() => resolveConfig({ ...CONFIG, trigger: { mode: "release", tagPattern: "v*", secretsEnvironment: bad } }), /secretsEnvironment: must be an environment name/, JSON.stringify(bad));
  }
});

test("the template and a workflow rendered with the environment pass actionlint when it is installed", (t) => {
  const probe = spawnSync("actionlint", ["--version"], { encoding: "utf8" });
  if (probe.error) t.skip("actionlint is not installed");
  const template = lintWorkflow(path.join(SOURCE_ROOT, "templates", "klaus.yml"));
  assert.equal(template.tool, "actionlint");
  assert.equal(template.ok, true, template.message);

  const repo = sampleRepo();
  write(path.join(repo, "klaus.config.json"), JSON.stringify({ ...CONFIG, trigger: { mode: "release", tagPattern: "v*", secretsEnvironment: "klaus-release" } }));
  const result = writeWorkflow({
    repo,
    install: "pnpm install --frozen-lockfile",
    storybookBuild: "pnpm build-storybook -o storybook-static",
    checkTags: () => ({ status: "protected", rulesets: [{ id: 1, name: RULESET_NAME }] }),
    checkEnv: () => ({ status: "ok", defaultBranch: "main" }),
  });
  assert.match(readFileSync(result.destination, "utf8"), /environment:\n {6}name: "klaus-release"/);
  assert.equal(result.lint.tool, "actionlint");
  assert.equal(result.lint.ok, true, result.lint.message);
});

test("a written workflow passes actionlint when it is installed", (t) => {
  const repo = sampleRepo();
  const result = writeWorkflow({ repo, install: "pnpm install --frozen-lockfile", storybookBuild: "pnpm build-storybook -o storybook-static", checkTags: () => ({ status: "protected", rulesets: [{ id: 1, name: RULESET_NAME }] }) });
  assert.equal(result.destination, path.join(repo, ".github/workflows/klaus.yml"));
  assert.ok(readFileSync(result.destination, "utf8").length > 0, "the workflow was written");
  if (result.lint.tool !== "actionlint") t.skip(`actionlint is not installed (${result.lint.tool} ran instead)`);
  assert.equal(result.lint.ok, true, result.lint.message);
  assert.equal(lintWorkflow(result.destination).ok, true);
});

test("a workflow that does not parse is reported as a failure, not as unchecked", (t) => {
  const file = path.join(tempDir(), "bad.yml");
  write(file, "on: [\n  push\njobs: {\n");
  const result = lintWorkflow(file);
  if (result.ok === null) t.skip("no workflow checker is installed");
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------------------------
// Where code that is not on the default branch could get the deploy token.
// ---------------------------------------------------------------------------------------------

/** The steps of a rendered workflow, in order, as { name, text }. A step starts at six spaces and a dash. */
function stepsOf(text) {
  const lines = text.slice(text.indexOf("    steps:\n")).split("\n");
  const steps = [];
  let current = null;
  for (const line of lines) {
    if (/^ {6}- /.test(line)) {
      current = { name: /^ {6}- name: (.*)$/.exec(line)?.[1] ?? line.trim(), lines: [line] };
      steps.push(current);
    } else if (current && (/^ {6}#/.test(line) || /^\S/.test(line))) {
      current = null;
    } else if (current) {
      current.lines.push(line);
    }
  }
  return steps.map((step) => ({ name: step.name, text: step.lines.join("\n") }));
}

/** The shell text and the plain env values of one step, as the runner would give them. */
function shellOf(workflow, name) {
  const step = stepsOf(workflow).find((candidate) => candidate.name === name);
  assert.ok(step, `a step named ${name}`);
  const lines = step.text.split("\n");
  const env = {};
  const envAt = lines.findIndex((line) => /^ {8}env:$/.test(line));
  if (envAt >= 0) {
    for (const line of lines.slice(envAt + 1)) {
      const entry = /^ {10}([A-Z_]+): (.*)$/.exec(line);
      if (!entry) break;
      env[entry[1]] = entry[2].replace(/^"(.*)"$/, "$1").replace(/\s+#.*$/, "");
    }
  }
  const runAt = lines.findIndex((line) => /^ {8}run: \|$/.test(line));
  assert.ok(runAt >= 0, `${name} has a shell block`);
  const body = [];
  for (const line of lines.slice(runAt + 1)) {
    if (line !== "" && !line.startsWith(" ".repeat(10))) break;
    body.push(line.slice(10));
  }
  return { env, run: body.join("\n") };
}

const GUARD = "Refuse a commit that is not on the default branch";
const PICK = "Build the inventory and pick versions, one release at a time";

test("both modes refuse a commit and a tag that are not on the default branch, before anything from the repo runs", () => {
  for (const mode of [{ mode: "release", tagPattern: "v*" }, { mode: "schedule", cron: "0 6 * * 1" }]) {
    const { text } = render({ ...CONFIG, trigger: mode });
    const names = stepsOf(text).map((step) => step.name);
    // The checkout, then the check, then setup-node and the repo's install.
    assert.match(names[0], /actions\/checkout/);
    assert.equal(names[1], GUARD, `${mode.mode}: the check is the first step after the checkout`);
    assert.ok(names.indexOf(GUARD) < names.findIndex((name) => /setup-node/.test(name)));
    assert.ok(names.indexOf(GUARD) < names.indexOf("Install the repo's dependencies"));
    assert.match(shellOf(text, GUARD).run, /git merge-base --is-ancestor HEAD "refs\/remotes\/origin\/\$default"/);
    // The picker checks each tag too, drops the ones that fail, and stops when none is left.
    const pick = shellOf(text, PICK).run;
    assert.match(pick, /git merge-base --is-ancestor "refs\/tags\/\$tag\^\{commit\}" "refs\/remotes\/origin\/\$KLAUS_DEFAULT_BRANCH"/);
    assert.match(pick, /git tag -d "\$tag"/);
    assert.match(pick, /proceed=false/);
    // Everything that builds or deploys waits for the picker to say there is a release.
    for (const name of ["Build Storybook for the Figma output", "Run Klaus"]) {
      assert.match(stepsOf(text).find((step) => step.name === name).text, /if: steps\.pick\.outputs\.proceed == 'true'/);
    }
  }
});

test("release mode says that only a tag ruleset protects it, and schedule mode does not", () => {
  const release = render(CONFIG).text;
  assert.match(release, /Without that ruleset, use the schedule/);
  assert.match(release, /repository\s+# ruleset that lets only maintainers create, update or delete tags/);
  assert.doesNotMatch(render({ ...CONFIG, trigger: { mode: "schedule", cron: "0 6 * * 1" } }).text, /Without that ruleset/);
});

test("the Vercel token and every other secret are on the deploy step alone", () => {
  const config = { ...CONFIG, outputs: { ...CONFIG.outputs, storybook: { enabled: true, target: "acme-storybook", secrets: ["VERCEL_TOKEN", "VERCEL_ORG_ID"] } } };
  for (const mode of [{ mode: "release", tagPattern: "v*" }, { mode: "schedule", cron: "0 6 * * 1" }]) {
    const { text } = render({ ...config, trigger: mode });
    assert.doesNotMatch(text, /^env:/m, "no workflow-level env");
    assert.doesNotMatch(text, /^ {4}env:/m, "no job-level env");
    const holders = stepsOf(text).filter((step) => /secrets\.(?!GITHUB_TOKEN)/.test(step.text));
    assert.deepEqual(holders.map((step) => step.name), ["Run Klaus"]);
    assert.equal(text.match(/secrets\.VERCEL_TOKEN/g).length, 1);
    assert.equal(text.match(/secrets\.VERCEL_ORG_ID/g).length, 1);
    for (const step of stepsOf(text).filter((candidate) => /^(Install|Build Storybook|Enable corepack)/.test(candidate.name))) {
      assert.doesNotMatch(step.text, /secrets\./, `${step.name} has no secret`);
      assert.doesNotMatch(step.text, /GH_TOKEN|github\.token/, `${step.name} has no GitHub token`);
    }
  }
});

/** A scratch git repo shaped like a Klaus checkout: main with tags, a remote-tracking main, and a branch that is not merged. */
function gitRepo({ mainTags = ["v1.0.0", "v1.1.0"], unmerged = ["v2.0.0"] } = {}) {
  const repo = tempDir();
  const git = (...args) => {
    const result = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", ...args], { cwd: repo, encoding: "utf8" });
    assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  git("init", "-q", "-b", "main");
  write(path.join(repo, "a.txt"), "0\n");
  git("add", "-A");
  git("commit", "-q", "-m", "start");
  mainTags.forEach((tag, i) => {
    write(path.join(repo, "a.txt"), `${i + 1}\n`);
    git("commit", "-q", "-am", `release ${tag}`);
    git("tag", "-a", tag, "-m", tag);
  });
  git("update-ref", "refs/remotes/origin/main", "main");
  git("checkout", "-q", "-b", "feature/exfil", "main");
  for (const tag of unmerged) {
    git("commit", "-q", "--allow-empty", "-m", `unmerged ${tag}`);
    git("tag", "-a", tag, "-m", tag);
  }
  git("checkout", "-q", "main");
  return { repo, git };
}

/** Stand-ins for the two scripts the picker runs, so the shell logic is tested without TypeScript. */
function stubKlaus() {
  const dir = tempDir();
  write(path.join(dir, "inventory/inventory.mjs"), 'import fs from "node:fs"; fs.writeFileSync("inventory.json", JSON.stringify({ entries: [] }));\n');
  write(path.join(dir, "version/version.mjs"), 'import fs from "node:fs"; const i = process.argv.indexOf("--release"); const inv = JSON.parse(fs.readFileSync("inventory.json", "utf8")); inv.versioned = { release: process.argv[i + 1] }; fs.writeFileSync("inventory.json", JSON.stringify(inv)); console.log("picked for " + process.argv[i + 1]);\n');
  return dir;
}

function runStep(workflow, name, { repo, event, tag = "", extraEnv = {} }) {
  const { env, run } = shellOf(workflow, name);
  const work = tempDir();
  const files = { GITHUB_ENV: path.join(work, "env"), GITHUB_OUTPUT: path.join(work, "out") };
  for (const file of Object.values(files)) writeFileSync(file, "");
  const result = spawnSync("bash", ["-e", "-c", run], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, ...env, ...files, EVENT: event, TAG: tag, DEFAULT_BRANCH: "main", GITHUB_REPOSITORY: "acme/sample", RUNNER_TEMP: work, ...extraEnv },
  });
  const read = (file) => Object.fromEntries(readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => line.split(/=(.*)/s).slice(0, 2)));
  return { status: result.status, output: result.stdout + result.stderr, setEnv: read(files.GITHUB_ENV), outputs: read(files.GITHUB_OUTPUT) };
}

test("a scheduled run ignores a newer tag on an unmerged branch and builds the newest tag that is on main", () => {
  const { repo, git } = gitRepo();
  const { text } = render({ ...CONFIG, trigger: { mode: "schedule", cron: "0 6 * * 1" } });
  const klaus = stubKlaus();
  const guard = runStep(text, GUARD, { repo, event: "schedule" });
  assert.equal(guard.status, 0, guard.output);
  assert.equal(guard.setEnv.KLAUS_DEFAULT_BRANCH, "main");

  const pick = runStep(text, PICK, { repo, event: "schedule", extraEnv: { KLAUS: klaus, KLAUS_DEFAULT_BRANCH: "main" } });
  assert.equal(pick.status, 0, pick.output);
  assert.match(pick.output, /::warning::Ignoring tags whose commit is not on main: v2\.0\.0/);
  assert.equal(pick.outputs.proceed, "true");
  assert.equal(git("describe", "--tags", "--exact-match", "HEAD"), "v1.1.0", "the checkout is the newest tag that is on main");
  assert.equal(git("tag", "--list", "v*").split("\n").includes("v2.0.0"), false, "the unmerged tag is gone from the runner's clone");
  assert.match(pick.output, /picked for v1\.1\.0/);
  assert.doesNotMatch(pick.output, /v2\.0\.0.*picked|picked for v2/);
});

test("a scheduled run stops with a plain message when every matching tag is on an unmerged branch", () => {
  const { repo } = gitRepo({ mainTags: [], unmerged: ["v3.0.0"] });
  const { text } = render({ ...CONFIG, trigger: { mode: "schedule", cron: "0 6 * * 1" } });
  const pick = runStep(text, PICK, { repo, event: "schedule", extraEnv: { KLAUS: stubKlaus(), KLAUS_DEFAULT_BRANCH: "main" } });
  assert.equal(pick.status, 0, pick.output);
  assert.equal(pick.outputs.proceed, "false");
  assert.match(pick.output, /::notice::No tag matching v\* is on main, so there is no release to write\. Ignored: v3\.0\.0/);
  assert.doesNotMatch(pick.output, /picked for/);
});

test("a pushed tag on an unmerged branch is refused by the first step, and by the picker if the first step is missing", () => {
  const { repo, git } = gitRepo();
  const { text } = render(CONFIG);
  git("checkout", "-q", "--detach", "refs/tags/v2.0.0");
  const guard = runStep(text, GUARD, { repo, event: "push", tag: "v2.0.0" });
  assert.notEqual(guard.status, 0);
  assert.match(guard.output, /is not on main, so Klaus will not build it/);

  const pick = runStep(text, PICK, { repo, event: "push", tag: "v2.0.0", extraEnv: { KLAUS: stubKlaus(), KLAUS_DEFAULT_BRANCH: "main" } });
  assert.notEqual(pick.status, 0);
  assert.match(pick.output, /::error::Refusing v2\.0\.0/);
  assert.equal(pick.outputs.proceed, undefined);
});

test("a run started from a branch that is not on main is refused, and a tag on main passes", () => {
  const { repo, git } = gitRepo();
  const { text } = render(CONFIG);
  git("checkout", "-q", "feature/exfil");
  assert.notEqual(runStep(text, GUARD, { repo, event: "workflow_dispatch" }).status, 0);
  git("checkout", "-q", "--detach", "refs/tags/v1.1.0");
  assert.equal(runStep(text, GUARD, { repo, event: "push", tag: "v1.1.0" }).status, 0);
  // Without the remote-tracking branch the run cannot tell, so it fails closed.
  git("update-ref", "-d", "refs/remotes/origin/main");
  const missing = runStep(text, GUARD, { repo, event: "push", tag: "v1.1.0" });
  assert.notEqual(missing.status, 0);
  assert.match(missing.output, /was not fetched/);
});

// ---------------------------------------------------------------------------------------------
// The tag ruleset release mode needs.
// ---------------------------------------------------------------------------------------------

const ADMIN = { actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" };
const WRITE_ROLE = { actor_id: 4, actor_type: "RepositoryRole", bypass_mode: "always" };
const RELEASE_BOT = { actor_id: 123, actor_type: "Integration", bypass_mode: "always" };
const TAG_RULESET = {
  id: 41,
  name: "release tags",
  target: "tag",
  enforcement: "active",
  bypass_actors: [ADMIN],
  conditions: { ref_name: { include: ["refs/tags/v*"], exclude: [] } },
  rules: [{ type: "creation" }, { type: "update" }, { type: "deletion" }],
  _links: { html: { href: "https://github.com/acme/sample/rules/41" } },
};
const APPROVED_BOT = { type: "Integration", id: 123, name: "release-bot" };

test("the ruleset to create limits creating, updating and deleting the release tags, with admins let through", () => {
  const body = rulesetBody({ tagPattern: "v*", apps: [{ id: 123, name: "release-bot" }], teams: [{ id: 9, name: "releasers" }] });
  assert.equal(body.target, "tag");
  assert.equal(body.enforcement, "active");
  assert.deepEqual(body.conditions.ref_name, { include: ["refs/tags/v*"], exclude: [] });
  assert.deepEqual(body.rules, [{ type: "creation" }, { type: "update" }, { type: "deletion" }]);
  assert.deepEqual(body.bypass_actors, [ADMIN, RELEASE_BOT, { actor_id: 9, actor_type: "Team", bypass_mode: "always" }]);
  assert.throws(() => rulesetBody({ tagPattern: "v*", apps: [{ id: "abc", name: "x" }] }), /not an id/);
  const words = explainRuleset(body, new Map([["Integration:123", "release-bot"]]));
  assert.match(words, /Why: a pushed tag runs the workflow file from the tagged commit/);
  assert.match(words, /repository admins, app 123 \(release-bot\), team 9/);
  assert.match(words, /can create, update or delete tags matching refs\/tags\/v\*/);
  assert.match(words, /Who it blocks: everyone not listed, including any workflow that makes release tags today/);
});

test("actors are read as Type:id:name or id:name, and need an id and a name", () => {
  assert.deepEqual(parseActor("Integration:123:release-bot"), APPROVED_BOT);
  assert.deepEqual(parseActor("123:release bot: v2", "Integration"), { type: "Integration", id: 123, name: "release bot: v2" });
  assert.throws(() => parseActor("Integration:123"), /give the name/);
  assert.throws(() => parseActor("Integration:abc:x"), /whole number/);
  assert.throws(() => parseActor("Robot:1:x"), /not an actor type/);
});

test("a ruleset with only admins as bypass actors protects the tags, and one with a write-role actor does not", () => {
  assert.equal(protects(TAG_RULESET, "v*"), true);
  const writeRole = { ...TAG_RULESET, bypass_actors: [ADMIN, WRITE_ROLE] };
  assert.equal(protects(writeRole, "v*"), false);
  const result = assess({ rulesets: [writeRole], tagPattern: "v*" });
  assert.equal(result.status, "unapproved");
  assert.deepEqual(result.unapproved.map((entry) => entry.actor), [{ type: "RepositoryRole", id: 4, mode: "always" }]);
  assert.equal(result.unapproved[0].ruleset.url, "https://github.com/acme/sample/rules/41");
  // Approving it by name is a choice the person can make, and the list is what a later render checks.
  assert.equal(protects(writeRole, "v*", [{ type: "RepositoryRole", id: 4, name: "write" }]), true);
  // An approval is for one actor, not for a type.
  assert.equal(protects({ ...TAG_RULESET, bypass_actors: [ADMIN, { ...RELEASE_BOT, actor_id: 124 }] }, "v*", [APPROVED_BOT]), false);
});

test("only a ruleset of one exact shape is accepted", () => {
  const exact = (patch) => ({ ...TAG_RULESET, ...patch });
  const include = (...entries) => ({ ref_name: { include: entries, exclude: [] } });
  // The shapes that count: the release pattern, or all tags as ~ALL.
  assert.equal(protects(TAG_RULESET, "v*"), true);
  assert.equal(protects(exact({ conditions: include("~ALL") }), "v*"), true);
  assert.equal(protects(exact({ conditions: include("refs/tags/v*", "~ALL") }), "v*"), true);
  assert.equal(protects(exact({ rules: [{ type: "creation" }, { type: "update" }, { type: "deletion" }, { type: "non_fast_forward" }] }), "v*"), true, "extra rules only add to it");
  assert.equal(protects(exact({ conditions: { ref_name: { include: ["refs/tags/v*"] } } }), "v*"), true, "no exclude list is an empty one");

  // Any exclusion is refused, a partial one too: it leaves the tags it names open.
  for (const excluded of [["refs/tags/v1*"], ["refs/tags/v*"], ["refs/tags/v1.2.3"], ["~ALL"], ["refs/tags/**"]]) {
    assert.equal(protects(exact({ conditions: { ref_name: { include: ["refs/tags/v*"], exclude: excluded } } }), "v*"), false, `exclude ${excluded}`);
    assert.equal(protects(exact({ conditions: { ref_name: { include: ["~ALL"], exclude: excluded } } }), "v*"), false, `all tags, exclude ${excluded}`);
  }
  // Any other include is refused: narrower, different, wider than all tags can say, or mixed with something else.
  // refs/tags/* is not all tags: in a ruleset * stops at /, so a tag like release/evil is outside it.
  for (const other of [["refs/tags/*"], ["refs/tags/*", "~ALL"], ["refs/tags/v1*"], ["refs/tags/release-*"], ["refs/tags/**"], ["refs/heads/*"], ["refs/tags/v*", "refs/tags/release-*"], ["~DEFAULT_BRANCH"], []]) {
    assert.equal(protects(exact({ conditions: { ref_name: { include: other, exclude: [] } } }), "v*"), false, `include ${other}`);
  }
  assert.equal(protects(exact({ conditions: {} }), "v*"), false);
  // ~ALL is accepted only when everything else is exact too.
  const all = { conditions: include("~ALL") };
  assert.equal(protects(exact({ ...all, rules: [{ type: "creation" }, { type: "update" }] }), "v*"), false, "no deletion rule");
  assert.equal(protects(exact({ ...all, enforcement: "evaluate" }), "v*"), false);
  assert.equal(protects(exact({ ...all, target: "branch" }), "v*"), false);
  assert.equal(protects(exact({ ...all, bypass_actors: [ADMIN, WRITE_ROLE] }), "v*"), false, "a write-role bypass actor");
  // Each rule is needed.
  for (const left of [["update", "deletion"], ["creation", "deletion"], ["creation", "update"]]) {
    assert.equal(protects(exact({ rules: left.map((type) => ({ type })) }), "v*"), false, `only ${left}`);
  }
  assert.equal(protects(exact({ enforcement: "disabled" }), "v*"), false);
  // The rules cannot be split between two rulesets.
  const creation = exact({ id: 1, rules: [{ type: "creation" }] });
  const rest = exact({ id: 2, rules: [{ type: "update" }, { type: "deletion" }] });
  assert.equal(assess({ rulesets: [creation, rest], tagPattern: "v*" }).status, "missing");
});

test("a ruleset of another shape neither counts nor blocks", () => {
  const exclusion = { ...TAG_RULESET, id: 50, name: "loose", conditions: { ref_name: { include: ["refs/tags/v*"], exclude: ["refs/tags/v1*"] } }, bypass_actors: [ADMIN, WRITE_ROLE] };
  const otherInclude = { ...TAG_RULESET, id: 51, name: "elsewhere", conditions: { ref_name: { include: ["refs/tags/release-*"], exclude: [] } }, bypass_actors: [WRITE_ROLE] };
  // On its own it does not count, and it is not reported as a ruleset with someone to approve.
  assert.deepEqual(assess({ rulesets: [exclusion], tagPattern: "v*" }), { status: "missing" });
  assert.deepEqual(assess({ rulesets: [exclusion, otherInclude], tagPattern: "v*" }), { status: "missing" });
  // Beside an exact one it does not block it, whoever it lets bypass.
  const result = assess({ rulesets: [exclusion, otherInclude, TAG_RULESET], tagPattern: "v*" });
  assert.equal(result.status, "protected");
  assert.deepEqual(result.rulesets, [TAG_RULESET]);
  // A ruleset of the exact shape with an actor nobody approved is still listed, and still does not count.
  const loose = { ...TAG_RULESET, id: 52, name: "wide open", bypass_actors: [ADMIN, WRITE_ROLE] };
  assert.equal(assess({ rulesets: [loose], tagPattern: "v*" }).status, "unapproved");
  assert.equal(assess({ rulesets: [exclusion, loose], tagPattern: "v*" }).unapproved.length, 1);
});

test("the ruleset Klaus creates passes its own check, for the pattern it renders", () => {
  for (const tagPattern of ["v*", "release-*", "v1.*", "v*-rc*"]) {
    const created = { ...rulesetBody({ tagPattern, apps: [{ id: 123, name: "release-bot" }] }), id: 99 };
    assert.equal(assess({ rulesets: [created], tagPattern }).status, "unapproved", "an app is a bypass actor until someone approves it");
    assert.equal(assess({ rulesets: [created], tagPattern, approved: [APPROVED_BOT] }).status, "protected");
    assert.equal(protects({ ...rulesetBody({ tagPattern }), id: 99 }, tagPattern), true);
    assert.equal(protects({ ...rulesetBody({ tagPattern }), id: 99 }, "other-*"), false, "and not for another pattern");
  }
});

test("a ruleset whose bypass list was not returned is not known to protect anything", () => {
  const hidden = { ...TAG_RULESET, bypass_actors: undefined };
  const result = assess({ rulesets: [hidden], tagPattern: "v*" });
  assert.equal(result.status, "unknown");
  assert.match(result.reason, /Sign in to gh as a repository admin/);
});

const BAD_PATTERNS = ["release/**", "release/*", "release/v*", "v**", "**", "v?", "v+", "v[0-9]*", "!v*", "v{1,2}*", "v\\1*", "v 1", "", "refs/tags/v*"];
const GOOD_PATTERNS = ["v*", "release-*", "v1.*", "v*-rc*", "*", "v1.2.3", "RELEASE_*"];

test("only a release pattern that means the same in a workflow's tag filter and in a ruleset is accepted", () => {
  for (const pattern of GOOD_PATTERNS) assert.doesNotThrow(() => assertReleasePattern(pattern), pattern);
  for (const pattern of BAD_PATTERNS) {
    assert.throws(() => assertReleasePattern(pattern), (error) => error.message.includes("cannot be protected by a tag ruleset") && /for example v\*/.test(error.message) && error.message.includes(PATTERN_DOCS.workflow) && error.message.includes(PATTERN_DOCS.ruleset), pattern);
  }
  assert.throws(() => assertReleasePattern(undefined), /cannot be protected/);
  assert.match(PATTERN_DOCS.workflow, /^https:\/\/docs\.github\.com\/en\/actions\/.*#filter-pattern-cheat-sheet$/);
  assert.match(PATTERN_DOCS.ruleset, /^https:\/\/docs\.github\.com\/en\/repositories\/.*#using-fnmatch-syntax$/);
});

test("a release pattern with a slash or ** is refused when the workflow is rendered, before any ruleset is read", () => {
  for (const tagPattern of ["release/**", "release/*", "release/v*", "v**", "v?"]) {
    const config = { ...CONFIG, trigger: { mode: "release", tagPattern } };
    assert.throws(() => render(config), /cannot be protected by a tag ruleset/, tagPattern);
    // The same through the writer: gh is never called, and nothing is written.
    const repo = sampleRepo();
    write(path.join(repo, "klaus.config.json"), JSON.stringify(config));
    assert.throws(() => writeWorkflow({ repo, install: "pnpm install --frozen-lockfile", storybookBuild: "pnpm build-storybook", checkTags: () => assert.fail("a ruleset was read for a pattern that cannot be protected") }), /for example v\*/, tagPattern);
    assert.equal(existsSync(path.join(repo, ".github/workflows/klaus.yml")), false);
    assert.throws(() => requireTagRuleset({ repo, config: resolveConfig(config), checkTags: () => assert.fail("a ruleset was read") }), /cannot be protected/);
  }
  for (const tagPattern of ["v*", "release-*", "v1.*"]) assert.doesNotThrow(() => render({ ...CONFIG, trigger: { mode: "release", tagPattern } }), tagPattern);
  // A schedule has no push filter and needs no ruleset, so its pattern is only a list of tags to look at.
  assert.doesNotThrow(() => render({ ...CONFIG, trigger: { mode: "schedule", cron: "0 6 * * 1", tagPattern: "release/*" } }));
});

test("no ruleset is read, created or shown for a release pattern that cannot be protected", () => {
  const fake = fakeGh({ list: [] });
  assert.throws(() => checkRuleset({ repo: tempDir(), tagPattern: "release/**", run: fake.run }), /cannot be protected/);
  assert.throws(() => rulesetBody({ tagPattern: "release/**" }), /cannot be protected/);
  assert.throws(() => assess({ rulesets: [], tagPattern: "release/**" }), /cannot be protected/);
  assert.equal(fake.calls.length, 0);
});

/** A fake `gh` for checkRuleset and createRuleset. It answers the two rulesets endpoints from the table. */
function fakeGh({ list, full = {}, fail } = {}) {
  const calls = [];
  const run = (command, args, options) => {
    calls.push({ command, args, input: options.input, cwd: options.cwd });
    if (fail) return { status: 1, stdout: "", stderr: fail };
    const endpoint = args.find((arg) => arg.startsWith("repos/"));
    if (args.includes("POST")) return { status: 0, stdout: JSON.stringify({ id: 99, name: JSON.parse(options.input).name }), stderr: "" };
    if (/rulesets$/.test(endpoint)) return { status: 0, stdout: JSON.stringify(list), stderr: "" };
    return { status: 0, stdout: JSON.stringify(full[endpoint.split("/").pop()]), stderr: "" };
  };
  return { run, calls };
}

const SUMMARIES = [
  { id: 7, name: "main: checks", target: "branch", enforcement: "active" },
  { id: 8, name: "old", target: "tag", enforcement: "disabled" },
  { id: 41, name: "release tags", target: "tag", enforcement: "active" },
];

test("checkRuleset reads every active tag ruleset in full, and reports protected, unapproved, missing or unknown", () => {
  const repo = tempDir();
  const found = fakeGh({ list: SUMMARIES, full: { 41: TAG_RULESET } });
  const result = checkRuleset({ repo, tagPattern: "v*", run: found.run });
  assert.equal(result.status, "protected");
  assert.deepEqual(result.rulesets, [TAG_RULESET]);
  assert.deepEqual(found.calls.map((call) => call.args.at(-1)), ["repos/{owner}/{repo}/rulesets", "repos/{owner}/{repo}/rulesets/41"]);
  assert.equal(found.calls[0].cwd, repo, "gh runs inside the repo, so it fills in {owner} and {repo}");

  const second = { ...TAG_RULESET, id: 42, name: "also tags", bypass_actors: [ADMIN, WRITE_ROLE] };
  const both = fakeGh({ list: [...SUMMARIES, { id: 42, name: "also tags", target: "tag", enforcement: "active" }], full: { 41: TAG_RULESET, 42: second } });
  const beside = checkRuleset({ repo, tagPattern: "v*", run: both.run });
  assert.equal(beside.status, "protected", "a second ruleset that lets the write role through does not block the clean one");
  assert.deepEqual(beside.rulesets, [TAG_RULESET]);
  assert.equal(both.calls.length, 3, "every active tag ruleset is read in full");

  const onlyLoose = fakeGh({ list: SUMMARIES, full: { 41: { ...TAG_RULESET, conditions: { ref_name: { include: ["refs/tags/v*"], exclude: ["refs/tags/v1*"] } } } } });
  assert.deepEqual(checkRuleset({ repo, tagPattern: "v*", run: onlyLoose.run }), { status: "missing" });

  const refused = checkRuleset({ repo, tagPattern: "v*", run: fakeGh({ list: SUMMARIES, full: { 41: second } }).run });
  assert.equal(refused.status, "unapproved");

  const none = fakeGh({ list: SUMMARIES.slice(0, 2) });
  assert.deepEqual(checkRuleset({ repo, tagPattern: "v*", run: none.run }), { status: "missing" });
  assert.equal(none.calls.length, 1, "a branch ruleset and a disabled one are not read in full");

  const denied = fakeGh({ fail: "HTTP 403: Must have admin rights to Repository." });
  const unknown = checkRuleset({ repo, tagPattern: "v*", run: denied.run });
  assert.equal(unknown.status, "unknown");
  assert.match(unknown.reason, /403/);
});

test("createRuleset posts the body to the rulesets endpoint and nothing else", () => {
  const fake = fakeGh();
  const body = rulesetBody({ tagPattern: "v*" });
  const created = createRuleset({ repo: tempDir(), body, run: fake.run });
  assert.equal(created.id, 99);
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(fake.calls[0].args, ["api", "--method", "POST", "repos/{owner}/{repo}/rulesets", "--input", "-"]);
  assert.deepEqual(JSON.parse(fake.calls[0].input), body);
});

test("the workflow is not rendered in release mode without a tag ruleset, and is in schedule mode", () => {
  const repo = sampleRepo();
  const options = { repo, install: "pnpm install --frozen-lockfile", storybookBuild: "pnpm build-storybook" };
  assert.throws(() => writeWorkflow({ ...options, checkTags: () => ({ status: "missing" }) }), /No ruleset of the shape Klaus needs .* protects tags matching v\*/);
  assert.equal(existsSync(path.join(repo, ".github/workflows/klaus.yml")), false, "nothing is written");
  assert.throws(() => writeWorkflow({ ...options, checkTags: () => ({ status: "unknown", reason: "gh api failed: HTTP 403" }) }), /could not be read \(gh api failed: HTTP 403\)/);
  assert.equal(requireTagRuleset({ repo, config: resolveConfig(CONFIG), checkTags: () => ({ status: "protected", rulesets: [{ id: 3, name: "x" }] }) })[0].name, "x");

  write(path.join(repo, "klaus.config.json"), JSON.stringify({ ...CONFIG, trigger: { mode: "schedule", cron: "0 6 * * 1" } }));
  const scheduled = writeWorkflow({ ...options, checkTags: () => assert.fail("a schedule needs no tag ruleset") });
  assert.equal(scheduled.rulesets, null);
  assert.ok(existsSync(scheduled.destination));
});

test("a ruleset that gains an actor nobody approved makes the next render refuse", () => {
  const repo = sampleRepo();
  const withApproval = { ...CONFIG, trigger: { mode: "release", tagPattern: "v*", approvedTagBypass: [APPROVED_BOT] } };
  write(path.join(repo, "klaus.config.json"), JSON.stringify(withApproval));
  const options = { repo, install: "pnpm install --frozen-lockfile", storybookBuild: "pnpm build-storybook" };
  const checkWith = (ruleset) => {
    const fake = fakeGh({ list: SUMMARIES, full: { 41: ruleset } });
    return (args) => checkRuleset({ ...args, run: fake.run });
  };

  // At onboarding: admins and the approved release bot.
  const onboarded = writeWorkflow({ ...options, checkTags: checkWith({ ...TAG_RULESET, bypass_actors: [ADMIN, RELEASE_BOT] }) });
  assert.equal(onboarded.rulesets[0].id, 41);
  assert.ok(existsSync(onboarded.destination));

  // Later someone adds the write role to the ruleset. The same config now refuses, and nothing is rewritten.
  const before = readFileSync(onboarded.destination, "utf8");
  write(onboarded.destination, `${before}# marker\n`);
  assert.throws(
    () => writeWorkflow({ ...options, checkTags: checkWith({ ...TAG_RULESET, bypass_actors: [ADMIN, RELEASE_BOT, WRITE_ROLE] }) }),
    (error) => /everyone with repository role 4/.test(error.message) && /"release tags" \(id 41\)/.test(error.message) && /Release mode stays off/.test(error.message),
  );
  assert.match(readFileSync(onboarded.destination, "utf8"), /# marker\n$/, "the refused render wrote nothing");

  // An actor swapped for another id is not the approved one either.
  assert.throws(() => writeWorkflow({ ...options, checkTags: checkWith({ ...TAG_RULESET, bypass_actors: [ADMIN, { ...RELEASE_BOT, actor_id: 999 }] }) }), /app 999/);

  // Without the approval in the config, the same ruleset is refused at onboarding too.
  write(path.join(repo, "klaus.config.json"), JSON.stringify(CONFIG));
  assert.throws(() => writeWorkflow({ ...options, checkTags: checkWith({ ...TAG_RULESET, bypass_actors: [ADMIN, RELEASE_BOT] }) }), /app 123/);
});

test("klaus.config.json records the approved bypass actors, by type, id and name", () => {
  const ok = { ...CONFIG, trigger: { mode: "release", tagPattern: "v*", approvedTagBypass: [APPROVED_BOT, { type: "Team", id: 9, name: "releasers" }] } };
  assert.equal(resolveConfig(ok).trigger.approvedTagBypass.length, 2);
  for (const bad of [[{ type: "Integration", id: 123 }], [{ type: "Robot", id: 1, name: "x" }], [{ type: "Team", id: "9", name: "x" }], [{ type: "Team", id: 9, name: "x", extra: true }]]) {
    assert.throws(() => resolveConfig({ ...CONFIG, trigger: { mode: "release", approvedTagBypass: bad } }));
  }
});

test("the ruleset command shows what it would create, creates it only with --create, and says so when one exists", () => {
  const stub = tempDir();
  const log = path.join(stub, "log");
  write(path.join(stub, "gh"), `#!/bin/sh
echo "$@" >> "${log}"
case "$*" in
  *"--method POST"*) cat > "${log}.body"; echo '{"id": 77, "name": "Klaus release tags"}' ;;
  *"rulesets/41"*) echo "$GH_FULL" ;;
  *rulesets) echo "$GH_LIST" ;;
esac
`);
  spawnSync("chmod", ["+x", path.join(stub, "gh")]);
  const repo = tempDir();
  const run = (args, { list, full } = { list: [] }) => spawnSync(process.execPath, [path.join(SOURCE_ROOT, "install/install.mjs"), "ruleset", "--repo", repo, "--tag-pattern", "v*", ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${stub}:${process.env.PATH}`, GH_LIST: JSON.stringify(list), GH_FULL: JSON.stringify(full ?? null) },
  });

  const badPattern = spawnSync(process.execPath, [path.join(SOURCE_ROOT, "install/install.mjs"), "ruleset", "--repo", repo, "--tag-pattern", "release/**", "--create"], { encoding: "utf8", env: { ...process.env, PATH: `${stub}:${process.env.PATH}`, GH_LIST: "[]", GH_FULL: "null" } });
  assert.equal(badPattern.status, 2);
  assert.match(badPattern.stderr, /cannot be protected by a tag ruleset/);
  assert.match(badPattern.stderr, /for example v\*/);
  assert.equal(existsSync(log), false, "gh was not called");

  const shown = run([]);
  assert.equal(shown.status, 0, shown.stderr);
  assert.match(shown.stdout, /No ruleset of the shape Klaus needs limits who can create, update or delete tags matching v\*\. Nothing has been created/);
  assert.match(shown.stdout, /"target": "tag"/);
  assert.match(shown.stdout, /Only a ruleset of exactly this shape counts/);
  assert.match(shown.stdout, /\{ ?"type": "deletion"|"type": "deletion"/);
  assert.equal(existsSync(`${log}.body`), false, "nothing was posted");

  const created = run(["--create", "--bypass-app", "123:release-bot"]);
  assert.equal(created.status, 0, created.stderr);
  assert.match(created.stdout, /Created the ruleset "Klaus release tags" \(id 77\)/);
  assert.match(created.stdout, /"approvedTagBypass": \[\{"type":"Integration","id":123,"name":"release-bot"\}\]/);
  assert.equal(JSON.parse(readFileSync(`${log}.body`, "utf8")).bypass_actors.some((actor) => actor.actor_id === 123 && actor.actor_type === "Integration"), true);

  rmSync(`${log}.body`);
  const summaries = [{ id: 41, name: "release tags", target: "tag", enforcement: "active" }];
  const already = run(["--create"], { list: summaries, full: TAG_RULESET });
  assert.match(already.stdout, /protected by "release tags" \(id 41\), which has the shape Klaus needs\. Every bypass actor is a repository admin or approved by name/);
  assert.match(already.stdout, /Nothing to create/);
  assert.equal(existsSync(`${log}.body`), false, "nothing was posted when a ruleset exists");

  // A ruleset with an exclusion does not count, so the command offers to create one and does not list its actors.
  const excluded = { ...TAG_RULESET, conditions: { ref_name: { include: ["refs/tags/v*"], exclude: ["refs/tags/v1*"] } }, bypass_actors: [ADMIN, WRITE_ROLE] };
  const ignored = run([], { list: summaries, full: excluded });
  assert.equal(ignored.status, 0, ignored.stderr);
  assert.match(ignored.stdout, /No ruleset of the shape Klaus needs/);
  assert.doesNotMatch(ignored.stdout + ignored.stderr, /repository role 4/);

  // A write-role actor is listed and refused, and the exit code says so.
  const loose = { ...TAG_RULESET, bypass_actors: [ADMIN, WRITE_ROLE] };
  const refused = run(["--create"], { list: summaries, full: loose });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /everyone with repository role 4 \(RepositoryRole 4, bypass always\) can bypass "release tags" \(id 41\)/);
  assert.equal(existsSync(`${log}.body`), false, "nothing was posted when a ruleset is too loose");

  // Approved by name, it passes, and the command says what to record.
  const approved = run(["--approve", "RepositoryRole:4:write-role"], { list: summaries, full: loose });
  assert.equal(approved.status, 0, approved.stderr);
  assert.match(approved.stdout, /Approved besides admins: write-role \(RepositoryRole 4\)/);
  assert.match(approved.stdout, /"approvedTagBypass": \[\{"type":"RepositoryRole","id":4,"name":"write-role"\}\]/);

  // The names already recorded in klaus.config.json count without the flag.
  write(path.join(repo, "klaus.config.json"), JSON.stringify({ ...CONFIG, trigger: { mode: "release", tagPattern: "v*", approvedTagBypass: [{ type: "RepositoryRole", id: 4, name: "write-role" }] } }));
  assert.equal(run([], { list: summaries, full: loose }).status, 0);
});

// ---------------------------------------------------------------------------------------------
// The environment that holds the secrets.
// ---------------------------------------------------------------------------------------------

const API = "repos/{owner}/{repo}";
const ENV_URL = `${API}/environments/${DEFAULT_ENVIRONMENT}`;
const POLICIES_URL = `${ENV_URL}/deployment-branch-policies?per_page=100`;
const ENV_SECRETS_URL = `${ENV_URL}/secrets?per_page=100`;
const REPO_SECRETS_URL = `${API}/actions/secrets?per_page=100`;
const SELECTED = { protected_branches: false, custom_branch_policies: true };
const MAIN = { name: "main", type: "branch" };
const RELEASE_TAGS = { name: "v*", type: "tag" };
const NOT_FOUND = { fail: "gh: Not Found (HTTP 404)" };
const secretsReply = (...names) => ({ body: { total_count: names.length, secrets: names.map((name) => ({ name })) } });

/**
 * What GitHub answers for an environment with these rules. Every answer is a GET, keyed "METHOD endpoint".
 * Shapes checked against the REST API on a scratch private repo on 2026-10-19: the rule list carries a
 * type of branch or tag, and an environment that does not exist answers HTTP 404.
 */
function environmentReplies(policies, { rule = SELECTED, defaultBranch = "main", total = policies.length } = {}) {
  return {
    [`GET ${API}`]: { body: { default_branch: defaultBranch } },
    [`GET ${ENV_URL}`]: { body: { name: DEFAULT_ENVIRONMENT, deployment_branch_policy: rule, protection_rules: [{ type: "branch_policy" }] } },
    [`GET ${POLICIES_URL}`]: { body: { total_count: total, branch_policies: policies.map((policy, i) => ({ id: i + 1, ...policy })) } },
  };
}

/** A stand-in for `gh` inside the process. It answers from a table and records every call. */
function fakeEnvironmentGh(table) {
  const calls = [];
  const run = (command, args, options) => {
    const method = args.includes("--method") ? args[args.indexOf("--method") + 1] : "GET";
    const endpoint = args.find((arg) => arg.startsWith("repos/"));
    calls.push({ method, endpoint, input: options.input, cwd: options.cwd });
    const answer = table[`${method} ${endpoint}`];
    if (answer === undefined) return { status: 1, stdout: "", stderr: `gh: nothing is set up to answer ${method} ${endpoint}` };
    if (answer.fail) return { status: 1, stdout: "", stderr: answer.fail };
    return { status: 0, stdout: JSON.stringify(answer.body ?? {}), stderr: "" };
  };
  return { run, calls };
}

const checkIn = (table, overrides = {}) => checkEnvironment({ repo: tempDir(), name: DEFAULT_ENVIRONMENT, mode: "release", tagPattern: "v*", run: fakeEnvironmentGh(table).run, ...overrides });

test("an environment that allows the default branch and the release tags, and nothing else, is accepted", () => {
  const repo = tempDir();
  const fake = fakeEnvironmentGh(environmentReplies([MAIN, RELEASE_TAGS]));
  const result = checkEnvironment({ repo, name: DEFAULT_ENVIRONMENT, mode: "release", tagPattern: "v*", run: fake.run });
  assert.deepEqual(result, { status: "ok", defaultBranch: "main" });
  assert.deepEqual(fake.calls.map((call) => call.endpoint), [API, ENV_URL, POLICIES_URL]);
  assert.equal(fake.calls.every((call) => call.method === "GET" && call.cwd === repo), true, "it only reads, inside the repo, so gh fills in {owner} and {repo}");
  // The rule list may come in any order, and a rule listed without a type is a branch rule.
  assert.equal(checkIn(environmentReplies([RELEASE_TAGS, MAIN])).status, "ok");
  assert.equal(checkIn(environmentReplies([{ name: "main" }, RELEASE_TAGS])).status, "ok");
  // A schedule has no tag trigger, so the environment allows the default branch alone.
  assert.equal(checkIn(environmentReplies([MAIN]), { mode: "schedule", tagPattern: undefined }).status, "ok");
  // The branch it allows is the default branch of the repo, whatever it is called.
  assert.equal(checkIn(environmentReplies([{ name: "trunk", type: "branch" }, RELEASE_TAGS], { defaultBranch: "trunk" })).status, "ok");
});

test("an environment that does not exist is reported as missing, and an environment that cannot be read as unknown", () => {
  const missing = checkIn({ ...environmentReplies([]), [`GET ${ENV_URL}`]: NOT_FOUND });
  assert.deepEqual(missing, { status: "missing", defaultBranch: "main" });
  const denied = checkIn({ ...environmentReplies([]), [`GET ${ENV_URL}`]: { fail: "gh: Must have admin rights to Repository. (HTTP 403)" } });
  assert.equal(denied.status, "unknown");
  assert.match(denied.reason, /HTTP 403/);
  assert.equal(checkIn({}).status, "unknown", "a repo that cannot be read is not reported as having no environment");
});

const DRIFT = [
  ["a branch pattern that takes in every branch", environmentReplies([MAIN, RELEASE_TAGS, { name: "*", type: "branch" }]), /also allows the branch \*/],
  ["a feature branch pattern", environmentReplies([MAIN, RELEASE_TAGS, { name: "feature/*", type: "branch" }]), /also allows the branch feature\/\*/],
  ["a second tag pattern", environmentReplies([MAIN, RELEASE_TAGS, { name: "*", type: "tag" }]), /also allows tags matching \*/],
  ["a different tag pattern", environmentReplies([MAIN, { name: "v1*", type: "tag" }]), /does not allow tags matching v\*[\s\S]*also allows tags matching v1\*/],
  ["no tag rule in release mode", environmentReplies([MAIN]), /does not allow tags matching v\*/],
  ["no rule for the default branch", environmentReplies([RELEASE_TAGS]), /does not allow the branch main/],
  ["a tag rule where a branch rule should be", environmentReplies([{ name: "main", type: "tag" }, RELEASE_TAGS]), /does not allow the branch main[\s\S]*also allows tags matching main/],
  ["a renamed default branch", environmentReplies([MAIN, RELEASE_TAGS], { defaultBranch: "trunk" }), /does not allow the branch trunk[\s\S]*also allows the branch main/],
  ["protected branches only", environmentReplies([MAIN, RELEASE_TAGS], { rule: { protected_branches: true, custom_branch_policies: false } }), /protected branches only/],
  ["no branch rule at all", environmentReplies([], { rule: null }), /no rule on which branches and tags can use it/],
  ["neither kind of rule on", environmentReplies([MAIN, RELEASE_TAGS], { rule: { protected_branches: false, custom_branch_policies: false } }), /not set to selected branches and tags/],
  ["more rules than were read", environmentReplies([MAIN, RELEASE_TAGS], { total: 150 }), /150 rules and only 2 were read/],
];

test("every way the environment's rules can differ from what Klaus set is reported, and none is accepted", () => {
  for (const [label, table, problem] of DRIFT) {
    const result = checkIn(table);
    assert.equal(result.status, "drifted", label);
    assert.match(result.problems.join("\n"), problem, label);
  }
  // In schedule mode the tag rule is itself the difference: nothing makes a tag a safe release there.
  const scheduled = checkIn(environmentReplies([MAIN, RELEASE_TAGS]), { mode: "schedule", tagPattern: undefined });
  assert.equal(scheduled.status, "drifted");
  assert.match(scheduled.problems[0], /also allows tags matching v\*/);
});

test("no environment is read for a release pattern that a tag ruleset cannot protect, or for a name that is not safe", () => {
  const fake = fakeEnvironmentGh(environmentReplies([MAIN, RELEASE_TAGS]));
  assert.throws(() => checkEnvironment({ repo: tempDir(), name: DEFAULT_ENVIRONMENT, mode: "release", tagPattern: "release/**", run: fake.run }), /cannot be protected by a tag ruleset/);
  for (const name of ["", "a b", "../x", "a/b", "-x"]) {
    assert.throws(() => checkEnvironment({ repo: tempDir(), name, mode: "release", tagPattern: "v*", run: fake.run }), /is not an environment name Klaus uses/, JSON.stringify(name));
  }
  assert.equal(fake.calls.length, 0);
});

test("createEnvironment turns on selected branches and tags first, then adds one rule for each, and nothing else", () => {
  const fake = fakeEnvironmentGh({
    [`PUT ${ENV_URL}`]: { body: { name: DEFAULT_ENVIRONMENT } },
    [`POST ${ENV_URL}/deployment-branch-policies`]: { body: { id: 1 } },
  });
  createEnvironment({ repo: tempDir(), name: DEFAULT_ENVIRONMENT, policies: [MAIN, RELEASE_TAGS], run: fake.run });
  assert.deepEqual(fake.calls.map((call) => `${call.method} ${call.endpoint}`), [`PUT ${ENV_URL}`, `POST ${ENV_URL}/deployment-branch-policies`, `POST ${ENV_URL}/deployment-branch-policies`]);
  assert.deepEqual(JSON.parse(fake.calls[0].input), { deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } });
  assert.deepEqual(JSON.parse(fake.calls[0].input), environmentBody());
  assert.deepEqual(fake.calls.slice(1).map((call) => JSON.parse(call.input)), [MAIN, RELEASE_TAGS]);
});

test("the secrets check reads names only, ignores case, and tells the person what is left", () => {
  const table = {
    [`GET ${ENV_SECRETS_URL}`]: secretsReply("VERCEL_TOKEN", "OTHER"),
    [`GET ${REPO_SECRETS_URL}`]: secretsReply("vercel_token", "ONLY_HERE", "UNRELATED"),
  };
  const fake = fakeEnvironmentGh(table);
  const result = checkSecrets({ repo: tempDir(), name: DEFAULT_ENVIRONMENT, secrets: ["VERCEL_TOKEN", "VERCEL_ORG_ID", "ONLY_HERE"], run: fake.run });
  assert.deepEqual(result.secrets, [
    { name: "VERCEL_TOKEN", inEnvironment: true, inRepository: true },
    { name: "VERCEL_ORG_ID", inEnvironment: false, inRepository: false },
    { name: "ONLY_HERE", inEnvironment: false, inRepository: true },
  ]);
  assert.equal(fake.calls.every((call) => call.method === "GET"), true, "no secret is written, and no value is read");
  const advice = secretsAdvice({ name: DEFAULT_ENVIRONMENT, result });
  assert.match(advice, /VERCEL_TOKEN: in the environment, and still a repository secret[\s\S]*gh secret delete VERCEL_TOKEN/);
  assert.match(advice, /VERCEL_ORG_ID: not in the environment[\s\S]*gh secret set VERCEL_ORG_ID --env klaus-release/);
  assert.match(advice, /GitHub does not show a secret's value, so Klaus cannot copy it/);
  assert.match(advice, /ONLY_HERE: not in the environment[\s\S]*It is a repository secret now/);
  assert.match(advice, /Not done yet/);

  const done = secretsAdvice({ name: DEFAULT_ENVIRONMENT, result: { status: "read", secrets: [{ name: "VERCEL_TOKEN", inEnvironment: true, inRepository: false }] } });
  assert.match(done, /All 1 secrets are in klaus-release and none is left in the repository/);
  const unread = checkSecrets({ repo: tempDir(), name: DEFAULT_ENVIRONMENT, secrets: ["X"], run: fakeEnvironmentGh({ [`GET ${ENV_SECRETS_URL}`]: { fail: "gh: Forbidden (HTTP 403)" } }).run });
  assert.equal(unread.status, "unknown");
  assert.match(secretsAdvice({ name: DEFAULT_ENVIRONMENT, result: unread }), /could not be read/);
  const partial = checkSecrets({ repo: tempDir(), name: DEFAULT_ENVIRONMENT, secrets: ["X"], run: fakeEnvironmentGh({ [`GET ${ENV_SECRETS_URL}`]: { body: { total_count: 120, secrets: [{ name: "A" }] } } }).run });
  assert.equal(partial.status, "unknown", "a list that was cut short does not say a secret is missing");
});

const ENVIRONMENT_CONFIG = { ...CONFIG, trigger: { mode: "release", tagPattern: "v*", secretsEnvironment: DEFAULT_ENVIRONMENT } };
const WORKFLOW_OPTIONS = { install: "pnpm install --frozen-lockfile", storybookBuild: "pnpm build-storybook" };
const protectedTags = () => ({ status: "protected", rulesets: [{ id: 1, name: RULESET_NAME }] });

test("the workflow is not rendered when the environment is missing, unreadable or has other rules, and nothing is written", () => {
  const repo = sampleRepo();
  write(path.join(repo, "klaus.config.json"), JSON.stringify(ENVIRONMENT_CONFIG));
  const destination = path.join(repo, ".github/workflows/klaus.yml");
  const render = (table) => writeWorkflow({ repo, ...WORKFLOW_OPTIONS, checkTags: protectedTags, checkEnv: (args) => checkEnvironment({ ...args, run: fakeEnvironmentGh(table).run }) });

  assert.throws(() => render({ ...environmentReplies([]), [`GET ${ENV_URL}`]: NOT_FOUND }), /The environment klaus-release does not exist\..*install\.mjs environment --repo <repo> --create/);
  assert.throws(() => render({ [`GET ${API}`]: { fail: "gh: Bad credentials (HTTP 401)" } }), /could not be read \(gh api repos\/\{owner\}\/\{repo\} failed: gh: Bad credentials \(HTTP 401\)\)/);
  for (const [label, table, problem] of DRIFT) {
    assert.throws(() => render(table), (error) => problem.test(error.message) && /does not have the rules Klaus set/.test(error.message) && error.message.includes(ENVIRONMENT_DOCS.rules) && /Klaus does not change an environment that already exists/.test(error.message), label);
  }
  assert.equal(existsSync(destination), false, "nothing is written when the check fails");

  const written = render(environmentReplies([MAIN, RELEASE_TAGS]));
  assert.equal(written.environment.name, DEFAULT_ENVIRONMENT);
  assert.deepEqual(written.environment.policies, [MAIN, RELEASE_TAGS]);
  assert.match(readFileSync(destination, "utf8"), /environment:\n {6}name: "klaus-release"\n {6}deployment: false/);
});

test("an environment that loses its rules after onboarding makes the next render refuse and leaves the written workflow alone", () => {
  const repo = sampleRepo();
  write(path.join(repo, "klaus.config.json"), JSON.stringify(ENVIRONMENT_CONFIG));
  const render = (table) => writeWorkflow({ repo, ...WORKFLOW_OPTIONS, checkTags: protectedTags, checkEnv: (args) => checkEnvironment({ ...args, run: fakeEnvironmentGh(table).run }) });
  const onboarded = render(environmentReplies([MAIN, RELEASE_TAGS]));
  write(onboarded.destination, `${readFileSync(onboarded.destination, "utf8")}# marker\n`);
  // Someone opens the environment to every branch.
  assert.throws(() => render(environmentReplies([MAIN, RELEASE_TAGS, { name: "*", type: "branch" }])), /also allows the branch \*/);
  // Or turns the rules off.
  assert.throws(() => render(environmentReplies([], { rule: null })), /no rule on which branches and tags can use it/);
  assert.match(readFileSync(onboarded.destination, "utf8"), /# marker\n$/, "the refused render wrote nothing");
});

test("the environment is checked in a schedule too, and not at all when the config sets none", () => {
  const repo = sampleRepo();
  write(path.join(repo, "klaus.config.json"), JSON.stringify({ ...CONFIG, trigger: { mode: "schedule", cron: "0 6 * * 1", secretsEnvironment: DEFAULT_ENVIRONMENT } }));
  const render = (table) => writeWorkflow({ repo, ...WORKFLOW_OPTIONS, checkTags: () => assert.fail("a schedule needs no tag ruleset"), checkEnv: (args) => checkEnvironment({ ...args, run: fakeEnvironmentGh(table).run }) });
  assert.throws(() => render(environmentReplies([MAIN, RELEASE_TAGS])), /also allows tags matching v\*/, "a schedule never needs a tag to reach the secrets");
  assert.equal(existsSync(path.join(repo, ".github/workflows/klaus.yml")), false);
  const written = render(environmentReplies([MAIN]));
  assert.deepEqual(written.environment.policies, [MAIN]);

  write(path.join(repo, "klaus.config.json"), JSON.stringify(CONFIG));
  assert.equal(requireEnvironment({ repo, config: resolveConfig(CONFIG), checkEnv: () => assert.fail("no environment was asked for") }), null);
  assert.equal(writeWorkflow({ repo, ...WORKFLOW_OPTIONS, checkTags: protectedTags, checkEnv: () => assert.fail("no environment was asked for") }).environment, null);
});

/**
 * A stand-in `gh` on PATH for the command line. It answers "METHOD endpoint" from a table (GH_TABLE),
 * and appends every call, with what was sent on standard input, to a log (GH_LOG).
 */
function ghOnPath() {
  const dir = tempDir();
  const log = path.join(dir, "log");
  write(path.join(dir, "gh"), `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
const method = args.includes("--method") ? args[args.indexOf("--method") + 1] : "GET";
const endpoint = args.find((arg) => arg.startsWith("repos/"));
const input = args.includes("--input") ? fs.readFileSync(0, "utf8") : undefined;
fs.appendFileSync(process.env.GH_LOG, JSON.stringify({ method, endpoint, input }) + "\\n");
const answer = JSON.parse(process.env.GH_TABLE)[method + " " + endpoint];
if (!answer) { console.error("gh: nothing is set up to answer " + method + " " + endpoint); process.exit(1); }
if (answer.fail) { console.error(answer.fail); process.exit(1); }
process.stdout.write(JSON.stringify(answer.body ?? {}));
`);
  spawnSync("chmod", ["+x", path.join(dir, "gh")]);
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []);
  const writes = () => calls().filter((call) => call.method !== "GET");
  const run = (command, repo, args, table) => spawnSync(process.execPath, [path.join(SOURCE_ROOT, "install/install.mjs"), command, "--repo", repo, ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GH_TABLE: JSON.stringify(table), GH_LOG: log },
  });
  return { run, calls, writes, reset: () => rmSync(log, { force: true }) };
}

test("the environment command shows what it would create, creates it only with --create, and then checks the secrets", () => {
  const gh = ghOnPath();
  const repo = sampleRepo();
  const none = { ...environmentReplies([]), [`GET ${ENV_URL}`]: NOT_FOUND };
  const created = { ...none, [`PUT ${ENV_URL}`]: { body: { name: DEFAULT_ENVIRONMENT } }, [`POST ${ENV_URL}/deployment-branch-policies`]: { body: { id: 1 } }, [`GET ${ENV_SECRETS_URL}`]: secretsReply(), [`GET ${REPO_SECRETS_URL}`]: secretsReply("VERCEL_TOKEN", "VERCEL_ORG_ID") };

  const shown = gh.run("environment", repo, [], none);
  assert.equal(shown.status, 0, shown.stderr);
  assert.match(shown.stdout, /There is no environment klaus-release, so the secrets are repository secrets that a workflow on any branch can read\. Nothing has been created\./);
  assert.match(shown.stdout, /Why: a repository secret can be read by a workflow run from any branch/);
  assert.match(shown.stdout, /only when the run is on the branch main and tags matching v\*/);
  assert.match(shown.stdout, /PUT repos\/\{owner\}\/\{repo\}\/environments\/klaus-release {2}\{"deployment_branch_policy":\{"protected_branches":false,"custom_branch_policies":true\}\}/);
  assert.match(shown.stdout, /POST .*deployment-branch-policies {2}\{"name":"v\*","type":"tag"\}/);
  assert.match(shown.stdout, /Klaus will not copy a secret[\s\S]*gh secret set VERCEL_TOKEN --env klaus-release\n {2}gh secret set VERCEL_ORG_ID --env klaus-release/);
  assert.deepEqual(gh.writes(), [], "nothing was created without --create");

  gh.reset();
  const made = gh.run("environment", repo, ["--create"], created);
  assert.equal(made.status, 0, made.stderr);
  assert.deepEqual(gh.writes().map((call) => `${call.method} ${call.endpoint}`), [`PUT ${ENV_URL}`, `POST ${ENV_URL}/deployment-branch-policies`, `POST ${ENV_URL}/deployment-branch-policies`]);
  assert.deepEqual(gh.writes().slice(1).map((call) => JSON.parse(call.input)), [MAIN, RELEASE_TAGS]);
  assert.match(made.stdout, /Created the environment klaus-release\. Only the branch main and tags matching v\* can use it from now on\./);
  assert.match(made.stdout, /Record this in klaus\.config\.json, under "trigger": "secretsEnvironment": "klaus-release"/);
  assert.match(made.stdout, /VERCEL_TOKEN: not in the environment[\s\S]*gh secret set VERCEL_TOKEN --env klaus-release/);
  assert.match(made.stdout, /Not done yet/);
  assert.equal(JSON.stringify(gh.calls()).includes("\"value\""), false, "no secret value is sent anywhere");
});

test("the environment command leaves an environment that already has the right rules alone, and reports the secrets", () => {
  const gh = ghOnPath();
  const repo = sampleRepo();
  write(path.join(repo, "klaus.config.json"), JSON.stringify(ENVIRONMENT_CONFIG));
  const exact = environmentReplies([MAIN, RELEASE_TAGS]);

  const half = gh.run("environment", repo, ["--create"], { ...exact, [`GET ${ENV_SECRETS_URL}`]: secretsReply("VERCEL_TOKEN"), [`GET ${REPO_SECRETS_URL}`]: secretsReply("VERCEL_TOKEN") });
  assert.equal(half.status, 0, half.stderr);
  assert.match(half.stdout, /The environment klaus-release allows the branch main and tags matching v\* and nothing else\. Nothing to create\./);
  assert.doesNotMatch(half.stdout, /Record this in klaus\.config\.json/, "the config already names it");
  assert.match(half.stdout, /VERCEL_TOKEN: in the environment, and still a repository secret[\s\S]*gh secret delete VERCEL_TOKEN/);
  assert.match(half.stdout, /VERCEL_ORG_ID: not in the environment/);
  assert.deepEqual(gh.writes(), [], "an environment that exists is not written to");

  const all = gh.run("environment", repo, [], { ...exact, [`GET ${ENV_SECRETS_URL}`]: secretsReply("VERCEL_TOKEN", "VERCEL_ORG_ID"), [`GET ${REPO_SECRETS_URL}`]: secretsReply() });
  assert.match(all.stdout, /All 2 secrets are in klaus-release and none is left in the repository\./);
});

test("the environment command stops, and changes nothing, when the environment has other rules or cannot be read", () => {
  const gh = ghOnPath();
  const repo = sampleRepo();
  const loose = gh.run("environment", repo, ["--create"], environmentReplies([MAIN, RELEASE_TAGS, { name: "*", type: "branch" }]));
  assert.equal(loose.status, 2);
  assert.match(loose.stderr, /The environment klaus-release does not have the rules Klaus set/);
  assert.match(loose.stderr, /also allows the branch \*/);
  assert.match(loose.stderr, /It must allow the branch main and tags matching v\*, and nothing else/);
  assert.match(loose.stderr, /Settings, Environments, klaus-release, Deployment branches and tags/);
  assert.deepEqual(gh.writes(), []);

  const denied = gh.run("environment", repo, ["--create"], { ...environmentReplies([]), [`GET ${ENV_URL}`]: { fail: "gh: Must have admin rights to Repository. (HTTP 403)" } });
  assert.equal(denied.status, 2);
  assert.match(denied.stderr, /could not be read.*HTTP 403/);
  assert.match(denied.stderr, /environments for private repos need GitHub Pro, Team or Enterprise/);
  assert.deepEqual(gh.writes(), []);
});

test("the environment command allows only the default branch in a schedule, and reads nothing for a pattern that cannot be protected or an output without secrets", () => {
  const gh = ghOnPath();
  const repo = sampleRepo();
  write(path.join(repo, "klaus.config.json"), JSON.stringify({ ...CONFIG, trigger: { mode: "schedule", cron: "0 6 * * 1" } }));
  const none = { ...environmentReplies([]), [`GET ${ENV_URL}`]: NOT_FOUND, [`PUT ${ENV_URL}`]: { body: {} }, [`POST ${ENV_URL}/deployment-branch-policies`]: { body: {} }, [`GET ${ENV_SECRETS_URL}`]: secretsReply(), [`GET ${REPO_SECRETS_URL}`]: secretsReply() };
  const made = gh.run("environment", repo, ["--create"], none);
  assert.equal(made.status, 0, made.stderr);
  assert.deepEqual(gh.writes().slice(1).map((call) => JSON.parse(call.input)), [MAIN], "a schedule has no tag rule");
  assert.match(made.stdout, /Only the branch main can use it from now on/);

  gh.reset();
  write(path.join(repo, "klaus.config.json"), JSON.stringify({ ...CONFIG, trigger: { mode: "release", tagPattern: "release/**" } }));
  const bad = gh.run("environment", repo, ["--create"], none);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /cannot be protected by a tag ruleset/);

  write(path.join(repo, "klaus.config.json"), JSON.stringify({ ...CONFIG, outputs: { figma: CONFIG.outputs.figma } }));
  const quiet = gh.run("environment", repo, ["--create"], none);
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.match(quiet.stdout, /No output that is on reads a secret, so there is nothing to keep in an environment/);
  assert.deepEqual(gh.calls(), [], "gh was not called");
});

test("the workflow command names the environment, says what it allows, and refuses when the rules have changed", () => {
  const gh = ghOnPath();
  const repo = sampleRepo();
  write(path.join(repo, "klaus.config.json"), JSON.stringify({ ...CONFIG, trigger: { mode: "schedule", cron: "0 6 * * 1", secretsEnvironment: DEFAULT_ENVIRONMENT } }));
  const args = ["--install", "pnpm install --frozen-lockfile", "--storybook-build", "pnpm build-storybook"];
  const destination = path.join(repo, ".github/workflows/klaus.yml");

  const loose = gh.run("workflow", repo, args, environmentReplies([MAIN, { name: "*", type: "branch" }]));
  assert.equal(loose.status, 2);
  assert.match(loose.stderr, /also allows the branch \*/);
  assert.equal(existsSync(destination), false);

  const ok = gh.run("workflow", repo, args, environmentReplies([MAIN]));
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /the job uses the environment "klaus-release", whose rules allow only the branch main/);
  assert.match(ok.stdout, /secrets to set in the environment klaus-release: VERCEL_TOKEN, VERCEL_ORG_ID/);
  assert.match(readFileSync(destination, "utf8"), /environment:\n {6}name: "klaus-release"/);

  // Without the setting, the secrets stay repository secrets, and the command says how to change that.
  write(path.join(repo, "klaus.config.json"), JSON.stringify({ ...CONFIG, trigger: { mode: "schedule", cron: "0 6 * * 1" } }));
  gh.reset();
  const plain = gh.run("workflow", repo, args, {});
  assert.equal(plain.status, 0, plain.stdout + plain.stderr);
  assert.match(plain.stdout, /secrets to set in the repo: VERCEL_TOKEN, VERCEL_ORG_ID/);
  assert.match(plain.stdout, /repository secrets, which a workflow run on any branch can read\. To keep them in an environment instead, run install\.mjs environment/);
  assert.deepEqual(gh.calls(), [], "no environment is read when the config sets none");
});

// ---------------------------------------------------------------------------------------------
// Restoring state from an earlier run.
// ---------------------------------------------------------------------------------------------

const RESTORE = "Restore Klaus state";

function stateFolder(files = {}) {
  const dir = tempDir();
  const all = {
    "state.json": JSON.stringify({ version: 1, outputs: { storybook: { lastRelease: "v1.0.0", lastRunAt: "2026-10-18T06:00:00.000Z", unwritten: [] } } }),
    "inventory.versioned.json": JSON.stringify({ entries: [{ name: "Button", version: "1.0.0" }], screens: [], versioned: { release: "v1.0.0", commit: "abc" } }),
    "figma/ledger.json": JSON.stringify({ version: 2, components: { Button: { "1.0.0": "generated" } }, screens: {} }),
    ...files,
  };
  for (const [name, content] of Object.entries(all)) if (content !== null) write(path.join(dir, name), content);
  return dir;
}

test("check-state passes what Klaus writes and refuses everything else", () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("rest")]);
  const good = stateFolder();
  write(path.join(good, "screenshots/components/Button/1.0.0.png"), png);
  assert.deepEqual(checkState(good), { ok: true, errors: [] });

  const refuses = (dir, pattern) => {
    const result = checkState(dir);
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), pattern);
  };
  refuses(stateFolder({ "notes.txt": "x" }), /notes\.txt is not something Klaus keeps/);
  refuses(stateFolder({ "state.json": JSON.stringify({ version: 9, outputs: {} }) }), /not a Klaus state file/);
  refuses(stateFolder({ "state.json": "{" }), /not valid JSON/);
  refuses(stateFolder({ "inventory.versioned.json": JSON.stringify({ entries: [{ name: "Button", version: "latest" }], versioned: { release: "v1" } }) }), /not x\.y\.z/);
  refuses(stateFolder({ "inventory.versioned.json": JSON.stringify({ entries: [] }) }), /does not say which release/);
  refuses(stateFolder({ "figma/ledger.json": JSON.stringify({ version: 2, components: { Button: { "1.0.0": "run-this" } }, screens: {} }) }), /status Klaus does not write/);
  const badPng = stateFolder();
  write(path.join(badPng, "screenshots/a.png"), "not a png");
  refuses(badPng, /not a PNG file/);
  const linked = stateFolder();
  symlinkSync("/etc/hosts", path.join(linked, "figma/link.json"));
  refuses(linked, /symbolic link/);
  refuses(path.join(tempDir(), "missing"), /is not a folder/);
});

/**
 * A stand-in `gh` for the restore step. runs.json maps a run id to what `gh api runs/<id>` returns,
 * and artifacts.json is the artifact list. `gh run download` copies folders/<id> into --dir and logs it.
 */
function fakeRestoreGh({ runs, folders }) {
  const dir = tempDir();
  const artifacts = Object.keys(runs).sort((a, b) => b - a).map((id) => ({ id: Number(id), expired: false, created_at: new Date(Date.UTC(2026, 9, 1) + Number(id) * 3600e3).toISOString(), workflow_run: { id: Number(id) } }));
  write(path.join(dir, "artifacts.json"), JSON.stringify({ total_count: artifacts.length, artifacts }));
  for (const [id, run] of Object.entries(runs)) write(path.join(dir, `runs/${id}.json`), JSON.stringify(run));
  for (const [id, source] of Object.entries(folders)) {
    mkdirSync(path.join(dir, `download/${id}`), { recursive: true });
    spawnSync("cp", ["-R", `${source}/.`, path.join(dir, `download/${id}`)]);
  }
  write(path.join(dir, "bin/gh"), `#!/bin/sh
echo "gh $*" >> "${dir}/calls.log"
case "$*" in
  "api repos/acme/sample/actions/artifacts?"*) cat "${dir}/artifacts.json" ;;
  "api repos/acme/sample/actions/runs/"*) cat "${dir}/runs/\${2##*/}.json" ;;
  "run download "*)
    id=$3
    while [ $# -gt 0 ]; do [ "$1" = "--dir" ] && target=$2; shift; done
    mkdir -p "$target" && cp -R "${dir}/download/$id/." "$target/" ;;
  *) echo "unexpected gh call: $*" >&2; exit 1 ;;
esac
`);
  spawnSync("chmod", ["+x", path.join(dir, "bin/gh")]);
  return { bin: path.join(dir, "bin"), downloads: () => (existsSync(path.join(dir, "calls.log")) ? readFileSync(path.join(dir, "calls.log"), "utf8").split("\n").filter((line) => line.startsWith("gh run download")).map((line) => line.split(" ")[3]) : []) };
}

test("state is restored only from a successful run of this workflow, on the default branch or at a commit on it, with the shape Klaus writes", () => {
  const { repo, git } = gitRepo();
  const mainTip = git("rev-parse", "main");
  const hostile = git("rev-parse", "feature/exfil");
  const klaus = ".github/workflows/klaus.yml";
  const run = (overrides) => ({ path: klaus, conclusion: "success", event: "schedule", head_branch: "main", head_sha: mainTip, ...overrides });
  const poisoned = stateFolder({ "state.json": JSON.stringify({ version: 1, outputs: {}, injected: true }) });
  const wrongShape = stateFolder({ "state.json": "[]" });
  const good = stateFolder();
  const fake = fakeRestoreGh({
    runs: {
      306: run({ path: ".github/workflows/other.yml" }), // another workflow
      305: run({ event: "workflow_dispatch", head_branch: "feature/exfil", head_sha: hostile }), // another branch
      304: run({ conclusion: "failure" }), // did not succeed
      303: run({ event: "push", head_branch: "v9.9.9", head_sha: hostile }), // a tag whose commit is not on main
      302: run({ event: "pull_request" }), // an event Klaus never starts from
      301: run({ event: "push", head_branch: "v1.1.0", head_sha: git("rev-parse", "v1.1.0^{commit}") }), // a release tag on main, but its files are the wrong shape
      300: run({ event: "push", head_branch: "v1.0.0", head_sha: git("rev-parse", "v1.0.0^{commit}") }), // a release tag on main with the right files
      299: run(), // never reached
    },
    folders: { 306: poisoned, 305: poisoned, 304: poisoned, 303: poisoned, 302: poisoned, 301: wrongShape, 300: good, 299: good },
  });
  const { text } = render(CONFIG);
  const klausDir = path.join(SOURCE_ROOT);
  const result = runStep(text, RESTORE, {
    repo,
    event: "schedule",
    extraEnv: { PATH: `${fake.bin}:${process.env.PATH}`, KLAUS: klausDir, KLAUS_DEFAULT_BRANCH: "main", GH_REPO: "acme/sample" },
  });
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(fake.downloads(), ["301", "300"], "only runs that pass the checks are downloaded, newest first");
  assert.match(result.output, /::warning::The klaus-state artifact of run 301 does not have the shape Klaus writes/);
  assert.equal(readFileSync(path.join(repo, ".klaus/state.json"), "utf8"), readFileSync(path.join(good, "state.json"), "utf8"));
  assert.equal(existsSync(path.join(repo, ".klaus/injected")), false);
});

test("when no earlier state qualifies, nothing is restored and the run says so", () => {
  const { repo, git } = gitRepo();
  const hostile = git("rev-parse", "feature/exfil");
  const poisoned = stateFolder({ "state.json": JSON.stringify({ version: 1, outputs: { storybook: { lastRelease: "v9.9.9", unwritten: [] } } }) });
  const fake = fakeRestoreGh({
    runs: { 401: { path: ".github/workflows/klaus.yml", conclusion: "success", event: "push", head_branch: "v9.9.9", head_sha: hostile }, 400: { path: ".github/workflows/deploy.yml", conclusion: "success", event: "schedule", head_branch: "main", head_sha: git("rev-parse", "main") } },
    folders: { 401: poisoned, 400: poisoned },
  });
  const { text } = render(CONFIG);
  const result = runStep(text, RESTORE, { repo, event: "push", tag: "v1.1.0", extraEnv: { PATH: `${fake.bin}:${process.env.PATH}`, KLAUS: SOURCE_ROOT, KLAUS_DEFAULT_BRANCH: "main", GH_REPO: "acme/sample" } });
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(fake.downloads(), []);
  assert.match(result.output, /No earlier Klaus state that can be trusted/);
  assert.equal(existsSync(path.join(repo, ".klaus/state.json")), false);
});

test("the state step runs after the copy of Klaus and the check, and the state is kept only after a successful run", () => {
  const { text } = render(CONFIG);
  const names = stepsOf(text).map((step) => step.name);
  assert.ok(names.indexOf("Copy Klaus out of the working tree") < names.indexOf(RESTORE));
  assert.ok(names.indexOf(RESTORE) < names.indexOf(PICK));
  assert.match(shellOf(text, RESTORE).run, /node "\$KLAUS\/ci\/check-state\.mjs" "\$dir"/);
  assert.match(stepsOf(text).find((step) => step.name === "Keep Klaus state for the next run").text, /if: success\(\) && hashFiles/);
});

// ---------------------------------------------------------------------------------------------
// Symbolic links in the places Klaus writes.
// ---------------------------------------------------------------------------------------------

/** A folder outside the repo, and a way to see whether anything in it changed. */
function outsideFolder() {
  const dir = tempDir();
  write(path.join(dir, "keep.txt"), "outside\n");
  write(path.join(dir, "target.mjs"), "original\n");
  const state = () => readdirSync(dir, { recursive: true }).sort().map((name) => `${name}=${lstatSync(path.join(dir, name)).isFile() ? readFileSync(path.join(dir, name), "utf8") : "dir"}`).join("|");
  return { dir, state };
}

test("a symlinked scripts, scripts/klaus, folder or file inside it is refused, and nothing outside the repo changes", () => {
  for (const place of ["scripts", "scripts/klaus", "scripts/klaus/frame", "scripts/klaus/frame/cli.mjs"]) {
    const repo = sampleRepo();
    const outside = outsideFolder();
    if (place.split("/").length > 2) copyKlaus({ repo });
    const target = path.join(repo, place);
    mkdirSync(path.dirname(target), { recursive: true });
    rmSync(target, { recursive: true, force: true });
    symlinkSync(place.endsWith(".mjs") ? path.join(outside.dir, "target.mjs") : outside.dir, target);
    const before = outside.state();
    assert.throws(() => copyKlaus({ repo, force: true }), /symbolic link/, place);
    assert.equal(outside.state(), before, `${place}: nothing outside the repo changed`);
    assert.ok(lstatSync(target).isSymbolicLink(), `${place}: the link is left as it was`);
  }
});

test("a symlinked .github, .github/workflows or klaus.yml is refused, and the file it points at is not written", () => {
  const checkTags = () => ({ status: "protected", rulesets: [{ id: 1, name: "x" }] });
  for (const place of [".github", ".github/workflows", ".github/workflows/klaus.yml"]) {
    const repo = sampleRepo();
    const outside = outsideFolder();
    const target = path.join(repo, place);
    mkdirSync(path.dirname(target), { recursive: true });
    symlinkSync(place.endsWith(".yml") ? path.join(outside.dir, "target.mjs") : outside.dir, target);
    const before = outside.state();
    assert.throws(() => writeWorkflow({ repo, install: "pnpm install --frozen-lockfile", storybookBuild: "pnpm build-storybook", checkTags }), /symbolic link/, place);
    assert.equal(outside.state(), before, `${place}: nothing outside the repo changed`);
    assert.ok(lstatSync(target).isSymbolicLink(), `${place}: the link is left as it was`);
  }
});

test("files are written through a temporary name and renamed, leaving none behind", () => {
  const repo = sampleRepo();
  copyKlaus({ repo });
  writeWorkflow({ repo, install: "pnpm install --frozen-lockfile", storybookBuild: "pnpm build-storybook", checkTags: () => ({ status: "protected", rulesets: [{ id: 1, name: "x" }] }) });
  const stray = (dir) => readdirSync(dir, { recursive: true }).filter((name) => String(name).endsWith(".tmp"));
  assert.deepEqual(stray(path.join(repo, "scripts")), []);
  assert.deepEqual(stray(path.join(repo, ".github")), []);
  // The repo folder itself may be a link (macOS temp folders are), and that is not refused.
  const alias = path.join(tempDir(), "alias");
  symlinkSync(repo, alias);
  assert.doesNotThrow(() => copyKlaus({ repo: alias }));
});
