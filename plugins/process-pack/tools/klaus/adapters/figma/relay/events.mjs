/**
 * Reads what `codex exec --json` prints: one JSON event a line.
 *
 * The event and field names are Codex's own (codex-rs/exec/src/exec_events.rs):
 *
 *   item.started, item.completed   item.type "mcp_tool_call" has server, tool, arguments,
 *                                  result { content, structured_content }, error { message }
 *                                  and status ("completed" or "failed")
 *   turn.completed                 usage { input_tokens, cached_input_tokens, output_tokens,
 *                                  reasoning_output_tokens }
 *   turn.failed                    error { message }
 *   error                          message
 *
 * A tool result whose is_error is set arrives as status "failed" with the result kept.
 */

export const FIGMA_SERVER = "figma";
export const FIGMA_TOOL = "use_figma";

/** Parses the JSONL. A line that is not JSON is counted, not fatal: Codex may print a warning. */
export function parseEvents(text) {
  const events = [];
  let unreadable = 0;
  for (const line of String(text).split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      const event = JSON.parse(trimmed);
      if (event && typeof event === "object" && !Array.isArray(event)) events.push(event);
      else unreadable += 1;
    } catch {
      unreadable += 1;
    }
  }
  return { events, unreadable };
}

function addUsage(total, usage) {
  const out = total ?? { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 };
  for (const key of Object.keys(out)) {
    const value = usage[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) out[key] += value;
  }
  return out;
}

/** Arguments arrive as an object. Accept a JSON string too. */
function readArguments(value) {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * What one Codex run did.
 * @param {object[]} events
 * @returns {{
 *   calls: Array<{ status: string, arguments: object | null, result: object | null, error: string | null }>,
 *   started: number,
 *   otherTools: string[],
 *   usage: { input_tokens: number, cached_input_tokens: number, output_tokens: number, reasoning_output_tokens: number } | null,
 *   failure: string | null,
 *   message: string | null,
 * }}
 *   calls are the finished use_figma calls, in order. started counts the ones that began, so a
 *   run that died during a call shows started > calls.length. usage is null when no turn finished.
 */
export function summarizeEvents(events) {
  const calls = [];
  const otherTools = [];
  const failures = [];
  let started = 0;
  let usage = null;
  let message = null;
  for (const event of events) {
    const item = event.item;
    const isFigmaCall = item?.type === "mcp_tool_call" && item.server === FIGMA_SERVER && item.tool === FIGMA_TOOL;
    if (event.type === "item.started" && isFigmaCall) started += 1;
    else if (event.type === "item.completed" && item) {
      if (isFigmaCall) {
        calls.push({ status: String(item.status ?? "unknown"), arguments: readArguments(item.arguments), result: item.result ?? null, error: item.error?.message ?? null });
      } else if (item.type === "mcp_tool_call") otherTools.push(`${item.server}.${item.tool}`);
      else if (item.type === "command_execution") otherTools.push(`a shell command (${String(item.command ?? "unknown").slice(0, 80)})`);
      else if (item.type === "agent_message" && typeof item.text === "string") message = item.text;
      else if (item.type === "error" && item.message) failures.push(String(item.message));
    } else if (event.type === "turn.completed" && event.usage && typeof event.usage === "object") usage = addUsage(usage, event.usage);
    else if (event.type === "turn.failed") failures.push(String(event.error?.message ?? "The Codex turn failed."));
    else if (event.type === "error") failures.push(String(event.message ?? "Codex reported an error."));
  }
  return { calls, started: Math.max(started, calls.length), otherTools, usage, failure: failures.length > 0 ? failures.join(" ") : null, message };
}

/**
 * Relay tokens: input plus output, which is the API's total_tokens. Cached input is part of
 * input, and reasoning output is part of output (Codex reads it from output_tokens_details),
 * so adding either again would count it twice.
 */
export function relayTokens(usage) {
  return usage ? usage.input_tokens + usage.output_tokens : null;
}

/** Every JSON value a text holds: the whole text, or the span from its first { to its last }. */
function jsonIn(text) {
  try {
    return [JSON.parse(text)];
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return [];
    try {
      // Only one object around the whole span counts. Prose that holds two objects does not parse.
      const value = JSON.parse(text.slice(start, end + 1));
      return value && typeof value === "object" && !Array.isArray(value) ? [value] : [];
    } catch {
      return [];
    }
  }
}

const isUnitList = (value) =>
  Array.isArray(value) && value.every((unit) => unit && typeof unit.id === "string" && typeof unit.status === "string");

function findUnits(value, depth) {
  if (depth > 5 || value === null || value === undefined) return null;
  if (typeof value === "string") {
    for (const parsed of jsonIn(value)) {
      const found = findUnits(parsed, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  if (isUnitList(value.units)) return value;
  for (const child of Object.values(value)) {
    const found = findUnits(child, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * What the generated code returned, out of a use_figma result: { units: [{ id, status, error? }] }.
 * The code returns that object. Figma's server wraps it in text, so this looks through the
 * structured content and every text block, and through JSON held in a string.
 * @returns {object | null}  null when the result does not hold a unit list.
 */
export function readCodeResult(result) {
  if (!result || typeof result !== "object") return null;
  const found = findUnits(result.structured_content ?? null, 0);
  if (found) return found;
  for (const block of Array.isArray(result.content) ? result.content : []) {
    if (block?.type === "text" && typeof block.text === "string") {
      const inText = findUnits(block.text, 0);
      if (inText) return inText;
    }
  }
  return null;
}

/** The text of a result, for an error message. */
export function resultText(result, limit = 400) {
  const parts = [];
  for (const block of Array.isArray(result?.content) ? result.content : []) {
    if (block?.type === "text" && typeof block.text === "string") parts.push(block.text);
  }
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}
