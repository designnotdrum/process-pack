/**
 * The Vercel calls the Storybook adapter makes, through the Vercel command line
 * (`npx vercel@64.5.0`). Nothing is installed: npx fetches the command.
 *
 * Each release is one deployment of the built Storybook. It carries metadata
 * (`vercel deploy --meta`) and one alias, and Vercel keeps a deployment that has
 * an alias. The version index is built from those deployments
 * (`vercel list --meta`), so the index needs no store of its own.
 *
 * The first deployment in a project is always made the production deployment
 * by Vercel, and `--target preview` does not change that (checked with CLI
 * 64.5.0 on 2026-10-18). With Vercel's default protection the production address
 * of a project is open to anyone, while preview deployments and their aliases ask
 * for a Vercel login. So in an empty project Klaus deploys an empty index first,
 * and the first release then lands as a protected preview deployment.
 *
 * The project must already exist (`vercel project create <name>`). `vercel deploy
 * --project` does not create one.
 */
import { createHash } from "node:crypto";

/** Metadata keys written on every deployment Klaus makes. */
export const META = Object.freeze({
  kind: "klausKind",
  release: "klausRelease",
  alias: "klausAlias",
  commit: "klausCommit",
});

/** Values of the `klausKind` metadata. */
export const KINDS = Object.freeze({ release: "storybook-release", index: "storybook-index" });

// Pinned, not "latest": the token is in the command's environment, and the parsers below read the
// JSON that this version prints (see fixtures/). Change the version on purpose, with the fixtures.
export const VERCEL_CLI_VERSION = "64.5.0";
const CLI = ["--yes", `vercel@${VERCEL_CLI_VERSION}`];
const PAGE_SIZE = 100;
const MAX_PAGES = 50;
const DNS_LABEL_MAX = 63;

/** Lower case letters and digits, with single dashes between them. */
export function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** A short stable tag for a name, used to keep a shortened alias unique. */
const shortHash = (text) => createHash("sha1").update(String(text)).digest("hex").slice(0, 6);

/**
 * The address of a release: `<project>-<release>.vercel.app`. A name is a DNS
 * label, so it is at most 63 characters. A longer one is cut and given a short
 * hash of the full name, so two long names stay different.
 */
export function aliasFor(project, release) {
  const full = `${slug(project)}-${slug(release)}`;
  const label = full.length <= DNS_LABEL_MAX ? full : `${full.slice(0, DNS_LABEL_MAX - 7).replace(/-+$/, "")}-${shortHash(full)}`;
  return `${label}.vercel.app`;
}

function parseJson(text, what) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${what} did not print JSON. It printed: ${String(text).trim().slice(0, 200) || "nothing"}`);
  }
}

const hostOf = (url) => String(url).replace(/^https?:\/\//, "").replace(/\/.*$/, "");

/**
 * @param {object} args
 * @param {import("./exec.mjs").Exec} args.exec
 * @param {string} args.token    A Vercel access token. It goes to the command in its environment, never in its arguments.
 * @param {string} args.project  The Vercel project name.
 * @param {string} [args.scope]  A team id or slug. Without it the token's own account is used.
 */
export function createVercel({ exec, token, project, scope }) {
  // The command links itself to a project from these two variables. A workflow that deploys the web
  // app sets them to the web app, so they are removed and the project is always named explicitly.
  const env = { ...process.env, VERCEL_TOKEN: token };
  delete env.VERCEL_ORG_ID;
  delete env.VERCEL_PROJECT_ID;
  let calls = 0;

  async function run(label, args) {
    calls += 1;
    const full = [...CLI, ...args, "--non-interactive", "--no-color", ...(scope ? ["--scope", scope] : [])];
    try {
      return await exec("npx", full, { env });
    } catch (error) {
      throw new Error(`${label} failed: ${error.message}`);
    }
  }

  return {
    /** How many Vercel commands have run. */
    calls: () => calls,

    /**
     * Deploys a folder of static files and waits until it is ready.
     * @param {string} dir
     * @param {{ meta: Record<string, string>, prod?: boolean }} options
     * @returns {Promise<{ id: string, url: string, productionUrl: string | null }>}
     */
    async deploy(dir, { meta, prod = false }) {
      const args = ["deploy", dir, "--project", project, "--yes", "--json"];
      if (prod) args.push("--prod");
      for (const [key, value] of Object.entries(meta)) args.push("--meta", `${key}=${value}`);
      const { stdout } = await run("vercel deploy", args);
      const deployment = parseJson(stdout, "vercel deploy").deployment;
      if (!deployment || typeof deployment.url !== "string" || deployment.readyState !== "READY") {
        throw new Error(`vercel deploy did not report a ready deployment (state: ${deployment?.readyState ?? "unknown"}).`);
      }
      return { id: deployment.id, url: deployment.url, productionUrl: deployment.productionUrl ?? null };
    },

    /** Points an address at a deployment. An address that already exists is moved to this deployment. */
    async alias(deploymentUrl, alias) {
      await run("vercel alias set", ["alias", "set", hostOf(deploymentUrl), alias]);
    },

    /** True when the project has at least one deployment of any kind. */
    async hasDeployments() {
      const { stdout } = await run("vercel list", ["list", project, "--json", "--limit", "1"]);
      return (parseJson(stdout, "vercel list").deployments ?? []).length > 0;
    },

    /**
     * Every ready release deployment in the project, newest first, one page at a time.
     * @returns {Promise<Array<{ release: string, alias: string | null, commit: string | null, createdAt: number }>>}
     */
    async listReleases() {
      const found = [];
      let next;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const args = ["list", project, "--json", "--status", "READY", "--limit", String(PAGE_SIZE), "--meta", `${META.kind}=${KINDS.release}`];
        if (next) args.push("--next", String(next));
        const { stdout } = await run("vercel list", args);
        const body = parseJson(stdout, "vercel list");
        for (const deployment of body.deployments ?? []) {
          const meta = deployment.meta ?? {};
          if (typeof meta[META.release] !== "string") continue;
          found.push({
            release: meta[META.release],
            alias: meta[META.alias] ?? null,
            commit: meta[META.commit] ?? null,
            createdAt: deployment.createdAt,
          });
        }
        next = body.pagination?.next;
        if (!next) return found;
      }
      // Fail instead of returning the pages read so far: an index built from part of the list would
      // quietly drop the older releases.
      throw new Error(`vercel list returned more than ${MAX_PAGES * PAGE_SIZE} release deployments.`);
    },
  };
}
