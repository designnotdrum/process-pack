// Runs scripts/docs_refresh_gate.py before each bash command, the same check
// Claude Code and Codex run through their PreToolUse hooks. Exit 2 blocks the
// command with the script's message; anything else lets it through.
import { spawnSync } from "node:child_process"
import { join } from "node:path"

export const DocsRefreshGate = async ({ worktree, directory }) => ({
  "tool.execute.before": async (input, output) => {
    if (input.tool !== "bash") return
    const root = worktree || directory
    const payload = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: output.args.command },
      cwd: directory,
    })
    const result = spawnSync("python3", [join(root, "scripts", "docs_refresh_gate.py")], {
      input: payload,
      encoding: "utf8",
      timeout: 10000,
    })
    if (result.status === 2) throw new Error(result.stderr.trim())
  },
})
