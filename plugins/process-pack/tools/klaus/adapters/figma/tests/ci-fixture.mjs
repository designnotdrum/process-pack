/**
 * The Figma generator as CI runs it: the frame's runner, the default spending cap, a fake browser
 * that draws every component as Meridian's Button, and a repo folder of its own. Shared by the
 * tests of the shared record and of the first load.
 */
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveConfig, runKlaus } from "../../../frame/index.mjs";
import { createAdapter } from "../index.mjs";
import { buttonCapture } from "./helpers.mjs";

/** A made-up Figma file key. */
export const KEY = "zSRhsvwtutOIPvHyWF9Wf2";
export const RELEASE = "release/2026-10-19";

const browser = {
  async openStorybook() {
    return { entries: [], async close() {} };
  },
  async captureComponent() {
    return buttonCapture();
  },
};

/** An inventory entry used in `usage` files, with the Button's 18 variants. */
export const entry = (name, usage) => ({
  name,
  kind: "shared",
  folder: "packages/ui",
  file: `packages/ui/${name}.tsx`,
  props: [],
  parts: [],
  variants: { variant: ["primary", "secondary", "destructive", "outline", "ghost", "link"], size: ["sm", "md", "lg"] },
  purpose: { useWhen: "", notFor: "", text: "" },
  version: "1.0.0",
  screenshot: "",
  usedIn: Array.from({ length: usage }, (_, i) => `apps/web/screen-${i}.tsx`),
});

/** An inventory of the named components, the first used most. */
export const inventoryOf = (names) => ({ schemaVersion: 1, folders: ["packages/ui"], entries: names.map((name, i) => entry(name, names.length - i)) });

export const newRepo = () => mkdtempSync(path.join(tmpdir(), "klaus-figma-ci-"));

/**
 * One Klaus run in the repo, as the workflow's Run Klaus step makes it: a manual trigger, the
 * default spending cap, and env standing in for the step's environment.
 * @returns {Promise<{ report: object, state: object, output: object }>}
 */
export async function ciRun(root, { inventory, state, env = {}, firstLoad, dryRun = false }) {
  const config = resolveConfig({ outputs: { figma: { enabled: true, target: KEY } } });
  const figma = createAdapter(browser, { env });
  const cwd = process.cwd();
  // The adapter works in the folder it runs in, as in CI.
  process.chdir(root);
  try {
    const { report, state: next } = await runKlaus({ config, inventory, adapters: { figma }, releases: [RELEASE], trigger: "manual", state, env, firstLoad, dryRun });
    return { report, state: next, output: report.outputs[0] };
  } finally {
    process.chdir(cwd);
  }
}

/** The manifest the run left, and the ids of the units in its data files. */
export function manifestIn(root) {
  const folder = path.join(root, ".klaus/figma", RELEASE.replace(/[^A-Za-z0-9._-]+/g, "_"));
  const manifest = JSON.parse(readFileSync(path.join(folder, "manifest.json"), "utf8"));
  const dataFiles = readdirSync(folder).filter((name) => /^figma-\d+\.json$/.test(name));
  const units = dataFiles.flatMap((name) => JSON.parse(readFileSync(path.join(folder, name), "utf8")).units.map((unit) => unit.id));
  return { manifest, dataFiles, units };
}

/** The shared record the relay publishes, marking the named components' 1.0.0 with status. */
export const sharedRecord = (names, { status = "sent", fileKey = KEY } = {}) =>
  JSON.stringify({ version: 2, fileKey, components: Object.fromEntries(names.map((name) => [name, { "1.0.0": status }])), screens: {} });
