/** The code server hands the call's code to Codex, so the model never reads or retypes it. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../code-server.mjs", import.meta.url));

/** Sends each request in turn and resolves with the replies, by id. */
async function talk(file, requests) {
  const child = spawn(process.execPath, [SERVER, file], { stdio: ["pipe", "pipe", "inherit"] });
  const replies = new Map();
  const lines = createInterface({ input: child.stdout });
  const closed = new Promise((resolve) => child.on("close", resolve));
  lines.on("line", (line) => {
    const reply = JSON.parse(line);
    replies.set(reply.id, reply);
  });
  for (const request of requests) child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...request })}\n`);
  child.stdin.end();
  await closed;
  return replies;
}

test("read_code returns the file exactly, whatever characters it holds", async () => {
  const code = `const a = "\\\\ \\" \\n"; \`\${b}\`;\n// é ✓ ${"x".repeat(60000)}\n`;
  const file = path.join(mkdtempSync(path.join(tmpdir(), "klaus-code-server-")), "code.js");
  writeFileSync(file, code);

  const replies = await talk(file, [
    { id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } },
    { method: "notifications/initialized" },
    { id: 2, method: "tools/list" },
    { id: 3, method: "tools/call", params: { name: "read_code", arguments: {} } },
  ]);

  assert.equal(replies.get(1).result.protocolVersion, "2025-06-18");
  assert.deepEqual(replies.get(2).result.tools.map((tool) => tool.name), ["read_code"]);
  assert.equal(replies.get(3).result.structuredContent.code, code);
  assert.equal(replies.size, 3, "a notification gets no reply");
});

test("a tool or method it does not have is an error, not an empty success", async () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "klaus-code-server-")), "code.js");
  writeFileSync(file, "x");

  const replies = await talk(file, [
    { id: 1, method: "tools/call", params: { name: "other", arguments: {} } },
    { id: 2, method: "resources/list" },
  ]);

  assert.equal(replies.get(1).error.code, -32602);
  assert.equal(replies.get(2).error.code, -32601);
});

test("a code file it cannot read fails the call with the reason, and the server keeps running", async () => {
  const missing = path.join(mkdtempSync(path.join(tmpdir(), "klaus-code-server-")), "gone.js");

  const replies = await talk(missing, [
    { id: 1, method: "tools/call", params: { name: "read_code", arguments: {} } },
    { id: 2, method: "ping" },
  ]);

  assert.equal(replies.get(1).error.code, -32603);
  assert.match(replies.get(1).error.message, /The code file could not be read: .*gone\.js/);
  assert.deepEqual(replies.get(2).result, {});
});
