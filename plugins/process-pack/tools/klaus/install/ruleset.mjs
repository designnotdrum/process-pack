/**
 * The tag ruleset that release mode needs.
 *
 * A pushed tag runs the workflow file from the tagged commit. A check inside that
 * file cannot stop a tag whose commit removes the check, so whoever can push a tag
 * matching the release pattern can run their own copy of the Klaus workflow with
 * the repo's secrets. What closes this is a repository ruleset that lets only a
 * short list of people and apps create or update tags matching the pattern.
 *
 * This file checks whether such a ruleset exists, builds the one design-onboard
 * proposes, and creates it. It calls `gh api` from inside the repo, where gh fills
 * in {owner} and {repo} from the git remote. It creates nothing unless asked.
 */
import { spawnSync } from "node:child_process";
import { UserError } from "../frame/errors.mjs";

export const RULESET_NAME = "Klaus release tags";

/** The repository admin role, as GitHub's rulesets API names it (checked on a real ruleset, 2026-10-19). */
export const ADMIN_ROLE_ID = 5;

/** The ruleset to create. Admins always bypass it. Apps and teams are added by id. */
export function rulesetBody({ tagPattern, apps = [], teams = [] }) {
  if (typeof tagPattern !== "string" || tagPattern === "") throw new UserError("The ruleset needs the release tag pattern, for example v*.");
  const actor = (actor_type, id) => ({ actor_id: Number(id), actor_type, bypass_mode: "always" });
  for (const id of [...apps, ...teams]) {
    if (!Number.isInteger(Number(id)) || Number(id) <= 0) throw new UserError(`${JSON.stringify(id)} is not an id. App and team ids are whole numbers.`);
  }
  return {
    name: RULESET_NAME,
    target: "tag",
    enforcement: "active",
    bypass_actors: [actor("RepositoryRole", ADMIN_ROLE_ID), ...apps.map((id) => actor("Integration", id)), ...teams.map((id) => actor("Team", id))],
    conditions: { ref_name: { include: [`refs/tags/${tagPattern}`], exclude: [] } },
    rules: [{ type: "creation" }, { type: "update" }],
  };
}

/** Why the ruleset exists, who it lets through, and who it blocks, in plain words. */
export function explainRuleset(body) {
  const pattern = body.conditions.ref_name.include[0];
  const named = body.bypass_actors.map((a) => (a.actor_type === "RepositoryRole" ? "repository admins" : `${a.actor_type === "Integration" ? "app" : "team"} ${a.actor_id}`));
  return [
    `Why: a pushed tag runs the workflow file from the tagged commit, so the workflow cannot protect itself from a hostile tag. Anyone who can push a tag matching ${pattern} could run their own copy of the Klaus workflow with the repo's secrets.`,
    `What it does: only ${named.join(", ")} can create or update tags matching ${pattern}. Everyone else is refused when they push one.`,
    "Who it blocks: everyone not listed, including any workflow that makes release tags today. A workflow can create tags only if its identity is on the list: an app by id, a team, or a repository admin.",
  ].join("\n");
}

const BROAD = new Set(["~ALL", "refs/tags/**", "refs/tags/*"]);

/** Whether a full ruleset limits creating and updating tags that match the pattern, and is switched on. */
export function protects(ruleset, tagPattern) {
  if (ruleset?.target !== "tag" || ruleset.enforcement !== "active") return false;
  const types = new Set((ruleset.rules ?? []).map((rule) => rule.type));
  if (!types.has("creation") || !types.has("update")) return false;
  const { include = [], exclude = [] } = ruleset.conditions?.ref_name ?? {};
  const wanted = `refs/tags/${tagPattern}`;
  if (exclude.some((entry) => entry === wanted || BROAD.has(entry))) return false;
  return include.some((entry) => entry === wanted || BROAD.has(entry));
}

/** Runs `gh api` from inside the repo. Returns the parsed JSON, or throws a UserError with gh's own words. */
export function gh(repo, args, { input, run = spawnSync } = {}) {
  const result = run("gh", ["api", ...args], { cwd: repo, encoding: "utf8", input });
  if (result.error?.code === "ENOENT") throw new UserError("The gh command is not installed, so the repo's rulesets cannot be read. Install it from https://cli.github.com and sign in.");
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const said = String(result.stderr || result.stdout).trim().split("\n")[0];
    throw new UserError(`gh api ${args[0]} failed${said ? `: ${said}` : ""}`);
  }
  return result.stdout.trim() === "" ? null : JSON.parse(result.stdout);
}

/**
 * Looks for a ruleset that already protects the release tags.
 * @returns {{ status: "protected", ruleset: object } | { status: "missing" } | { status: "unknown", reason: string }}
 *   unknown means the rulesets could not be read, for example without admin rights or on a plan without rulesets.
 */
export function checkRuleset({ repo, tagPattern, run }) {
  let summaries;
  try {
    summaries = gh(repo, ["repos/{owner}/{repo}/rulesets"], { run });
  } catch (error) {
    if (error instanceof UserError) return { status: "unknown", reason: error.message };
    throw error;
  }
  for (const summary of summaries ?? []) {
    if (summary.target !== "tag" || summary.enforcement !== "active") continue;
    const full = gh(repo, [`repos/{owner}/{repo}/rulesets/${summary.id}`], { run });
    if (protects(full, tagPattern)) return { status: "protected", ruleset: full };
  }
  return { status: "missing" };
}

/** Creates the ruleset. The caller has the person's yes. */
export function createRuleset({ repo, body, run }) {
  return gh(repo, ["--method", "POST", "repos/{owner}/{repo}/rulesets", "--input", "-"], { input: JSON.stringify(body), run });
}
