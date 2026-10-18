/** The state file the runner reads and writes between runs. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { emptyState, readState, writeState } from "../state.mjs";

const dir = () => mkdtempSync(path.join(tmpdir(), "klaus-state-"));

test("a missing state file is a first run", () => {
  assert.deepEqual(readState(path.join(dir(), "none.json")), emptyState());
});

test("writes and reads back, creating folders and leaving no temporary file", () => {
  const root = dir();
  const file = path.join(root, ".klaus", "state.json");
  const state = { version: 1, outputs: { storybook: { lastRelease: "v1.0.0", lastRunAt: "2026-10-18T06:00:00.000Z", unwritten: ["Card"] } } };
  writeState(file, state);
  assert.deepEqual(readState(file), state);
  assert.deepEqual(readdirSync(path.dirname(file)), ["state.json"]);
});

test("refuses a file that is not a state file instead of starting over silently", () => {
  const file = path.join(dir(), "state.json");
  writeFileSync(file, "{ nope");
  assert.throws(() => readState(file), /is not valid JSON/);
  writeFileSync(file, JSON.stringify({ version: 2, outputs: {} }));
  assert.throws(() => readState(file), /wrong version/);
  writeFileSync(file, JSON.stringify({ version: 1, outputs: { storybook: { lastRelease: "v1" } } }));
  assert.throws(() => readState(file), /storybook\.unwritten/);
  writeFileSync(file, JSON.stringify({ version: 1, outputs: { storybook: { unwritten: [], lastRunAt: 5 } } }));
  assert.throws(() => readState(file), /storybook\.lastRunAt/);
});
