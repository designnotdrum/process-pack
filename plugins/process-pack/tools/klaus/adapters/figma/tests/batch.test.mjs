/** Packing units into data files whose code is at most 50,000 characters. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { packUnits } from "../batch.mjs";
import { RUNTIME_CODE } from "../codegen.mjs";
import { MAX_CODE_CHARS } from "../settings.mjs";
import { runCode } from "./fake-figma.mjs";
import { CONFIG, buttonUnit, newFigma, run, tinyUnit } from "./helpers.mjs";

const names = (files) => files.map((file) => file.units.map((unit) => unit.id));

test("components go about ten to a file", () => {
  const units = Array.from({ length: 25 }, (_, i) => tinyUnit(`C${i}`));
  const { files, tooLarge } = packUnits(units, { config: CONFIG });
  assert.deepEqual(files.map((f) => f.units.length), [10, 10, 5]);
  assert.deepEqual(files.map((f) => f.name), ["figma-001.json", "figma-002.json", "figma-003.json"]);
  assert.equal(tooLarge.length, 0);
});

test("the number of components in a file is a setting", () => {
  const units = Array.from({ length: 7 }, (_, i) => tinyUnit(`C${i}`));
  assert.deepEqual(packUnits(units, { config: CONFIG, perFile: 3 }).files.map((f) => f.units.length), [3, 3, 1]);
});

test("a file is closed before the next unit would take the relay's code past 50,000 characters", () => {
  // Each description is 10,000 characters, about 13,400 once the relay encodes it. The runtime adds about 21,800.
  const units = Array.from({ length: 7 }, (_, i) => tinyUnit(`C${i}`, { description: "d".repeat(10000) }));
  const { files, tooLarge } = packUnits(units, { config: CONFIG });
  assert.equal(tooLarge.length, 0);
  // Two units fit with the runtime. A third would not.
  assert.deepEqual(files.map((f) => f.units.length), [2, 2, 2, 1]);
  for (const file of files) assert.ok(file.chars <= MAX_CODE_CHARS, `${file.name} has ${file.chars} characters`);
  // The relay's code is the longer one: encoded text is about a third longer.
  for (const file of files) assert.ok(file.chars > file.code.length);
  // Every unit lands once, in order.
  assert.deepEqual(names(files).flat(), units.map((u) => u.id));
});

test("a file can be exactly full and still go through", () => {
  const unit = tinyUnit("C", { description: "" });
  const base = packUnits([unit], { config: CONFIG }).files[0].chars;
  // Grow the description until the relay's code is within a few characters of the limit. Base64 makes 3 characters 4.
  const room = Math.floor(((MAX_CODE_CHARS - 120 - base) * 3) / 4);
  const { files, tooLarge } = packUnits([tinyUnit("C", { description: "d".repeat(room) })], { config: CONFIG });
  assert.equal(tooLarge.length, 0);
  assert.ok(files[0].chars <= MAX_CODE_CHARS);
  assert.ok(files[0].chars > MAX_CODE_CHARS - 300, `the file should be nearly full, it has ${files[0].chars}`);
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

test("real component sets pack about nine to a file under the limit, and every file runs", async () => {
  const units = Array.from({ length: 12 }, (_, i) => ({ ...buttonUnit({ page: `Page ${i}` }), id: `Button${i}`, name: `Button${i}` }));
  const { files } = packUnits(units, { config: CONFIG });
  assert.ok(files[0].units.length >= 8, `a full call holds ${files[0].units.length}`);
  assert.deepEqual(files.flatMap((f) => f.units.map((u) => u.id)), units.map((u) => u.id));
  for (const file of files) assert.ok(file.chars <= MAX_CODE_CHARS, `${file.name} has ${file.chars} characters`);

  const figma = newFigma();
  const written = [];
  for (const file of files) {
    const result = await runCode(file.code, figma);
    written.push(...result.units.map((u) => u.status));
  }
  assert.deepEqual(written, Array(12).fill("written"));
});

test("an 18-variant Button is small enough that eight of them fit in one relay call", () => {
  const unit = buttonUnit();
  const { files } = packUnits(Array.from({ length: 8 }, () => unit), { config: CONFIG });
  assert.equal(files.length, 1);
  assert.ok(files[0].chars < MAX_CODE_CHARS);
});

test("units reach Figma in the order they were given", async () => {
  const figma = newFigma();
  const result = await run(figma, [tinyUnit("B"), tinyUnit("A")]);
  assert.deepEqual(result.units.map((u) => u.id), ["B", "A"]);
});

test("the runtime still parses after its comments are stripped", () => {
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  assert.doesNotThrow(() => new AsyncFunction("figma", "CONFIG", "TOKENS", "UNITS", RUNTIME_CODE));
  assert.ok(!/^\s*\/\//m.test(RUNTIME_CODE), "no comment lines are left");
});

test("a file header of any length does not push a file over the limit", () => {
  const units = Array.from({ length: 10 }, (_, i) => tinyUnit(`${"Long".repeat(40)}${i}`, { description: "d".repeat(3000) }));
  const { files } = packUnits(units, { config: CONFIG });
  for (const file of files) assert.ok(file.chars <= MAX_CODE_CHARS);
});

test("the small unit the tests use has the same fields as a real one", () => {
  const real = Object.keys(buttonUnit()).sort();
  assert.deepEqual(Object.keys(tinyUnit("X")).sort(), real);
});
