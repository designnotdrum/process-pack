/**
 * The GitHub environment that holds Klaus's secrets.
 *
 * A repository secret is readable by any workflow run on any branch. Anyone with write
 * access can push a branch that carries a workflow of their own and print the secret,
 * and in a repo where agent accounts open pull requests that includes the agents. A
 * secret kept in an environment is different: GitHub checks the environment's deployment
 * rules before the job starts, and refuses a job that runs from a branch or tag the rules
 * do not name. Such a job never sees the secret.
 *
 * The rules Klaus sets, and the only ones it accepts:
 *   - "selected branches and tags" is on, and "protected branches only" is off.
 *   - The default branch is allowed. A scheduled run, and a manual run from the default
 *     branch, run on it (GitHub's events table gives the default branch as the ref).
 *   - In release mode the release tag pattern is allowed as a tag rule. It is the same
 *     pattern the tag ruleset protects (ruleset.mjs), so only people the ruleset lets
 *     through can push a tag that reaches the secrets.
 *   - Nothing else is allowed.
 * Any other rule, such as a branch pattern someone added or a changed default branch name,
 * counts as drift, and the next render of the workflow refuses.
 *
 * Klaus never moves a secret. GitHub does not show a secret's value, so Klaus could not
 * copy one, and it should not handle a value in any case. It tells the person which
 * secrets to add to the environment and how, then reads the names with `gh api` to see
 * whether they are there. A repository secret of the same name stays readable from every
 * branch until it is deleted, so Klaus says that too.
 *
 * This file reads the environment, builds the rules design-onboard proposes, and creates
 * the environment. It calls `gh api` from inside the repo, where gh fills in {owner} and
 * {repo} from the git remote. It creates nothing unless asked, and it never changes an
 * environment that already exists, because it cannot see what else uses it.
 */
import { UserError } from "../frame/errors.mjs";
import { assertReleasePattern, gh } from "./ruleset.mjs";

export const DEFAULT_ENVIRONMENT = "klaus-release";

/** GitHub's pages for what this file does (read 2026-10-19). */
export const ENVIRONMENT_DOCS = Object.freeze({
  manage: "https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments",
  rules: "https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#deployment-branches-and-tags",
  api: "https://docs.github.com/en/rest/deployments/branch-policies",
  job: "https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idenvironment",
});

/** The same rule the config schema applies to trigger.secretsEnvironment. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Throws unless the name is one Klaus writes into a URL and a workflow without quoting. */
export function assertEnvironmentName(name) {
  if (typeof name === "string" && NAME.test(name)) return;
  throw new UserError(`${JSON.stringify(name)} is not an environment name Klaus uses. Use letters, digits, ".", "_" and "-", starting with a letter or digit, at most 64 characters, for example ${DEFAULT_ENVIRONMENT}.`);
}

/** The secret names the workflow passes to its Run Klaus step: those of every output that is on. */
export function secretsOf(config) {
  return [...new Set(Object.values(config.outputs).filter((output) => output.enabled).flatMap((output) => output.secrets))];
}

/** The rules the environment must have, as the policies GitHub lists. The default branch always; the release tag pattern in release mode. */
export function expectedPolicies({ defaultBranch, mode, tagPattern }) {
  const policies = [{ type: "branch", name: defaultBranch }];
  if (mode === "release") {
    assertReleasePattern(tagPattern);
    policies.push({ type: "tag", name: tagPattern });
  }
  return policies;
}

/** What the rules say in words. */
export const describePolicy = (policy) => (policy.type === "tag" ? `tags matching ${policy.name}` : `the branch ${policy.name}`);

const sameRule = (a, b) => a.type === b.type && a.name === b.name;

/** The body that turns on "selected branches and tags" for an environment. */
export const environmentBody = () => ({ deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } });

/** The calls that create the environment, in order. The environment first, so a failure part way leaves it allowing less, not more. */
export function environmentRequests({ name, policies }) {
  assertEnvironmentName(name);
  return [
    { method: "PUT", endpoint: `repos/{owner}/{repo}/environments/${name}`, body: environmentBody() },
    ...policies.map((policy) => ({ method: "POST", endpoint: `repos/{owner}/{repo}/environments/${name}/deployment-branch-policies`, body: { name: policy.name, type: policy.type } })),
  ];
}

/** Why the environment exists, what it does and who it blocks, in plain words. */
export function explainEnvironment({ name, policies, secrets }) {
  const allowed = policies.map(describePolicy).join(" and ");
  return [
    `Why: a repository secret can be read by a workflow run from any branch, so anyone who can push a branch can run their own workflow and print ${secrets.join(", ")}. A secret kept in an environment can be read only by a job that GitHub lets use the environment.`,
    `What it does: the environment ${name} lets a job use it only when the run is on ${allowed}. A run from any other branch or tag is refused before it starts.`,
    "Who it blocks: every other workflow in the repo that reads these secrets. Once a secret lives in the environment and its repository copy is deleted, only a job that names the environment can read it.",
  ].join("\n");
}

/**
 * Judges what GitHub returned for the environment.
 *
 * @param {object} args
 * @param {object | null} args.environment  The environment as GitHub returns it, or null when there is none.
 * @param {Array<{ type?: string, name: string }>} args.policies  Its branch and tag rules.
 * @param {number} [args.total]  How many rules GitHub says there are. More than were listed counts as drift.
 * @returns {{ status: "missing" } | { status: "ok" } | { status: "drifted", problems: string[] }}
 */
export function assessEnvironment({ environment, policies = [], total, defaultBranch, mode, tagPattern }) {
  if (!environment) return { status: "missing" };
  const wanted = expectedPolicies({ defaultBranch, mode, tagPattern });
  const rule = environment.deployment_branch_policy;
  const problems = [];
  if (!rule) {
    problems.push("it has no rule on which branches and tags can use it, so any of them can");
  } else if (rule.protected_branches === true) {
    problems.push('it is set to "protected branches only" instead of selected branches and tags, which depends on branch protection rules and does not name the release tags');
  } else if (rule.custom_branch_policies !== true) {
    problems.push("it is not set to selected branches and tags");
  } else {
    const have = policies.map((policy) => ({ type: policy.type ?? "branch", name: policy.name }));
    for (const policy of wanted) if (!have.some((other) => sameRule(other, policy))) problems.push(`it does not allow ${describePolicy(policy)}`);
    for (const policy of have) if (!wanted.some((other) => sameRule(other, policy))) problems.push(`it also allows ${describePolicy(policy)}`);
    if (Number.isInteger(total) && total > policies.length) problems.push(`it has ${total} rules and only ${policies.length} were read`);
  }
  return problems.length === 0 ? { status: "ok" } : { status: "drifted", problems };
}

/**
 * Reads the environment and judges it (see assessEnvironment). Reads the default branch too,
 * because that is the branch the environment must allow, and a renamed default branch is drift.
 *
 * @returns {{ status: "ok" | "missing", defaultBranch: string }
 *   | { status: "drifted", defaultBranch: string, problems: string[] }
 *   | { status: "unknown", reason: string }}
 *   unknown covers an environment that could not be read, for example without admin rights or on a plan without environments.
 */
export function checkEnvironment({ repo, name, mode, tagPattern, run }) {
  assertEnvironmentName(name);
  if (mode === "release") assertReleasePattern(tagPattern);
  try {
    const defaultBranch = gh(repo, ["repos/{owner}/{repo}"], { run })?.default_branch;
    if (typeof defaultBranch !== "string" || defaultBranch === "") return { status: "unknown", reason: "GitHub did not say which branch is the default" };
    let environment;
    try {
      environment = gh(repo, [`repos/{owner}/{repo}/environments/${name}`], { run });
    } catch (error) {
      if (error instanceof UserError && error.httpStatus === 404) return { status: "missing", defaultBranch };
      throw error;
    }
    let listed = { branch_policies: [] };
    if (environment?.deployment_branch_policy?.custom_branch_policies === true) {
      listed = gh(repo, [`repos/{owner}/{repo}/environments/${name}/deployment-branch-policies?per_page=100`], { run }) ?? listed;
    }
    return { ...assessEnvironment({ environment, policies: listed.branch_policies ?? [], total: listed.total_count, defaultBranch, mode, tagPattern }), defaultBranch };
  } catch (error) {
    if (error instanceof UserError) return { status: "unknown", reason: error.message };
    throw error;
  }
}

/** Creates the environment and its rules. The caller has the person's yes, and has seen that the environment does not exist. */
export function createEnvironment({ repo, name, policies, run }) {
  const created = environmentRequests({ name, policies }).map((request) => gh(repo, ["--method", request.method, request.endpoint, "--input", "-"], { input: JSON.stringify(request.body), run }));
  return created[0];
}

/** Where the person changes an environment by hand. */
export const settingsPath = (name) => `Settings, Environments, ${name}, Deployment branches and tags`;

/** The refusal for an environment whose rules are not what Klaus set. */
export function driftMessage({ name, problems, mode, tagPattern, defaultBranch }) {
  const wanted = expectedPolicies({ defaultBranch, mode, tagPattern }).map(describePolicy).join(" and ");
  return [
    `The environment ${name} does not have the rules Klaus set, so a run from a branch or tag that should not read the secrets might:`,
    ...problems.map((problem) => `  - ${problem}`),
    `It must allow ${wanted}, and nothing else. Klaus does not change an environment that already exists, because it cannot see what else uses it. Fix it in GitHub (${settingsPath(name)}), or remove trigger.secretsEnvironment from klaus.config.json to keep the secrets as repository secrets.`,
    `Rules: ${ENVIRONMENT_DOCS.rules}`,
  ].join("\n");
}

/** The refusal for any status that is not ok, for a render. */
export function requireMessage({ found, name, mode, tagPattern }) {
  if (found.status === "drifted") return driftMessage({ name, problems: found.problems, mode, tagPattern, defaultBranch: found.defaultBranch });
  const why = found.status === "unknown"
    ? `The environment ${name} could not be read (${found.reason}).`
    : `The environment ${name} does not exist.`;
  return `${why} klaus.config.json says the secrets are kept in it, and a run from a branch that should not read them can read a secret that is not. Create it with \`install.mjs environment --repo <repo> --create\` after the person agrees, or remove trigger.secretsEnvironment from klaus.config.json. Environments for private repos need GitHub Pro, Team or Enterprise (${ENVIRONMENT_DOCS.manage}).`;
}

/**
 * Whether each secret is in the environment, and whether a repository secret of the same name is still there.
 * Names are compared without regard to case, because GitHub stores secret names in capitals.
 * @returns {{ status: "read", secrets: Array<{ name: string, inEnvironment: boolean, inRepository: boolean }> } | { status: "unknown", reason: string }}
 */
export function checkSecrets({ repo, name, secrets, run }) {
  assertEnvironmentName(name);
  const namesAt = (endpoint) => {
    const answer = gh(repo, [endpoint], { run });
    const listed = answer?.secrets ?? [];
    if (Number.isInteger(answer?.total_count) && answer.total_count > listed.length) throw new UserError(`${endpoint} lists ${answer.total_count} secrets and only ${listed.length} were read`);
    return new Set(listed.map((secret) => String(secret.name).toUpperCase()));
  };
  try {
    const inEnvironment = namesAt(`repos/{owner}/{repo}/environments/${name}/secrets?per_page=100`);
    const inRepository = namesAt("repos/{owner}/{repo}/actions/secrets?per_page=100");
    return { status: "read", secrets: secrets.map((secret) => ({ name: secret, inEnvironment: inEnvironment.has(secret.toUpperCase()), inRepository: inRepository.has(secret.toUpperCase()) })) };
  } catch (error) {
    if (error instanceof UserError) return { status: "unknown", reason: error.message };
    throw error;
  }
}

/** What the person does for each secret, and whether the environment is done. Klaus runs none of these. */
export function secretsAdvice({ name, result }) {
  if (result.status !== "read") {
    return [`The secrets in ${name} could not be read (${result.reason}), so it is not known whether they are there.`, "Check them in GitHub (Settings, Secrets and variables, Actions, Environment secrets)."].join("\n");
  }
  const lines = [];
  for (const secret of result.secrets) {
    if (secret.inEnvironment && !secret.inRepository) {
      lines.push(`  ${secret.name}: in the environment, and not a repository secret. Done.`);
    } else if (secret.inEnvironment) {
      lines.push(`  ${secret.name}: in the environment, and still a repository secret. A repository secret can be read from a workflow on any branch, so the environment does not protect it yet. When you are sure the environment copy has the right value, delete the repository one: gh secret delete ${secret.name}`);
    } else {
      lines.push(`  ${secret.name}: not in the environment. Add it from your own secret store; GitHub does not show a secret's value, so Klaus cannot copy it. gh asks for the value and does not echo it: gh secret set ${secret.name} --env ${name}${secret.inRepository ? "\n    It is a repository secret now. Klaus leaves that one alone until the environment copy is there." : ""}`);
    }
  }
  const done = result.secrets.every((secret) => secret.inEnvironment && !secret.inRepository);
  return [
    ...lines,
    done ? `${result.secrets.length === 1 ? "The secret is" : `All ${result.secrets.length} secrets are`} in ${name} and none is left in the repository.` : "Not done yet. Run this command again after the steps above; it reads the names again.",
  ].join("\n");
}

/** The same steps before the environment exists, when there is nothing to read yet. */
export function secretsPlan({ name, secrets }) {
  return [
    `Klaus will not copy a secret. After the environment exists, add each one yourself, from your own secret store (gh asks for the value and does not echo it):`,
    ...secrets.map((secret) => `  gh secret set ${secret} --env ${name}`),
    "Then check them with this command again, and delete each repository copy of the same name (gh secret delete <name>), because a repository secret can be read from a workflow on any branch.",
  ].join("\n");
}
