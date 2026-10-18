/** Packing units into code files of at most 50,000 characters. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { packUnits } from "../batch.mjs";
import { MAX_CODE_CHARS } from "../settings.mjs";
import { runCode } from "./fake-figma.mjs";
import { CONFIG, buttonUnit, newFigma, run, tinyUnit } from "./helpers.mjs";

const names = (files) => files.map((file) => file.units.map((unit) => unit.id));

test("components go about ten to a file", () => {
  const units = Array.from({ length: 25 }, (_, i) => tinyUnit(`C${i}`));
  const { files, tooLarge } = packUnits(units, { config: CONFIG });
  assert.deepEqual(files.map((f) => f.units.length), [10, 10, 5]);
  assert.deepEqual(files.map((f) => f.name), ["figma-001.js", "figma-002.js", "figma-003.js"]);
  assert.equal(tooLarge.length, 0);
});

test("the number of components in a file is a setting", () => {
  const units = Array.from({ length: 7 }, (_, i) => tinyUnit(`C${i}`));
  assert.deepEqual(packUnits(units, { config: CONFIG, perFile: 3 }).files.map((f) => f.units.length), [3, 3, 1]);
});

test("a file is closed before the next unit would take it past 50,000 characters", () => {
  // Each unit carries about 17,000 characters of description, and the runtime adds about 13,000.
  const units = Array.from({ length: 7 }, (_, i) => tinyUnit(`C${i}`, { description: "d".repeat(17000) }));
  const { files, tooLarge } = packUnits(units, { config: CONFIG });
  assert.equal(tooLarge.length, 0);
  assert.ok(files.length >= 4, `expected the 7 units to need several files, got ${files.length}`);
  for (const file of files) {
    assert.ok(file.code.length <= MAX_CODE_CHARS, `${file.name} has ${file.code.length} characters`);
    assert.ok(file.units.length < 10, "the size limit cut the file before the unit count did");
  }
  // Every unit lands once, in order.
  assert.deepEqual(names(files).flat(), units.map((u) => u.id));
});

test("a file can be exactly full and still go through", () => {
  const unit = tinyUnit("C", { description: "" });
  const base = packUnits([unit], { config: CONFIG }).files[0].code.length;
  // Grow the description until the file is within a few characters of the limit.
  const room = MAX_CODE_CHARS - 120 - base;
  const { files, tooLarge } = packUnits([tinyUnit("C", { description: "d".repeat(room) })], { config: CONFIG });
  assert.equal(tooLarge.length, 0);
  assert.ok(files[0].code.length <= MAX_CODE_CHARS);
  assert.ok(files[0].code.length > MAX_CODE_CHARS - 200, `the file should be nearly full, it has ${files[0].code.length}`);
});

test("a unit too big for a file of its own is returned apart and the rest still pack", () => {
  const units = [tinyUnit("Small"), tinyUnit("Huge", { description: "d".repeat(60000) }), tinyUnit("Other")];
  const { files, tooLarge } = packUnits(units, { config: CONFIG });
  assert.deepEqual(tooLarge.map((t) => t.unit.id), ["Huge"]);
  assert.ok(tooLarge[0].chars > MAX_CODE_CHARS);
  assert.deepEqual(names(files).flat(), ["Small", "Other"]);
});

test("the limit counts characters the way Figma does, so non-ASCII text is written as escapes", () => {
  const { files } = packUnits([tinyUnit("C", { description: "café → 😀" })], { config: CONFIG });
  assert.match(files[0].code, /^[\x00-\x7f]*$/);
  assert.ok(files[0].code.includes("\\u00e9"));
});

test("real component sets pack ten to a file under the limit, and every file runs", async () => {
  const units = Array.from({ length: 12 }, (_, i) => ({ ...buttonUnit({ page: `Page ${i}` }), id: `Button${i}`, name: `Button${i}` }));
  const { files } = packUnits(units, { config: CONFIG });
  assert.deepEqual(files.map((f) => f.units.length), [10, 2]);
  for (const file of files) assert.ok(file.code.length <= MAX_CODE_CHARS, `${file.name} has ${file.code.length} characters`);

  const figma = newFigma();
  const written = [];
  for (const file of files) {
    const result = await runCode(file.code, figma);
    written.push(...result.units.map((u) => u.status));
  }
  assert.deepEqual(written, Array(12).fill("written"));
});

test("a set of 30 variants is small enough that ten of them fit in a call", () => {
  const unit = buttonUnit();
  const { files } = packUnits(Array.from({ length: 10 }, () => unit), { config: CONFIG });
  assert.equal(files.length, 1);
  assert.ok(files[0].code.length < MAX_CODE_CHARS);
});

test("units reach Figma in the order they were given", async () => {
  const figma = newFigma();
  const result = await run(figma, [tinyUnit("B"), tinyUnit("A")]);
  assert.deepEqual(result.units.map((u) => u.id), ["B", "A"]);
});
