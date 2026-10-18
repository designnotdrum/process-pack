/** Reading Codex's JSON events and the code's result out of use_figma's reply. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEvents, readCodeResult, relayTokens, summarizeEvents } from "../events.mjs";

const returned = { tokens: { made: [], updated: [] }, units: [{ id: "Button", status: "written" }], warnings: [] };
const call = (status, extra = {}) => ({
  type: "item.completed",
  item: { id: "item_0", type: "mcp_tool_call", server: "figma", tool: "use_figma", arguments: { fileKey: "k", code: "x" }, status, ...extra },
});

test("lines that are not JSON are counted and skipped", () => {
  const { events, unreadable } = parseEvents('{"type":"turn.started"}\nWARNING: something\n\n[1]\n');
  assert.deepEqual(events, [{ type: "turn.started" }]);
  assert.equal(unreadable, 2);
});

test("a run's use_figma calls, other tools, usage and failures are picked out", () => {
  const summary = summarizeEvents([
    { type: "item.started", item: { type: "mcp_tool_call", server: "figma", tool: "use_figma" } },
    call("completed", { result: { content: [] } }),
    { type: "item.completed", item: { type: "mcp_tool_call", server: "figma", tool: "get_screenshot" } },
    { type: "item.completed", item: { type: "command_execution", command: "ls" } },
    { type: "item.completed", item: { type: "agent_message", text: "Done." } },
    { type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 20, reasoning_output_tokens: 5 } },
    { type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 2, reasoning_output_tokens: 0 } },
    { type: "error", message: "Reconnecting... 1/5" },
  ]);
  assert.equal(summary.calls.length, 1);
  assert.equal(summary.started, 1);
  assert.deepEqual(summary.otherTools, ["figma.get_screenshot", "a shell command (ls)"]);
  assert.equal(summary.message, "Done.");
  assert.deepEqual(summary.usage, { input_tokens: 110, cached_input_tokens: 40, output_tokens: 22, reasoning_output_tokens: 5 });
  assert.equal(relayTokens(summary.usage), 132, "input plus output; cached input is part of input");
  assert.equal(summary.failure, "Reconnecting... 1/5");
});

test("a call that started and never finished is counted as started", () => {
  const summary = summarizeEvents([{ type: "item.started", item: { type: "mcp_tool_call", server: "figma", tool: "use_figma" } }]);
  assert.equal(summary.calls.length, 0);
  assert.equal(summary.started, 1);
  assert.equal(summary.usage, null);
  assert.equal(relayTokens(summary.usage), null);
});

test("arguments given as a JSON string are read too", () => {
  const summary = summarizeEvents([call("completed", { arguments: JSON.stringify({ fileKey: "k", code: "x" }) })]);
  assert.deepEqual(summary.calls[0].arguments, { fileKey: "k", code: "x" });
});

test("the code's result is found in plain text, in text around it, in a JSON string, or in structured content", () => {
  const text = JSON.stringify(returned);
  assert.deepEqual(readCodeResult({ content: [{ type: "text", text }] }), returned);
  assert.deepEqual(readCodeResult({ content: [{ type: "text", text: `Result: ${text}\n` }] }), returned);
  assert.deepEqual(readCodeResult({ content: [{ type: "text", text: JSON.stringify({ result: text }) }] }), returned);
  assert.deepEqual(readCodeResult({ content: [], structured_content: { result: returned } }), returned);
  assert.equal(readCodeResult({ content: [{ type: "text", text: "Done" }] }), null);
});

test("a unit list without an id and a status on every unit is not the code's result", () => {
  assert.equal(readCodeResult({ content: [{ type: "text", text: '{"units":[{"id":1}]}' }] }), null);
  assert.equal(readCodeResult({ content: [{ type: "text", text: '{"units":[{"id":"Button"}]}' }] }), null);
});
