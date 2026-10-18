/** The one place the adapter starts a process. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { exec } from "./exec.mjs";

const node = (code) => ["node", ["-e", code]];

test("returns what the command printed", async () => {
  const result = await exec(...node("process.stdout.write('out'); process.stderr.write('err')"));
  assert.deepEqual(result, { stdout: "out", stderr: "err" });
});

test("a failing command rejects with the end of its error output", async () => {
  await assert.rejects(exec(...node("console.error('first'); console.error('Cannot find module vite'); process.exit(3)")), /Cannot find module vite/);
});

test("a command that waits for input is not left waiting", async () => {
  const result = await exec(...node("process.stdin.on('data', () => {}); process.stdin.on('end', () => process.stdout.write('stdin closed'))"));
  assert.equal(result.stdout, "stdin closed");
});

test("a command that runs too long is stopped and the message says so", async () => {
  await assert.rejects(exec("node", ["-e", "setTimeout(() => {}, 10000)"], { timeoutMs: 300 }), /timed out after \d+ s/);
});

test("a command that prints more than the limit is stopped and the message says so", async () => {
  await assert.rejects(exec("node", ["-e", "process.stdout.write('x'.repeat(3e6))"], { maxBuffer: 1e6 }), /wrote more than 1 MB of output/);
});
