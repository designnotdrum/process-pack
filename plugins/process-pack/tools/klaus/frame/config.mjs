/**
 * Loads, checks and fills in klaus.config.json.
 *
 * The shape is defined once, in klaus.config.schema.json. A value that looks
 * like a secret is rejected by that schema, and the messages never repeat the
 * value, so a pasted token does not reach a CI log.
 */
import { readFileSync } from "node:fs";
import { UserError } from "./errors.mjs";
import { readJsonFile } from "./json-file.mjs";
import { validateAgainstSchema } from "./json-schema.mjs";

export const SCHEMA = JSON.parse(readFileSync(new URL("../klaus.config.schema.json", import.meta.url), "utf8"));

/**
 * A repo picks its cap at onboarding. 500,000 relay tokens is about six Button-sized component
 * versions through the Figma relay at the measured average of about 83,000 a call. The cap counts
 * the relay's prediction, about 100,000 for such a version, so a run sends five.
 */
export const DEFAULT_SPENDING_CAP = Object.freeze({ maxComponentWrites: 50, maxRelayTokens: 500000 });

/** Rules the schema cannot express, because they depend on two fields together. */
function crossFieldErrors(config) {
  if (!config || typeof config !== "object") return [];
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
  errors.push(...crossFieldErrors(config));
  return { ok: errors.length === 0, errors };
}

/**
 * The config with every default filled in. Throws if the config is not valid.
 * @param {object} config
 */
export function resolveConfig(config) {
  const { ok, errors } = validateConfig(config);
  if (!ok) throw new UserError(`klaus.config.json is not valid:\n${errors.map((e) => `  ${e}`).join("\n")}`);
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

/** Reads and resolves a config file. */
export function loadConfig(file) {
  return resolveConfig(readJsonFile(file, "Config"));
}
