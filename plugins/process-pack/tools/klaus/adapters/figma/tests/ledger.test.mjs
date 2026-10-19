/** The ledger: generated until the relay confirms a unit, then sent. */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  anyVersionSent,
  CHANGED,
  componentSent,
  emptyLedger,
  entryOf,
  entrySent,
  entryStatus,
  GENERATED,
  generatedComponents,
  generatedScreenCount,
  markGeneratedAsSent,
  readLedger,
  recordScreen,
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

test("a version drawn from changed code stays changed when generated again, and is not sent", () => {
  const ledger = emptyLedger();
  recordComponent(ledger, "Button", "1.1.0", CHANGED);
  recordComponent(ledger, "Button", "1.1.0");
  assert.equal(entryStatus(ledger, { kind: "component", name: "Button", version: "1.1.0" }), CHANGED);
  assert.equal(componentSent(ledger, "Button", "1.1.0"), false);
  assert.deepEqual(readLedger(ledgerFile(ledger)).components, { Button: { "1.1.0": CHANGED } });
  recordComponent(ledger, "Button", "1.1.0", SENT);
  assert.equal(componentSent(ledger, "Button", "1.1.0"), true, "a later write from the right code clears it");
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
  assert.deepEqual(Object.getOwnPropertyDescriptor(ledger.components, "constructor").value, { "1.0.0": SENT }, "the entry is the ledger's own");
});

test("a component named __proto__ is recorded, written and read back as its own entry", () => {
  const ledger = emptyLedger();
  recordComponent(ledger, "__proto__", "1.0.0", SENT);
  assert.equal(componentSent(ledger, "__proto__", "1.0.0"), true);
  assert.ok(Object.hasOwn(ledger.components, "__proto__"));
  assert.equal(Object.getPrototypeOf(ledger.components), Object.prototype, "the table's prototype is untouched");
  const read = readLedger(ledgerFile(ledger));
  assert.equal(componentSent(read, "__proto__", "1.0.0"), true);
  const old = readLedger(ledgerFile({ version: 1, components: JSON.parse('{"__proto__":["1.0.0"]}'), screens: {} }));
  assert.equal(entryStatus(old, { kind: "component", name: "__proto__", version: "1.0.0" }), GENERATED);
});

test("generatedComponents lists only the versions that are generated", () => {
  const ledger = emptyLedger();
  recordComponent(ledger, "Button", "1.0.0", GENERATED);
  recordComponent(ledger, "Button", "1.1.0", SENT);
  recordComponent(ledger, "Card", "2.0.0", CHANGED);
  recordComponent(ledger, "Card", "2.1.0", GENERATED);
  recordScreen(ledger, "/settings", "v1.0.0", GENERATED);
  assert.deepEqual(generatedComponents(ledger), [
    { kind: "component", name: "Button", version: "1.0.0" },
    { kind: "component", name: "Card", version: "2.1.0" },
  ]);
  assert.equal(generatedScreenCount(ledger), 1);
  assert.deepEqual(generatedComponents(emptyLedger()), []);
});

test("markGeneratedAsSent sends a generated unit and never touches a changed or sent one", () => {
  const ledger = emptyLedger();
  recordComponent(ledger, "Button", "1.0.0", GENERATED);
  recordComponent(ledger, "Button", "1.1.0", CHANGED);
  recordComponent(ledger, "Button", "1.2.0", SENT);
  const of = (version) => ({ kind: "component", name: "Button", version });
  assert.equal(markGeneratedAsSent(ledger, of("1.0.0")), true);
  assert.equal(markGeneratedAsSent(ledger, of("1.1.0")), false);
  assert.equal(markGeneratedAsSent(ledger, of("1.2.0")), false);
  assert.equal(markGeneratedAsSent(ledger, of("9.9.9")), false, "a version the ledger does not hold is not added");
  assert.deepEqual(ledger.components.Button, { "1.0.0": SENT, "1.1.0": CHANGED, "1.2.0": SENT });
});
