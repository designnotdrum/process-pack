/**
 * The Figma first load: the workflow's figma_first_load input runs the generator for every planned
 * component of the newest release, with no spending cap, so the Klaus plugin can apply all of it.
 * Meridian's first run planned 80 components and the cap left room for 4 (issue #76).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ciRun, inventoryOf, manifestIn, newRepo, RELEASE, sharedRecord } from "./ci-fixture.mjs";

const NAMES = Array.from({ length: 80 }, (_, i) => `Component${String(i).padStart(2, "0")}`);
const inventory = inventoryOf(NAMES);

test("the first-load input writes data for every planned unit, regardless of the cap", async () => {
  const capped = newRepo();
  const normal = await ciRun(capped, { inventory });
  assert.equal(normal.output.planned, 80);
  assert.equal(normal.output.written.length, 4, "without the input the default cap fits four");
  assert.equal(manifestIn(capped).units.length, 4);

  // The state now says the release is covered, with 76 left for later runs. A first load ignores both.
  const first = await ciRun(capped, { inventory, state: normal.state, firstLoad: "figma" });
  assert.equal(first.report.status, "ok");
  assert.equal(first.output.written.length, 80);
  assert.deepEqual(first.output.deferred, []);
  const { manifest, units, dataFiles } = manifestIn(capped);
  assert.equal(units.length, 80, "80 data units");
  assert.equal(dataFiles.length, 80, "one component version a file, as componentsPerCall says");
  assert.equal(manifest.firstLoad, true, "the manifest says it is a first load, so the relay will not send it");
  assert.equal(manifest.release, RELEASE);
  assert.deepEqual(first.state.outputs.figma.unwritten, [], "nothing is left for the capped runs");
  assert.deepEqual(first.output.actual, { calls: 0, tokens: 0, usd: 0 }, "no relay tokens: the plugin applies it");
  assert.ok(normal.output.actual.tokens > 0, "a capped run's data costs relay tokens to send");
});

test("the report says it was a first load for the plugin", async () => {
  const root = newRepo();
  const { output } = await ciRun(root, { inventory, firstLoad: "figma" });
  assert.match(output.adapter.summary, /first load for the Klaus plugin/);
  assert.match(output.adapter.summary, /--reconcile/);
  assert.equal(output.adapter.details.firstLoad, true);
  assert.ok(output.warnings.some((w) => /First load/.test(w) && /spending cap/.test(w)));
});

test("a first load leaves out the versions the variable marks sent, which are in Figma already", async () => {
  const root = newRepo();
  const sent = NAMES.slice(0, 4);
  // A capped run generated the first four, and the relay sent them.
  const capped = await ciRun(root, { inventory });
  const { output } = await ciRun(root, { inventory, state: capped.state, firstLoad: "figma", env: { KLAUS_FIGMA_LEDGER: sharedRecord(sent) } });
  assert.equal(output.written.length, 76);
  assert.equal(manifestIn(root).units.some((id) => sent.includes(id)), false);
});

test("a dry run of a first load counts every planned unit and writes nothing", async () => {
  const root = newRepo();
  const { output } = await ciRun(root, { inventory, firstLoad: "figma", dryRun: true });
  assert.equal(output.status, "dry-run");
  assert.equal(output.planned, 80);
  assert.deepEqual(output.deferred, []);
  assert.deepEqual(output.estimated, { calls: 0, tokens: 0, usd: 0 }, "the plugin applies it with no relay call");
});
