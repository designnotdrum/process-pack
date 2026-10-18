/** The ledger: generated until the relay confirms a unit, then sent. */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  anyVersionSent,
  componentSent,
  emptyLedger,
  entryOf,
  entrySent,
  GENERATED,
  readLedger,
  recordComponent,
  recordEntry,
  screenSent,
  SENT,
} from "../ledger.mjs";

function ledgerFile(value) {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "klaus-ledger-")), "ledger.json");
  writeFileSync(file, JSON.stringify(value));
  return file;
}

test("a generated version is not sent, and a sent one is", () => {
  const ledger = emptyLedger();
  recordComponent(ledger, "Button", "1.0.0");
  assert.equal(ledger.components.Button["1.0.0"], GENERATED);
  assert.equal(componentSent(ledger, "Button", "1.0.0"), false);
  assert.equal(anyVersionSent(ledger, "Button"), false);

  recordComponent(ledger, "Button", "1.0.0", SENT);
  assert.equal(componentSent(ledger, "Button", "1.0.0"), true);
  assert.equal(anyVersionSent(ledger, "Button"), true);
});

test("generating a sent version again leaves it sent", () => {
  const ledger = emptyLedger();
  recordComponent(ledger, "Button", "1.0.0", SENT);
  recordComponent(ledger, "Button", "1.0.0");
  assert.equal(ledger.components.Button["1.0.0"], SENT);
});

test("a version 1 ledger counted code files as written, so its entries read as generated", () => {
  const ledger = readLedger(ledgerFile({ version: 1, components: { Button: ["1.0.0", "1.1.0"] }, screens: { "/settings": ["v3.0.0"] } }));
  assert.deepEqual(ledger, {
    version: 2,
    components: { Button: { "1.0.0": GENERATED, "1.1.0": GENERATED } },
    screens: { "/settings": { "v3.0.0": GENERATED } },
  });
});

test("a ledger written to a file reads back the same", () => {
  const ledger = emptyLedger();
  recordComponent(ledger, "Button", "1.0.0");
  recordComponent(ledger, "Card", "2.0.0", SENT);
  recordEntry(ledger, { kind: "screen", route: "/settings", release: "v3.0.0" }, GENERATED);
  assert.deepEqual(readLedger(ledgerFile(ledger)), ledger);
});

test("an entry with an unknown status is dropped, and a file that is not a ledger reads as empty", () => {
  const ledger = readLedger(ledgerFile({ version: 2, components: { Button: { "1.0.0": "sent", "1.1.0": "maybe" }, Card: [] }, screens: {} }));
  assert.deepEqual(ledger.components, { Button: { "1.0.0": SENT } });
  assert.deepEqual(readLedger(ledgerFile({ version: 9, components: {}, screens: {} })), emptyLedger());
  assert.deepEqual(readLedger(ledgerFile([])), emptyLedger());
});

test("a manifest entry is recorded and checked by its kind", () => {
  const ledger = emptyLedger();
  recordEntry(ledger, { kind: "component", name: "Button", version: "1.0.0" }, SENT);
  recordEntry(ledger, { kind: "screen", route: "/", release: "v1.0.0" }, SENT);
  assert.equal(entrySent(ledger, { kind: "component", name: "Button", version: "1.0.0" }), true);
  assert.equal(screenSent(ledger, "/", "v1.0.0"), true);
  assert.throws(() => recordEntry(ledger, { kind: "retain" }, SENT), /kind of "component" or "screen"/);
  assert.throws(() => entrySent(ledger, { kind: "retain" }), /kind of "component" or "screen"/);
  assert.deepEqual(entryOf({ kind: "component", id: "Button", name: "Button", version: "1.1.0", cells: [] }), { kind: "component", name: "Button", version: "1.1.0" });
});

test("a component named like an object property does not reach the prototype", () => {
  const ledger = emptyLedger();
  assert.equal(componentSent(ledger, "constructor", "1.0.0"), false);
  recordComponent(ledger, "constructor", "1.0.0", SENT);
  assert.equal(componentSent(ledger, "constructor", "1.0.0"), true);
  assert.equal(Object.prototype.constructor["1.0.0"], undefined);
});
