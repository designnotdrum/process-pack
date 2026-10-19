/**
 * Reads what `codex exec --json` prints, one JSON event a line. The event and field names are
 * Codex's own and were read from real runs on 2026-10-19 (codex-cli 0.163.0):
 *
 *   item.completed   item.type "agent_message" (text), "file_change" (changes: [{ path, kind }],
 *                    status), "command_execution", "mcp_tool_call", "web_search", "error" (message)
 *   turn.completed   usage { input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens }
 *   turn.failed      error { message }
 *   error            message
 */

/** Parses the JSONL. A line that is not JSON is counted, not fatal: Codex may print a warning. */
export function parseEvents(text) {
  const events = []
  let unreadable = 0
  for (const line of String(text).split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      const event = JSON.parse(trimmed)
      if (event && typeof event === 'object' && !Array.isArray(event)) events.push(event)
      else unreadable += 1
    } catch {
      unreadable += 1
    }
  }
  return { events, unreadable }
}

const number = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0)

/**
 * What one Codex run did.
 *
 * Tokens are input plus output, which is the API's total. Cached input is part of input and
 * reasoning output is part of output, so adding either again would count it twice. The same
 * rule as the Figma relay's `relayTokens`.
 *
 * @returns {{ tokens: number | null, usage: object | null, failure: string | null, message: string | null, fileChanges: { path: string, kind: string }[], unexpected: string[] }}
 */
export function summarizeEvents(events) {
  let usage = null
  const failures = []
  const fileChanges = []
  const unexpected = []
  let message = null
  for (const event of events) {
    const item = event.item
    if (event.type === 'item.completed' && item) {
      if (item.type === 'agent_message' && typeof item.text === 'string') message = item.text
      else if (item.type === 'file_change' && item.status !== 'failed') for (const change of item.changes ?? []) fileChanges.push({ path: String(change.path), kind: String(change.kind) })
      else if (item.type === 'command_execution') unexpected.push('a shell command')
      else if (item.type === 'mcp_tool_call') unexpected.push(`the tool ${item.server}.${item.tool}`)
      else if (item.type === 'web_search' && (item.query || item.action?.query)) unexpected.push('a web search')
      else if (item.type === 'error' && item.message) failures.push(String(item.message))
    } else if (event.type === 'turn.completed' && event.usage && typeof event.usage === 'object') {
      usage = usage ?? { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 }
      for (const key of Object.keys(usage)) usage[key] += number(event.usage[key])
    } else if (event.type === 'turn.failed') failures.push(String(event.error?.message ?? 'The Codex turn failed.'))
    else if (event.type === 'error') failures.push(String(event.message ?? 'Codex reported an error.'))
  }
  return { tokens: usage ? usage.input_tokens + usage.output_tokens : null, usage, failure: failures.length > 0 ? failures.join(' ').slice(0, 400) : null, message, fileChanges, unexpected: [...new Set(unexpected)] }
}
