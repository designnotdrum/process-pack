#!/usr/bin/env node
/**
 * The mechanical parts of design-onboard's Klaus step. It runs from process-pack's
 * tools/klaus folder, not from a repo.
 *
 *   node install/install.mjs costs --repo <dir> --config <file> --inventory <file> [--outputs storybook,figma] [--enabled] [--json]
 *       Shows what each output would cost, from the adapters' plan and estimate steps. Writes nothing
 *       and calls no platform, so it can run before anything is turned on.
 *
 *   node install/install.mjs copy --repo <dir> [--to scripts/klaus] [--force]
 *       Copies Klaus into the repo with a VERSION line.
 *
 *   node install/install.mjs workflow --repo <dir> --install "<command>" [options]
 *       Renders templates/klaus.yml into .github/workflows/klaus.yml from the repo's klaus.config.json,
 *       and checks it with actionlint.
 *       --install <command>        the repo's install command, for example "pnpm install --frozen-lockfile"
 *       --install-steps <file>     YAML steps taken from the repo's own workflow, instead of --install
 *       --corepack                 run `corepack enable` before the install command
 *       --node <major>             Node version on the runner. Default 22.
 *       --storybook-build <cmd>    builds a static Storybook for the Figma output. Needed when Figma is on.
 *       --playwright <cmd>         installs the browser. Default npx playwright install --with-deps chromium.
 *       --captures <file>          the captures file the version picker reads
 *       --config <file>            default <repo>/klaus.config.json
 *       --to <file>                default .github/workflows/klaus.yml
 *
 *   node install/install.mjs ruleset --repo <dir> --tag-pattern <pattern> [--bypass-app <id>]... [--bypass-team <id>]... [--create]
 *       Release mode runs on a pushed tag, and only a tag ruleset protects the repo's secrets from a
 *       hostile tag. Without --create this only reads: it says whether an active ruleset already limits
 *       who can create or update tags matching the pattern, and if not, shows the ruleset it would create
 *       and why. With --create it creates it. Admins always bypass it. The workflow command refuses
 *       to render release mode until one exists.
 *
 * Exit 0 on success, 1 when a checked workflow has errors, 2 on an error the person running it can fix,
 * 3 on any other error. No dependencies.
 */
import path from "node:path";
import { parseArgs } from "node:util";
import { UserError } from "../frame/errors.mjs";
import { copyKlaus } from "./copy.mjs";
import { estimateOutputs, formatCosts, OUTPUTS } from "./costs.mjs";
import { checkRuleset, createRuleset, explainRuleset, rulesetBody } from "./ruleset.mjs";
import { writeWorkflow } from "./workflow.mjs";

const OPTIONS = {
  repo: { type: "string" },
  config: { type: "string" },
  inventory: { type: "string" },
  outputs: { type: "string" },
  enabled: { type: "boolean" },
  json: { type: "boolean" },
  to: { type: "string" },
  force: { type: "boolean" },
  install: { type: "string" },
  "install-steps": { type: "string" },
  corepack: { type: "boolean" },
  node: { type: "string" },
  "storybook-build": { type: "string" },
  playwright: { type: "string" },
  captures: { type: "string" },
  "tag-pattern": { type: "string" },
  "bypass-app": { type: "string", multiple: true },
  "bypass-team": { type: "string", multiple: true },
  create: { type: "boolean" },
};

const USAGE = "Usage: install.mjs costs|copy|workflow|ruleset --repo <dir> [options]. See the top of this file.";

function repoOf(values) {
  if (!values.repo) throw new UserError(`--repo <dir> is needed.\n${USAGE}`);
  return path.resolve(values.repo);
}

async function costsCommand(values) {
  const repo = repoOf(values);
  const outputs = values.outputs ? values.outputs.split(",").map((s) => s.trim()) : OUTPUTS;
  const unknown = outputs.find((name) => !OUTPUTS.includes(name));
  if (unknown) throw new UserError(`Unknown output "${unknown}". The outputs are ${OUTPUTS.join(", ")}.`);
  if (!values.config) throw new UserError("--config <file> is needed: the settings to estimate under.");
  if (!values.inventory) throw new UserError("--inventory <file> is needed: an inventory.json for the repo.");
  const results = await estimateOutputs({ repo, config: path.resolve(values.config), inventory: path.resolve(values.inventory), outputs, onlyEnabled: values.enabled });
  const heading = values.enabled ? "Onboarding run: the one-time estimate for the outputs that are on" : "What each output would cost. Nothing is turned on or written.";
  console.log(values.json ? JSON.stringify(results, null, 2) : await formatCosts(results, { heading }));
  return 0;
}

function copyCommand(values) {
  const result = copyKlaus({ repo: repoOf(values), to: values.to, force: values.force });
  const lines = [`Klaus copied to ${path.relative(process.cwd(), result.destination) || "."}`, `  ${result.line}`];
  if (result.previousLine) lines.push(`  replaced: ${result.previousLine}`);
  lines.push(`  ${result.added.length} added, ${result.changed.length} changed, ${result.removed.length} removed, ${result.unchanged} unchanged`);
  console.log(lines.join("\n"));
  return 0;
}

function rulesetCommand(values) {
  const repo = repoOf(values);
  const tagPattern = values["tag-pattern"];
  if (!tagPattern) throw new UserError("--tag-pattern <pattern> is needed: the release tag pattern, for example v*.");
  const found = checkRuleset({ repo, tagPattern });
  if (found.status === "protected") {
    console.log(`A ruleset already limits who can create or update tags matching ${tagPattern}: "${found.ruleset.name}" (id ${found.ruleset.id}). Nothing to create.`);
    return 0;
  }
  const body = rulesetBody({ tagPattern, apps: values["bypass-app"], teams: values["bypass-team"] });
  if (found.status === "unknown") {
    throw new UserError(`The repo's rulesets could not be read, so it is not known whether the release tags are protected (${found.reason}). Creating rulesets needs admin rights on the repo, and some plans do not have rulesets. Use the schedule trigger instead, or ask an admin.`);
  }
  if (!values.create) {
    console.log([`No active ruleset limits who can create or update tags matching ${tagPattern}. Nothing has been created. This is what would be:`, "", explainRuleset(body), "", JSON.stringify(body, null, 2)].join("\n"));
    return 0;
  }
  const created = createRuleset({ repo, body });
  console.log(`Created the ruleset "${created?.name ?? body.name}" (id ${created?.id ?? "unknown"}). Only the bypass list can create or update tags matching ${tagPattern} from now on.`);
  return 0;
}

function workflowCommand(values) {
  const repo = repoOf(values);
  const result = writeWorkflow({
    repo,
    config: values.config ? path.resolve(values.config) : undefined,
    to: values.to,
    install: values.install,
    installSteps: values["install-steps"] ? path.resolve(values["install-steps"]) : undefined,
    corepack: values.corepack,
    node: values.node,
    storybookBuild: values["storybook-build"],
    playwright: values.playwright,
    captures: values.captures,
  });
  console.log([
    `Workflow written to ${path.relative(process.cwd(), result.destination)}`,
    `  parts kept: ${result.kept.join(", ") || "none"}`,
    ...(result.ruleset ? [`  release tags are protected by the ruleset "${result.ruleset.name}" (id ${result.ruleset.id})`] : []),
    `  secrets to set in the repo: ${result.secrets.join(", ") || "none"}`,
    `  ${result.lint.tool}: ${result.lint.ok === null ? "not checked" : result.lint.ok ? "ok" : "errors"}`,
    ...(result.lint.message ? [`  ${result.lint.message.split("\n").join("\n  ")}`] : []),
  ].join("\n"));
  return result.lint.ok === false ? 1 : 0;
}

async function main(argv) {
  try {
    const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
    const [command, ...extra] = positionals;
    if (extra.length > 0) throw new UserError(`Unexpected argument ${JSON.stringify(extra[0])}.`);
    if (command === "costs") return await costsCommand(values);
    if (command === "copy") return copyCommand(values);
    if (command === "workflow") return workflowCommand(values);
    if (command === "ruleset") return rulesetCommand(values);
    throw new UserError(USAGE);
  } catch (error) {
    if (error instanceof UserError || (typeof error?.code === "string" && error.code.startsWith("ERR_PARSE_ARGS"))) {
      console.error(error.message);
      return 2;
    }
    console.error(error?.stack ?? error);
    return 3;
  }
}

process.exitCode = await main(process.argv.slice(2));
