#!/usr/bin/env node
/**
 * The Figma relay: sends the generator's code files to Figma through a
 * signed-in Codex CLI, because Figma's MCP server refuses a plain script.
 *
 *   node relay.mjs <folder> [options]
 *   node relay.mjs --run <id> [--repo <owner/name>] [--artifact <name>] [--release <release>] [options]
 *
 * <folder> is a release folder the generator wrote, `.klaus/figma/<release>/`,
 * holding manifest.json and figma-001.js, figma-002.js, ... `--run` downloads
 * the CI artifact that holds one with `gh run download`.
 *
 * For each code file, in the manifest's order, the relay runs `codex exec`
 * once. The prompt tells Codex to call use_figma exactly once with the file's
 * code and to report the result, and nothing else. The code goes to Codex on
 * stdin, byte for byte. The relay reads Codex's JSON events, checks that the
 * code use_figma received is the file's code, and records a unit as sent in
 * the ledger only when the code's own result says it was written or was
 * already there. A unit that failed stays generated, so the next run retries it.
 *
 * Before each call the relay checks the spending cap in klaus.config.json
 * (component writes and relay tokens) and, when given, --max-calls. A call
 * that would pass a limit is not made: that file and every file after it are
 * deferred. The run report goes to .klaus/reports/ in the frame's format.
 *
 * Options:
 *   --root <dir>           The repo. klaus.config.json, the ledger and the reports are under it. Default: here.
 *   --config <file>        Default klaus.config.json. Without one, the frame's default cap applies.
 *   --ledger <file>        Default <outputDir>/ledger.json, as the generator keeps it.
 *   --report-dir <dir>     Default .klaus/reports.
 *   --file-key <key>       Write to this Figma file instead of the manifest's.
 *   --model <id>           The relaying model. Default gpt-6-luna.
 *   --effort <level>       Its reasoning effort. Default low.
 *   --max-calls <n>        Make at most n calls in this run.
 *   --timeout <seconds>    For one call. Default 600.
 *   --events-dir <dir>     Keep each call's Codex events, one .jsonl per code file.
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
import { DEFAULT_SPENDING_CAP, loadConfig } from "../../../frame/config.mjs";
import { UserError } from "../../../frame/errors.mjs";
import { readJsonFile, writeJsonFile } from "../../../frame/json-file.mjs";
import { buildReport, writeReport } from "../../../frame/report.mjs";
import { MANIFEST_VERSION } from "../index.mjs";
import { entrySent, readLedger, recordEntry, SENT } from "../ledger.mjs";
import { DEFAULT_OPTIONS, readOptions } from "../settings.mjs";
import { FIGMA_SERVER, FIGMA_TOOL, parseEvents, readCodeResult, relayTokens, resultText, summarizeEvents } from "./events.mjs";

export const DEFAULT_MODEL = "gpt-6-luna";
export const DEFAULT_EFFORT = "low";
export const DEFAULT_TIMEOUT_SECONDS = 600;
export const DEFAULT_ARTIFACT = "klaus-figma";
export const DEFAULT_FIGMA_URL = "https://mcp.figma.com/mcp";

/**
 * Relay tokens a call costs before its code: Codex's instructions, the use_figma
 * definition and the prompt. Unverified until the first real run measures it.
 */
export const CALL_BASE_TOKENS = 12000;
/** Relay tokens per character of code: the code is read once and written once as the tool's argument. */
export const TOKENS_PER_CODE_CHAR = 2 / 3.75;

/** The output name in the run report, so a relay run is not counted as another generator run. */
export const REPORT_OUTPUT = "figma-relay";

const FILE_NAME = /^figma-\d{3,}\.js$/;
const FILE_KEY = /^[0-9A-Za-z]{22,128}$/;
const MODEL = /^[A-Za-z0-9._-]{1,100}$/;
const EFFORT = /^[a-z]{1,20}$/;
const SENT_STATUSES = new Set(["written", "exists"]);

/** The tokens a file's call is expected to cost. Calls measured in this run raise it, never lower it. */
export function predictTokens(chars, ratios = []) {
  const base = CALL_BASE_TOKENS + chars * TOKENS_PER_CODE_CHAR;
  return Math.ceil(base * Math.max(1, ...ratios));
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
    "-c", `mcp_servers.${FIGMA_SERVER}.enabled_tools=["${FIGMA_TOOL}"]`,
    "-c", `mcp_servers.${FIGMA_SERVER}.tools.${FIGMA_TOOL}.approval_mode="approve"`,
    prompt,
  );
  return args;
}

function readSettings(root, configOption) {
  const file = path.resolve(root, configOption ?? "klaus.config.json");
  if (!existsSync(file)) {
    if (configOption) throw new UserError(`Config ${file} does not exist.`);
    return { cap: { ...DEFAULT_SPENDING_CAP }, outputDir: DEFAULT_OPTIONS.outputDir };
  }
  const config = loadConfig(file);
  try {
    return { cap: config.spendingCap, outputDir: readOptions(config.outputs.figma ?? {}).outputDir };
  } catch (error) {
    throw new UserError(error.message);
  }
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
    if (!FILE_NAME.test(entry?.name ?? "")) throw new UserError(`${file} names a code file ${JSON.stringify(entry?.name)}, which is not a name the generator writes.`);
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

function downloadArtifact({ gh, run, repo, artifact }) {
  if (!/^\d+$/.test(run)) throw new UserError(`--run must be a run id, a number, not ${JSON.stringify(run)}.`);
  // A fresh empty folder: the artifact is data from CI, kept apart from everything else.
  const dir = mkdtempSync(path.join(tmpdir(), "klaus-relay-artifact-"));
  const args = ["run", "download", run, "--name", artifact, "--dir", dir];
  if (repo) args.push("--repo", repo);
  try {
    execFileSync(gh, args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  } catch (error) {
    const said = String(error.stderr ?? error.message).trim().slice(0, 300);
    throw new UserError(`gh could not download the ${artifact} artifact of run ${run}: ${said}`);
  }
  return dir;
}

/** Checks Codex has a signed-in figma server, and returns its URL. */
function checkCodex(codex) {
  let text;
  try {
    text = execFileSync(codex, ["mcp", "list", "--json"], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  } catch (error) {
    if (error.code === "ENOENT") throw new UserError(`The Codex CLI (${codex}) is not installed. See relay/README.md.`);
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
  const url = figma.transport?.url ?? DEFAULT_FIGMA_URL;
  if (!/^https:\/\/[^\s"\\]+$/.test(url)) throw new UserError(`The ${FIGMA_SERVER} MCP server's URL is not one the relay can pass on: ${url}`);
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

const lastLine = (text) => String(text).trim().split("\n").filter(Boolean).at(-1)?.slice(0, 300) ?? "";

/**
 * Sends one code file and reads the outcome.
 * @returns {Promise<{ units: Map<string, object>, error: string | null, usage: object | null, tokens: number | null, warnings: string[], durationMs: number }>}
 *   units holds what the code reported for each unit, from calls that carried the file's code unchanged.
 */
async function sendFile({ codex, args, code, workdir, timeoutMs, fileKey, eventsFile }) {
  const startedAt = Date.now();
  const run = await spawnCodex(codex, args, code, workdir, timeoutMs);
  if (eventsFile) {
    writeFileSync(eventsFile, run.stdout);
    if (run.stderr) writeFileSync(eventsFile.replace(/\.jsonl$/, ".stderr.txt"), run.stderr);
  }
  const { events, unreadable } = parseEvents(run.stdout);
  const summary = summarizeEvents(events);
  const warnings = [];
  const units = new Map();
  const errors = [];
  const text = code.toString("utf8").trim();

  if (summary.calls.length > 1) warnings.push(`Codex called ${FIGMA_TOOL} ${summary.calls.length} times. The prompt asks for one call.`);
  if (summary.otherTools.length > 0) warnings.push(`Codex also called ${[...new Set(summary.otherTools)].join(", ")}.`);
  if (unreadable > 0) warnings.push(`${unreadable} lines of Codex's output were not JSON events.`);

  for (const call of summary.calls) {
    // What Codex's own events say it sent. The relay cannot see what Figma's server received,
    // so this trusts Codex's event log. Whitespace at either end is ignored: a model may drop the
    // file's last newline, and that changes nothing the code does.
    const sent = call.arguments?.code;
    if (typeof sent !== "string" || sent.trim() !== text) {
      errors.push(`Codex changed the code before it reached ${FIGMA_TOOL}, so its result is not trusted.`);
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
    const returned = readCodeResult(call.result);
    if (!returned) {
      errors.push(`${FIGMA_TOOL} returned a result Klaus cannot read: ${resultText(call.result) || "an empty result"}`);
      continue;
    }
    for (const unit of returned.units) {
      // Over two calls, a unit counts as sent if either call sent it.
      if (!SENT_STATUSES.has(units.get(unit.id)?.status)) units.set(unit.id, unit);
    }
    for (const warning of Array.isArray(returned.warnings) ? returned.warnings : []) warnings.push(`Figma: ${String(warning).slice(0, 300)}`);
  }

  if (summary.calls.length === 0) {
    if (summary.started > 0) errors.push(`${FIGMA_TOOL} started and did not finish, so whether it wrote is unknown.`);
    if (summary.failure) errors.push(summary.failure);
    else if (run.error) errors.push(`Codex could not be started: ${run.error.message}`);
    else if (run.timedOut) errors.push(`Codex did not finish within ${Math.round(timeoutMs / 1000)} seconds.`);
    else if (run.exitCode !== 0) errors.push(`Codex exited with ${run.exitCode ?? run.signal}: ${lastLine(run.stderr) || "no message"}`);
    else {
      const said = summary.message ? ` It replied: ${summary.message.replace(/\s+/g, " ").slice(0, 200)}` : "";
      errors.push(`Codex did not call ${FIGMA_TOOL}.${said}`);
    }
  } else if (run.exitCode !== 0 && !run.timedOut) {
    warnings.push(`Codex exited with ${run.exitCode ?? run.signal} after the call: ${lastLine(run.stderr) || "no message"}`);
  }

  return {
    units,
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
  if (Boolean(options.folder) === Boolean(options.run)) throw new UserError("Give a release folder or --run <id>, not both and not neither.");
  if (!options.run) return relayRelease(options, { root, settings, ledgerPath, folder: path.resolve(root, options.folder), source: null });
  const downloaded = downloadArtifact({ gh: options.gh ?? "gh", run: options.run, repo: options.repo, artifact: options.artifact ?? DEFAULT_ARTIFACT });
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
  const fileKey = options.fileKey ?? manifest.fileKey;
  if (!FILE_KEY.test(fileKey ?? "")) throw new UserError("The manifest has no Figma file key. Set outputs.figma.target, or pass --file-key.");

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

  try {
    for (const file of manifest.files) {
      const entries = file.units.map((id) => ({ id, ...manifest.ledgerEntries[id] }));
      const pending = entries.filter((entry) => !entrySent(ledger, entry));
      const record = { name: file.name, chars: file.chars, units: file.units };
      const unitBase = (entry) => ({ id: entry.id, kind: entry.kind, file: file.name });
      if (pending.length === 0) {
        fileRecords.push({ ...record, status: "already sent", calls: 0, tokens: 0 });
        unitRecords.push(...entries.map((entry) => ({ ...unitBase(entry), status: "already sent", calls: 0, tokens: 0 })));
        continue;
      }
      planned += pending.length;
      const predicted = predictTokens(file.chars, ratios);
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
      const codeFile = path.join(folder, file.name);
      const code = existsSync(codeFile) ? readFileSync(codeFile) : null;
      const length = code?.toString("utf8").length;
      if (length !== file.chars) {
        const error = code === null
          ? `${file.name} is not in ${folder}.`
          : `${file.name} has ${length} characters and the manifest says ${file.chars}. It changed after it was generated; run the generator again.`;
        fileRecords.push({ ...record, status: "failed", error, calls: 0, tokens: 0 });
        for (const entry of pending) failed.push({ id: entry.id, error });
        unitRecords.push(...entries.map((entry) => ({ ...unitBase(entry), status: pending.includes(entry) ? "failed" : "already sent", error: pending.includes(entry) ? error : undefined, calls: 0, tokens: 0 })));
        continue;
      }

      estimated.calls += 1;
      estimated.tokens += predicted;
      totals.calls += 1;
      totals.componentWrites += components;
      if (dryRun) {
        totals.tokens += predicted;
        fileRecords.push({ ...record, status: "would send", predictedTokens: predicted, calls: 1, tokens: null });
        unitRecords.push(...entries.map((entry) => ({ ...unitBase(entry), status: pending.includes(entry) ? "would send" : "already sent", calls: share(1, entries.length), tokens: null })));
        continue;
      }

      log(`${file.name}: sending ${plural(entries.length, "unit")}, about ${predicted} relay tokens`);
      const prompt = relayPrompt({ fileKey, fileName: file.name });
      const args = codexArgs({ model, effort, workdir, figmaUrl, keepCodexConfig: Boolean(options.keepCodexConfig), prompt });
      const eventsFile = keepEvents ? path.join(keepEvents, file.name.replace(/\.js$/, ".jsonl")) : null;
      const outcome = await sendFile({ codex, args, code, workdir, timeoutMs, fileKey, eventsFile });

      if (outcome.tokens === null) {
        // Codex stopped before it said what the call cost. The cap counts the prediction.
        totals.tokens += predicted;
        totals.unmeasured += 1;
      } else {
        totals.tokens += outcome.tokens;
        totals.measured += outcome.tokens;
        ratios.push(outcome.tokens / predictTokens(file.chars));
      }

      let sentHere = 0;
      for (const entry of entries) {
        const returned = outcome.units.get(entry.id);
        const base = { ...unitBase(entry), figma: returned?.status, calls: share(1, entries.length), tokens: share(outcome.tokens, entries.length) };
        if (SENT_STATUSES.has(returned?.status)) {
          if (pending.includes(entry)) {
            recordEntry(ledger, entry, SENT);
            sent.push(entry.id);
            sentHere += 1;
            unitRecords.push({ ...base, status: "sent" });
          } else unitRecords.push({ ...base, status: "already sent" });
          continue;
        }
        if (!pending.includes(entry)) {
          unitRecords.push({ ...base, status: "already sent" });
          continue;
        }
        const error = returned?.status === "failed"
          ? `Figma: ${String(returned.error ?? "the unit failed")}`
          : outcome.error ?? `${FIGMA_TOOL}'s result does not list ${entry.id}.`;
        failed.push({ id: entry.id, error });
        unitRecords.push({ ...base, status: "failed", error });
      }
      if (sentHere > 0) {
        // Apply this file's marks to the ledger as it is now, so a mark another run wrote
        // since this run read it is kept.
        const fresh = readLedger(ledgerPath);
        for (const entry of pending) if (entrySent(ledger, entry)) recordEntry(fresh, entry, SENT);
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
  if (stopped) warnings.push(`The relay stopped before a call that would pass the ${stopped}. The rest is deferred to the next run.`);

  const actual = { calls: dryRun ? 0 : totals.calls, tokens: dryRun ? 0 : totals.measured, usd: 0 };
  const summary = dryRun
    ? `Figma relay, dry run: would send ${plural(unitRecords.filter((u) => u.status === "would send").length, "unit")} in ${plural(estimated.calls, "call")}, about ${estimated.tokens} relay tokens; ${deferred.length} deferred.`
    : `Figma relay: sent ${sent.length} of ${plural(planned, "unit")} in ${plural(actual.calls, "call")}, ${actual.tokens} relay tokens; ${failed.length} failed, ${deferred.length} deferred.`;
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

/** The lines printed after a run. */
export function describeRun(report, reportFile) {
  const output = report.outputs[0];
  const lines = [output.adapter.summary];
  for (const file of output.adapter.details.files) {
    const cost = file.tokens === null || file.tokens === undefined ? (file.predictedTokens ? `about ${file.predictedTokens} tokens` : "") : `${file.tokens} tokens`;
    const why = file.reason ? ` (${file.reason})` : file.error ? `: ${file.error}` : "";
    lines.push(`  ${file.name}: ${file.status}${why}${cost ? `, ${cost}` : ""}`);
  }
  for (const failure of output.failed) lines.push(`  failed ${failure.id}: ${failure.error}`);
  for (const warning of output.warnings) lines.push(`  note: ${warning}`);
  if (reportFile) lines.push(`Report: ${reportFile}`);
  return lines.join("\n");
}

const OPTIONS = {
  run: { type: "string" },
  repo: { type: "string" },
  artifact: { type: "string" },
  release: { type: "string" },
  root: { type: "string" },
  config: { type: "string" },
  ledger: { type: "string" },
  "report-dir": { type: "string" },
  "file-key": { type: "string" },
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
      run: values.run,
      repo: values.repo,
      artifact: values.artifact,
      release: values.release,
      root: values.root,
      config: values.config,
      ledger: values.ledger,
      reportDir: values["report-dir"],
      fileKey: values["file-key"],
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
