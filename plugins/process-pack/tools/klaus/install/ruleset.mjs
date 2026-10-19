/**
 * The tag ruleset that release mode needs.
 *
 * A pushed tag runs the workflow file from the tagged commit. A check inside that
 * file cannot stop a tag whose commit removes the check, so whoever can push a tag
 * matching the release pattern can run their own copy of the Klaus workflow with
 * the repo's secrets. What closes this is a repository ruleset that lets only a
 * short list of people and apps create or update tags matching the pattern.
 *
 * Only a ruleset of one exact shape counts (see hasExactShape). Klaus does not judge
 * other rulesets: a ruleset with an exclusion, a different include, or fewer rules
 * neither counts as protection nor blocks it, because GitHub applies the rules of
 * every ruleset that targets a tag, so the exact one still binds.
 *
 * "Short list" is checked, not assumed. A ruleset of that shape protects the tags
 * only when every one of its bypass actors is a repository admin, or was approved by
 * name by the person who installed Klaus. The approved list is recorded in
 * klaus.config.json (trigger.approvedTagBypass), so every later render checks the
 * same list and refuses when the ruleset has gained someone who is not on it.
 *
 * This file checks the rulesets, builds the one design-onboard proposes, and
 * creates it. It calls `gh api` from inside the repo, where gh fills in {owner} and
 * {repo} from the git remote. It creates nothing unless asked.
 */
import { spawnSync } from "node:child_process";
import { UserError } from "../frame/errors.mjs";

export const RULESET_NAME = "Klaus release tags";

/** The repository admin role, as GitHub's rulesets API names it (checked on a real ruleset, 2026-10-19). */
export const ADMIN_ROLE_ID = 5;

/** The rules a ruleset must have, besides whatever else it has. */
export const REQUIRED_RULES = Object.freeze(["creation", "update", "deletion"]);

/**
 * The one include, besides the release pattern, that takes in every release tag. `refs/tags/*` does not:
 * in a ruleset `*` does not match `/`, while in a workflow's tag filter `**` does.
 */
const ALL_TAGS = "~ALL";

export const PATTERN_DOCS = Object.freeze({
  workflow: "https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#filter-pattern-cheat-sheet",
  ruleset: "https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository#using-fnmatch-syntax",
});

/**
 * Throws unless the release pattern means the same thing in the workflow's tag filter and in a ruleset.
 * The two syntaxes differ. In a workflow filter `**` matches `/`, `?` and `+` repeat the character before,
 * `[ ]` takes only letters and digits, and `!` negates. In a ruleset (Ruby fnmatch) `*` stops at `/`, `**`
 * only works as a whole path part, `?` is any one character, `[ ]` takes any set, and `\` escapes. A tag
 * such as `release/evil` can match the workflow's `release/**` and not the ruleset's. So Klaus renders
 * only a pattern of letters, digits, `.`, `_`, `-` and `*`, with no `/` and no `**`. Those mean the same in both.
 */
export function assertReleasePattern(tagPattern) {
  if (typeof tagPattern === "string" && /^[A-Za-z0-9._*-]+$/.test(tagPattern) && !tagPattern.includes("**")) return;
  throw new UserError([
    `The release pattern ${JSON.stringify(tagPattern)} cannot be protected by a tag ruleset, so release mode will not use it.`,
    "A workflow's tag filter and a ruleset read the same pattern differently: in a workflow `**` matches `/`, while in a ruleset `*` stops at `/`, and `?`, `+`, `[ ]`, `!` and `\\` mean different things in the two. A tag such as release/evil could then match the workflow and slip past the ruleset.",
    "Use a pattern made only of letters, digits, `.`, `_`, `-` and `*`, with no `/` and no `**`, for example v*. Or use the schedule trigger, which does not need a ruleset.",
    `Workflow syntax: ${PATTERN_DOCS.workflow}`,
    `Ruleset syntax: ${PATTERN_DOCS.ruleset}`,
  ].join("\n"));
}

/** Why only one shape of ruleset counts, for the person to read. */
export const SHAPE_NOTE = "Only a ruleset of exactly this shape counts: it is about tags, active, includes exactly the release pattern or ~ALL, excludes nothing, limits creating, updating and deleting, and only repository admins and actors approved by name can bypass it. Any exclusion leaves the tags it names open to everyone, and a different include may not reach the release tags, so Klaus does not try to judge other rulesets. They neither count nor block, and GitHub applies the rules of every ruleset together, so this one still binds.";

/** The actor types the rulesets API knows. */
export const ACTOR_TYPES = Object.freeze(["Integration", "OrganizationAdmin", "RepositoryRole", "Team", "DeployKey", "User"]);

const keyOf = (type, id) => `${type}:${id}`;

/** Repository admins always count as maintainers. */
export const isAdmin = (actor) => actor.actor_type === "RepositoryRole" && Number(actor.actor_id) === ADMIN_ROLE_ID;

/** An actor in plain words. A role other than admin is named by its id, because only the admin id is known. */
export function describeActor(type, id) {
  if (type === "RepositoryRole") return Number(id) === ADMIN_ROLE_ID ? "repository admins" : `everyone with repository role ${id}`;
  if (type === "OrganizationAdmin") return "organization owners";
  if (type === "DeployKey") return "deploy keys";
  return `${{ Integration: "app", Team: "team", User: "user" }[type] ?? type} ${id}`;
}

/**
 * Reads "<id>:<name>" (for --bypass-app and --bypass-team) or "<Type>:<id>:<name>" (for --approve).
 * The name is what the person typed to approve the actor. It is kept so a reader of klaus.config.json can tell who it is.
 */
export function parseActor(text, type) {
  const parts = String(text).split(":");
  if (type === undefined) type = parts.shift();
  const [id, ...nameParts] = parts;
  const name = nameParts.join(":").trim();
  if (!ACTOR_TYPES.includes(type)) throw new UserError(`${JSON.stringify(type)} is not an actor type. Use one of ${ACTOR_TYPES.join(", ")}.`);
  if (!/^[1-9][0-9]*$/.test(id ?? "")) throw new UserError(`${JSON.stringify(text)}: the id must be a whole number.`);
  if (name === "") throw new UserError(`${JSON.stringify(text)}: give the name of the ${describeActor(type, id)} after the id, as the person approving it typed it.`);
  return { type, id: Number(id), name };
}

/** The ruleset to create. Admins always bypass it. Approved apps and teams ({ id, name }) are added by id. */
export function rulesetBody({ tagPattern, apps = [], teams = [] }) {
  assertReleasePattern(tagPattern);
  const actor = (actor_type, id) => ({ actor_id: Number(id), actor_type, bypass_mode: "always" });
  const named = [...apps.map((a) => ({ ...a, type: "Integration" })), ...teams.map((t) => ({ ...t, type: "Team" }))];
  for (const entry of named) {
    if (!Number.isInteger(Number(entry.id)) || Number(entry.id) <= 0) throw new UserError(`${JSON.stringify(entry.id)} is not an id. App and team ids are whole numbers.`);
  }
  return {
    name: RULESET_NAME,
    target: "tag",
    enforcement: "active",
    bypass_actors: [actor("RepositoryRole", ADMIN_ROLE_ID), ...named.map((entry) => actor(entry.type, entry.id))],
    conditions: { ref_name: { include: [`refs/tags/${tagPattern}`], exclude: [] } },
    rules: REQUIRED_RULES.map((type) => ({ type })),
  };
}

/** Why the ruleset exists, who it lets through, and who it blocks, in plain words. */
export function explainRuleset(body, names = new Map()) {
  const pattern = body.conditions.ref_name.include[0];
  const named = body.bypass_actors.map((a) => {
    const label = describeActor(a.actor_type, a.actor_id);
    const name = names.get(keyOf(a.actor_type, a.actor_id));
    return name ? `${label} (${name})` : label;
  });
  return [
    `Why: a pushed tag runs the workflow file from the tagged commit, so the workflow cannot protect itself from a hostile tag. Anyone who can push a tag matching ${pattern} could run their own copy of the Klaus workflow with the repo's secrets.`,
    `What it does: only ${named.join(", ")} can create, update or delete tags matching ${pattern}. Everyone else is refused when they push, move or delete one.`,
    "Who it blocks: everyone not listed, including any workflow that makes release tags today. A workflow can create tags only if its identity is on the list: an app by id, a team, or a repository admin.",
  ].join("\n");
}

/**
 * Whether a ruleset has the one shape Klaus accepts, leaving the bypass list aside:
 * about tags, active, including exactly the release pattern or ~ALL, excluding nothing,
 * and with the creation, update and deletion rules. Other rules may be there too.
 */
export function hasExactShape(ruleset, tagPattern) {
  if (ruleset?.target !== "tag" || ruleset.enforcement !== "active") return false;
  const { include, exclude } = ruleset.conditions?.ref_name ?? {};
  if (!Array.isArray(include) || include.length === 0) return false;
  if (exclude !== undefined && exclude !== null && !(Array.isArray(exclude) && exclude.length === 0)) return false;
  const wanted = `refs/tags/${tagPattern}`;
  if (!include.every((entry) => entry === wanted || entry === ALL_TAGS)) return false;
  const types = new Set((ruleset.rules ?? []).map((rule) => rule.type));
  return REQUIRED_RULES.every((type) => types.has(type));
}

/**
 * Judges the repo's tag rulesets. Only rulesets of the exact shape (hasExactShape) are looked at;
 * any other ruleset neither counts as protection nor blocks it.
 *
 * @param {object} args
 * @param {object[]} args.rulesets   Rulesets as `gh api .../rulesets/<id>` returns them.
 * @param {string} args.tagPattern
 * @param {Array<{ type: string, id: number, name: string }>} [args.approved]  Actors approved by name besides repository admins.
 * @returns {{ status: "protected", rulesets: object[] }
 *   | { status: "unapproved", rulesets: object[], unapproved: Array<{ ruleset: object, actor: object }> }
 *   | { status: "missing" }
 *   | { status: "unknown", reason: string }}
 *   protected: a ruleset of the exact shape lets only admins and approved actors bypass it (rulesets lists those).
 *   unapproved: rulesets of the exact shape exist, and each lets someone bypass it who is neither an admin nor approved.
 *   missing: no ruleset has the exact shape.
 *   unknown: no ruleset qualifies and the bypass list of one of the exact shape was not returned.
 */
export function assess({ rulesets, tagPattern, approved = [] }) {
  assertReleasePattern(tagPattern);
  const exact = rulesets.filter((ruleset) => hasExactShape(ruleset, tagPattern));
  if (exact.length === 0) return { status: "missing" };
  const allowed = new Set(approved.map((entry) => keyOf(entry.type, entry.id)));
  const clean = [];
  const unapproved = [];
  let hidden = null;
  for (const ruleset of exact) {
    if (!Array.isArray(ruleset.bypass_actors)) {
      hidden ??= `the bypass list of the ruleset "${ruleset.name}" was not returned, so it is not known who can bypass it. Sign in to gh as a repository admin`;
      continue;
    }
    const others = ruleset.bypass_actors.filter((actor) => !isAdmin(actor) && !allowed.has(keyOf(actor.actor_type, actor.actor_id)));
    if (others.length === 0) clean.push(ruleset);
    for (const actor of others) {
      unapproved.push({
        ruleset: { id: ruleset.id, name: ruleset.name, url: ruleset._links?.html?.href ?? null },
        actor: { type: actor.actor_type, id: actor.actor_id, mode: actor.bypass_mode ?? "always" },
      });
    }
  }
  if (clean.length > 0) return { status: "protected", rulesets: clean };
  if (hidden) return { status: "unknown", reason: hidden };
  return { status: "unapproved", rulesets: exact, unapproved };
}

/** Whether one ruleset, alone, protects the tags: it has the exact shape, and every bypass actor is an admin or approved. */
export function protects(ruleset, tagPattern, approved = []) {
  return assess({ rulesets: [ruleset], tagPattern, approved }).status === "protected";
}

/** The non-admin actors in the protecting rulesets that the approved list covers: what klaus.config.json must keep recording. */
export function approvalsInUse(result, approved) {
  const present = new Set((result.rulesets ?? []).flatMap((ruleset) => ruleset.bypass_actors.map((a) => keyOf(a.actor_type, a.actor_id))));
  return approved.filter((entry) => present.has(keyOf(entry.type, entry.id)));
}

/** The refusal for a ruleset that lets someone unapproved bypass it. Lists each one and says how to go on. */
export function unapprovedMessage(result, tagPattern) {
  const lines = result.unapproved.map(({ ruleset, actor }) => `  - ${describeActor(actor.type, actor.id)} (${actor.type} ${actor.id}, bypass ${actor.mode}) can bypass "${ruleset.name}" (id ${ruleset.id})${ruleset.url ? `: ${ruleset.url}` : ""}`);
  return [
    `The ruleset for tags matching ${tagPattern} has the shape Klaus needs, but it lets people or apps other than repository admins bypass it, so those people can still push release tags:`,
    ...lines,
    "Remove each one from the ruleset in GitHub, or approve it by name with --approve <Type>:<id>:<name> and record it in klaus.config.json under trigger.approvedTagBypass. Release mode stays off until then.",
  ].join("\n");
}

/**
 * Runs `gh api` from inside the repo. Returns the parsed JSON, or throws a UserError with gh's own words.
 * When gh printed an HTTP status, the error carries it as `httpStatus`.
 */
export function gh(repo, args, { input, run = spawnSync } = {}) {
  const result = run("gh", ["api", ...args], { cwd: repo, encoding: "utf8", input });
  if (result.error?.code === "ENOENT") throw new UserError("The gh command is not installed, so the repo cannot be read. Install it from https://cli.github.com and sign in.");
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const said = String(result.stderr || result.stdout).trim().split("\n")[0];
    const error = new UserError(`gh api ${args.find((arg) => arg.startsWith("repos/")) ?? args[0]} failed${said ? `: ${said}` : ""}`);
    error.httpStatus = Number(/HTTP (\d{3})/.exec(said)?.[1]) || undefined;
    throw error;
  }
  return result.stdout.trim() === "" ? null : JSON.parse(result.stdout);
}

/**
 * Reads the repo's tag rulesets in full and judges them (see assess).
 * unknown also covers rulesets that could not be read at all, for example without admin rights or on a plan without rulesets.
 */
export function checkRuleset({ repo, tagPattern, approved = [], run }) {
  assertReleasePattern(tagPattern);
  let summaries;
  try {
    summaries = gh(repo, ["repos/{owner}/{repo}/rulesets"], { run });
  } catch (error) {
    if (error instanceof UserError) return { status: "unknown", reason: error.message };
    throw error;
  }
  const full = [];
  try {
    for (const summary of summaries ?? []) {
      if (summary.target === "tag" && summary.enforcement === "active") full.push(gh(repo, [`repos/{owner}/{repo}/rulesets/${summary.id}`], { run }));
    }
  } catch (error) {
    if (error instanceof UserError) return { status: "unknown", reason: error.message };
    throw error;
  }
  return assess({ rulesets: full, tagPattern, approved });
}

/** Creates the ruleset. The caller has the person's yes. */
export function createRuleset({ repo, body, run }) {
  return gh(repo, ["--method", "POST", "repos/{owner}/{repo}/rulesets", "--input", "-"], { input: JSON.stringify(body), run });
}
