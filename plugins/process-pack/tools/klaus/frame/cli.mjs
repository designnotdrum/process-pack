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
 * Exit 0 when the run finished or was skipped, 1 when an output failed, 2 on an error the person
 * running it can fix (usage, config, state file, tags), 3 on any other error, with a stack trace.
 * Going over the spending cap is not a failure: the rest is deferred to the next run.
 *
 * No dependencies. Copied into a consuming repo by the design-onboard skill.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { loadConfig, validateConfig } from "./config.mjs";
import { UserError } from "./errors.mjs";
import { readJsonFile } from "./json-file.mjs";
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

const USAGE = "Usage: cli.mjs validate | cli.mjs run --trigger <release|schedule|manual> [--release <tag>] [--dry-run] [--model-free] [--json]";

function listReleases(pattern) {
  // Two sorts: the last one given is the main key. Date order, then version order for tags made together.
  const args = ["tag", "--list", pattern, "--sort=version:refname", "--sort=creatordate"];
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\n").filter(Boolean);
  } catch (error) {
    if (error?.code === "ENOENT") throw new UserError("Could not run git to list release tags. Install git, or run this where git is on the PATH.");
    // Git ran and refused: say what it said. Any other failure to start it is not something the reader can fix here.
    if (typeof error?.status !== "number") throw error;
    const said = String(error.stderr ?? "").trim().split("\n")[0];
    throw new UserError(`Could not list release tags${said ? ` (git said: ${said})` : ""}. Run this inside the repo's git checkout, with tags fetched.`);
  }
}

async function loadAdapters(dir, config) {
  const adapters = {};
  for (const [name, settings] of Object.entries(config.outputs)) {
    if (!settings.enabled) continue;
    const file = path.join(dir, name, "index.mjs");
    if (!existsSync(file)) continue;
    const adapter = (await import(pathToFileURL(file).href)).default;
    if (!adapter) throw new UserError(`${file} must default-export an adapter.`);
    adapters[name] = adapter;
  }
  return adapters;
}

const money = (usd) => `$${usd.toFixed(2)}`;

function describeOutput(o) {
  if (o.status === "failed") return `failed${o.failedStep ? ` at ${o.failedStep}` : ""}: ${o.error}`;
  if (o.status === "skipped") return `skipped (${o.reason})`;
  const dry = o.status === "dry-run";
  const count = dry ? o.planned - o.deferred.length : o.written.length;
  const actual = o.actual ? money(o.actual.usd) : "unknown";
  return `${dry ? "would write" : "written"} ${count}, deferred ${o.deferred.length}, failed ${o.failed.length}, estimated ${money(o.estimated.usd)}, actual ${actual}`;
}

function summarize(report, reportFile) {
  const release = report.release ? ` (release ${report.release})` : "";
  const lines = [`Klaus run: ${report.status}${release}${report.dryRun ? ", dry run" : ""}`];
  if (report.reason) lines.push(`  ${report.reason}`);
  for (const o of report.outputs) {
    lines.push(`  ${o.output}: ${describeOutput(o)}`);
    for (const warning of o.warnings) lines.push(`    note: ${warning}`);
  }
  if (reportFile) lines.push(`Report: ${reportFile}`);
  return lines.join("\n");
}

async function validateCommand(values) {
  const { ok, errors } = validateConfig(readJsonFile(values.config, "Config"));
  if (!ok) throw new UserError(`${values.config} is not valid:\n${errors.map((e) => `  ${e}`).join("\n")}`);
  console.log(`${values.config} is valid.`);
  return 0;
}

async function runCommand(values) {
  const trigger = values.trigger;
  if (!TRIGGERS.includes(trigger)) throw new UserError(`--trigger must be one of ${TRIGGERS.join(", ")}.`);
  if (trigger === "release" && !values.release) throw new UserError("--trigger release needs --release <tag>.");

  const config = loadConfig(values.config);
  if (!triggerEnabled(config, trigger)) {
    console.log(`Klaus run: skipped. The ${trigger} trigger is not enabled in ${values.config} (trigger.mode is ${config.trigger.mode}).`);
    return 0;
  }

  const inventory = readJsonFile(values.inventory, "Inventory");
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
  let reportError = null;
  if (!values["dry-run"]) {
    // The state is saved first: the outputs are already written, so a rerun must not write them again.
    writeState(values.state, nextState);
    try {
      reportFile = writeReport(values["report-dir"], report);
    } catch (error) {
      reportError = error;
    }
  }
  console.log(values.json ? JSON.stringify(report, null, 2) : summarize(report, reportFile));
  if (reportError) {
    throw new UserError(`The run finished and ${values.state} was updated, but the report could not be written to ${values["report-dir"]} (${reportError.code ?? reportError.message}).`);
  }
  return report.status === "failed" ? 1 : 0;
}

async function main(argv) {
  try {
    const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
    const [command, ...extra] = positionals;
    if (extra.length > 0) throw new UserError(`Unexpected argument ${JSON.stringify(extra[0])}.`);
    if (command === "validate") return await validateCommand(values);
    if (command === "run") return await runCommand(values);
    throw new UserError(USAGE);
  } catch (error) {
    // The code is not always a string, and a module can throw a value that is not an Error at all.
    if (error instanceof UserError || (typeof error?.code === "string" && error.code.startsWith("ERR_PARSE_ARGS"))) {
      console.error(error.message);
      return 2;
    }
    console.error(error?.stack ?? error);
    return 3;
  }
}

process.exitCode = await main(process.argv.slice(2));
