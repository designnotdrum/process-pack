/**
 * The command line end to end: a throwaway git repo with release tags, a config,
 * an inventory and a fake adapter, run as a real process.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { inventoryOf } from "./fake-adapter.mjs";

const CLI = fileURLToPath(new URL("../cli.mjs", import.meta.url));
const FAKE = pathToFileURL(fileURLToPath(new URL("./fake-adapter.mjs", import.meta.url))).href;

/** A repo with one commit per tag, dated a day apart, so the tags have a clear order. */
function makeRepo({ tags = ["v1.0.0", "v1.1.0", "v1.2.0"], config, adapterSource } = {}) {
  const repo = mkdtempSync(path.join(tmpdir(), "klaus-cli-"));
  const git = (...args) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  git("init", "-q");
  tags.forEach((tag, i) => {
    const date = `2026-10-${String(10 + i).padStart(2, "0")}T12:00:00Z`;
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-q", "--allow-empty", "-m", tag], {
      cwd: repo,
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    });
    git("tag", tag);
  });

  writeFileSync(path.join(repo, "klaus.config.json"), JSON.stringify(config ?? { outputs: { storybook: { enabled: true } } }));
  writeFileSync(path.join(repo, "inventory.json"), JSON.stringify(inventoryOf({ A: 3, B: 2, C: 1 })));
  mkdirSync(path.join(repo, "adapters", "storybook"), { recursive: true });
  writeFileSync(
    path.join(repo, "adapters", "storybook", "index.mjs"),
    adapterSource ??
      `import { fakeAdapter } from ${JSON.stringify(FAKE)};
const adapter = fakeAdapter({ log: [], ids: ["A", "B", "C"] });
const report = adapter.report;
adapter.report = (outcome, ctx) => ({ ...report(outcome, ctx), details: { releases: ctx.releases } });
export default adapter;
`,
  );
  return repo;
}

function klaus(repo, ...args) {
  const result = spawnSync(process.execPath, [CLI, ...args, "--adapters", path.join(repo, "adapters")], { cwd: repo, encoding: "utf8" });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

const reportsIn = (repo) => {
  const dir = path.join(repo, ".klaus", "reports");
  return existsSync(dir) ? readdirSync(dir).map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8"))) : [];
};
const stateIn = (repo) => JSON.parse(readFileSync(path.join(repo, ".klaus", "state.json"), "utf8"));

test("a release run writes a report file and the state file, and exits 0", () => {
  const repo = makeRepo();
  const { code, out } = klaus(repo, "run", "--trigger", "release", "--release", "v1.0.0");

  assert.equal(code, 0);
  assert.match(out, /Klaus run: ok \(release v1\.0\.0\)/);
  const [report] = reportsIn(repo);
  assert.equal(report.outputs[0].output, "storybook");
  assert.deepEqual(report.outputs[0].written, ["A", "B", "C"]);
  assert.equal(stateIn(repo).outputs.storybook.lastRelease, "v1.0.0");
});

test("a later scheduled run covers every release since the last run, in tag order", () => {
  const repo = makeRepo({ config: { outputs: { storybook: { enabled: true } }, trigger: { mode: "schedule", cron: "0 6 * * 1" } } });
  klaus(repo, "run", "--trigger", "manual");
  assert.equal(stateIn(repo).outputs.storybook.lastRelease, "v1.2.0");

  // Later releases: v1.3.0 alone, then v1.9.0 and v1.10.0 tagged on one commit.
  // Tags made together tie on date and fall back to version order, where plain name order would put v1.10.0 first.
  const commit = (message, date, ...tags) => {
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-q", "--allow-empty", "-m", message], {
      cwd: repo, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    });
    for (const tag of tags) execFileSync("git", ["tag", tag], { cwd: repo });
  };
  commit("v1.3.0", "2026-10-20T12:00:00Z", "v1.3.0");
  commit("v1.9.0 and v1.10.0", "2026-10-21T12:00:00Z", "v1.10.0", "v1.9.0");
  const { code } = klaus(repo, "run", "--trigger", "schedule");

  assert.equal(code, 0);
  const reports = reportsIn(repo).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  assert.deepEqual(reports.at(-1).outputs[0].adapter.details.releases, ["v1.3.0", "v1.9.0", "v1.10.0"]);
  assert.equal(stateIn(repo).outputs.storybook.lastRelease, "v1.10.0");
});

test("running the same release again does nothing", () => {
  const repo = makeRepo();
  klaus(repo, "run", "--trigger", "release", "--release", "v1.2.0");
  const { code, out } = klaus(repo, "run", "--trigger", "release", "--release", "v1.2.0");

  assert.equal(code, 0);
  assert.match(out, /storybook: skipped \(up-to-date\)/);
  const reports = reportsIn(repo).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  assert.equal(reports.at(-1).outputs[0].status, "skipped");
  assert.equal(stateIn(repo).outputs.storybook.lastRelease, "v1.2.0");
  assert.deepEqual(stateIn(repo).outputs.storybook.unwritten, []);
});

test("a trigger the config does not enable exits 0 and writes nothing", () => {
  const repo = makeRepo();
  const { code, out } = klaus(repo, "run", "--trigger", "schedule");

  assert.equal(code, 0);
  assert.match(out, /schedule trigger is not enabled/);
  assert.equal(existsSync(path.join(repo, ".klaus")), false);
});

test("a dry run prints the estimate and writes no report or state", () => {
  const repo = makeRepo();
  const { code, out } = klaus(repo, "run", "--trigger", "manual", "--dry-run", "--json");

  assert.equal(code, 0);
  const report = JSON.parse(out);
  assert.equal(report.dryRun, true);
  assert.equal(report.outputs[0].status, "dry-run");
  assert.deepEqual(report.outputs[0].written, []);
  assert.equal(report.outputs[0].estimated.tokens, 300);
  assert.equal(existsSync(path.join(repo, ".klaus")), false);
});

test("a write that fails exits 1 and keeps the item for the next run", () => {
  const repo = makeRepo({
    adapterSource: `import { fakeAdapter } from ${JSON.stringify(FAKE)};
export default fakeAdapter({ log: [], ids: ["A", "B"], failIds: ["B"] });
`,
  });
  const { code, out } = klaus(repo, "run", "--trigger", "manual");

  assert.equal(code, 1);
  assert.match(out, /Klaus run: failed/);
  assert.deepEqual(stateIn(repo).outputs.storybook.unwritten, ["B"]);
});

test("an enabled output with no adapter folder is reported failed with exit 1", () => {
  const repo = makeRepo({ config: { outputs: { storybook: { enabled: true }, penpot: { enabled: true } } } });
  const { code, out } = klaus(repo, "run", "--trigger", "manual");

  assert.equal(code, 1);
  assert.match(out, /penpot: failed: No adapter is installed for the penpot output/);
});

test("a release run without --release, and an unknown trigger, exit 2", () => {
  const repo = makeRepo();
  const cases = [
    [["run", "--trigger", "release"], /--trigger release needs --release/],
    [["run", "--trigger", "release", "--release", "v9.9.9"], /Release v9\.9\.9 is not among the release tags/],
    [["run", "--trigger", "nightly"], /--trigger must be one of/],
    [["run"], /--trigger must be one of/],
    [["run", "--trigger", "manual", "--nope"], /Unknown option '--nope'/],
    [["explode"], /Usage: cli\.mjs/],
  ];
  for (const [args, message] of cases) {
    const { code, err } = klaus(repo, ...args);
    assert.equal(code, 2, args.join(" "));
    assert.match(err, message, args.join(" "));
  }
});

test("an adapter file that cannot be loaded is a bug, not a usage error: exit 3 with a stack", () => {
  const repo = makeRepo({ adapterSource: "throw new Error('adapter exploded on load');\n" });
  const { code, err } = klaus(repo, "run", "--trigger", "manual");

  assert.equal(code, 3);
  assert.match(err, /adapter exploded on load/);
  assert.match(err, /at /);
});

test("a state file that is not a state file stops the run with exit 2", () => {
  const repo = makeRepo();
  mkdirSync(path.join(repo, ".klaus"));
  writeFileSync(path.join(repo, ".klaus", "state.json"), "{ nope");
  const { code, err } = klaus(repo, "run", "--trigger", "manual");

  assert.equal(code, 2);
  assert.match(err, /is not valid JSON\. Delete it/);
});

test("validate accepts a good config and rejects a secret value without printing it", () => {
  const good = makeRepo();
  assert.equal(klaus(good, "validate").code, 0);

  const token = ["gh", "p_", "a1B2c3D4".repeat(5)].join("");
  const bad = makeRepo({ config: { outputs: { storybook: { enabled: true, target: token } } } });
  const { code, err, out } = klaus(bad, "validate");
  assert.equal(code, 2);
  assert.match(err, /outputs\.storybook\.target: looks like a secret value/);
  assert.ok(!(err + out).includes(token));
});

test("a run with a secret in the config stops before any adapter runs", () => {
  const token = ["gh", "p_", "a1B2c3D4".repeat(5)].join("");
  const repo = makeRepo({ config: { outputs: { storybook: { enabled: true, target: token } } } });
  const { code, err } = klaus(repo, "run", "--trigger", "manual");

  assert.equal(code, 2);
  assert.match(err, /outputs\.storybook\.target: looks like a secret value/);
  assert.ok(!err.includes(token));
  assert.equal(existsSync(path.join(repo, ".klaus")), false);
});
