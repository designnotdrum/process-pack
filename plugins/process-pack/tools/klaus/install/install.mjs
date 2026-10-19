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
 *   node install/install.mjs ruleset --repo <dir> --tag-pattern <pattern> [--approve <Type>:<id>:<name>]... [--bypass-app <id>:<name>]... [--bypass-team <id>:<name>]... [--create]
 *       Release mode runs on a pushed tag, and only a tag ruleset protects the repo's secrets from a
 *       hostile tag. Without --create this only reads: it reads every active tag ruleset in full and looks
 *       only at rulesets of one exact shape (about tags; active; includes exactly the release pattern or
 *       ~ALL; excludes nothing; has the creation, update and deletion rules). Other rulesets neither
 *       count nor block. It says whether one of that shape lets only repository admins and approved
 *       actors bypass it. If it lets anyone else bypass it, it lists them and stops. If no ruleset has
 *       the shape it shows the one it would create and why. With --create it creates it. Admins always
 *       bypass it. --approve names an actor the person approves besides admins (Type is Integration,
 *       Team, User, RepositoryRole, OrganizationAdmin or DeployKey), --bypass-app and --bypass-team add one
 *       to the ruleset that is created. Approved actors are read from trigger.approvedTagBypass in
 *       klaus.config.json too, and printed again so they can be recorded there. The workflow command
 *       refuses to render release mode until the check passes, and again if a later render finds an
 *       actor that is not on the list.
 *
 *   node install/install.mjs environment --repo <dir> [--config <file>] [--name <environment>] [--create]
 *       A repository secret can be read from a workflow run on any branch. This keeps Klaus's secrets
 *       (those of every output that is on in klaus.config.json) in a GitHub environment whose
 *       deployment rules allow only the default branch and, in release mode, the release tag pattern.
 *       Without --create this only reads: it reads the default branch and the environment, and says
 *       whether the environment has exactly those rules. If it has none it shows what it would create and
 *       why. If it exists with other rules it lists the differences and stops, because it never changes an
 *       environment that exists. With --create it creates the environment after the person's yes. It never
 *       moves a secret: it prints which secrets to add to the environment and how, then reads the secret
 *       names with `gh api` to see whether they are there and whether a repository secret of the same name
 *       is left. The name is --name, else trigger.secretsEnvironment, else klaus-release. When
 *       trigger.secretsEnvironment is set, the workflow command names the environment in the job and
 *       refuses to render if its rules are no longer these.
 *
 * Exit 0 on success, 1 when a checked workflow has errors, 2 on an error the person running it can fix,
 * 3 on any other error. No dependencies.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { UserError } from "../frame/errors.mjs";
import { resolveConfig } from "../frame/config.mjs";
import { readJsonFile } from "../frame/json-file.mjs";
import { copyKlaus } from "./copy.mjs";
import { estimateOutputs, formatCosts, OUTPUTS } from "./costs.mjs";
import { checkEnvironment, checkSecrets, createEnvironment, DEFAULT_ENVIRONMENT, describePolicy, driftMessage, ENVIRONMENT_DOCS, environmentBody, expectedPolicies, explainEnvironment, assertEnvironmentName, secretsAdvice, secretsOf, secretsPlan } from "./environment.mjs";
import { approvalsInUse, assertReleasePattern, checkRuleset, createRuleset, explainRuleset, parseActor, rulesetBody, SHAPE_NOTE, unapprovedMessage } from "./ruleset.mjs";
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
  approve: { type: "string", multiple: true },
  "bypass-app": { type: "string", multiple: true },
  "bypass-team": { type: "string", multiple: true },
  create: { type: "boolean" },
  name: { type: "string" },
};

const USAGE = "Usage: install.mjs costs|copy|workflow|ruleset|environment --repo <dir> [options]. See the top of this file.";

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

/** The actors klaus.config.json already records as approved. A missing file or key means none. */
function recordedApprovals(repo) {
  const file = path.join(repo, "klaus.config.json");
  if (!existsSync(file)) return [];
  const list = readJsonFile(file, "Config").trigger?.approvedTagBypass;
  return Array.isArray(list) ? list : [];
}

const recordLine = (approved) => `Record this in klaus.config.json, under "trigger": "approvedTagBypass": ${JSON.stringify(approved)}`;

function rulesetCommand(values) {
  const repo = repoOf(values);
  const tagPattern = values["tag-pattern"];
  if (!tagPattern) throw new UserError("--tag-pattern <pattern> is needed: the release tag pattern, for example v*.");
  assertReleasePattern(tagPattern);
  const apps = (values["bypass-app"] ?? []).map((text) => parseActor(text, "Integration"));
  const teams = (values["bypass-team"] ?? []).map((text) => parseActor(text, "Team"));
  const fromFlags = (values.approve ?? []).map((text) => parseActor(text));
  const approved = [...recordedApprovals(repo), ...fromFlags].filter((entry, i, all) => all.findIndex((other) => other.type === entry.type && other.id === entry.id) === i);

  const found = checkRuleset({ repo, tagPattern, approved });
  if (found.status === "protected") {
    const names = found.rulesets.map((ruleset) => `"${ruleset.name}" (id ${ruleset.id})`).join(", ");
    const extra = approvalsInUse(found, approved);
    console.log([
      `Tags matching ${tagPattern} are protected by ${names}, which has the shape Klaus needs. Every bypass actor is a repository admin or approved by name.`,
      ...(extra.length > 0 ? [`Approved besides admins: ${extra.map((entry) => `${entry.name} (${entry.type} ${entry.id})`).join(", ")}.`, recordLine(extra)] : []),
      "Nothing to create.",
    ].join("\n"));
    return 0;
  }
  if (found.status === "unapproved") throw new UserError(unapprovedMessage(found, tagPattern));
  if (found.status === "unknown") {
    throw new UserError(`The repo's rulesets could not be read, so it is not known whether the release tags are protected (${found.reason}). Creating rulesets needs admin rights on the repo, and some plans do not have rulesets. Use the schedule trigger instead, or ask an admin.`);
  }
  const body = rulesetBody({ tagPattern, apps, teams });
  const names = new Map([...apps, ...teams].map((entry) => [`${entry.type}:${entry.id}`, entry.name]));
  if (!values.create) {
    console.log([`No ruleset of the shape Klaus needs limits who can create, update or delete tags matching ${tagPattern}. Nothing has been created. This is what would be:`, "", explainRuleset(body, names), "", SHAPE_NOTE, "", JSON.stringify(body, null, 2)].join("\n"));
    return 0;
  }
  const created = createRuleset({ repo, body });
  const recorded = [...apps, ...teams];
  console.log([
    `Created the ruleset "${created?.name ?? body.name}" (id ${created?.id ?? "unknown"}). Only the bypass list can create, update or delete tags matching ${tagPattern} from now on.`,
    ...(recorded.length > 0 ? [recordLine(recorded)] : []),
  ].join("\n"));
  return 0;
}

/** The line to put in klaus.config.json once the environment exists. */
const recordEnvironmentLine = (name) => `Record this in klaus.config.json, under "trigger": "secretsEnvironment": ${JSON.stringify(name)}`;

function environmentCommand(values) {
  const repo = repoOf(values);
  const file = values.config ? path.resolve(values.config) : path.join(repo, "klaus.config.json");
  const config = resolveConfig(readJsonFile(file, "Config"));
  const secrets = secretsOf(config);
  if (secrets.length === 0) {
    console.log("No output that is on reads a secret, so there is nothing to keep in an environment. Nothing to create.");
    return 0;
  }
  const { mode, tagPattern } = config.trigger;
  if (mode === "release") assertReleasePattern(tagPattern);
  const name = values.name ?? config.trigger.secretsEnvironment ?? DEFAULT_ENVIRONMENT;
  assertEnvironmentName(name);
  const record = config.trigger.secretsEnvironment === name ? [] : [recordEnvironmentLine(name)];

  const found = checkEnvironment({ repo, name, mode, tagPattern });
  if (found.status === "unknown") {
    throw new UserError(`The environment ${name} could not be read, so it is not known whether the secrets are limited to the default branch and the release tags (${found.reason}). Reading and creating an environment needs admin rights on the repo, and environments for private repos need GitHub Pro, Team or Enterprise (${ENVIRONMENT_DOCS.manage}). Without one the secrets stay repository secrets, which a workflow on any branch can read.`);
  }
  if (found.status === "drifted") throw new UserError(driftMessage({ name, problems: found.problems, mode, tagPattern, defaultBranch: found.defaultBranch }));

  const policies = expectedPolicies({ defaultBranch: found.defaultBranch, mode, tagPattern });
  if (found.status === "missing") {
    if (!values.create) {
      console.log([
        `There is no environment ${name}, so the secrets are repository secrets that a workflow on any branch can read. Nothing has been created. This is what would be:`,
        "",
        explainEnvironment({ name, policies, secrets }),
        "",
        `Rules (${ENVIRONMENT_DOCS.manage}): ${policies.map(describePolicy).join(", ")}; every other branch and tag is refused. The calls:`,
        `  PUT repos/{owner}/{repo}/environments/${name}  ${JSON.stringify(environmentBody())}`,
        ...policies.map((policy) => `  POST repos/{owner}/{repo}/environments/${name}/deployment-branch-policies  ${JSON.stringify({ name: policy.name, type: policy.type })}`),
        "",
        secretsPlan({ name, secrets }),
      ].join("\n"));
      return 0;
    }
    createEnvironment({ repo, name, policies });
    console.log([`Created the environment ${name}. Only ${policies.map(describePolicy).join(" and ")} can use it from now on.`, ...record].join("\n"));
  } else {
    console.log([`The environment ${name} allows ${policies.map(describePolicy).join(" and ")} and nothing else. Nothing to create.`, ...record].join("\n"));
  }
  console.log(secretsAdvice({ name, result: checkSecrets({ repo, name, secrets }) }));
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
    ...(result.rulesets ? [`  release tags are protected by ${result.rulesets.map((r) => `"${r.name}" (id ${r.id})`).join(", ")}`] : []),
    ...(result.environment ? [`  the job uses the environment "${result.environment.name}", whose rules allow only ${result.environment.policies.map(describePolicy).join(" and ")}`] : []),
    `  secrets to set in ${result.environment ? `the environment ${result.environment.name}` : "the repo"}: ${result.secrets.join(", ") || "none"}`,
    ...(!result.environment && result.secrets.length > 0 ? ["  they are repository secrets, which a workflow run on any branch can read. To keep them in an environment instead, run install.mjs environment."] : []),
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
    if (command === "environment") return environmentCommand(values);
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
