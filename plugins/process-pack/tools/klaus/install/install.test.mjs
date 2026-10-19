/**
 * The install step: the copy with its version line, the cost estimate taken from
 * the adapters, and the rendered workflow.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveConfig } from "../frame/config.mjs";
import { copyKlaus, listFiles, SOURCE_ROOT, versionLine } from "./copy.mjs";
import { estimateOutputs, formatCosts } from "./costs.mjs";
import { checkRuleset, createRuleset, explainRuleset, protects, rulesetBody, RULESET_NAME } from "./ruleset.mjs";
import { lintWorkflow, renderWorkflow, requireTagRuleset, writeWorkflow } from "./workflow.mjs";

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
  const result = writeWorkflow({ repo, install: "pnpm install --frozen-lockfile", storybookBuild: "pnpm build-storybook -o storybook-static", checkTags: () => ({ status: "protected", ruleset: { id: 1, name: RULESET_NAME } }) });
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
  assert.match(release, /repository\s+# ruleset that lets only maintainers create or update tags/);
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

const TAG_RULESET = { id: 41, name: "release tags", target: "tag", enforcement: "active", conditions: { ref_name: { include: ["refs/tags/v*"], exclude: [] } }, rules: [{ type: "creation" }, { type: "update" }, { type: "deletion" }] };

test("the ruleset to create limits creating and updating the release tags, with admins let through", () => {
  const body = rulesetBody({ tagPattern: "v*", apps: ["123"], teams: [9] });
  assert.equal(body.target, "tag");
  assert.equal(body.enforcement, "active");
  assert.deepEqual(body.conditions.ref_name, { include: ["refs/tags/v*"], exclude: [] });
  assert.deepEqual(body.rules, [{ type: "creation" }, { type: "update" }]);
  assert.deepEqual(body.bypass_actors, [
    { actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" },
    { actor_id: 123, actor_type: "Integration", bypass_mode: "always" },
    { actor_id: 9, actor_type: "Team", bypass_mode: "always" },
  ]);
  assert.throws(() => rulesetBody({ tagPattern: "v*", apps: ["abc"] }), /not an id/);
  const words = explainRuleset(body);
  assert.match(words, /Why: a pushed tag runs the workflow file from the tagged commit/);
  assert.match(words, /repository admins, app 123, team 9/);
  assert.match(words, /Who it blocks: everyone not listed, including any workflow that makes release tags today/);
});

test("a ruleset protects the tags only when it is on, covers the pattern, and limits both creating and updating", () => {
  assert.equal(protects(TAG_RULESET, "v*"), true);
  assert.equal(protects({ ...TAG_RULESET, conditions: { ref_name: { include: ["~ALL"], exclude: [] } } }, "v*"), true);
  assert.equal(protects({ ...TAG_RULESET, enforcement: "evaluate" }, "v*"), false);
  assert.equal(protects({ ...TAG_RULESET, enforcement: "disabled" }, "v*"), false);
  assert.equal(protects({ ...TAG_RULESET, target: "branch" }, "v*"), false);
  assert.equal(protects({ ...TAG_RULESET, rules: [{ type: "creation" }] }, "v*"), false);
  assert.equal(protects({ ...TAG_RULESET, conditions: { ref_name: { include: ["refs/tags/release-*"], exclude: [] } } }, "v*"), false);
  assert.equal(protects({ ...TAG_RULESET, conditions: { ref_name: { include: ["refs/tags/v*"], exclude: ["refs/tags/v*"] } } }, "v*"), false);
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

test("checkRuleset reads the list, then each active tag ruleset in full, and reports protected, missing or unknown", () => {
  const repo = tempDir();
  const summaries = [
    { id: 7, name: "main: checks", target: "branch", enforcement: "active" },
    { id: 8, name: "old", target: "tag", enforcement: "disabled" },
    { id: 41, name: "release tags", target: "tag", enforcement: "active" },
  ];
  const found = fakeGh({ list: summaries, full: { 41: TAG_RULESET } });
  assert.deepEqual(checkRuleset({ repo, tagPattern: "v*", run: found.run }), { status: "protected", ruleset: TAG_RULESET });
  assert.deepEqual(found.calls.map((call) => call.args.at(-1)), ["repos/{owner}/{repo}/rulesets", "repos/{owner}/{repo}/rulesets/41"]);
  assert.equal(found.calls[0].cwd, repo, "gh runs inside the repo, so it fills in {owner} and {repo}");

  const none = fakeGh({ list: summaries.slice(0, 2) });
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
  const missing = () => ({ status: "missing" });
  assert.throws(() => writeWorkflow({ ...options, checkTags: missing }), /No active ruleset limits who can create or update tags matching v\*/);
  assert.equal(existsSync(path.join(repo, ".github/workflows/klaus.yml")), false, "nothing is written");
  assert.throws(() => writeWorkflow({ ...options, checkTags: () => ({ status: "unknown", reason: "gh api failed: HTTP 403" }) }), /could not be read \(gh api failed: HTTP 403\)/);
  assert.match(requireTagRuleset({ repo, config: resolveConfig(CONFIG), checkTags: () => ({ status: "protected", ruleset: { id: 3, name: "x" } }) }).name, /x/);

  write(path.join(repo, "klaus.config.json"), JSON.stringify({ ...CONFIG, trigger: { mode: "schedule", cron: "0 6 * * 1" } }));
  const scheduled = writeWorkflow({ ...options, checkTags: () => assert.fail("a schedule needs no tag ruleset") });
  assert.equal(scheduled.ruleset, null);
  assert.ok(existsSync(scheduled.destination));
});

test("the ruleset command shows what it would create, creates it only with --create, and says so when one exists", () => {
  const stub = tempDir();
  const log = path.join(stub, "log");
  write(path.join(stub, "gh"), `#!/bin/sh
echo "$@" >> "${log}"
case "$*" in
  *"--method POST"*) cat > "${log}.body"; echo '{"id": 77, "name": "Klaus release tags"}' ;;
  *"rulesets/41"*) echo '${JSON.stringify(TAG_RULESET)}' ;;
  *rulesets) echo "$GH_LIST" ;;
esac
`);
  spawnSync("chmod", ["+x", path.join(stub, "gh")]);
  const run = (args, list) => spawnSync(process.execPath, [path.join(SOURCE_ROOT, "install/install.mjs"), "ruleset", "--repo", tempDir(), "--tag-pattern", "v*", ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${stub}:${process.env.PATH}`, GH_LIST: JSON.stringify(list) },
  });

  const shown = run([], []);
  assert.equal(shown.status, 0, shown.stderr);
  assert.match(shown.stdout, /No active ruleset limits who can create or update tags matching v\*\. Nothing has been created/);
  assert.match(shown.stdout, /"target": "tag"/);
  assert.equal(existsSync(`${log}.body`), false, "nothing was posted");

  const created = run(["--create", "--bypass-app", "123"], []);
  assert.equal(created.status, 0, created.stderr);
  assert.match(created.stdout, /Created the ruleset "Klaus release tags" \(id 77\)/);
  assert.equal(JSON.parse(readFileSync(`${log}.body`, "utf8")).bypass_actors.some((actor) => actor.actor_id === 123 && actor.actor_type === "Integration"), true);

  rmSync(`${log}.body`);
  const already = run(["--create"], [{ id: 41, name: "release tags", target: "tag", enforcement: "active" }]);
  assert.match(already.stdout, /already limits who can create or update tags matching v\*: "release tags" \(id 41\)\. Nothing to create/);
  assert.equal(existsSync(`${log}.body`), false, "nothing was posted when a ruleset exists");
});
