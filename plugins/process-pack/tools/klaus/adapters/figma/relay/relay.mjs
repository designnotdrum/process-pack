#!/usr/bin/env node
/**
 * The Figma relay: writes the generator's data to Figma through a signed-in
 * Codex CLI, because Figma's MCP server refuses a plain script.
 *
 *   node relay.mjs <folder> [options]
 *   node relay.mjs --run <id> [--repo <owner/name>] [--artifact <name>] [--release <release>] [options]
 *   node relay.mjs --reconcile [options]
 *
 * <folder> is a release folder the generator wrote, `.klaus/figma/<release>/`,
 * holding manifest.json and the data files figma-001.json, figma-002.json, ...
 * `--run` downloads the CI artifact that holds one with `gh run download`, and
 * only from a successful run of the Klaus workflow at a commit on the default
 * branch. A local folder is trusted as the operator's own.
 *
 * The artifact supplies data, never code. Before any call the relay reads every
 * data file with data-file.mjs, refuses one that is not the generator's shape
 * or writes anywhere the repo's settings do not name, and builds each call's
 * code from the data and the runtime in this checkout. Every string from the
 * data is encoded with a new key for each call, so text in the data cannot
 * steer the model that copies the code. The Figma file is the one
 * klaus.config.json names; a manifest naming another file is refused.
 *
 * For each data file, in the manifest's order, the relay runs `codex exec`
 * once. The prompt tells Codex to call use_figma exactly once with the code and
 * to report the result, and nothing else. The code goes to Codex on stdin,
 * byte for byte. The relay reads Codex's JSON events, checks that the code
 * use_figma received is the code it built, and records a unit as sent in the
 * ledger only when the code's own result says it was written or was already
 * there. A unit that failed stays generated, so the next run retries it.
 *
 * `--reconcile` writes nothing to Figma. The Klaus plugin does the first, large load and cannot
 * write the ledger, so the ledger still lists those units as generated. One read-only use_figma
 * call returns the names of the component sets and components on the pages Klaus writes (the
 * pages of the generated units in the ledger, and Older versions). Each generated component
 * version whose `<Name> <version>` is among them is recorded as sent. The rest stay generated
 * and the report lists them, and a changed unit is never touched. The same rules hold: the Figma
 * file is the settings' file, the code is written by the relay and checked after it reached
 * Figma, and only the tool's result is read, never the model's reply. The call and its tokens are
 * counted under figma-relay and the spending cap applies.
 *
 * A changed token value is written only by the call that sends the release's last component unit,
 * so a version moved to Older versions in an earlier call is frozen in the colours it shipped with
 * (runtime.js TOKEN_VALUES). Earlier calls create missing variables and change no existing value, and
 * the report counts the changes that wait.
 *
 * Before each call the relay checks the spending cap in klaus.config.json
 * (component writes and relay tokens) and, when given, --max-calls. A call
 * that would pass a limit is not made: that file and every file after it are
 * deferred. The run report goes to .klaus/reports/ in the frame's format.
 *
 * Options:
 *   --reconcile            Mark the generated components the plugin wrote as sent, in one read-only call.
 *                          Takes no release folder, --run, --repo, --artifact or --release.
 *   --root <dir>           The repo. klaus.config.json, the ledger and the reports are under it. Default: here.
 *   --config <file>        Default klaus.config.json. It must name the Figma file (outputs.figma.target).
 *   --ledger <file>        Default <outputDir>/ledger.json, as the generator keeps it.
 *   --report-dir <dir>     Default .klaus/reports.
 *   --model <id>           The relaying model. Default gpt-5.6-terra.
 *   --effort <level>       Its reasoning effort. Default low.
 *   --max-calls <n>        Make at most n calls in this run.
 *   --timeout <seconds>    For one call. Default 600.
 *   --events-dir <dir>     Keep each call's Codex events, one .jsonl per data file.
 *   --keep-codex-config    Run Codex with ~/.codex/config.toml as it is. By default the relay ignores
 *                          it and gives Codex the figma server alone, so no other server, plugin or
 *                          hook adds to the tokens.
 *   --dry-run              Say what would be sent and what it would cost. Makes no call.
 *   --json                 Print the run report.
 *   --codex <path>, --gh <path>   The executables. Default: found on PATH.
 *
 * Exit 0 when every unit was sent or deferred, 1 when a unit failed, 2 on an
 * error the person running it can fix (not signed in, no manifest, bad option),
 * 3 on any other error.
 *
 * No dependencies.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { loadConfig } from "../../../frame/config.mjs";
import { UserError } from "../../../frame/errors.mjs";
import { readJsonFile, writeJsonFile } from "../../../frame/json-file.mjs";
import { buildReport, writeReport } from "../../../frame/report.mjs";
import { codeFor, newKey, withReleaseTokens } from "../codegen.mjs";
import { checkTargets, DataError, readData } from "../data-file.mjs";
import { fileKeyOf, MANIFEST_VERSION } from "../index.mjs";
import { CHANGED, entrySent, entryStatus, GENERATED, generatedComponents, markGeneratedAsSent, readLedger, recordEntry, screenCount, SENT } from "../ledger.mjs";
import { MAX_CODE_CHARS, readOptions, relayCallTokens } from "../settings.mjs";
import { decodeResult, FIGMA_SERVER, FIGMA_TOOL, keyIn, parseEvents, readCodeResult, relayTokens, resultText, summarizeEvents } from "./events.mjs";
import { lookupPlan, readFound, reconcileCode } from "./reconcile.mjs";

/**
 * The relaying model. On 2026-10-18 gpt-6-luna at low effort changed a 20,582-character file on
 * the way in two of two tries, and gpt-5.6-terra at low effort copied it exactly in one try
 * (apart from the final newline), at 70,639 relay tokens and about two minutes.
 */
export const DEFAULT_MODEL = "gpt-5.6-terra";
export const DEFAULT_EFFORT = "low";
export const DEFAULT_TIMEOUT_SECONDS = 600;
export const DEFAULT_ARTIFACT = "klaus-figma";
export const DEFAULT_FIGMA_URL = "https://mcp.figma.com/mcp";

/** How long Codex waits for Figma's MCP server to sign in and list its tools. */
export const MCP_STARTUP_TIMEOUT_SECONDS = 60;

/** codex mcp list reads local config only, so a hang means something is wrong. */
const MCP_LIST_TIMEOUT_MS = 30000;

/** The output name in the run report, so a relay run is not counted as another generator run. */
export const REPORT_OUTPUT = "figma-relay";

const FILE_NAME = /^figma-\d{3,}\.json$/;

/** Where design-onboard installs the Klaus workflow. A run of any other workflow is not trusted. */
export const KLAUS_WORKFLOW = ".github/workflows/klaus.yml";
const FILE_KEY = /^[0-9A-Za-z]{22,128}$/;
const MODEL = /^[A-Za-z0-9._-]{1,100}$/;
const EFFORT = /^[a-z]{1,20}$/;
const SENT_STATUSES = new Set(["written", "exists"]);

/**
 * The tokens a file's call is expected to cost: the generator's measured rate (settings.mjs).
 * Calls measured in this run raise it, never lower it.
 */
export function predictTokens(chars, ratios = []) {
  return Math.ceil(relayCallTokens(chars) * Math.max(1, ...ratios));
}

/** The prompt. It holds no code: the code arrives on stdin, which Codex appends as a <stdin> block. */
export function relayPrompt({ fileKey, fileName }) {
  return [
    "You are a relay. Your whole job is one tool call.",
    `Call the ${FIGMA_TOOL} tool of the ${FIGMA_SERVER} MCP server exactly once, with these arguments:`,
    `- fileKey: ${fileKey}`,
    `- description: Klaus relay: ${fileName}`,
    "- code: the whole text inside the <stdin> block below, character for character.",
    "Do not change, shorten, reformat, fix or explain the code. Make no design decisions.",
    "Call no other tool, read no skill or resource, and run no command.",
    "If the call fails, do not retry it.",
    "After the call, reply with the tool's result text exactly as it came back, and nothing else.",
  ].join("\n");
}

/** The arguments for one `codex exec`. */
export function codexArgs({ model, effort, workdir, figmaUrl, keepCodexConfig, prompt }) {
  const args = ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "-C", workdir, "-m", model];
  if (!keepCodexConfig) args.push("--ignore-user-config", "-c", `mcp_servers.${FIGMA_SERVER}.url="${figmaUrl}"`);
  args.push(
    "-c", `model_reasoning_effort="${effort}"`,
    "-c", 'approval_policy="never"',
    "-c", "features.hooks=false",
    // No shell tool: the model then has use_figma and Codex's built-in file tools in a read-only sandbox, and cannot run a command.
    "-c", "features.shell_tool=false",
    "-c", `mcp_servers.${FIGMA_SERVER}.enabled_tools=["${FIGMA_TOOL}"]`,
    // A server that has not listed its tools by then is dropped, and the model runs without use_figma.
    "-c", `mcp_servers.${FIGMA_SERVER}.startup_timeout_sec=${MCP_STARTUP_TIMEOUT_SECONDS}`,
    "-c", `mcp_servers.${FIGMA_SERVER}.tools.${FIGMA_TOOL}.approval_mode="approve"`,
    prompt,
  );
  return args;
}

/**
 * The repo's own Klaus settings: the cap, the Figma adapter's options, and the Figma file. The
 * file comes from here only, never from an artifact.
 */
function readSettings(root, configOption) {
  const file = path.resolve(root, configOption ?? "klaus.config.json");
  if (!existsSync(file)) throw new UserError(`The relay needs the repo's ${path.basename(file)}, which names the Figma file to write. ${file} does not exist.`);
  const config = loadConfig(file);
  let options;
  try {
    options = readOptions(config.outputs.figma ?? {});
  } catch (error) {
    throw new UserError(error.message);
  }
  const fileKey = fileKeyOf(config.outputs.figma?.target);
  if (!fileKey) throw new UserError(`${file} does not name a Figma file. Set outputs.figma.target to the file's key or URL.`);
  return { cap: config.spendingCap, options, outputDir: options.outputDir, fileKey };
}

function readManifest(folder) {
  const file = path.join(folder, "manifest.json");
  const manifest = readJsonFile(file, "The Figma manifest");
  if (manifest?.output !== "figma") throw new UserError(`${file} is not a manifest the Figma generator wrote.`);
  if (manifest.schemaVersion !== MANIFEST_VERSION) {
    throw new UserError(`${file} is version ${manifest.schemaVersion}. The relay needs version ${MANIFEST_VERSION}, which lists each unit's ledger entry. Run the generator again.`);
  }
  if (!Array.isArray(manifest.files)) throw new UserError(`${file} has no files list.`);
  const entries = manifest.ledgerEntries ?? {};
  for (const entry of manifest.files) {
    if (!FILE_NAME.test(entry?.name ?? "")) throw new UserError(`${file} names a data file ${JSON.stringify(entry?.name)}, which is not a name the generator writes.`);
    if (!Array.isArray(entry.units) || entry.units.length === 0) throw new UserError(`${file} lists ${entry.name} without its units.`);
    if (!Number.isInteger(entry.chars) || entry.chars < 0) throw new UserError(`${file} lists ${entry.name} without its character count.`);
    for (const id of entry.units) {
      if (!Object.hasOwn(entries, id) || !entries[id] || typeof entries[id] !== "object") throw new UserError(`${file} has no ledger entry for ${id}.`);
      const { kind, name, version, route, release } = entries[id];
      const whole = kind === "component" ? typeof name === "string" && typeof version === "string" : kind === "screen" && typeof route === "string" && typeof release === "string";
      if (!whole) throw new UserError(`${file} has a ledger entry for ${id} without its kind and version.`);
    }
  }
  return manifest;
}

/** Folders under dir that hold a manifest.json. Links are not followed. */
function manifestFolders(dir, depth = 0) {
  if (depth > 5) return [];
  const found = existsSync(path.join(dir, "manifest.json")) ? [dir] : [];
  try {
    for (const name of readdirSync(dir)) {
      const child = path.join(dir, name);
      if (lstatSync(child).isDirectory()) found.push(...manifestFolders(child, depth + 1));
    }
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError(`Could not read the artifact at ${dir}: ${error.message}`);
  }
  return found;
}

function findReleaseFolder(dir, release) {
  const folders = manifestFolders(dir);
  if (folders.length === 0) throw new UserError("The artifact holds no manifest.json.");
  if (folders.length === 1 && !release) return folders[0];
  const releases = folders.map((folder) => ({ folder, release: readJsonFile(path.join(folder, "manifest.json"), "The Figma manifest").release }));
  const match = releases.filter((r) => r.release === release);
  if (match.length === 1) return match[0].folder;
  throw new UserError(`The artifact holds ${folders.length} releases (${releases.map((r) => r.release).join(", ")}). Pick one with --release.`);
}

/** Reads a GitHub API path with gh, as JSON. */
function ghApi(gh, apiPath, cwd) {
  try {
    return JSON.parse(execFileSync(gh, ["api", apiPath], { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: MCP_LIST_TIMEOUT_MS }));
  } catch (error) {
    const said = String(error.stderr || error.message).trim().slice(0, 300);
    throw new UserError(`gh could not read ${apiPath}: ${said}`);
  }
}

/**
 * Checks that a CI run may be trusted: it ran the Klaus workflow, it succeeded, and its commit is
 * on the default branch. A release run is started by a tag, so its head branch is the tag's name;
 * then the commit must be in the default branch's history.
 */
function checkRun({ gh, run, repo, cwd }) {
  const target = repo ?? "{owner}/{repo}";
  const info = ghApi(gh, `repos/${target}/actions/runs/${run}`, cwd);
  if (info.path !== KLAUS_WORKFLOW) {
    throw new UserError(`Run ${run} is from ${JSON.stringify(info.path)}, not the Klaus workflow (${KLAUS_WORKFLOW}). The relay sends only what the Klaus workflow made.`);
  }
  if (info.status !== "completed" || info.conclusion !== "success") {
    throw new UserError(`Run ${run} did not succeed (${info.conclusion ?? info.status}). The relay sends only what a successful run made.`);
  }
  const main = ghApi(gh, `repos/${target}`, cwd).default_branch;
  if (typeof main !== "string" || main === "") throw new UserError(`gh did not say what the default branch of ${target} is.`);
  if (info.head_branch === main) return;
  const sha = String(info.head_sha ?? "");
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new UserError(`Run ${run} has no commit id the relay can check.`);
  const compared = ghApi(gh, `repos/${target}/compare/${encodeURIComponent(main)}...${sha}`, cwd);
  if (compared.status !== "identical" && compared.status !== "behind") {
    throw new UserError(`Run ${run} ran on ${JSON.stringify(info.head_branch)}, at a commit that is not on ${main}. The relay sends only what was made from the default branch.`);
  }
}

function downloadArtifact({ gh, run, repo, artifact, cwd }) {
  if (!/^\d+$/.test(run)) throw new UserError(`--run must be a run id, a number, not ${JSON.stringify(run)}.`);
  if (repo !== undefined && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new UserError(`--repo must be owner/name, not ${JSON.stringify(repo)}.`);
  checkRun({ gh, run, repo, cwd });
  // A fresh empty folder: the artifact is data from CI, kept apart from everything else.
  const dir = mkdtempSync(path.join(tmpdir(), "klaus-relay-artifact-"));
  const args = ["run", "download", run, "--name", artifact, "--dir", dir];
  if (repo) args.push("--repo", repo);
  try {
    execFileSync(gh, args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    const said = String(error.stderr ?? error.message).trim().slice(0, 300);
    throw new UserError(`gh could not download the ${artifact} artifact of run ${run}: ${said}`);
  }
  return dir;
}

/**
 * Reads and checks every data file the manifest lists, and builds each one's code, before any call.
 * Anything that is not the generator's shape, writes where the settings do not say, or does not
 * match the manifest's ledger entries stops the run here.
 *
 * Each file gets two versions of its code. The held one writes no changed token value. The last one
 * is for the call that sends the release's last component unit: it carries the tokens of the release's
 * other files too and writes every changed value at its end (runtime.js, TOKEN_VALUES). The run picks
 * one when it reaches the file.
 * @returns {Map<string, { key: number[], held: string, last: string }>}  The code of each data file, by name, with the key its strings are encoded with.
 */
function prepareCode(folder, manifest, options) {
  const refuse = (file) => (why) => {
    throw new UserError(`${file.name} is refused, so nothing was sent: ${why}`);
  };
  const read = [];
  for (const file of manifest.files) {
    const where = path.join(folder, file.name);
    const fail = refuse(file);
    if (!existsSync(where) || !lstatSync(where).isFile()) fail("it is not in the folder.");
    let data;
    try {
      data = readData(readFileSync(where, "utf8"), file.name);
      checkTargets(data, options, file.name);
    } catch (error) {
      if (error instanceof DataError) fail(error.message);
      throw error;
    }
    const ids = data.units.map((unit) => unit.id);
    if (ids.length !== file.units.length || ids.some((id, i) => id !== file.units[i])) fail(`it holds ${ids.join(", ")}, but the manifest lists ${file.units.join(", ")}.`);
    for (const unit of data.units) {
      const entry = manifest.ledgerEntries[unit.id];
      const same = unit.kind === "component"
        ? entry.kind === "component" && entry.name === unit.name && entry.version === unit.version
        : unit.kind === "screen" && entry.kind === "screen" && entry.route === unit.route && entry.release === unit.release;
      if (!same) fail(`its unit ${unit.id} does not match the manifest's ledger entry.`);
    }
    read.push({ file, data });
  }
  const code = new Map();
  for (const { file, data } of read) {
    const fail = refuse(file);
    // A new key for each call: the model sees every piece of the data's text as noise (codegen.mjs).
    const key = newKey();
    const held = codeFor(data, { key, tokenValues: "hold" });
    if (held.length > MAX_CODE_CHARS) fail(`its code comes to ${held.length} characters, more than the ${MAX_CODE_CHARS} one call takes.`);
    let last;
    try {
      last = codeFor(withReleaseTokens(data, read.filter((other) => other.file !== file).map((other) => other.data)), { key, tokenValues: "last" });
    } catch (error) {
      fail(error.message);
    }
    if (last.length > MAX_CODE_CHARS) {
      fail(`its code comes to ${last.length} characters with the tokens of the release's other files, which the call that sends the release's last component unit writes, and ${MAX_CODE_CHARS} is all one call takes. Lower outputs.figma.options.componentsPerCall.`);
    }
    code.set(file.name, { key, held, last });
  }
  return code;
}

/** Checks Codex has a signed-in figma server, and returns its URL. */
function checkCodex(codex) {
  let text;
  try {
    text = execFileSync(codex, ["mcp", "list", "--json"], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: MCP_LIST_TIMEOUT_MS });
  } catch (error) {
    if (error.code === "ENOENT") throw new UserError(`The Codex CLI (${codex}) is not installed. See relay/README.md.`);
    if (error.code === "ETIMEDOUT") throw new UserError(`codex mcp list did not answer within ${MCP_LIST_TIMEOUT_MS / 1000} seconds.`);
    throw new UserError(`codex mcp list failed: ${String(error.stderr ?? error.message).trim().slice(0, 300)}`);
  }
  let servers;
  try {
    servers = JSON.parse(text);
  } catch {
    throw new UserError("codex mcp list --json did not print JSON.");
  }
  const figma = Array.isArray(servers) ? servers.find((s) => s?.name === FIGMA_SERVER) : null;
  if (!figma) throw new UserError(`Codex has no ${FIGMA_SERVER} MCP server. Run: codex mcp add ${FIGMA_SERVER} --url ${DEFAULT_FIGMA_URL}`);
  if (figma.enabled === false) throw new UserError(`The ${FIGMA_SERVER} MCP server is disabled in Codex.`);
  if (figma.auth_status === "not_logged_in") {
    throw new UserError(`Codex is not signed in to Figma. Run: codex mcp login ${FIGMA_SERVER} (add --no-browser on a machine without a browser).`);
  }
  const url = figma.transport?.url;
  if (typeof url !== "string" || !/^https:\/\/[^\s"\\]+$/.test(url)) {
    throw new UserError(`The ${FIGMA_SERVER} MCP server in Codex has no https URL the relay can pass on. Add it with: codex mcp add ${FIGMA_SERVER} --url ${DEFAULT_FIGMA_URL}`);
  }
  return { url };
}

/** Runs one `codex exec` and collects what it printed. Never throws. */
function spawnCodex(codex, args, input, cwd, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const done = (fields) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, timedOut, ...fields });
    };
    const child = spawn(codex, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-20000);
    });
    child.on("error", (error) => done({ exitCode: null, error }));
    child.on("close", (exitCode, signal) => done({ exitCode, signal }));
    // Codex may exit before it reads all of stdin. That shows up in its exit code, not here.
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

/** How a unit is named in Figma: the set "Button 1.1.0", or the frame "/settings v3.0.0". */
const labelOf = (entry) => (entry.kind === "component" ? `${entry.name} ${entry.version}` : `${entry.route} ${entry.release}`);

const lastLine = (text) => String(text).trim().split("\n").filter(Boolean).at(-1)?.slice(0, 300) ?? "";

/**
 * Runs `codex exec` with the code on stdin and reads what it printed.
 * @returns {Promise<{ run: object, summary: object, warnings: string[] }>}
 */
async function runCodex({ codex, args, code, workdir, timeoutMs, eventsFile }) {
  const run = await spawnCodex(codex, args, code, workdir, timeoutMs);
  if (eventsFile) {
    writeFileSync(eventsFile, run.stdout);
    if (run.stderr) writeFileSync(eventsFile.replace(/\.jsonl$/, ".stderr.txt"), run.stderr);
  }
  const { events, unreadable } = parseEvents(run.stdout);
  const summary = summarizeEvents(events);
  const warnings = [];
  if (summary.calls.length > 1) warnings.push(`Codex called ${FIGMA_TOOL} ${summary.calls.length} times. The prompt asks for one call.`);
  if (summary.otherTools.length > 0) warnings.push(`Codex also called ${[...new Set(summary.otherTools)].join(", ")}.`);
  if (unreadable > 0) warnings.push(`${unreadable} lines of Codex's output were not JSON events.`);
  return { run, summary, warnings };
}

/** Adds to errors why a run made no use_figma call, or to warnings what went wrong after one. */
function judgeRun({ run, summary, timeoutMs, errors, warnings }) {
  if (summary.calls.length === 0) {
    if (summary.started > 0) errors.push(`${FIGMA_TOOL} started and did not finish, so whether it wrote is unknown.`);
    if (summary.failure) errors.push(summary.failure);
    else if (run.error) errors.push(`Codex could not be started: ${run.error.message}`);
    else if (run.timedOut) errors.push(`Codex did not finish within ${Math.round(timeoutMs / 1000)} seconds.`);
    else if (run.exitCode !== 0) errors.push(`Codex exited with ${run.exitCode ?? run.signal}: ${lastLine(run.stderr) || "no message"}`);
    else {
      const said = summary.message ? ` It replied: ${summary.message.replace(/\s+/g, " ").slice(0, 200)}` : "";
      // A model with use_figma in front of it calls it. One that calls nothing most likely never had it.
      const why = summary.otherTools.length === 0
        ? ` The ${FIGMA_SERVER} server's tools most likely did not reach the model: its sign-in may need renewing (codex mcp login ${FIGMA_SERVER}), or it did not start within ${MCP_STARTUP_TIMEOUT_SECONDS} seconds.`
        : "";
      errors.push(`Codex did not call ${FIGMA_TOOL}.${said}${why}`);
    }
  } else if (run.error) {
    warnings.push(`Codex reported an error after the call: ${run.error.message}`);
  } else if (run.exitCode !== 0 && !run.timedOut) {
    warnings.push(`Codex exited with ${run.exitCode ?? run.signal} after the call: ${lastLine(run.stderr) || "no message"}`);
  }
}

/**
 * Sends one code file and reads the outcome.
 * @returns {Promise<{ units: Map<string, object>, changed: Set<string>, tokenValues: { held: string[], written: string[] }, error: string | null, usage: object | null, tokens: number | null, warnings: string[], durationMs: number }>}
 *   units holds what the code reported for each unit, from calls that carried the file's code unchanged.
 *   changed holds the units Figma wrote from code Codex had changed.
 *   tokenValues holds the tokens whose changed value the code held back, and those it wrote, from the same calls.
 */
async function sendFile({ codex, args, code, key, workdir, timeoutMs, fileKey, eventsFile }) {
  const startedAt = Date.now();
  const { run, summary, warnings } = await runCodex({ codex, args, code, workdir, timeoutMs, eventsFile });
  const units = new Map();
  const changed = new Set();
  const held = new Set();
  const written = new Set();
  const errors = [];
  const text = code.toString("utf8").trim();

  for (const call of summary.calls) {
    // What Codex's own events say it sent. The relay cannot see what Figma's server received,
    // so this trusts Codex's event log. Whitespace at either end is ignored: a model may drop the
    // file's last newline, and that changes nothing the code does.
    const sent = call.arguments?.code;
    if (typeof sent !== "string" || sent.trim() !== text) {
      errors.push(`Codex changed the code before it reached ${FIGMA_TOOL}, so its result is not trusted.`);
      // Figma may still have drawn units from the changed code. Those sets may be wrong.
      // The runtime encoded its result with the key it was given, which is the changed code's own.
      const found = call.status === "completed" ? readCodeResult(call.result) : null;
      const drawn = found ? decodeResult(found, (typeof sent === "string" ? keyIn(sent) : null) ?? key) : null;
      for (const unit of drawn?.units ?? []) if (unit.status === "written") changed.add(unit.id);
      continue;
    }
    if (call.arguments?.fileKey !== fileKey) {
      errors.push(`Codex sent the code to file ${JSON.stringify(call.arguments?.fileKey)}, not ${fileKey}.`);
      continue;
    }
    if (call.status !== "completed") {
      errors.push(`${FIGMA_TOOL} failed: ${call.error ?? (resultText(call.result) || "no reason given")}`);
      continue;
    }
    const encoded = readCodeResult(call.result);
    if (!encoded) {
      errors.push(`${FIGMA_TOOL} returned a result Klaus cannot read: ${resultText(call.result) || "an empty result"}`);
      continue;
    }
    // The runtime encodes every string of its result with the call's key, so the model read none of it.
    const returned = decodeResult(encoded, key);
    for (const unit of returned.units) {
      // Over two calls, a unit counts as sent if either call sent it.
      if (!SENT_STATUSES.has(units.get(unit.id)?.status)) units.set(unit.id, unit);
    }
    for (const [list, into] of [[returned.tokens?.held, held], [returned.tokens?.updated, written]]) {
      for (const name of Array.isArray(list) ? list : []) if (typeof name === "string") into.add(name);
    }
    for (const warning of Array.isArray(returned.warnings) ? returned.warnings : []) warnings.push(`Figma: ${String(warning).slice(0, 300)}`);
  }

  judgeRun({ run, summary, timeoutMs, errors, warnings });

  return {
    units,
    changed,
    tokenValues: { held: [...held].filter((name) => !written.has(name)), written: [...written] },
    error: errors.length > 0 ? [...new Set(errors)].join(" ") : null,
    usage: summary.usage,
    tokens: relayTokens(summary.usage),
    warnings,
    durationMs: Date.now() - startedAt,
  };
}

/** Why the next call must not be made, or null when it fits. */
function capReason({ totals, predicted, components, cap, maxCalls }) {
  if (maxCalls !== null && totals.calls + 1 > maxCalls) return "call-cap";
  if (totals.componentWrites + components > cap.maxComponentWrites) return "write-cap";
  if (predicted > cap.maxRelayTokens) return "larger-than-token-cap";
  if (totals.tokens + predicted > cap.maxRelayTokens) return "token-cap";
  return null;
}

const share = (value, count) => (value === null ? null : Math.round((value / count) * 100) / 100);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Relays one release folder.
 * @param {object} options  The command line's options, by long name in camel case.
 * @returns {Promise<{ report: object, reportFile: string | null, exitCode: number }>}
 */
export async function runRelay(options) {
  const root = path.resolve(options.root ?? process.cwd());
  if (!MODEL.test(options.model ?? DEFAULT_MODEL)) throw new UserError(`--model ${JSON.stringify(options.model)} is not a model id.`);
  if (!EFFORT.test(options.effort ?? DEFAULT_EFFORT)) throw new UserError(`--effort ${JSON.stringify(options.effort)} is not an effort level.`);

  const settings = readSettings(root, options.config);
  const ledgerPath = options.ledger ? path.resolve(root, options.ledger) : path.join(root, settings.outputDir, "ledger.json");
  if (options.reconcile) {
    const stray = [options.folder && "a release folder", options.run && "--run", options.repo && "--repo", options.artifact && "--artifact", options.release && "--release"].filter(Boolean);
    if (stray.length > 0) throw new UserError(`--reconcile reads the ledger and Figma, and takes no release folder or artifact. Remove ${stray.join(", ")}.`);
    return reconcileLedger(options, { root, settings, ledgerPath });
  }
  if (Boolean(options.folder) === Boolean(options.run)) throw new UserError("Give a release folder or --run <id>, not both and not neither.");
  if (!options.run) return relayRelease(options, { root, settings, ledgerPath, folder: path.resolve(root, options.folder), source: null });
  const downloaded = downloadArtifact({ gh: options.gh ?? "gh", run: options.run, repo: options.repo, artifact: options.artifact ?? DEFAULT_ARTIFACT, cwd: root });
  try {
    const source = `the ${options.artifact ?? DEFAULT_ARTIFACT} artifact of run ${options.run}`;
    return await relayRelease(options, { root, settings, ledgerPath, folder: findReleaseFolder(downloaded, options.release), source });
  } finally {
    rmSync(downloaded, { recursive: true, force: true });
  }
}

/** Relays the release in folder. source names the artifact it came from, or is null for a local folder. */
async function relayRelease(options, { root, settings, ledgerPath, folder, source }) {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => {});
  const codex = options.codex ?? "codex";
  const dryRun = Boolean(options.dryRun);
  const model = options.model ?? DEFAULT_MODEL;
  const effort = options.effort ?? DEFAULT_EFFORT;
  const maxCalls = options.maxCalls ?? null;
  const timeoutMs = (options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
  const manifest = readManifest(folder);
  // The Figma file comes from the repo's settings. The manifest only has to agree with them.
  const fileKey = settings.fileKey;
  if (!FILE_KEY.test(fileKey)) throw new UserError(`outputs.figma.target is not a Figma file key the relay can use.`);
  if (manifest.fileKey !== fileKey) {
    throw new UserError(`The manifest is for Figma file ${JSON.stringify(manifest.fileKey)}, but klaus.config.json names ${fileKey}. The relay writes only to the file the settings name, so nothing was sent.`);
  }
  const prepared = prepareCode(folder, manifest, settings.options);

  const warnings = [];
  let figmaUrl = DEFAULT_FIGMA_URL;
  try {
    figmaUrl = checkCodex(codex).url;
  } catch (error) {
    if (!dryRun || !(error instanceof UserError)) throw error;
    warnings.push(error.message);
  }

  const ledger = readLedger(ledgerPath);
  const startedAt = now();
  const keepEvents = options.eventsDir ? path.resolve(root, options.eventsDir) : null;
  if (keepEvents) mkdirSync(keepEvents, { recursive: true });
  const workdir = mkdtempSync(path.join(tmpdir(), "klaus-relay-"));

  const totals = { calls: 0, tokens: 0, measured: 0, unmeasured: 0, componentWrites: 0 };
  const ratios = [];
  const fileRecords = [];
  const unitRecords = [];
  const sent = [];
  const failed = [];
  const deferred = [];
  const estimated = { calls: 0, tokens: 0, usd: 0 };
  const uncapped = { calls: 0, tokens: 0, usd: 0 };
  let stopped = null;
  let planned = 0;

  // Changed token values are written only by the call that sends the release's last component unit
  // (runtime.js, TOKEN_VALUES), so a version moved to Older versions in an earlier call is frozen
  // in the colours it shipped with. The count is taken from the results of the calls made.
  const unitIds = manifest.files.flatMap((file) => file.units);
  const componentIds = unitIds.filter((id) => manifest.ledgerEntries[id].kind === "component");
  const sentIds = new Set(unitIds.filter((id) => entrySent(ledger, manifest.ledgerEntries[id])));
  const tokenWritten = new Set();
  const tokenWaiting = new Set();

  try {
    for (const file of manifest.files) {
      const entries = file.units.map((id) => ({ id, ...manifest.ledgerEntries[id] }));
      const pending = entries.filter((entry) => !entrySent(ledger, entry));
      // This call is the release's last when every other component unit is already sent. Then it
      // writes the changed token values, unless a component unit of this call fails (the runtime checks).
      const lastCall = componentIds.every((id) => file.units.includes(id) || sentIds.has(id));
      const { key, ...variants } = prepared.get(file.name);
      const text = lastCall ? variants.last : variants.held;
      const code = Buffer.from(text, "utf8");
      const chars = text.length;
      const record = { name: file.name, chars, units: file.units };
      const unitBase = (entry) => ({ id: entry.id, kind: entry.kind, file: file.name });
      if (pending.length === 0) {
        fileRecords.push({ ...record, status: "already sent", calls: 0, tokens: 0 });
        unitRecords.push(...entries.map((entry) => ({ ...unitBase(entry), status: "already sent", calls: 0, tokens: 0 })));
        continue;
      }
      record.tokenValues = lastCall ? "written at the end of the call" : "held";
      planned += pending.length;
      const predicted = predictTokens(chars, ratios);
      uncapped.calls += 1;
      uncapped.tokens += predicted;
      const components = pending.filter((entry) => entry.kind === "component").length;
      stopped = stopped ?? capReason({ totals, predicted, components, cap: settings.cap, maxCalls });
      if (stopped) {
        fileRecords.push({ ...record, status: "deferred", reason: stopped, predictedTokens: predicted, calls: 0, tokens: 0 });
        for (const entry of entries) {
          const isPending = pending.includes(entry);
          unitRecords.push({ ...unitBase(entry), status: isPending ? "deferred" : "already sent", reason: isPending ? stopped : undefined, calls: 0, tokens: 0 });
          if (isPending) deferred.push({ id: entry.id, kind: entry.kind, reason: stopped });
        }
        continue;
      }
      estimated.calls += 1;
      estimated.tokens += predicted;
      totals.calls += 1;
      totals.componentWrites += components;
      if (dryRun) {
        totals.tokens += predicted;
        // A dry run assumes the call succeeds, so the files after it can be the last.
        for (const entry of pending) sentIds.add(entry.id);
        fileRecords.push({ ...record, status: "would send", predictedTokens: predicted, calls: 1, tokens: null });
        unitRecords.push(...entries.map((entry) => ({ ...unitBase(entry), status: pending.includes(entry) ? "would send" : "already sent", calls: share(1, entries.length), tokens: null })));
        continue;
      }

      log(`${file.name}: sending ${plural(entries.length, "unit")}, about ${predicted} relay tokens`);
      const prompt = relayPrompt({ fileKey, fileName: file.name });
      const args = codexArgs({ model, effort, workdir, figmaUrl, keepCodexConfig: Boolean(options.keepCodexConfig), prompt });
      const eventsFile = keepEvents ? path.join(keepEvents, file.name.replace(/\.json$/, ".jsonl")) : null;
      const outcome = await sendFile({ codex, args, code, key, workdir, timeoutMs, fileKey, eventsFile });

      if (outcome.tokens === null) {
        // Codex stopped before it said what the call cost. The cap counts the prediction.
        totals.tokens += predicted;
        totals.unmeasured += 1;
      } else {
        totals.tokens += outcome.tokens;
        totals.measured += outcome.tokens;
        ratios.push(outcome.tokens / predictTokens(chars));
      }

      for (const name of outcome.tokenValues.held) tokenWaiting.add(name);
      for (const name of outcome.tokenValues.written) {
        tokenWaiting.delete(name);
        tokenWritten.add(name);
      }

      let sentHere = 0;
      const marks = [];
      for (const entry of entries) {
        const returned = outcome.units.get(entry.id);
        const base = { ...unitBase(entry), figma: returned?.status, calls: share(1, entries.length), tokens: share(outcome.tokens, entries.length) };
        if (!pending.includes(entry)) {
          unitRecords.push({ ...base, status: "already sent" });
          continue;
        }
        let error = null;
        if (outcome.changed.has(entry.id)) {
          marks.push([entry, CHANGED]);
          error = `Figma drew ${labelOf(entry)} from code Codex changed on the way, so the set may be wrong. Delete it in Figma, then run the relay again.`;
        } else if (returned?.status === "exists" && entryStatus(ledger, entry) === CHANGED) {
          error = `${labelOf(entry)} in Figma was drawn from code Codex changed in an earlier run. Delete it in Figma, then run the relay again.`;
        } else if (SENT_STATUSES.has(returned?.status)) {
          marks.push([entry, SENT]);
          sent.push(entry.id);
          sentIds.add(entry.id);
          sentHere += 1;
          unitRecords.push({ ...base, status: "sent" });
          continue;
        } else if (returned?.status === "failed") error = `Figma: ${String(returned.error ?? "the unit failed")}`;
        else error = outcome.error ?? `${FIGMA_TOOL}'s result does not list ${entry.id}.`;
        failed.push({ id: entry.id, error });
        unitRecords.push({ ...base, status: "failed", error });
      }
      if (marks.length > 0) {
        // Apply this file's marks to the ledger as it is now, so a mark another run wrote
        // since this run read it is kept.
        const fresh = readLedger(ledgerPath);
        for (const [entry, status] of marks) {
          recordEntry(fresh, entry, status);
          recordEntry(ledger, entry, status);
        }
        writeJsonFile(ledgerPath, fresh);
      }

      const status = sentHere === pending.length ? "sent" : sentHere === 0 ? "failed" : "partly sent";
      fileRecords.push({
        ...record,
        status,
        error: outcome.error ?? undefined,
        calls: 1,
        tokens: outcome.tokens,
        usage: outcome.usage,
        predictedTokens: predicted,
        durationMs: outcome.durationMs,
        warnings: outcome.warnings.length > 0 ? outcome.warnings : undefined,
      });
      for (const warning of outcome.warnings) warnings.push(`${file.name}: ${warning}`);
      log(`${file.name}: ${status}, ${outcome.tokens ?? "unknown"} relay tokens${outcome.error ? `. ${outcome.error}` : ""}`);
    }
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }

  // Screenshot uploads go through another tool, which the relay does not call yet.
  const uploads = (manifest.uploads ?? []).filter((upload) => !entrySent(ledger, manifest.ledgerEntries[upload.id] ?? { kind: "screen", route: upload.screen, release: upload.release }));
  for (const upload of uploads) deferred.push({ id: upload.id, kind: "screen", reason: "upload-not-supported" });
  if (uploads.length > 0) {
    warnings.push(`The relay does not upload screenshots yet, so ${plural(uploads.length, "upload")}${manifest.afterUploads ? " and the retention file" : ""} were not sent.`);
  }
  if (totals.unmeasured > 0) warnings.push(`${plural(totals.unmeasured, "call")} ended without a token count, so actual tokens leave them out. The cap counted their predicted tokens.`);
  if (stopped === "larger-than-token-cap") {
    warnings.push("The next code file alone needs more relay tokens than spendingCap.maxRelayTokens allows, so it will never be sent at this cap. Raise the cap, or lower outputs.figma.options.componentsPerCall.");
  } else if (stopped) warnings.push(`The relay stopped before a call that would pass the ${stopped}. The rest is deferred to the next run.`);
  const waiting = tokenWaiting.size;
  if (waiting > 0) {
    warnings.push("Changed token values wait for the call that sends the release's last component unit, so older versions keep the colours they shipped with. Run the relay on this folder again to send the rest. The count covers the calls made.");
  }

  // A call that ended without a token count is left out of actual tokens, as for a send. The cap counted its prediction.
  const actual = { calls: dryRun ? 0 : totals.calls, tokens: dryRun ? 0 : totals.measured, usd: 0 };
  const waitingNote = waiting > 0 ? ` ${plural(waiting, "token change")} waiting for the release's last call.` : "";
  const summary = dryRun
    ? `Figma relay, dry run: would send ${plural(unitRecords.filter((u) => u.status === "would send").length, "unit")} in ${plural(estimated.calls, "call")}, about ${estimated.tokens} relay tokens; ${deferred.length} deferred.`
    : `Figma relay: sent ${sent.length} of ${plural(planned, "unit")} in ${plural(actual.calls, "call")}, ${actual.tokens} relay tokens; ${failed.length} failed, ${deferred.length} deferred.${waitingNote}`;
  const outputRecord = {
    output: REPORT_OUTPUT,
    status: dryRun ? "dry-run" : "ok",
    reason: null,
    releases: manifest.release ? [manifest.release] : [],
    planned,
    written: sent,
    deferred,
    failed,
    estimated,
    estimatedUncapped: uncapped,
    actual,
    adapter: {
      summary,
      links: [{ label: "Figma file", url: `https://www.figma.com/design/${fileKey}` }],
      details: {
        // A downloaded artifact is removed after the run, so its temporary path would point nowhere.
        folder: source ?? folder,
        ledger: ledgerPath,
        model,
        effort,
        codexConfig: options.keepCodexConfig ? "user" : "clean",
        maxCalls,
        // Token values this run's calls changed in Figma, and those they held back for the release's last call.
        tokenChanges: { written: tokenWritten.size, waiting },
        files: fileRecords,
        units: unitRecords,
      },
    },
    warnings,
  };
  const report = buildReport({
    status: failed.length > 0 ? "failed" : "ok",
    startedAt,
    finishedAt: now(),
    trigger: "manual",
    release: manifest.release ?? null,
    dryRun,
    cap: settings.cap,
    outputs: [outputRecord],
  });
  const reportFile = dryRun ? null : writeReport(path.resolve(root, options.reportDir ?? ".klaus/reports"), report);
  return { report, reportFile, exitCode: failed.length > 0 ? 1 : 0 };
}

/**
 * Sends the reconcile code and reads the booleans it returned. Nothing is trusted that did not
 * come from the tool's own result: the code use_figma received must be the code the relay wrote,
 * on the settings' file, and the result must hold a list of true and false as long as the list of
 * labels sent. Any error means no answer.
 * @returns {Promise<{ found: boolean[] | null, error: string | null, usage: object | null, tokens: number | null, warnings: string[], durationMs: number }>}
 */
async function sendReconcile({ codex, args, code, expected, workdir, timeoutMs, fileKey, eventsFile }) {
  const startedAt = Date.now();
  const { run, summary, warnings } = await runCodex({ codex, args, code, workdir, timeoutMs, eventsFile });
  const errors = [];
  const text = code.toString("utf8").trim();
  const answers = [];

  for (const call of summary.calls) {
    const sent = call.arguments?.code;
    if (typeof sent !== "string" || sent.trim() !== text) {
      // Changed code could write, so unlike a plain failure this one asks for a look at the file.
      errors.push(`Codex changed the code before it reached ${FIGMA_TOOL}, so its result is not trusted and what it did in Figma is unknown. Look at the file before running again.`);
      continue;
    }
    if (call.arguments?.fileKey !== fileKey) {
      errors.push(`Codex sent the code to file ${JSON.stringify(call.arguments?.fileKey)}, not ${fileKey}.`);
      continue;
    }
    if (call.status !== "completed") {
      errors.push(`${FIGMA_TOOL} failed: ${call.error ?? (resultText(call.result) || "no reason given")}`);
      continue;
    }
    const read = readFound(call.result, expected);
    if (read.error) {
      errors.push(`${FIGMA_TOOL}'s result is refused, so nothing was marked: ${read.error}`);
      continue;
    }
    answers.push(read.found);
  }

  judgeRun({ run, summary, timeoutMs, errors, warnings });
  // Two valid answers from two calls are merged: a version is found if either call found it.
  const merged = answers.length === 0 || errors.length > 0 ? null : answers[0].map((entry, i) => answers.some((answer) => answer[i]));
  return {
    found: merged,
    error: errors.length > 0 ? [...new Set(errors)].join(" ") : null,
    usage: summary.usage,
    tokens: relayTokens(summary.usage),
    warnings,
    durationMs: Date.now() - startedAt,
  };
}

/** The one-line summary of a reconcile run. tokens is null when the call ended without a count. */
function reconcileSummary({ total, pages, changed, dryRun, stopped, failed, reconciled, missing, predicted, tokens }) {
  const versions = plural(total, "component version");
  const cost = `1 call, ${tokens ?? "unknown"} relay tokens`;
  if (total === 0) return `Figma reconcile: no generated component version to look for${changed > 0 ? `; ${plural(changed, "changed version")} left alone` : ""}.`;
  if (dryRun) return `Figma reconcile, dry run: would look for ${versions} on ${plural(pages, "page")} in 1 call, about ${predicted} relay tokens.`;
  if (stopped) return `Figma reconcile: the call was deferred (${stopped}); ${versions} stay generated.`;
  if (failed) return `Figma reconcile: failed, so nothing was marked; ${versions} stay generated. ${cost}.`;
  return `Figma reconcile: ${reconciled} of ${plural(total, "generated component version")} found in Figma and marked sent; ${missing} missing; ${cost}.`;
}

/**
 * Reconcile mode. One read-only call lists the component sets and components on the pages Klaus
 * writes. Each generated component version whose `<Name> <version>` is in the list becomes sent.
 * The rest stay generated, and a changed unit is never touched.
 */
async function reconcileLedger(options, { settings, ledgerPath, root }) {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => {});
  const codex = options.codex ?? "codex";
  const dryRun = Boolean(options.dryRun);
  const model = options.model ?? DEFAULT_MODEL;
  const effort = options.effort ?? DEFAULT_EFFORT;
  const maxCalls = options.maxCalls ?? null;
  const timeoutMs = (options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
  const fileKey = settings.fileKey;
  if (!FILE_KEY.test(fileKey)) throw new UserError(`outputs.figma.target is not a Figma file key the relay can use.`);

  const startedAt = now();
  const ledger = readLedger(ledgerPath);
  const generated = generatedComponents(ledger);
  const { pages, looked, skipped } = lookupPlan(generated, settings.options);
  const changedLabels = [];
  for (const [name, versions] of Object.entries(ledger.components)) {
    for (const [version, status] of Object.entries(versions)) if (status === CHANGED) changedLabels.push(labelOf({ kind: "component", name, version }));
  }

  const warnings = [];
  const unitRecords = [];
  const deferred = [];
  for (const { entry, reason } of skipped) {
    warnings.push(`${labelOf(entry)} was not looked for: ${reason}.`);
    deferred.push({ id: labelOf(entry), kind: "component", reason: "page-name-not-usable" });
    unitRecords.push({ id: labelOf(entry), kind: "component", status: "deferred", reason: "page-name-not-usable" });
  }
  const generatedScreens = screenCount(ledger, GENERATED);
  const changedScreens = screenCount(ledger, CHANGED);
  if (generatedScreens > 0) warnings.push(`${plural(generatedScreens, "generated screen")} ${generatedScreens === 1 ? "stays" : "stay"} generated: reconcile reads component sets and components only.`);
  if (changedScreens > 0) warnings.push(`${plural(changedScreens, "changed screen")} ${changedScreens === 1 ? "is" : "are"} left alone: reconcile reads component sets and components only.`);

  const failed = [];
  const estimated = { calls: 0, tokens: 0, usd: 0 };
  const uncapped = { calls: 0, tokens: 0, usd: 0 };
  const reconciled = [];
  const notMarked = [];
  const missing = [];
  let fileRecord = null;
  let callTokens = null;
  let stopped = null;

  if (looked.length > 0) {
    const labels = looked.map(labelOf);
    const key = newKey();
    const code = reconcileCode(pages, labels, key);
    // As with a send (prepareCode), code over one call's limit is a setting to fix, so the run stops with an error.
    if (code.length > MAX_CODE_CHARS) {
      throw new UserError(`The reconcile call would name ${plural(pages.length, "page")} and come to ${code.length} characters, more than the ${MAX_CODE_CHARS} one call takes. Set outputs.figma.options.page to one page for the components.`);
    }
    const predicted = predictTokens(code.length);
    uncapped.calls = 1;
    uncapped.tokens = predicted;
    stopped = capReason({ totals: { calls: 0, tokens: 0, componentWrites: 0 }, predicted, components: 0, cap: settings.cap, maxCalls });
    const record = { name: "reconcile", chars: code.length, units: looked.map(labelOf), pages };

    if (stopped) {
      fileRecord = { ...record, status: "deferred", reason: stopped, predictedTokens: predicted, calls: 0, tokens: 0 };
      for (const entry of looked) {
        deferred.push({ id: labelOf(entry), kind: "component", reason: stopped });
        unitRecords.push({ id: labelOf(entry), kind: "component", status: "deferred", reason: stopped });
      }
    } else if (dryRun) {
      estimated.calls = 1;
      estimated.tokens = predicted;
      fileRecord = { ...record, status: "would read", predictedTokens: predicted, calls: 1, tokens: null };
      for (const entry of looked) unitRecords.push({ id: labelOf(entry), kind: "component", status: "would look" });
    } else {
      estimated.calls = 1;
      estimated.tokens = predicted;
      const figmaUrl = checkCodex(codex).url;
      const keepEvents = options.eventsDir ? path.resolve(root, options.eventsDir) : null;
      if (keepEvents) mkdirSync(keepEvents, { recursive: true });
      const workdir = mkdtempSync(path.join(tmpdir(), "klaus-relay-"));
      let outcome;
      try {
        log(`reconcile: looking for ${plural(looked.length, "component version")} on ${plural(pages.length, "page")}, about ${predicted} relay tokens`);
        const args = codexArgs({ model, effort, workdir, figmaUrl, keepCodexConfig: Boolean(options.keepCodexConfig), prompt: relayPrompt({ fileKey, fileName: "reconcile" }) });
        outcome = await sendReconcile({ codex, args, code: Buffer.from(code, "utf8"), expected: labels.length, workdir, timeoutMs, fileKey, eventsFile: keepEvents ? path.join(keepEvents, "reconcile.jsonl") : null });
      } finally {
        rmSync(workdir, { recursive: true, force: true });
      }
      callTokens = outcome.tokens;
      if (outcome.tokens === null) warnings.push("The call ended without a token count, so actual tokens leave it out. The cap counted its predicted tokens.");

      if (outcome.found === null) {
        failed.push({ id: "reconcile", error: outcome.error ?? "The call returned no list of true and false." });
        for (const entry of looked) unitRecords.push({ id: labelOf(entry), kind: "component", status: "not checked" });
      } else {
        const found = looked.filter((_, i) => outcome.found[i]);
        for (const entry of looked) if (!found.includes(entry)) missing.push(entry);
        if (found.length > 0) {
          // Apply the marks to the ledger as it is now, so a mark another run wrote since this run read it is kept.
          // A version that is no longer generated by now is left as it is, and the report says it was not marked.
          // This narrows the race with another run and does not close it: the relay takes no lock (README, Limits).
          const fresh = readLedger(ledgerPath);
          for (const entry of found) (markGeneratedAsSent(fresh, entry) ? reconciled : notMarked).push(entry);
          if (reconciled.length > 0) writeJsonFile(ledgerPath, fresh);
        }
        for (const entry of reconciled) unitRecords.push({ id: labelOf(entry), kind: "component", status: "reconciled" });
        for (const entry of notMarked) unitRecords.push({ id: labelOf(entry), kind: "component", status: "not marked", note: "Its status changed while the call ran, so the relay left it as it is." });
        for (const entry of missing) unitRecords.push({ id: labelOf(entry), kind: "component", status: "missing" });
        if (notMarked.length > 0) warnings.push(`${plural(notMarked.length, "version")} found in Figma ${notMarked.length === 1 ? "was" : "were"} not marked, because the ledger changed while the call ran: ${notMarked.map(labelOf).join(", ")}.`);
      }
      fileRecord = {
        ...record,
        status: outcome.found === null ? "failed" : "read",
        error: outcome.error ?? undefined,
        calls: 1,
        tokens: outcome.tokens,
        usage: outcome.usage,
        predictedTokens: predicted,
        durationMs: outcome.durationMs,
        warnings: outcome.warnings.length > 0 ? outcome.warnings : undefined,
      };
      for (const warning of outcome.warnings) warnings.push(`reconcile: ${warning}`);
      log(`reconcile: ${fileRecord.status}, ${outcome.tokens ?? "unknown"} relay tokens${outcome.error ? `. ${outcome.error}` : ""}`);
    }
  }
  if (stopped === "larger-than-token-cap") {
    warnings.push("The reconcile call alone needs more relay tokens than spendingCap.maxRelayTokens allows, so it will never be made at this cap. Raise the cap.");
  } else if (stopped) warnings.push(`The relay stopped before the call, which would pass the ${stopped}.`);
  for (const labelText of changedLabels) unitRecords.push({ id: labelText, kind: "component", status: "changed", note: "Not touched. Delete the set in Figma, then run the relay." });

  // A call that ended without a token count is left out of actual tokens, as for a send. The cap counted its prediction.
  const actual = { calls: fileRecord && fileRecord.calls === 1 && !dryRun ? 1 : 0, tokens: callTokens ?? 0, usd: 0 };
  const total = looked.length;
  const summary = reconcileSummary({ total, pages: pages.length, changed: changedLabels.length, dryRun, stopped, failed: failed.length > 0, reconciled: reconciled.length, missing: missing.length, predicted: estimated.tokens, tokens: callTokens });
  const outputRecord = {
    output: REPORT_OUTPUT,
    status: dryRun ? "dry-run" : "ok",
    reason: null,
    releases: [],
    planned: total,
    written: [],
    deferred,
    failed,
    estimated,
    estimatedUncapped: uncapped,
    actual,
    adapter: {
      summary,
      links: [{ label: "Figma file", url: `https://www.figma.com/design/${fileKey}` }],
      details: {
        mode: "reconcile",
        folder: null,
        ledger: ledgerPath,
        model,
        effort,
        codexConfig: options.keepCodexConfig ? "user" : "clean",
        maxCalls,
        pages,
        // The units the call found and marked sent, which no relayed send is.
        reconciled: reconciled.map(labelOf),
        notMarked: notMarked.map(labelOf),
        missing: missing.map(labelOf),
        changed: changedLabels,
        files: fileRecord ? [fileRecord] : [],
        units: unitRecords,
      },
    },
    warnings,
  };
  const report = buildReport({
    status: failed.length > 0 ? "failed" : "ok",
    startedAt,
    finishedAt: now(),
    trigger: "manual",
    release: null,
    dryRun,
    cap: settings.cap,
    outputs: [outputRecord],
  });
  const reportFile = dryRun ? null : writeReport(path.resolve(root, options.reportDir ?? ".klaus/reports"), report);
  return { report, reportFile, exitCode: failed.length > 0 ? 1 : 0 };
}

/** The lines printed after a run. */
export function describeRun(report, reportFile) {
  const output = report.outputs[0];
  const lines = [output.adapter.summary];
  for (const file of output.adapter.details.files) {
    const cost = file.tokens === null || file.tokens === undefined ? (file.predictedTokens ? `about ${file.predictedTokens} tokens` : "") : `${file.tokens} tokens`;
    const why = file.reason ? ` (${file.reason})` : file.error ? `: ${file.error}` : "";
    lines.push(`  ${file.name}: ${file.status}${why}${cost ? `, ${cost}` : ""}`);
  }
  const details = output.adapter.details;
  if (details.mode === "reconcile") {
    if (details.reconciled.length > 0) lines.push(`  reconciled, now sent: ${details.reconciled.join(", ")}`);
    if (details.notMarked.length > 0) lines.push(`  found but not marked, the ledger changed meanwhile: ${details.notMarked.join(", ")}`);
    if (details.missing.length > 0) lines.push(`  missing, still generated: ${details.missing.join(", ")}`);
    if (details.changed.length > 0) lines.push(`  changed, left alone: ${details.changed.join(", ")}`);
  }
  for (const failure of output.failed) lines.push(`  failed ${failure.id}: ${failure.error}`);
  for (const warning of output.warnings) lines.push(`  note: ${warning}`);
  if (reportFile) lines.push(`Report: ${reportFile}`);
  return lines.join("\n");
}

const OPTIONS = {
  reconcile: { type: "boolean" },
  run: { type: "string" },
  repo: { type: "string" },
  artifact: { type: "string" },
  release: { type: "string" },
  root: { type: "string" },
  config: { type: "string" },
  ledger: { type: "string" },
  "report-dir": { type: "string" },
  model: { type: "string" },
  effort: { type: "string" },
  "max-calls": { type: "string" },
  timeout: { type: "string" },
  "events-dir": { type: "string" },
  "keep-codex-config": { type: "boolean" },
  "dry-run": { type: "boolean" },
  json: { type: "boolean" },
  codex: { type: "string" },
  gh: { type: "string" },
};

function wholeNumber(value, flag, min) {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value) || Number(value) < min) throw new UserError(`${flag} must be a whole number of at least ${min}.`);
  return Number(value);
}

export async function main(argv) {
  try {
    const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
    if (positionals.length > 1) throw new UserError(`Unexpected argument ${JSON.stringify(positionals[1])}.`);
    const { report, reportFile, exitCode } = await runRelay({
      folder: positionals[0],
      reconcile: values.reconcile,
      run: values.run,
      repo: values.repo,
      artifact: values.artifact,
      release: values.release,
      root: values.root,
      config: values.config,
      ledger: values.ledger,
      reportDir: values["report-dir"],
      model: values.model,
      effort: values.effort,
      maxCalls: wholeNumber(values["max-calls"], "--max-calls", 0) ?? null,
      timeoutSeconds: wholeNumber(values.timeout, "--timeout", 1),
      eventsDir: values["events-dir"],
      keepCodexConfig: values["keep-codex-config"],
      dryRun: values["dry-run"],
      codex: values.codex,
      gh: values.gh,
      log: (line) => console.error(line),
    });
    console.log(values.json ? JSON.stringify(report, null, 2) : describeRun(report, reportFile));
    return exitCode;
  } catch (error) {
    if (error instanceof UserError || error.code?.startsWith("ERR_PARSE_ARGS")) {
      console.error(error.message);
      return 2;
    }
    console.error(error.stack ?? error);
    return 3;
  }
}

const invoked = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : null;
if (import.meta.url === invoked) process.exitCode = await main(process.argv.slice(2));
