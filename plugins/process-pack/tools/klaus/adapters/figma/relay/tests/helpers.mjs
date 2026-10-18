/** Shared setup for the relay's tests: a repo with generated code, and the relay run against stubs. */
import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAdapter } from "../../index.mjs";
import { buttonCapture } from "../../tests/helpers.mjs";

export const KEY = "zSRhsvwtutOIPvHyWF9Wf2";
export const RELAY = fileURLToPath(new URL("../relay.mjs", import.meta.url));
export const STUBS = fileURLToPath(new URL("./stub", import.meta.url));

const entry = (name) => ({
  name,
  kind: "shared",
  folder: "packages/ui",
  file: `packages/ui/${name}.tsx`,
  props: [],
  parts: [],
  // The recorded capture's own axes, so the unit matches it.
  variants: { variant: ["primary", "secondary", "destructive", "outline", "ghost", "link"], size: ["sm", "md", "lg"] },
  purpose: { useWhen: "", notFor: "", text: "" },
  version: "1.0.0",
  usedIn: ["a.tsx"],
});

const browser = {
  async openStorybook() {
    return { entries: [], async close() {} };
  },
  async captureComponent() {
    return buttonCapture();
  },
};

/**
 * A repo with the generator's output for one release: one code file per component unless
 * perFile says otherwise. Returns the repo, the release folder and the manifest.
 */
export async function generatedRepo({ components = ["Button", "Card"], perFile = 1, release = "v1.0.0", config } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "klaus-relay-"));
  if (config) writeFileSync(path.join(root, "klaus.config.json"), JSON.stringify(config));
  const ctx = {
    output: "figma",
    root,
    settings: { enabled: true, target: KEY, options: { page: "Relay test", componentsPerCall: perFile } },
    selection: { componentGroups: [], screens: { mode: "none", routes: [] }, newComponents: { rule: "all", minUsage: 2 } },
    inventory: { schemaVersion: 1, folders: ["packages/ui"], entries: components.map(entry) },
    trigger: "manual",
    release,
    releases: [release],
    unwrittenFromLastRun: [],
    dryRun: false,
    secret() {},
  };
  const figma = createAdapter(browser);
  await figma.write(await figma.plan(ctx), ctx);
  const folder = path.join(root, ".klaus/figma", release);
  const manifest = JSON.parse(readFileSync(path.join(folder, "manifest.json"), "utf8"));
  return { root, folder, manifest, plan: () => figma.plan(ctx) };
}

/**
 * Runs the relay as a command, with the stub codex and gh first on PATH.
 * @returns {Promise<{ code: number, stdout: string, stderr: string, calls: Array<{ args: string[], stdin: Buffer }>, report: object | null }>}
 */
export function relay(root, args, { scenarios = "success", mcp, ghSource } = {}) {
  const log = mkdtempSync(path.join(tmpdir(), "klaus-relay-log-"));
  const ghLog = path.join(log, "gh.json");
  const env = {
    ...process.env,
    PATH: `${STUBS}${path.delimiter}${process.env.PATH}`,
    STUB_CODEX_LOG: path.join(log, "codex"),
    STUB_CODEX_SCENARIOS: scenarios,
    STUB_GH_LOG: ghLog,
  };
  if (mcp !== undefined) env.STUB_CODEX_MCP = JSON.stringify(mcp);
  if (ghSource) env.STUB_GH_SOURCE = ghSource;
  return new Promise((resolve) => {
    execFile(process.execPath, [RELAY, ...args, "--root", root, "--json"], { env, cwd: root }, (error, stdout, stderr) => {
      let calls = [];
      try {
        const dir = path.join(log, "codex");
        const count = readdirSync(dir).filter((name) => name.endsWith(".json")).length;
        calls = Array.from({ length: count }, (_, i) => ({
          args: JSON.parse(readFileSync(path.join(dir, `call-${i + 1}.json`), "utf8")).args,
          stdin: readFileSync(path.join(dir, `call-${i + 1}.stdin`)),
        }));
      } catch {
        calls = [];
      }
      let report = null;
      try {
        report = JSON.parse(stdout);
      } catch {
        report = null;
      }
      let gh = null;
      try {
        gh = JSON.parse(readFileSync(ghLog, "utf8"));
      } catch {
        gh = null;
      }
      resolve({ code: error ? error.code : 0, stdout, stderr, calls, report, gh });
    });
  });
}

export const ledgerOf = (root) => JSON.parse(readFileSync(path.join(root, ".klaus/figma/ledger.json"), "utf8"));
export const outputOf = (report) => report.outputs[0];
