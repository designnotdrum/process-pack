/** The shared record's reading, merging and writing, apart from gh and the frame. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyLedger } from "../ledger.mjs";
import { MAX_SHARED_LEDGER_BYTES, mergeMarks, parseSharedLedger, SHARED_LEDGER_VARIABLE, sharedLedgerText } from "../shared-ledger.mjs";

const KEY = "zSRhsvwtutOIPvHyWF9Wf2";
const ledger = (components, screens = {}) => ({ version: 2, components, screens });

test("the variable is named KLAUS_FIGMA_LEDGER and is held under GitHub's 48 KB limit", () => {
  assert.equal(SHARED_LEDGER_VARIABLE, "KLAUS_FIGMA_LEDGER");
  assert.equal(MAX_SHARED_LEDGER_BYTES, 48000, "48 KB counted as 48,000 bytes, the stricter reading");
});

test("a record the relay wrote reads back, keeping sent and changed and dropping anything else", () => {
  const text = JSON.stringify({ version: 2, fileKey: KEY, components: { Button: { "1.0.0": "sent", "1.1.0": "changed", "1.2.0": "generated", "2.0.0": "lost" } }, screens: { "/": { v1: "sent" } } });
  const read = parseSharedLedger(text, KEY);
  assert.equal(read.status, "read");
  assert.equal(read.warning, null);
  assert.deepEqual(read.ledger, ledger({ Button: { "1.0.0": "sent", "1.1.0": "changed" } }, { "/": { v1: "sent" } }));
});

test("absent, malformed and another file's records give a warning and no ledger", () => {
  for (const text of [undefined, null, "", "   "]) {
    const read = parseSharedLedger(text, KEY);
    assert.equal(read.status, "absent", JSON.stringify(text));
    assert.match(read.warning, /KLAUS_FIGMA_LEDGER is not set/);
    assert.equal(read.ledger, null);
  }
  for (const text of ["{", "[]", "42", JSON.stringify({ version: 1, fileKey: KEY, components: {}, screens: {} }), JSON.stringify({ version: 2, components: {}, screens: {} }), JSON.stringify({ version: 2, fileKey: KEY, components: [], screens: {} })]) {
    const read = parseSharedLedger(text, KEY);
    assert.equal(read.status, "malformed", text);
    assert.match(read.warning, /KLAUS_FIGMA_LEDGER is not a record the relay writes/);
    assert.equal(read.ledger, null);
  }
  const other = parseSharedLedger(JSON.stringify({ version: 2, fileKey: "AnotherFigmaFileKey0000", components: {}, screens: {} }), KEY);
  assert.equal(other.status, "other-file");
  assert.match(other.warning, /AnotherFigmaFileKey0000/);
  assert.equal(other.ledger, null);
});

test("merging: sent or changed in either ledger counts, and sent wins over changed", () => {
  const local = ledger({ Button: { "1.0.0": "generated", "1.1.0": "changed", "1.2.0": "sent" }, Card: { "1.0.0": "generated" } });
  const shared = ledger({ Button: { "1.0.0": "sent", "1.1.0": "sent", "1.2.0": "changed" }, Card: { "1.0.0": "changed" }, Dialog: { "2.0.0": "sent" } }, { "/": { v1: "sent" } });
  mergeMarks(local, shared);
  assert.deepEqual(local.components, {
    Button: { "1.0.0": "sent", "1.1.0": "sent", "1.2.0": "sent" },
    Card: { "1.0.0": "changed" },
    Dialog: { "2.0.0": "sent" },
  });
  assert.deepEqual(local.screens, { "/": { v1: "sent" } });
});

test("merging never takes a generated mark from the other ledger, and keeps a name like __proto__ as data", () => {
  const local = emptyLedger();
  const shared = JSON.parse('{"version":2,"components":{"__proto__":{"1.0.0":"sent"},"Card":{"1.0.0":"generated"}},"screens":{}}');
  mergeMarks(local, shared);
  assert.deepEqual(Object.keys(local.components), ["__proto__"]);
  assert.equal(Object.getPrototypeOf(local.components), Object.prototype);
});

test("the published text holds only sent and changed, with the file key", () => {
  const text = sharedLedgerText(ledger({ Button: { "1.0.0": "sent", "1.1.0": "generated" }, Card: { "1.0.0": "generated" }, Dialog: { "1.0.0": "changed" } }), KEY);
  assert.deepEqual(JSON.parse(text), { version: 2, fileKey: KEY, components: { Button: { "1.0.0": "sent" }, Dialog: { "1.0.0": "changed" } }, screens: {} });
  assert.equal(parseSharedLedger(text, KEY).status, "read", "what the relay writes, it and CI can read");
});
