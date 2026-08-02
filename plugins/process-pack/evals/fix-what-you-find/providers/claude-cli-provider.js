// Custom promptfoo provider that shells out to the local `claude` CLI in
// non-interactive print mode. This lets the eval run against a real,
// current-generation Claude model without a separate Anthropic API key -
// it reuses whatever auth the local Claude Code install already has.
//
// Known limitation (documented in ../README.md): non-`--bare` invocations
// still carry the ambient Claude Code tool/skill/subagent schema listing in
// context, which is why every call shows nontrivial token usage even for a
// one-line answer. That listing is identical across the control and
// treatment arms, so it is noise and cost, not a directional bias, and
// `--disallowedTools "*"` blocks the model from invoking any tool in it,
// including the real fix-what-you-find skill installed in this Claude Code
// config. That alone was not enough - see the NEUTRAL_CWD note below for
// the leak path `--disallowedTools` does not close. Prefer `--bare` with a
// working ANTHROPIC_API_KEY if one becomes available; see the README for
// why this eval doesn't use it.

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Claude Code auto-discovers "directory-scoped" skills whose files live
// under the current working directory - which is exactly this repo when
// promptfoo runs the eval from inside it. That leaked the real
// fix-what-you-find skill's content into the control arm during harness
// development (its reasoning cited the skill's own blocker numbering
// verbatim, with no skill in its system prompt at all) - confirmed by the
// leak disappearing once the subprocess cwd moved outside the repo. Run
// the CLI from a neutral scratch directory, well outside any
// process-pack-registered path, so neither arm gets directory-scoped
// skill awareness for free.
const NEUTRAL_CWD = fs.mkdtempSync(path.join(os.tmpdir(), "fix-what-you-find-eval-"));

function readSystemPrompt(configuredPath) {
  const resolved = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.join(__dirname, "..", configuredPath);
  return fs.readFileSync(resolved, "utf8");
}

class ClaudeCliProvider {
  constructor(options) {
    this.config = (options && options.config) || {};
    this.providerId = this.config.label || "claude-cli";
    if (!this.config.systemPromptFile) {
      throw new Error(
        "ClaudeCliProvider requires config.systemPromptFile (path relative to the eval dir)"
      );
    }
    this.systemPrompt = readSystemPrompt(this.config.systemPromptFile);
    this.model = this.config.model || "sonnet";
    this.timeoutMs = this.config.timeoutMs || 120000;
  }

  id() {
    return this.providerId;
  }

  async callApi(prompt) {
    const args = [
      "-p",
      prompt,
      "--system-prompt",
      this.systemPrompt,
      "--model",
      this.model,
      "--output-format",
      "json",
      "--disallowedTools",
      "*",
      "--strict-mcp-config",
    ];

    return new Promise((resolve) => {
      execFile(
        "claude",
        args,
        { maxBuffer: 1024 * 1024 * 16, timeout: this.timeoutMs, cwd: NEUTRAL_CWD },
        (error, stdout, stderr) => {
          if (error && !stdout) {
            resolve({
              error: `claude CLI failed: ${error.message}${stderr ? `\nstderr: ${stderr}` : ""}`,
            });
            return;
          }
          let parsed;
          try {
            parsed = JSON.parse(stdout);
          } catch (parseError) {
            resolve({
              error: `Could not parse claude CLI JSON output: ${parseError.message}\nraw stdout: ${stdout.slice(0, 2000)}`,
            });
            return;
          }
          if (parsed.is_error) {
            resolve({
              error: `claude CLI reported an error: ${parsed.result || JSON.stringify(parsed)}`,
            });
            return;
          }
          resolve({
            output: parsed.result,
            cost: parsed.total_cost_usd,
            tokenUsage: {
              total:
                (parsed.usage && parsed.usage.input_tokens) +
                (parsed.usage && parsed.usage.output_tokens),
              prompt: parsed.usage && parsed.usage.input_tokens,
              completion: parsed.usage && parsed.usage.output_tokens,
            },
            raw: parsed,
          });
        }
      );
    });
  }
}

module.exports = ClaudeCliProvider;
