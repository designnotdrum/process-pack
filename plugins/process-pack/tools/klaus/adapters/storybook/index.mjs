/**
 * The Storybook adapter. It builds the repo's Storybook, deploys it to Vercel
 * as one static deployment per release with its own address, and regenerates a
 * version index that links every release. See README.md in this folder.
 *
 * What the four steps do:
 *
 *   plan      one item, the newest release covered. Finds the Storybook folder. No network.
 *   estimate  the Vercel calls, and the deployment storage the release adds each month.
 *   write     builds, deploys, gives the deployment its address, redeploys the index.
 *   report    the index and release addresses, and the storage cost.
 *
 * Storybook shows every component that has a story. It ignores the design-tool
 * selection in klaus.config.json (component groups, screens, new components).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildStorybook, directorySize, findStorybookDir } from "./build.mjs";
import { exec as defaultExec } from "./exec.mjs";
import { latestPerRelease, renderIndex } from "./index-page.mjs";
import { aliasFor, createVercel, KINDS, META } from "./vercel.mjs";

/**
 * Vercel's price for deployment storage. From the Klaus Storybook hosting
 * research (NJM-1770), which cites Vercel's Deployment Storage page. Not
 * re-checked against Vercel's billing.
 */
export const STORAGE_USD_PER_GB_MONTH = 0.1;

/**
 * The size of one built Storybook that the estimate assumes, in bytes, because
 * the estimate runs before anything is built. It is the budget from the same
 * research, set above its 12 to 15 MB measurement. The report gives the real size.
 */
export const ASSUMED_BUILD_BYTES = 15_000_000;

// Per release: one deploy and one alias. Per run: two lists and one index deploy. The first run in an
// empty project makes one more call, for the empty index.
const CALLS_PER_RELEASE = 2;
const CALLS_PER_RUN = 3;

const storageUsdPerMonth = (bytes) => (bytes / 1e9) * STORAGE_USD_PER_GB_MONTH;

function money(usd) {
  return `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`;
}

/** Writes the index files into a new folder and returns their total size in bytes. */
function writeIndexFiles(dir, files) {
  mkdirSync(dir);
  let size = 0;
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), content);
    size += Buffer.byteLength(content);
  }
  return size;
}

function megabytes(bytes) {
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

/**
 * @param {object} [deps]  Replaced by tests.
 * @param {import("./exec.mjs").Exec} [deps.exec]
 * @param {() => string} [deps.cwd]  The repo root. The command line runs from it.
 * @param {() => Date} [deps.now]
 * @returns {import("../../frame/adapter.mjs").Adapter}
 */
export function createStorybookAdapter({ exec = defaultExec, cwd = () => process.cwd(), now = () => new Date() } = {}) {
  /** What write learned about each item, read back by report. Keyed by the run's context, then by item id. */
  const outcomes = new WeakMap();

  function projectOf(ctx) {
    const project = ctx.settings.target;
    if (typeof project !== "string" || project === "") {
      throw new Error('The storybook output needs a "target" in klaus.config.json: the name of its Vercel project.');
    }
    return project;
  }

  function secret(ctx, name) {
    const value = ctx.secret(name); // Throws, naming the secret, when it is not listed under secrets.
    if (!value) throw new Error(`${name} is not set in the environment.`);
    return value;
  }

  return {
    name: "storybook",
    usesModel: false,

    plan(ctx) {
      projectOf(ctx);
      if (!ctx.release) return { items: [] };
      const storybookDir = findStorybookDir({ root: cwd(), inventory: ctx.inventory });
      if (storybookDir === null) {
        throw new Error(
          "No .storybook folder was found in the repo root or in the inventory folders and the folders above them. Storybook is built from the folder that holds .storybook.",
        );
      }
      // One checkout builds one Storybook, so only the newest release can be built. Earlier releases
      // covered by this run are not given a deployment of their own, and report says which.
      return { items: [{ id: ctx.release, kind: "screen", release: ctx.release, storybookDir }] };
    },

    estimate(plan) {
      return {
        items: plan.items.map((item) => ({ id: item.id, calls: CALLS_PER_RELEASE, usd: storageUsdPerMonth(ASSUMED_BUILD_BYTES) })),
        // The index is a few kilobytes, which costs nothing worth reporting.
        overhead: { calls: CALLS_PER_RUN },
      };
    },

    async write(plan, ctx) {
      const root = cwd();
      const project = projectOf(ctx);
      const token = secret(ctx, "VERCEL_TOKEN");
      const scope = ctx.settings.secrets.includes("VERCEL_ORG_ID") ? secret(ctx, "VERCEL_ORG_ID") : undefined;
      const vercel = createVercel({ exec, token, project, scope });

      let commit;
      try {
        commit = (await exec("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim() || undefined;
      } catch {
        commit = undefined; // The index shows no commit for this release.
      }

      const written = [];
      const failed = [];
      let bytes = 0; // Storage that Vercel keeps: a build counts once it is deployed.
      for (const item of plan.items) {
        const work = mkdtempSync(path.join(tmpdir(), "klaus-storybook-"));
        const outcome = { release: item.release, alias: aliasFor(project, item.release), commit };
        if (!outcomes.has(ctx)) outcomes.set(ctx, new Map());
        outcomes.get(ctx).set(item.id, outcome);
        try {
          const buildDir = path.join(work, "build");
          await buildStorybook({ exec, root, storybookDir: item.storybookDir, outDir: buildDir });
          outcome.buildBytes = directorySize(buildDir);

          // Vercel makes the first deployment of a project its open production deployment, so an empty
          // project gets an empty index first and the release then lands as a protected preview.
          if (!(await vercel.hasDeployments())) {
            const empty = renderIndex({ project, releases: [] });
            const emptyDir = path.join(work, "empty");
            writeIndexFiles(emptyDir, empty);
            await vercel.deploy(emptyDir, { meta: { [META.kind]: KINDS.index }, prod: true });
          }

          // Two release names can make the same address ("v1.0.0" and "v1-0-0"). Deploying the second
          // would move the address away from the first, so stop before that happens.
          const listed = await vercel.listReleases();
          const taken = listed.find((entry) => entry.release !== item.release && (entry.alias ?? aliasFor(project, entry.release)) === outcome.alias);
          if (taken) throw new Error(`The address ${outcome.alias} already belongs to release ${taken.release}, so ${item.release} cannot use it.`);

          const meta = { [META.kind]: KINDS.release, [META.release]: item.release, [META.alias]: outcome.alias };
          if (commit) meta[META.commit] = commit;
          const deployed = await vercel.deploy(buildDir, { meta });
          bytes += outcome.buildBytes; // Kept on Vercel from here on, even if a later step fails.
          await vercel.alias(deployed.url, outcome.alias);
          outcome.releaseUrl = `https://${outcome.alias}/`;

          // The list was read before this release was deployed, so it is added by hand.
          const releases = latestPerRelease([...listed, { release: item.release, alias: outcome.alias, commit: commit ?? null, createdAt: now().getTime() }]);
          const files = renderIndex({ project, releases });
          const indexDir = path.join(work, "index");
          const indexBytes = writeIndexFiles(indexDir, files);
          const index = await vercel.deploy(indexDir, { meta: { [META.kind]: KINDS.index }, prod: true });
          outcome.indexUrl = index.productionUrl ?? index.url;
          outcome.releaseCount = releases.length;
          bytes += indexBytes;
          written.push(item.id);
        } catch (error) {
          failed.push({ id: item.id, error: error.message });
        } finally {
          rmSync(work, { recursive: true, force: true });
        }
      }
      return { written, failed, actual: { calls: vercel.calls(), tokens: 0, usd: storageUsdPerMonth(bytes) } };
    },

    report(outcome, ctx) {
      const project = projectOf(ctx);
      const release = ctx.release;
      const found = outcomes.get(ctx)?.get(release);
      const notDeployed = [...new Set([...ctx.releases, ...ctx.unwrittenFromLastRun])].filter((r) => r !== release);
      const details = {
        project,
        release,
        alias: found?.alias ?? null,
        commit: found?.commit ?? null,
        buildBytes: found?.buildBytes ?? null,
        assumedBuildBytes: ASSUMED_BUILD_BYTES,
        storageUsdPerGbMonth: STORAGE_USD_PER_GB_MONTH,
        releasesInIndex: found?.releaseCount ?? null,
        notDeployed,
      };

      const links = [];
      if (found?.indexUrl) links.push({ label: "Version index", url: found.indexUrl });
      if (found?.releaseUrl) links.push({ label: `Storybook ${release}`, url: found.releaseUrl });

      const rate = `${money(STORAGE_USD_PER_GB_MONTH)} per GB-month`;
      let summary;
      if (!release) {
        summary = "There was no release to deploy.";
      } else if (outcome.dryRun) {
        summary = `Would deploy Storybook for ${release} to the Vercel project ${project}. The release would add about ${money(outcome.estimated.usd)} a month in deployment storage, for an assumed ${megabytes(ASSUMED_BUILD_BYTES)} at ${rate}.`;
      } else if (outcome.written.length > 0) {
        summary = `Deployed Storybook for ${release} to the Vercel project ${project}. The release adds about ${money(outcome.actual?.usd ?? 0)} a month in deployment storage, for ${megabytes(found?.buildBytes ?? 0)} at ${rate}.`;
      } else if (outcome.failed.length > 0) {
        summary = `Storybook for ${release} was not deployed: ${outcome.failed[0].error}`;
      } else {
        summary = "No Storybook release was deployed.";
      }
      if (notDeployed.length > 0) {
        summary += ` One checkout builds one Storybook, so ${notDeployed.join(", ")} did not get a deployment of its own.`;
      }
      return { summary, links, details };
    },
  };
}

export default createStorybookAdapter();
