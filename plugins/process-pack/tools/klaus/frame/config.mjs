/**
 * Loads, checks and fills in klaus.config.json.
 *
 * The shape is defined once, in klaus.config.schema.json. A value that looks
 * like a secret is rejected by that schema, and the messages never repeat the
 * value, so a pasted token does not reach a CI log.
 */
import { readFileSync } from "node:fs";
import { validateAgainstSchema } from "./json-schema.mjs";

export const SCHEMA = JSON.parse(readFileSync(new URL("../klaus.config.schema.json", import.meta.url), "utf8"));

export const DEFAULT_SPENDING_CAP = Object.freeze({ maxComponentWrites: 50, maxRelayTokens: 100000 });

/** Rules the schema cannot express, because they depend on two fields together. */
function crossFieldErrors(config) {
  const errors = [];
  if (config.trigger?.mode === "schedule" && !config.trigger.cron) {
    errors.push("trigger.cron: is required when trigger.mode is schedule.");
  }
  const screens = config.selection?.screens;
  if (screens?.mode === "listed" && !(screens.routes?.length > 0)) {
    errors.push("selection.screens.routes: must list at least one route when mode is listed.");
  }
  return errors;
}

/**
 * @param {unknown} config
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateConfig(config) {
  const errors = validateAgainstSchema(SCHEMA, config);
  if (errors.length === 0) errors.push(...crossFieldErrors(config));
  return { ok: errors.length === 0, errors };
}

/**
 * The config with every default filled in. Throws if the config is not valid.
 * @param {object} config
 */
export function resolveConfig(config) {
  const { ok, errors } = validateConfig(config);
  if (!ok) throw new Error(`klaus.config.json is not valid:\n${errors.map((e) => `  ${e}`).join("\n")}`);
  const outputs = {};
  for (const [name, settings] of Object.entries(config.outputs)) {
    outputs[name] = { secrets: [], logins: [], ...settings };
  }
  return {
    outputs,
    inventory: { folders: [], ...config.inventory },
    selection: {
      componentGroups: [],
      ...config.selection,
      screens: { mode: "none", routes: [], ...config.selection?.screens },
      newComponents: { rule: "all", minUsage: 2, ...config.selection?.newComponents },
    },
    spendingCap: { ...DEFAULT_SPENDING_CAP, ...config.spendingCap },
    trigger: { mode: "release", tagPattern: "v*", ...config.trigger },
  };
}

/**
 * Reads and resolves a config file.
 * A JSON syntax error reports the line and column only, because the error text
 * Node produces can quote the start of the file.
 */
export function loadConfig(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`${file} does not exist.`);
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const where = /\(line \d+ column \d+\)/.exec(error.message)?.[0];
    throw new Error(`${file} is not valid JSON${where ? ` ${where}` : ""}.`);
  }
  return resolveConfig(parsed);
}
