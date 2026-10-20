/**
 * CI and what the relay sent. The relay runs on another machine and publishes its sent and changed
 * marks to the KLAUS_FIGMA_LEDGER variable; the workflow passes the variable to the generator.
 * These runs are the Meridian case of issue #76: 10 components, room for 4 a night.
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ciRun, inventoryOf, newRepo, sharedRecord } from "./ci-fixture.mjs";

const NAMES = ["Button", "Input", "Spinner", "Dialog", "Card", "Badge", "Tooltip", "Switch", "Table", "Tabs"];
const FIRST = ["Button", "Input", "Spinner", "Dialog"];
const NEXT = ["Card", "Badge", "Tooltip", "Switch"];
const inventory = inventoryOf(NAMES);
const sorted = (list) => [...list].sort();
const sharedWarnings = (output) => output.warnings.filter((w) => w.includes("KLAUS_FIGMA_LEDGER"));

test("CI plans the next units once the variable marks the first ones sent", async () => {
  const root = newRepo();
  const first = await ciRun(root, { inventory });
  assert.deepEqual(sorted(first.output.written), sorted(FIRST), "the default cap fits four Button-sized versions");
  assert.equal(first.output.deferred.length, 6);

  // The relay sent those four on its own machine and published the marks.
  const second = await ciRun(root, { inventory, state: first.state, env: { KLAUS_FIGMA_LEDGER: sharedRecord(FIRST) } });
  assert.deepEqual(sorted(second.output.written), sorted(NEXT), "the next four by usage");
  assert.equal(second.output.planned, 6, "a sent unit is not planned");
  assert.equal(sharedWarnings(second.output).length, 1, "CI's ledger never records sent, so the four are named (see below)");
});

test("CI plans the same units again when the variable is absent, and says why", async () => {
  const root = newRepo();
  const first = await ciRun(root, { inventory });
  const second = await ciRun(root, { inventory, state: first.state, env: {} });

  assert.deepEqual(sorted(second.output.written), sorted(FIRST), "nothing tells CI the first four reached Figma");
  const [warning] = sharedWarnings(second.output);
  assert.match(warning, /KLAUS_FIGMA_LEDGER is not set/);
});

test("an empty variable, as the workflow passes an unset one, counts as absent", async () => {
  const root = newRepo();
  const first = await ciRun(root, { inventory });
  const second = await ciRun(root, { inventory, state: first.state, env: { KLAUS_FIGMA_LEDGER: "" } });
  assert.deepEqual(sorted(second.output.written), sorted(FIRST));
  assert.match(sharedWarnings(second.output)[0], /KLAUS_FIGMA_LEDGER is not set/);
});

test("a malformed variable is a warning and the run plans as if nothing was sent", async () => {
  const root = newRepo();
  const first = await ciRun(root, { inventory });
  for (const text of ["{not json", JSON.stringify(["Button"]), JSON.stringify({ version: 9, components: {}, screens: {} })]) {
    const run = await ciRun(root, { inventory, state: first.state, env: { KLAUS_FIGMA_LEDGER: text }, dryRun: true });
    assert.equal(run.report.status, "ok", text);
    assert.equal(run.output.planned, 10, text);
    assert.match(sharedWarnings(run.output)[0], /KLAUS_FIGMA_LEDGER is not a record the relay writes/, text);
  }
});

test("a variable for another Figma file is not used", async () => {
  const root = newRepo();
  const run = await ciRun(root, { inventory, env: { KLAUS_FIGMA_LEDGER: sharedRecord(FIRST, { fileKey: "AnotherFigmaFileKey0000" }) }, dryRun: true });
  assert.equal(run.output.planned, 10);
  assert.match(sharedWarnings(run.output)[0], /AnotherFigmaFileKey0000/);
});

test("a version the variable marks changed is planned again, as a changed version in CI's own ledger would be", async () => {
  const root = newRepo();
  const run = await ciRun(root, { inventory, env: { KLAUS_FIGMA_LEDGER: sharedRecord(["Button"], { status: "changed" }) }, dryRun: true });
  assert.equal(run.output.planned, 10);
  assert.deepEqual(sharedWarnings(run.output), []);
});

test("CI's own ledger keeps what CI generated; the variable's marks are read on every run, not copied into it", async () => {
  const root = newRepo();
  const first = await ciRun(root, { inventory });
  await ciRun(root, { inventory, state: first.state, env: { KLAUS_FIGMA_LEDGER: sharedRecord(FIRST) } });
  const ledger = JSON.parse(readFileSync(path.join(root, ".klaus/figma/ledger.json"), "utf8"));
  for (const name of [...FIRST, ...NEXT]) assert.deepEqual(ledger.components[name], { "1.0.0": "generated" }, name);
});

// ---------------------------------------------------------------------------------------------
// A forged record is visible: every version only the variable marks sent is named in the report.
// ---------------------------------------------------------------------------------------------

test("a version the record alone marks sent is named in a warning, counted in the details, and said in the summary", async () => {
  const root = newRepo();
  const first = await ciRun(root, { inventory });
  // CI's own ledger has the first four as generated. The record says they were sent.
  const second = await ciRun(root, { inventory, state: first.state, env: { KLAUS_FIGMA_LEDGER: sharedRecord(FIRST) } });

  const [warning] = sharedWarnings(second.output);
  assert.match(warning, /^KLAUS_FIGMA_LEDGER alone marks 4 versions sent, so this run did not plan them: /);
  for (const name of FIRST) assert.ok(warning.includes(`${name} 1.0.0`), name);
  const { sharedLedger } = second.output.adapter.details;
  assert.equal(sharedLedger.variable, "KLAUS_FIGMA_LEDGER");
  assert.equal(sharedLedger.read, "read");
  assert.deepEqual(sharedLedger.sentOnlyInVariable, { count: 4, versions: FIRST.map((name) => `${name} 1.0.0`).sort() });
  assert.match(second.output.adapter.summary, /KLAUS_FIGMA_LEDGER alone marks 4 versions sent, so they were not planned\./);

  // A dry run says the same, so the mark shows before anything is written.
  const dry = await ciRun(root, { inventory, state: second.state, env: { KLAUS_FIGMA_LEDGER: sharedRecord(FIRST) }, dryRun: true });
  assert.equal(dry.output.adapter.details.sharedLedger.sentOnlyInVariable.count, 4);
  assert.match(dry.output.adapter.summary, /KLAUS_FIGMA_LEDGER alone marks 4 versions sent/);
});

test("a record that agrees with CI's own ledger adds no warning and no count", async () => {
  const root = newRepo();
  mkdirSync(path.join(root, ".klaus/figma"), { recursive: true });
  const own = { version: 2, components: Object.fromEntries(FIRST.map((name) => [name, { "1.0.0": "sent" }])), screens: {} };
  writeFileSync(path.join(root, ".klaus/figma/ledger.json"), JSON.stringify(own));
  const run = await ciRun(root, { inventory, env: { KLAUS_FIGMA_LEDGER: sharedRecord(FIRST) }, dryRun: true });

  assert.equal(run.output.planned, 6);
  assert.deepEqual(sharedWarnings(run.output), []);
  assert.deepEqual(run.output.adapter.details.sharedLedger.sentOnlyInVariable, { count: 0, versions: [] });
  assert.doesNotMatch(run.output.adapter.summary, /KLAUS_FIGMA_LEDGER/);
});
