/**
 * What each output would cost, from the adapters' own plan and estimate steps.
 *
 * This runs the same steps the runner runs before a write (plan, estimate, the
 * spending cap) and stops there. It writes nothing and calls no platform, so
 * onboarding can show every cost before an output is turned on. Nothing is
 * priced in this file: the numbers come from the adapters, and the Figma rate is
 * read from the Figma adapter's settings.
 *
 * The inventory and the settings are files the caller names, so onboarding can
 * run this before anything is written to the repo.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizePlan } from "../frame/adapter.mjs";
import { applyCap, indexEstimate } from "../frame/cap.mjs";
import { listComponents, usageCount } from "../frame/components.mjs";
import { resolveConfig } from "../frame/config.mjs";
import { readJsonFile } from "../frame/json-file.mjs";
import { SOURCE_ROOT } from "./copy.mjs";

/** The outputs the settings file knows, in the order onboarding walks them. */
export const OUTPUTS = Object.freeze(["storybook", "figma", "penpot", "pencil"]);

const LABELS = { storybook: "Storybook", figma: "Figma", penpot: "Penpot", pencil: "Pencil" };

/** How each output is reached. Penpot and Pencil name the issue that builds their adapter. */
const ROUTES = {
  storybook: "the Vercel CLI, run in CI",
  figma: "the Klaus plugin for the first load, the Codex relay for the updates after each release",
  penpot: "its API with a personal access token (adapter not built, issue #31)",
  pencil: "the pen CLI in headless mode (adapter not built, issue #32)",
};

/** Release tags in the order Klaus counts them. No git, or no tags, gives an empty list. */
function listReleases(repo, pattern) {
  try {
    const args = ["tag", "--list", pattern, "--sort=version:refname", "--sort=creatordate"];
    return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Plans and estimates each output as if it were on, under the settings' cap.
 *
 * @param {object} options
 * @param {string} options.repo
 * @param {string} options.config      The settings file. Outputs it lists as off are estimated too unless onlyEnabled is set.
 * @param {string} options.inventory   An inventory.json.
 * @param {string[]} [options.outputs] Which outputs. Default all of OUTPUTS.
 * @param {boolean} [options.onlyEnabled]  Only the outputs the settings turn on.
 */
export async function estimateOutputs({ repo, config: configFile, inventory: inventoryFile, outputs = OUTPUTS, onlyEnabled = false }) {
  const config = resolveConfig(readJsonFile(configFile, "Config"));
  const inventory = readJsonFile(inventoryFile, "Inventory");
  const usageById = new Map(listComponents(inventory).map((component) => [component.name, usageCount(component)]));
  const release = listReleases(repo, config.trigger.tagPattern).at(-1) ?? "(next release)";
  const results = [];

  // The adapters read the repo from the working directory, as they do in a run.
  const here = process.cwd();
  process.chdir(repo);
  try {
    for (const name of outputs) {
      const configured = config.outputs[name];
      if (onlyEnabled && !configured?.enabled) continue;
      const file = path.join(SOURCE_ROOT, "adapters", name, "index.mjs");
      if (!fs.existsSync(file)) {
        results.push({ output: name, adapter: false });
        continue;
      }
      const adapter = (await import(pathToFileURL(file).href)).default;
      const settings = { secrets: [], logins: [], ...configured, enabled: true, target: configured?.target ?? "estimate-only" };
      const ctx = {
        output: name,
        settings,
        selection: config.selection,
        inventory,
        trigger: "manual",
        release,
        releases: [release],
        unwrittenFromLastRun: [],
        dryRun: true,
        secret: () => undefined,
      };
      try {
        const plan = normalizePlan(await adapter.plan(ctx), name);
        const estimate = indexEstimate(plan, await adapter.estimate(plan, ctx), name);
        const capped = applyCap({ items: plan.items, estimate, usageById, cap: config.spendingCap });
        results.push({
          output: name,
          adapter: true,
          release,
          cap: config.spendingCap,
          items: plan.items.map((item) => ({ id: item.id, kind: item.kind, ...estimate.byId.get(item.id) })),
          overhead: estimate.overhead,
          allowed: capped.allowed.map((item) => item.id),
          deferred: capped.deferred,
          estimated: capped.estimated,
          estimatedUncapped: capped.estimatedUncapped,
        });
      } catch (error) {
        results.push({ output: name, adapter: true, error: error.message });
      }
    }
  } finally {
    process.chdir(here);
  }
  return results;
}

/** The Figma relay's rate, read from the adapter. Null when the adapter does not export it. */
async function figmaRate() {
  try {
    const settings = await import(pathToFileURL(path.join(SOURCE_ROOT, "adapters", "figma", "settings.mjs")).href);
    if (typeof settings.CALL_BASE_TOKENS === "number" && typeof settings.TOKENS_PER_CODE_CHAR === "number") {
      return { base: settings.CALL_BASE_TOKENS, perChar: settings.TOKENS_PER_CODE_CHAR };
    }
  } catch {
    // The line is left out.
  }
  return null;
}

const whole = (value) => Math.round(value).toLocaleString("en-US");
const dollars = (value) => `USD ${value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`;
const plural = (count, one, many = `${one}s`) => `${whole(count)} ${count === 1 ? one : many}`;

function storybookLines(result) {
  const item = result.items[0];
  if (!item) return ["Nothing to publish yet: no release tag matches, so there is no release to build."];
  const lines = [`Each release: ${plural(item.calls, "Vercel call")}, plus ${whole(result.overhead.calls)} for each run, and ${dollars(item.usd)} a month in storage. Vercel keeps every release, so the bill grows by that much with each one.`];
  lines.push(`Onboarding run: the same as one release (${plural(item.calls + result.overhead.calls, "Vercel call")}).`);
  return lines;
}

function figmaLines(result, rate) {
  const components = result.items.filter((item) => item.kind === "component");
  const screens = result.items.filter((item) => item.kind === "screen");
  const lines = [`Selected: ${plural(components.length, "component")} and ${plural(screens.length, "screen")}.`];
  if (components.length > 0) {
    const tokens = components.map((item) => item.tokens);
    const average = tokens.reduce((sum, value) => sum + value, 0) / tokens.length;
    const range = Math.min(...tokens) === Math.max(...tokens) ? "" : ` (lowest ${whole(Math.min(...tokens))}, highest ${whole(Math.max(...tokens))})`;
    const split = rate ? ` ${whole(rate.base)} of that is the call itself and the rest is ${rate.perChar} for each character of code.` : "";
    lines.push(`Relay, one component version per call: ${whole(average)} relay tokens on average${range}.${split}`);
    const sent = result.allowed.filter((id) => components.some((item) => item.id === id)).length;
    const cap = `${whole(result.cap.maxRelayTokens)} relay tokens and ${whole(result.cap.maxComponentWrites)} component writes`;
    lines.push(sent === components.length
      ? `Cap per run: ${cap}. All ${components.length} versions fit under it.`
      : `Cap per run: ${cap}. A run sends ${sent} of these ${components.length} versions and the other ${components.length - sent} wait for later runs.`);
    lines.push(`Each release after onboarding: one relay call for each component version that changed, about ${whole(average)} tokens each. A release with no UI change costs nothing.`);
  }
  if (screens.length > 0) {
    const tokens = screens.reduce((sum, item) => sum + item.tokens, 0);
    lines.push(`Screens: ${whole(tokens)} relay tokens for ${plural(screens.length, "screenshot")} (the adapter marks this rate unverified).`);
  }
  const uncapped = result.estimatedUncapped;
  lines.push(`Onboarding run: ${plural(components.length, "component version")} and ${plural(screens.length, "screen")}. Through the plugin: 0 relay tokens. Through the relay instead: ${whole(uncapped.tokens)} relay tokens in ${whole(uncapped.calls)} calls.`);
  return lines;
}

function genericLines(result) {
  const cost = result.estimatedUncapped;
  return [`Onboarding run: ${plural(result.items.length, "item")}, ${plural(cost.calls, "call")}, ${whole(cost.tokens)} relay tokens, ${dollars(cost.usd)}.`];
}

/** Plain text for a person to read before an output is turned on. */
export async function formatCosts(results, { heading } = {}) {
  const rate = results.some((r) => r.output === "figma" && r.adapter) ? await figmaRate() : null;
  const blocks = [];
  if (heading) blocks.push(heading);
  for (const result of results) {
    const lines = [LABELS[result.output] ?? result.output, `  Route: ${ROUTES[result.output] ?? "see the adapter's README"}.`];
    let body;
    if (!result.adapter) body = ["Off by default. There is no adapter yet, so there is no estimate and it cannot be turned on."];
    else if (result.error) body = [`No estimate: ${result.error}`];
    else if (result.output === "storybook") body = storybookLines(result);
    else if (result.output === "figma") body = figmaLines(result, rate);
    else body = genericLines(result);
    blocks.push([...lines, ...body.map((line) => `  ${line}`)].join("\n"));
  }
  return blocks.join("\n\n");
}
