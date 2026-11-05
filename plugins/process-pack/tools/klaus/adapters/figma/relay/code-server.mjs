#!/usr/bin/env node
/**
 * A local MCP server with one tool, read_code, which returns the code file named on the command line.
 *
 * A model will not retype a large file exactly (see README.md, "How the code reaches use_figma"). The
 * relay starts this server for each call, and a fixed script in Codex's exec tool passes read_code's
 * result straight to use_figma, so the code never goes through the model.
 *
 * It speaks MCP over stdio, one JSON-RPC message a line, and needs nothing but Node.
 */
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const TOOL = "read_code";

const file = process.argv[2];
const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);

function answer({ method, params }) {
  if (method === "initialize") {
    return { protocolVersion: params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "klaus-code", version: "1.0.0" } };
  }
  if (method === "ping") return {};
  if (method === "tools/list") {
    return {
      tools: [{
        name: TOOL,
        description: "Returns the code of this relay call.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        outputSchema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
      }],
    };
  }
  if (method === "tools/call" && params?.name === TOOL) {
    const code = readFileSync(file, "utf8");
    return { content: [{ type: "text", text: "The code is in structuredContent.code." }], structuredContent: { code } };
  }
  return null;
}

function reply(message) {
  try {
    const result = answer(message);
    if (result) send({ id: message.id, result });
    else if (message.method === "tools/call") send({ id: message.id, error: { code: -32602, message: `No tool named ${message.params?.name}.` } });
    else send({ id: message.id, error: { code: -32601, message: `No method named ${message.method}.` } });
  } catch (error) {
    // A code file the server cannot read must fail the call with a reason, not end the server.
    send({ id: message.id, error: { code: -32603, message: `The code file could not be read: ${error.message}` } });
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  // A notification has no id and gets no reply.
  if (message.id !== undefined) reply(message);
});
