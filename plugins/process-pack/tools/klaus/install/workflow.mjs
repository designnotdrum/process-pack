/**
 * Renders templates/klaus.yml into the repo's .github/workflows/klaus.yml.
 *
 * The template is a valid workflow on its own. Three kinds of comment mark what
 * this file changes:
 *
 *   # klaus:begin NAME ... # klaus:end NAME   a part that is kept or dropped
 *   # klaus:value NAME                        the first quoted string on that line is replaced
 *   # klaus:secrets                           replaced by one env line for each secret name
 *
 * The install part is always replaced, because the install steps are the repo's own.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { UserError } from "../frame/errors.mjs";
import { resolveConfig } from "../frame/config.mjs";
import { readJsonFile } from "../frame/json-file.mjs";
import { SOURCE_ROOT } from "./copy.mjs";
import { checkRuleset, unapprovedMessage } from "./ruleset.mjs";
import { writePlainFile } from "./safe-write.mjs";

const BEGIN = /^(\s*)# klaus:begin (\S+)\s*$/;
const END = /^\s*# klaus:end (\S+)\s*$/;
const VALUE = /^(.*?)"(?:[^"\\]|\\.)*"(.*?)\s*# klaus:value (\S+)\s*$/;
const SECRETS = /^(\s*)# klaus:secrets\s*$/;

/** Steps for one command, as lines at the steps' indentation. */
function runStep(name, command, indent) {
  const pad = " ".repeat(indent);
  const run = command.includes("\n")
    ? [`${pad}  run: |`, ...command.trimEnd().split("\n").map((line) => `${pad}    ${line}`)]
    : [`${pad}  run: ${JSON.stringify(command)}`];
  return [`${pad}- name: ${name}`, ...run];
}

function installLines({ install, installSteps, corepack }, indent) {
  const pad = " ".repeat(indent);
  if (installSteps) {
    const text = fs.readFileSync(installSteps, "utf8").trimEnd();
    return [`${pad}# The repo's own install steps, from ${path.basename(installSteps)}.`, ...text.split("\n").map((line) => (line === "" ? "" : `${pad}${line}`))];
  }
  return [...(corepack ? runStep("Enable corepack", "corepack enable", indent) : []), ...runStep("Install the repo's dependencies", install, indent)];
}

/**
 * @param {object} options
 * @param {string} options.template   The template's text.
 * @param {object} options.config     A resolved klaus.config.json.
 * @param {string} [options.install]  The repo's install command.
 * @param {string} [options.installSteps]  A file of YAML steps, instead of install. Taken from the repo's own workflow.
 * @param {boolean} [options.corepack]  Add a corepack step before the install command.
 * @param {string} [options.node]  Node major version for the runner. Default 22.
 * @param {string} [options.storybookBuild]  Command that builds a static Storybook into outputs.figma.options.storybookDir. Needed when Figma is on.
 * @param {string} [options.playwright]  Command that installs the browser. Default npx playwright install --with-deps chromium.
 * @param {string} [options.captures]  Path of the captures file the version picker reads.
 * @returns {{ text: string, kept: string[], secrets: string[] }}
 */
export function renderWorkflow({ template, config, install, installSteps, corepack = false, node = "22", storybookBuild, playwright, captures = "" }) {
  const figma = Boolean(config.outputs.figma?.enabled);
  if (!install && !installSteps) {
    throw new UserError("Give the repo's install command with --install (for example \"pnpm install --frozen-lockfile\"), or a file of the install steps with --install-steps. Klaus installs nothing itself, so the workflow needs the repo's own.");
  }
  if (figma && !storybookBuild) {
    throw new UserError("The Figma output reads a static Storybook build. Give the command that writes one with --storybook-build (it must write to outputs.figma.options.storybookDir, storybook-static by default).");
  }
  const folders = config.inventory.folders ?? [];
  if (folders.length === 0) throw new UserError("klaus.config.json has no inventory.folders, so the workflow has nothing to build the inventory from.");

  const secrets = [...new Set(Object.values(config.outputs).filter((o) => o.enabled).flatMap((o) => o.secrets))];
  const keep = {
    release: config.trigger.mode === "release",
    schedule: config.trigger.mode === "schedule",
    "figma-build": figma,
    "figma-artifact": figma,
    captures: captures !== "",
  };
  const values = {
    "tag-pattern": config.trigger.tagPattern,
    cron: config.trigger.cron ?? "0 6 * * 1",
    "node-version": String(node),
    "inventory-folders": folders.join(" "),
    captures,
    "storybook-build": storybookBuild ?? "",
    playwright: playwright ?? "npx playwright install --with-deps chromium",
  };

  const out = [];
  const kept = [];
  let skipping = null;
  for (const line of template.split("\n")) {
    const begin = BEGIN.exec(line);
    if (begin) {
      const [, indent, name] = begin;
      if (name === "install") {
        out.push(...installLines({ install, installSteps, corepack }, indent.length));
        skipping = name;
      } else if (keep[name]) {
        kept.push(name);
      } else {
        skipping = name;
      }
      continue;
    }
    const end = END.exec(line);
    if (end) {
      if (skipping === end[1]) skipping = null;
      continue;
    }
    if (skipping) continue;

    const secret = SECRETS.exec(line);
    if (secret) {
      for (const name of secrets) out.push(`${secret[1]}${name}: \${{ secrets.${name} }}`);
      continue;
    }
    const value = VALUE.exec(line);
    if (value) {
      const [, before, after, name] = value;
      if (!Object.hasOwn(values, name)) throw new Error(`The template asks for the value "${name}", which this renderer does not know.`);
      out.push(`${before}${JSON.stringify(values[name])}${after}`.trimEnd());
      continue;
    }
    out.push(line);
  }
  if (skipping) throw new Error(`The template's ${skipping} part has no end.`);
  const text = out.join("\n");
  if (/# klaus:(begin|end|value|secrets)/.test(text)) throw new Error("A klaus: marker was left in the rendered workflow.");
  return { text, kept, secrets };
}

/**
 * Checks a workflow file. actionlint when it is installed, else a YAML parse
 * with python3 or ruby, else nothing, and the result says which.
 * @returns {{ tool: string, ok: boolean | null, message: string }}
 */
export function lintWorkflow(file) {
  const run = (command, args) => spawnSync(command, args, { encoding: "utf8" });
  const actionlint = run("actionlint", [file]);
  if (!actionlint.error) {
    return { tool: "actionlint", ok: actionlint.status === 0, message: (actionlint.stdout + actionlint.stderr).trim() };
  }
  const parsedOnly = "actionlint is not installed, so the file was parsed as YAML only.";
  const python = run("python3", ["-c", "import sys, yaml; yaml.safe_load(open(sys.argv[1]))", file]);
  if (!python.error && python.status === 0) return { tool: "python3 yaml parse", ok: true, message: parsedOnly };
  // A parser that ran and rejected the file is a failure. Only a missing PyYAML falls through.
  if (!python.error && !/No module named/.test(python.stderr)) return { tool: "python3 yaml parse", ok: false, message: python.stderr.trim() };
  const ruby = run("ruby", ["-ryaml", "-e", "YAML.safe_load(File.read(ARGV[0]))", file]);
  if (!ruby.error && ruby.status === 0) return { tool: "ruby yaml parse", ok: true, message: parsedOnly };
  if (!ruby.error) return { tool: "ruby yaml parse", ok: false, message: ruby.stderr.trim() };
  return { tool: "none", ok: null, message: "Neither actionlint nor a YAML parser is available, so the file was not checked." };
}

/**
 * Release mode runs on a pushed tag, and a pushed tag runs the workflow file from the tagged commit,
 * so only a tag ruleset protects it. This refuses to render release mode unless an active ruleset
 * limits creating and updating the tags and every one of its bypass actors is a repository admin or
 * is listed in trigger.approvedTagBypass. A ruleset that gained someone since the list was made
 * is refused the next time this runs.
 * @returns {object[] | null}  The rulesets that protect the tags, or null when the trigger is not release.
 */
export function requireTagRuleset({ repo, config, checkTags = checkRuleset }) {
  if (config.trigger.mode !== "release") return null;
  const tagPattern = config.trigger.tagPattern;
  const found = checkTags({ repo, tagPattern, approved: config.trigger.approvedTagBypass ?? [] });
  if (found.status === "protected") return found.rulesets;
  if (found.status === "unapproved") throw new UserError(unapprovedMessage(found, tagPattern));
  const why = found.status === "unknown" ? `The repo's rulesets could not be read (${found.reason}).` : `No active ruleset limits who can create or update tags matching ${tagPattern}.`;
  throw new UserError(`${why} Release mode runs on a pushed tag, and a pushed tag runs the workflow file from the tagged commit, so only a tag ruleset protects the repo's secrets from a hostile tag. Create one with \`install.mjs ruleset --repo <repo> --tag-pattern ${tagPattern} --create\` after the person agrees, or set trigger.mode to "schedule" in klaus.config.json.`);
}

/** Reads the config and the template, renders, writes, and lints. */
export function writeWorkflow({ repo, config: configFile = path.join(repo, "klaus.config.json"), to = ".github/workflows/klaus.yml", checkTags, ...options }) {
  const config = resolveConfig(readJsonFile(configFile, "Config"));
  const rulesets = requireTagRuleset({ repo, config, checkTags });
  const template = fs.readFileSync(path.join(SOURCE_ROOT, "templates", "klaus.yml"), "utf8");
  const { text, kept, secrets } = renderWorkflow({ template, config, ...options });
  const destination = writePlainFile(repo, path.resolve(repo, to), text.endsWith("\n") ? text : `${text}\n`);
  return { destination, kept, secrets, rulesets, lint: lintWorkflow(destination) };
}
