/**
 * A first load: one output writes every item its plan lists for the newest release, with no
 * spending cap, even when the state says that release is covered. The Figma output uses it for
 * the data the Klaus plugin applies in one run.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { runKlaus } from "../runner.mjs";
import { configOf, fakeAdapter, inventoryOf } from "./fake-adapter.mjs";

const RELEASES = ["v1.0.0", "v1.1.0"];
const IDS = ["A", "B", "C", "D", "E"];
const USAGE = { A: 5, B: 4, C: 3, D: 2, E: 1 };

/** Both outputs covered v1.1.0 in an earlier run and left nothing unwritten. */
const COVERED = {
  version: 1,
  outputs: {
    storybook: { lastRelease: "v1.1.0", lastRunAt: "2026-10-19T06:00:00.000Z", unwritten: [] },
    figma: { lastRelease: "v1.1.0", lastRunAt: "2026-10-19T06:00:00.000Z", unwritten: [] },
  },
};

function setup({ failIds = [] } = {}) {
  const log = [];
  const config = configOf({ outputs: { storybook: { enabled: true }, figma: { enabled: true } }, spendingCap: { maxComponentWrites: 2, maxRelayTokens: 250 } });
  const adapters = {
    storybook: fakeAdapter({ log, output: "storybook", ids: IDS }),
    figma: fakeAdapter({ log, output: "figma", ids: IDS, failIds }),
  };
  return { config, adapters, inventory: inventoryOf(USAGE) };
}

const run = (options) => runKlaus({ releases: RELEASES, trigger: "manual", env: {}, state: COVERED, ...options });
const outputNamed = (report, name) => report.outputs.find((o) => o.output === name);

test("a first load covers the newest release though the state says it is covered, and writes every item past the cap", async () => {
  const { config, adapters, inventory } = setup();
  const { report, state } = await run({ config, adapters, inventory, firstLoad: "figma" });

  const figma = outputNamed(report, "figma");
  assert.equal(figma.status, "ok");
  assert.deepEqual(figma.releases, ["v1.1.0"]);
  assert.equal(figma.planned, 5);
  assert.deepEqual(figma.written.toSorted(), IDS, "the write cap of 2 and the token cap of 250 do not apply");
  assert.deepEqual(figma.deferred, []);
  assert.equal(adapters.figma.seen.plan[0].firstLoad, true, "the adapter is told it is a first load");
  assert.ok(figma.warnings.some((w) => /first load/i.test(w) && /spending cap/.test(w)), "the report says the cap was not applied");
  assert.deepEqual(state.outputs.figma.unwritten, []);
  assert.equal(state.outputs.figma.lastRelease, "v1.1.0");

  // The other output runs as it would without the input: its release is covered.
  assert.equal(outputNamed(report, "storybook").status, "skipped");
  assert.equal(adapters.storybook.seen.plan.length, 0);
});

test("without a first load the same state skips the output, and a run that writes keeps the cap", async () => {
  const skipped = setup();
  const { report } = await run({ config: skipped.config, adapters: skipped.adapters, inventory: skipped.inventory });
  assert.equal(outputNamed(report, "figma").status, "skipped");
  assert.equal(outputNamed(report, "figma").reason, "up-to-date");

  const fresh = setup();
  const capped = await run({ config: fresh.config, adapters: fresh.adapters, inventory: fresh.inventory, state: undefined });
  const figma = outputNamed(capped.report, "figma");
  assert.deepEqual(figma.written, ["A", "B"], "two writes fit the cap");
  assert.equal(figma.deferred.length, 3);
  assert.equal(fresh.adapters.figma.seen.plan[0].firstLoad, false);
});

test("a first load still reports a failed write and keeps it for the next run", async () => {
  const { config, adapters, inventory } = setup({ failIds: ["C"] });
  const { report, state } = await run({ config, adapters, inventory, firstLoad: "figma" });
  assert.equal(report.status, "failed");
  assert.deepEqual(outputNamed(report, "figma").failed.map((f) => f.id), ["C"]);
  assert.deepEqual(state.outputs.figma.unwritten, ["C"]);
});

test("a dry run of a first load shows every item and writes nothing", async () => {
  const { config, adapters, inventory } = setup();
  const { report, state } = await run({ config, adapters, inventory, firstLoad: "figma", dryRun: true });
  const figma = outputNamed(report, "figma");
  assert.equal(figma.status, "dry-run");
  assert.equal(figma.planned, 5);
  assert.deepEqual(figma.deferred, []);
  assert.equal(figma.estimated.calls, 5);
  assert.equal(adapters.figma.seen.write.length, 0);
  assert.deepEqual(state, COVERED);
});

test("a first load for an output that is not enabled stops the run before any output runs", async () => {
  const { config, adapters, inventory } = setup();
  await assert.rejects(run({ config, adapters, inventory, firstLoad: "penpot" }), /penpot is not an enabled output/);
  assert.equal(adapters.figma.seen.plan.length + adapters.storybook.seen.plan.length, 0);
});

test("warnings an adapter's plan returns reach the output's warnings", async () => {
  const log = [];
  const adapter = fakeAdapter({ log, ids: ["A"] });
  const plan = adapter.plan;
  adapter.plan = (ctx) => ({ ...plan(ctx), warnings: ["The shared record is not set."] });
  const { report } = await runKlaus({ config: configOf(), inventory: inventoryOf({ A: 1 }), adapters: { storybook: adapter }, releases: ["v1.0.0"], trigger: "manual", env: {} });
  assert.ok(report.outputs[0].warnings.includes("The shared record is not set."));
});
