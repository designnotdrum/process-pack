/**
 * The runner with a fake adapter: step order, the spending cap, most-used-first
 * ordering, deferral to the next run, and failure handling.
 * Run with: node --test "plugins/process-pack/tools/klaus/frame/**\/*.test.mjs"
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyState } from "../state.mjs";
import { runKlaus } from "../runner.mjs";
import { configOf, fakeAdapter, inventoryOf } from "./fake-adapter.mjs";

/** A clock that moves one second per call, so timestamps are stable. */
function clock() {
  let t = Date.UTC(2026, 9, 18, 6, 0, 0);
  return () => new Date((t += 1000));
}

function run(options) {
  return runKlaus({ releases: ["v1.0.0"], trigger: "release", release: "v1.0.0", now: clock(), env: {}, ...options });
}

const names = (count) => Array.from({ length: count }, (_, i) => `C${String(i).padStart(2, "0")}`);

test("calls plan, estimate, write, report in that order", async () => {
  const log = [];
  const adapter = fakeAdapter({ log, ids: ["Button", "Card"] });
  const { report } = await run({ config: configOf(), inventory: inventoryOf({ Button: 5, Card: 2 }), adapters: { storybook: adapter } });

  assert.deepEqual(log.map((e) => e.step), ["plan", "estimate", "write", "report"]);
  assert.equal(adapter.seen.plan[0].release, "v1.0.0");
  assert.deepEqual(adapter.seen.write[0].items.map((i) => i.id), ["Button", "Card"]);
  assert.deepEqual(adapter.seen.report[0].written, ["Button", "Card"]);
  assert.equal(report.status, "ok");
});

test("runs each enabled output to the end before starting the next, and skips disabled ones", async () => {
  const log = [];
  const config = configOf({ outputs: { storybook: { enabled: true }, figma: { enabled: true }, penpot: { enabled: false } } });
  const adapters = {
    storybook: fakeAdapter({ log, output: "storybook", ids: ["Button"] }),
    figma: fakeAdapter({ log, output: "figma", ids: ["Button"] }),
    penpot: fakeAdapter({ log, output: "penpot", ids: ["Button"] }),
  };
  await run({ config, inventory: inventoryOf({ Button: 1 }), adapters });

  assert.deepEqual(log.map((e) => `${e.output}:${e.step}`), [
    "storybook:plan", "storybook:estimate", "storybook:write", "storybook:report",
    "figma:plan", "figma:estimate", "figma:write", "figma:report",
  ]);
});

test("over the write cap, writes the 50 most-used components and defers the rest without failing", async () => {
  const log = [];
  const ids = names(60);
  // C00 is the most used and C59 the least.
  const inventory = inventoryOf(Object.fromEntries(ids.map((id, i) => [id, 100 - i])));
  // The plan lists them in the opposite order, so the sort has to do the work.
  const adapter = fakeAdapter({ log, ids: [...ids].reverse() });
  const { report, state } = await run({ config: configOf(), inventory, adapters: { storybook: adapter } });

  assert.equal(report.cap.maxComponentWrites, 50);
  assert.equal(report.cap.maxRelayTokens, 100000);
  assert.equal(report.status, "ok");
  const out = report.outputs[0];
  assert.deepEqual(out.written, ids.slice(0, 50));
  assert.deepEqual(out.deferred.map((d) => d.id), ids.slice(50));
  assert.ok(out.deferred.every((d) => d.reason === "write-cap"));
  assert.deepEqual(state.outputs.storybook.unwritten, ids.slice(50));
});

test("hands write the items most-used first, with the lower id first on a tie", async () => {
  const log = [];
  const adapter = fakeAdapter({ log, ids: ["D", "A", "C", "B"] });
  await run({ config: configOf(), inventory: inventoryOf({ A: 3, B: 9, C: 9, D: 1 }), adapters: { storybook: adapter } });

  const given = adapter.seen.write[0].items;
  assert.deepEqual(given.map((i) => i.id), ["B", "C", "A", "D"]);
  assert.deepEqual(given.map((i) => i.usage), [9, 9, 3, 1]);
});

test("a component missing from the inventory counts as unused and is written last", async () => {
  const log = [];
  const adapter = fakeAdapter({ log, ids: ["Ghost", "Button"] });
  await run({ config: configOf(), inventory: inventoryOf({ Button: 1 }), adapters: { storybook: adapter } });
  assert.deepEqual(adapter.seen.write[0].items.map((i) => i.id), ["Button", "Ghost"]);
});

test("over the token cap, defers what does not fit and writes the most-used that do", async () => {
  const log = [];
  const config = configOf({ spendingCap: { maxRelayTokens: 250 } });
  const adapter = fakeAdapter({ log, ids: ["A", "B", "C", "D"] });
  const { report } = await run({ config, inventory: inventoryOf({ A: 4, B: 3, C: 2, D: 1 }), adapters: { storybook: adapter } });

  const out = report.outputs[0];
  assert.deepEqual(out.written, ["A", "B"]);
  assert.deepEqual(out.deferred.map((d) => [d.id, d.reason]), [["C", "token-cap"], ["D", "token-cap"]]);
  assert.equal(out.estimated.tokens, 200);
  assert.equal(out.estimatedUncapped.tokens, 400);
});

test("a component that alone exceeds the token cap is deferred and does not block the rest", async () => {
  const log = [];
  const config = configOf({ spendingCap: { maxRelayTokens: 250 } });
  const cost = (id) => ({ calls: 1, tokens: id === "Huge" ? 900 : 100, usd: 0.01 });
  const adapter = fakeAdapter({ log, ids: ["Huge", "A", "B"], cost });
  const { report } = await run({ config, inventory: inventoryOf({ Huge: 50, A: 2, B: 1 }), adapters: { storybook: adapter } });

  const out = report.outputs[0];
  assert.deepEqual(out.written, ["A", "B"]);
  assert.deepEqual(out.deferred.map((d) => [d.id, d.reason]), [["Huge", "larger-than-token-cap"]]);
});

test("screens do not count against the component write cap", async () => {
  const log = [];
  const config = configOf({ spendingCap: { maxComponentWrites: 1 } });
  const adapter = fakeAdapter({ log, ids: ["A", "B"], screens: ["/home"] });
  const { report } = await run({ config, inventory: inventoryOf({ A: 2, B: 1 }), adapters: { storybook: adapter } });

  assert.deepEqual(report.outputs[0].written, ["A", "/home"]);
  assert.deepEqual(report.outputs[0].deferred.map((d) => d.id), ["B"]);
});

test("what the cap deferred is handed back to the plan on the next run and written then", async () => {
  const config = configOf({ spendingCap: { maxComponentWrites: 2 } });
  const inventory = inventoryOf({ A: 4, B: 3, C: 2, D: 1 });

  const first = await run({ config, inventory, adapters: { storybook: fakeAdapter({ log: [], ids: ["A", "B", "C", "D"] }) } });
  assert.deepEqual(first.report.outputs[0].written, ["A", "B"]);
  assert.deepEqual(first.state.outputs.storybook, {
    lastRelease: "v1.0.0",
    lastRunAt: "2026-10-18T06:00:02.000Z",
    unwritten: ["C", "D"],
  });

  // Nothing new in the second release: the plan is only what the first run left.
  const secondAdapter = fakeAdapter({ log: [], ids: [] });
  const second = await run({
    config, inventory, state: first.state, releases: ["v1.0.0", "v1.1.0"], release: "v1.1.0",
    adapters: { storybook: secondAdapter },
  });
  assert.deepEqual(secondAdapter.seen.plan[0].unwrittenFromLastRun, ["C", "D"]);
  assert.deepEqual(second.report.outputs[0].written, ["C", "D"]);
  assert.deepEqual(second.state.outputs.storybook.unwritten, []);
  assert.equal(second.state.outputs.storybook.lastRelease, "v1.1.0");
});

test("overhead counts against the token cap before any item", async () => {
  const config = configOf({ spendingCap: { maxRelayTokens: 250 } });
  const adapter = fakeAdapter({ log: [], ids: ["A", "B"], overhead: { calls: 1, tokens: 100, usd: 0.5 } });
  const { report } = await run({ config, inventory: inventoryOf({ A: 2, B: 1 }), adapters: { storybook: adapter } });

  assert.deepEqual(report.outputs[0].written, ["A"]);
  assert.equal(report.outputs[0].estimated.tokens, 200);
  assert.equal(report.outputs[0].estimated.usd, 0.51);
});

test("overhead that alone exceeds the token cap defers everything as larger than the cap", async () => {
  const config = configOf({ spendingCap: { maxRelayTokens: 250 } });
  const adapter = fakeAdapter({ log: [], ids: ["A", "B"], overhead: { calls: 1, tokens: 300, usd: 0 } });
  const { report } = await run({ config, inventory: inventoryOf({ A: 2, B: 1 }), adapters: { storybook: adapter } });

  assert.deepEqual(report.outputs[0].written, []);
  assert.deepEqual(report.outputs[0].deferred.map((d) => [d.id, d.reason]), [["A", "larger-than-token-cap"], ["B", "larger-than-token-cap"]]);
  assert.equal(adapter.seen.write.length, 0);
});

test("a write that fails is reported, retried next run, and marks the run failed", async () => {
  const adapter = fakeAdapter({ log: [], ids: ["A", "B"], failIds: ["B"] });
  const { report, state } = await run({ config: configOf(), inventory: inventoryOf({ A: 2, B: 1 }), adapters: { storybook: adapter } });

  assert.equal(report.status, "failed");
  assert.deepEqual(report.outputs[0].written, ["A"]);
  assert.deepEqual(report.outputs[0].failed, [{ id: "B", error: "relay refused it" }]);
  assert.deepEqual(state.outputs.storybook.unwritten, ["B"]);
});

test("a write that reports the same id twice fails the output instead of double counting", async () => {
  const adapter = fakeAdapter({ log: [], ids: ["A"] });
  adapter.write = () => ({ written: ["A", "A"], actual: { calls: 1 } });
  const { report } = await run({ config: configOf(), inventory: inventoryOf({ A: 1 }), adapters: { storybook: adapter } });

  assert.equal(report.outputs[0].status, "failed");
  assert.equal(report.outputs[0].failedStep, "write");
  assert.match(report.outputs[0].error, /same id more than once/);
});

test("an adapter that returns fewer ids than it was given leaves the rest unwritten", async () => {
  const adapter = fakeAdapter({ log: [], ids: ["A", "B"] });
  adapter.write = () => ({ written: ["A"], actual: { calls: 1 } });
  const { report, state } = await run({ config: configOf(), inventory: inventoryOf({ A: 2, B: 1 }), adapters: { storybook: adapter } });

  assert.deepEqual(report.outputs[0].deferred.map((d) => [d.id, d.reason]), [["B", "not-written"]]);
  assert.deepEqual(state.outputs.storybook.unwritten, ["B"]);
});

test("an output that throws is reported failed, keeps its old state, and does not stop the others", async () => {
  const log = [];
  const config = configOf({ outputs: { storybook: { enabled: true, secrets: ["STORYBOOK_TOKEN"] }, figma: { enabled: true } } });
  const before = { version: 1, outputs: { storybook: { lastRelease: "v0.9.0", unwritten: [] } } };
  const adapters = {
    storybook: fakeAdapter({ log, output: "storybook", ids: ["A"], throwAt: "estimate" }),
    figma: fakeAdapter({ log, output: "figma", ids: ["A"] }),
  };
  const { report, state } = await run({
    config, inventory: inventoryOf({ A: 1 }), adapters, state: before, releases: ["v0.9.0", "v1.0.0"],
    env: { STORYBOOK_TOKEN: "token-value-12345678" },
  });

  const [storybook, figma] = report.outputs;
  assert.equal(storybook.status, "failed");
  assert.equal(storybook.failedStep, "estimate");
  assert.equal(storybook.error, "estimate blew up with [redacted]");
  assert.equal(figma.status, "ok");
  assert.deepEqual(state.outputs.storybook, before.outputs.storybook);
  assert.equal(state.outputs.figma.lastRelease, "v1.0.0");
  assert.equal(report.status, "failed");
});

test("an enabled output with no adapter installed is reported failed", async () => {
  const { report } = await run({ config: configOf(), inventory: inventoryOf({}), adapters: {} });
  assert.equal(report.outputs[0].status, "failed");
  assert.match(report.outputs[0].error, /No adapter is installed for the storybook output/);
});

test("an adapter missing a step is reported failed", async () => {
  const adapter = fakeAdapter({ log: [], ids: ["A"] });
  delete adapter.estimate;
  const { report } = await run({ config: configOf(), inventory: inventoryOf({ A: 1 }), adapters: { storybook: adapter } });
  assert.match(report.outputs[0].error, /missing the estimate step/);
});

test("a secret named in the config but absent from the environment fails the output before any step", async () => {
  const log = [];
  const config = configOf({ outputs: { figma: { enabled: true, secrets: ["FIGMA_TOKEN", "OTHER_NAME"] } } });
  const { report } = await run({
    config, inventory: inventoryOf({ A: 1 }), adapters: { figma: fakeAdapter({ log, output: "figma", ids: ["A"] }) },
    env: { OTHER_NAME: "present-value-123" },
  });

  assert.deepEqual(log, []);
  assert.match(report.outputs[0].error, /not set in the environment: FIGMA_TOKEN\./);
});

test("secret values are removed from what the adapter reports, including its details", async () => {
  const config = configOf({ outputs: { storybook: { enabled: true, secrets: ["VERCEL_TOKEN"] } } });
  const adapter = fakeAdapter({ log: [], ids: ["A"] });
  adapter.report = () => ({ summary: "deployed with abc-123-xyz-789", details: { debug: ["token abc-123-xyz-789"] } });
  const { report } = await run({ config, inventory: inventoryOf({ A: 1 }), adapters: { storybook: adapter }, env: { VERCEL_TOKEN: "abc-123-xyz-789" } });

  assert.equal(report.outputs[0].adapter.summary, "deployed with [redacted]");
  assert.deepEqual(report.outputs[0].adapter.details, { debug: ["token [redacted]"] });
});

test("an adapter can read only the secrets its output lists", async () => {
  const config = configOf({ outputs: { storybook: { enabled: true, secrets: ["VERCEL_TOKEN"] } } });
  const adapter = fakeAdapter({ log: [], ids: ["A"] });
  let seen;
  const plan = adapter.plan;
  adapter.plan = (ctx) => {
    seen = ctx.secret("VERCEL_TOKEN");
    assert.throws(() => ctx.secret("SOMETHING_ELSE"), /not listed under secrets/);
    return plan(ctx);
  };
  await run({ config, inventory: inventoryOf({ A: 1 }), adapters: { storybook: adapter }, env: { VERCEL_TOKEN: "abc-123-xyz-789" } });
  assert.equal(seen, "abc-123-xyz-789");
});

test("a dry run plans and estimates but never writes, and leaves the state alone", async () => {
  const log = [];
  const adapter = fakeAdapter({ log, ids: ["A", "B"] });
  const before = emptyState();
  const { report, state } = await run({ config: configOf(), inventory: inventoryOf({ A: 2, B: 1 }), adapters: { storybook: adapter }, dryRun: true, state: before });

  assert.deepEqual(log.map((e) => e.step), ["plan", "estimate", "report"]);
  assert.equal(report.dryRun, true);
  assert.equal(report.outputs[0].status, "dry-run");
  assert.deepEqual(report.outputs[0].written, []);
  assert.equal(report.outputs[0].estimated.calls, 2);
  assert.equal(report.status, "ok");
  assert.deepEqual(state, emptyState());
});

test("a model-free run skips adapters that need a model", async () => {
  const log = [];
  const config = configOf({ outputs: { storybook: { enabled: true }, figma: { enabled: true } } });
  const adapters = {
    storybook: fakeAdapter({ log, output: "storybook", ids: ["A"] }),
    figma: fakeAdapter({ log, output: "figma", ids: ["A"], usesModel: true }),
  };
  const { report, state } = await run({ config, inventory: inventoryOf({ A: 1 }), adapters, modelFree: true });

  assert.ok(log.every((e) => e.output === "storybook"));
  assert.deepEqual(report.outputs.map((o) => [o.output, o.status, o.reason]), [["storybook", "ok", null], ["figma", "skipped", "needs-model"]]);
  assert.equal(state.outputs.figma, undefined);
});

test("a trigger the config does not enable is skipped, except a manual run", async () => {
  const log = [];
  const config = configOf({ trigger: { mode: "schedule", cron: "0 6 * * 1" } });
  const adapters = { storybook: fakeAdapter({ log, ids: ["A"] }) };
  const inventory = inventoryOf({ A: 1 });

  const byTag = await run({ config, inventory, adapters });
  assert.equal(byTag.report.status, "skipped");
  assert.match(byTag.report.reason, /release trigger is not enabled/);
  assert.deepEqual(log, []);

  const byHand = await run({ config, inventory, adapters, trigger: "manual", release: undefined });
  assert.equal(byHand.report.status, "ok");
  assert.deepEqual(byHand.report.outputs[0].written, ["A"]);
});

test("an output already up to date for the release is skipped without calling the adapter", async () => {
  const log = [];
  const state = { version: 1, outputs: { storybook: { lastRelease: "v1.0.0", unwritten: [] } } };
  const { report } = await run({ config: configOf(), inventory: inventoryOf({ A: 1 }), adapters: { storybook: fakeAdapter({ log, ids: ["A"] }) }, state });

  assert.deepEqual(log, []);
  assert.deepEqual([report.outputs[0].status, report.outputs[0].reason], ["skipped", "up-to-date"]);
});

test("a scheduled run covers every release since the last run and tells the adapter", async () => {
  const adapter = fakeAdapter({ log: [], ids: ["A"] });
  const state = { version: 1, outputs: { storybook: { lastRelease: "v1.0.0", unwritten: [] } } };
  const { report, state: next } = await run({
    config: configOf({ trigger: { mode: "schedule", cron: "0 6 * * 1" } }),
    inventory: inventoryOf({ A: 1 }), adapters: { storybook: adapter }, state,
    trigger: "schedule", release: undefined, releases: ["v0.9.0", "v1.0.0", "v1.1.0", "v1.2.0"],
  });

  assert.deepEqual(adapter.seen.plan[0].releases, ["v1.1.0", "v1.2.0"]);
  assert.equal(adapter.seen.plan[0].release, "v1.2.0");
  assert.deepEqual(report.outputs[0].releases, ["v1.1.0", "v1.2.0"]);
  assert.equal(report.release, "v1.2.0");
  assert.equal(next.outputs.storybook.lastRelease, "v1.2.0");
});

test("the report adds up cost across outputs and keeps estimated and actual apart", async () => {
  const log = [];
  const config = configOf({ outputs: { storybook: { enabled: true }, figma: { enabled: true } } });
  const adapters = {
    storybook: fakeAdapter({ log, output: "storybook", ids: ["A", "B"] }),
    figma: fakeAdapter({ log, output: "figma", ids: ["A"] }),
  };
  const { report } = await run({ config, inventory: inventoryOf({ A: 2, B: 1 }), adapters });

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.totals.written, 3);
  assert.deepEqual(report.totals.estimated, { calls: 3, tokens: 300, usd: 0.03 });
  assert.deepEqual(report.totals.actual, { calls: 3, tokens: 240, usd: 0.024 });
  assert.deepEqual(report.outputs[0].adapter.links, [{ label: "Result", url: "https://example.test/v1.0.0" }]);
  assert.equal(report.startedAt, "2026-10-18T06:00:01.000Z");
});

test("an adapter that writes and reports no cost is flagged and its actual cost is null", async () => {
  const adapter = fakeAdapter({ log: [], ids: ["A"], omitActual: true });
  const { report } = await run({ config: configOf(), inventory: inventoryOf({ A: 1 }), adapters: { storybook: adapter } });

  assert.equal(report.outputs[0].actual, null);
  assert.match(report.outputs[0].warnings[0], /did not report what the writes cost/);
  assert.deepEqual(report.totals.actual, { calls: 0, tokens: 0, usd: 0 });
});

test("a report step that throws is a warning, not a failure, and the state still advances", async () => {
  const adapter = fakeAdapter({ log: [], ids: ["A"], throwAt: "report" });
  const { report, state } = await run({ config: configOf(), inventory: inventoryOf({ A: 1 }), adapters: { storybook: adapter } });

  assert.equal(report.status, "ok");
  assert.match(report.outputs[0].warnings[0], /report step failed/);
  assert.equal(state.outputs.storybook.lastRelease, "v1.0.0");
});

test("a release run for a tag that is not a known release is an error", async () => {
  await assert.rejects(
    run({ config: configOf(), inventory: inventoryOf({}), adapters: {}, release: "v9.9.9" }),
    /Release v9.9.9 is not among the release tags/,
  );
});
