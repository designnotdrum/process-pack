#!/usr/bin/env node
/**
 * Klaus command line.
 *
 *   node scripts/klaus/frame/cli.mjs validate [--config klaus.config.json]
 *   node scripts/klaus/frame/cli.mjs run --trigger <release|schedule|manual> [options]
 *
 * run options:
 *   --release <tag>      The release tag. Required when --trigger is release.
 *   --dry-run            Plan and estimate only. Writes no design output, state or report file.
 *   --model-free         Skip outputs whose adapter needs a model or a signed-in tool (CI uses this).
 *   --json               Print the run report instead of a summary.
 *   --config <file>      Default klaus.config.json
 *   --inventory <file>   Default inventory.json
 *   --state <file>       Default .klaus/state.json
 *   --report-dir <dir>   Default .klaus/reports
 *   --adapters <dir>     Default ../adapters next to this file. Each output reads <dir>/<output>/index.mjs.
 *
 * Exit 0 when the run finished or was skipped, 1 when an output failed, 2 on a usage or config error.
 * Going over the spending cap is not a failure: the rest is deferred to the next run.
 *
 * No dependencies. Copied into a consuming repo by the design-onboard skill.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { loadConfig, validateConfig } from "./config.mjs";
import { writeReport } from "./report.mjs";
import { runKlaus } from "./runner.mjs";
import { readState, writeState } from "./state.mjs";
import { TRIGGERS, triggerEnabled } from "./triggers.mjs";

const OPTIONS = {
  trigger: { type: "string" },
  release: { type: "string" },
  "dry-run": { type: "boolean" },
  "model-free": { type: "boolean" },
  json: { type: "boolean" },
  config: { type: "string", default: "klaus.config.json" },
  inventory: { type: "string", default: "inventory.json" },
  state: { type: "string", default: ".klaus/state.json" },
  "report-dir": { type: "string", default: ".klaus/reports" },
  adapters: { type: "string", default: fileURLToPath(new URL("../adapters", import.meta.url)) },
};

class UsageError extends Error {}

function usage(message) {
  throw new UsageError(message);
}

function listReleases(pattern) {
  // Two sorts: the last one given is the main key. Date order, then version order for tags made together.
  const out = execFileSync("git", ["tag", "--list", pattern, "--sort=version:refname", "--sort=creatordate"], { encoding: "utf8" });
  return out.split("\n").filter(Boolean);
}

function readJson(file, what) {
  if (!existsSync(file)) usage(`${what} ${file} does not exist.`);
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return usage(`${what} ${file} is not valid JSON.`);
  }
}

async function loadAdapters(dir, config) {
  const adapters = {};
  for (const [name, settings] of Object.entries(config.outputs)) {
    if (!settings.enabled) continue;
    const file = path.join(dir, name, "index.mjs");
    if (!existsSync(file)) continue;
    const adapter = (await import(pathToFileURL(file).href)).default;
    if (!adapter) usage(`${file} must default-export an adapter.`);
    adapters[name] = adapter;
  }
  return adapters;
}

const money = (usd) => `$${usd.toFixed(2)}`;

function summarize(report, reportFile) {
  const lines = [`Klaus run: ${report.status}${report.release ? ` (release ${report.release})` : ""}${report.dryRun ? ", dry run" : ""}`];
  if (report.reason) lines.push(`  ${report.reason}`);
  for (const o of report.outputs) {
    const detail = o.status === "failed"
      ? `failed${o.failedStep ? ` at ${o.failedStep}` : ""}: ${o.error}`
      : o.status === "skipped"
        ? `skipped (${o.reason})`
        : `${o.status === "dry-run" ? "would write" : "written"} ${o.status === "dry-run" ? o.planned - o.deferred.length : o.written.length}, deferred ${o.deferred.length}, failed ${o.failed.length}, estimated ${money(o.estimated.usd)}, actual ${o.actual ? money(o.actual.usd) : "unknown"}`;
    lines.push(`  ${o.output}: ${detail}`);
    for (const w of o.warnings) lines.push(`    note: ${w}`);
  }
  if (reportFile) lines.push(`Report: ${reportFile}`);
  return lines.join("\n");
}

async function validateCommand(values) {
  const file = values.config;
  if (!existsSync(file)) usage(`${file} does not exist.`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    usage(`${file} is not valid JSON.`);
  }
  const { ok, errors } = validateConfig(parsed);
  if (!ok) usage(`${file} is not valid:\n${errors.map((e) => `  ${e}`).join("\n")}`);
  console.log(`${file} is valid.`);
  return 0;
}

async function runCommand(values) {
  const trigger = values.trigger;
  if (!TRIGGERS.includes(trigger)) usage(`--trigger must be one of ${TRIGGERS.join(", ")}.`);
  if (trigger === "release" && !values.release) usage("--trigger release needs --release <tag>.");

  const config = loadConfig(values.config);
  if (!triggerEnabled(config, trigger)) {
    console.log(`Klaus run: skipped. The ${trigger} trigger is not enabled in ${values.config} (trigger.mode is ${config.trigger.mode}).`);
    return 0;
  }

  const inventory = readJson(values.inventory, "Inventory");
  const state = readState(values.state);
  const adapters = await loadAdapters(values.adapters, config);
  const { report, state: nextState } = await runKlaus({
    config,
    inventory,
    adapters,
    releases: listReleases(config.trigger.tagPattern),
    trigger,
    release: values.release,
    state,
    modelFree: values["model-free"],
    dryRun: values["dry-run"],
    log: (line) => console.error(line),
  });

  let reportFile = null;
  if (!values["dry-run"]) {
    writeState(values.state, nextState);
    reportFile = writeReport(values["report-dir"], report);
  }
  console.log(values.json ? JSON.stringify(report, null, 2) : summarize(report, reportFile));
  return report.status === "failed" ? 1 : 0;
}

async function main(argv) {
  try {
    const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
    const [command, ...extra] = positionals;
    if (extra.length > 0) usage(`Unexpected argument ${JSON.stringify(extra[0])}.`);
    if (command === "validate") return await validateCommand(values);
    if (command === "run") return await runCommand(values);
    return usage("Usage: cli.mjs validate | cli.mjs run --trigger <release|schedule|manual> [--release <tag>] [--dry-run] [--model-free] [--json]");
  } catch (error) {
    // Config, state, git and usage errors are all things the person running this can fix.
    console.error(error.message);
    return 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
