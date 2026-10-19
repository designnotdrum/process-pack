/** Reading a JSON file for the config and inventory: every failure the reader can fix is a UserError. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { UserError } from "../errors.mjs";
import { readJsonFile } from "../json-file.mjs";

const dir = () => mkdtempSync(path.join(tmpdir(), "klaus-json-"));

test("reads a JSON file", () => {
  const file = path.join(dir(), "a.json");
  writeFileSync(file, '{ "a": 1 }');
  assert.deepEqual(readJsonFile(file, "Config"), { a: 1 });
});

test("a missing file is a UserError that names it", () => {
  const file = path.join(dir(), "none.json");
  assert.throws(() => readJsonFile(file, "Config"), (error) => error instanceof UserError && error.message === `Config ${file} does not exist.`);
});

test("a folder where the file should be is a UserError, not a raw system error", () => {
  const folder = path.join(dir(), "config.json");
  mkdirSync(folder);
  assert.throws(() => readJsonFile(folder, "Config"), (error) => error instanceof UserError && error.message === `Config ${folder} could not be read (EISDIR).`);
});

test("a syntax error reports the position and none of the file", () => {
  const file = path.join(dir(), "bad.json");
  writeFileSync(file, '{ "token": "do-not-print-this", nope }');
  assert.throws(() => readJsonFile(file, "Config"), (error) => error instanceof UserError && /is not valid JSON/.test(error.message) && !error.message.includes("do-not-print-this"));
});
