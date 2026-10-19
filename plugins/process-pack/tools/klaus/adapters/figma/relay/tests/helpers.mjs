/** Shared setup for the relay's tests: a repo with generated code, and the relay run against stubs. */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAdapter } from "../../index.mjs";
import { buttonCapture } from "../../tests/helpers.mjs";

/** A made-up Figma file key, so no test can write to a real file. */
export const KEY = "KlausRelayTestFileKey0000";
export const RELAY = fileURLToPath(new URL("../relay.mjs", import.meta.url));
export const STUBS = fileURLToPath(new URL("./stub", import.meta.url));

const entry = (name, purpose = { useWhen: "", notFor: "", text: "" }) => ({
  name,
  kind: "shared",
  folder: "packages/ui",
  file: `packages/ui/${name}.tsx`,
  props: [],
  parts: [],
  // The recorded capture's own axes, so the unit matches it.
  variants: { variant: ["primary", "secondary", "destructive", "outline", "ghost", "link"], size: ["sm", "md", "lg"] },
  purpose,
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
/** A cap no test reaches unless it means to. At measured costs, the frame's default allows about one call. */
export const ROOMY = { outputs: { figma: { enabled: true, target: KEY } }, spendingCap: { maxRelayTokens: 10000000 } };

export async function generatedRepo({ components = ["Button", "Card"], perFile = 1, release = "v1.0.0", config = ROOMY, purpose } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "klaus-relay-"));
  if (config) writeFileSync(path.join(root, "klaus.config.json"), JSON.stringify(config));
  const ctx = {
    output: "figma",
    root,
    // The generator runs with the repo's own settings, as the relay reads them.
    settings: { ...config.outputs.figma, options: { ...config.outputs.figma.options, componentsPerCall: perFile } },
    selection: { componentGroups: [], screens: { mode: "none", routes: [] }, newComponents: { rule: "all", minUsage: 2 } },
    inventory: { schemaVersion: 1, folders: ["packages/ui"], entries: components.map((name) => entry(name, purpose)) },
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
export function relay(root, args, { scenarios = "success", mcp, ghSource, ghRun, ghCompare, otherRunLedger, names, resultText, message, otherRunMarks } = {}) {
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
  if (ghRun) env.STUB_GH_RUN = JSON.stringify(ghRun);
  if (ghCompare) env.STUB_GH_COMPARE = ghCompare;
  if (otherRunLedger) env.STUB_CODEX_OTHER_RUN_LEDGER = otherRunLedger;
  if (names !== undefined) env.STUB_CODEX_NAMES = JSON.stringify(names);
  if (resultText !== undefined) env.STUB_CODEX_RESULT_TEXT = resultText;
  if (message !== undefined) env.STUB_CODEX_MESSAGE = message;
  if (otherRunMarks !== undefined) env.STUB_CODEX_OTHER_RUN_MARKS = JSON.stringify(otherRunMarks);
  return new Promise((resolve) => {
    execFile(process.execPath, [RELAY, ...args, "--root", root, "--json"], { env, cwd: root, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      // A stub that made no call leaves no log folder, and a run that stopped early prints no report.
      const dir = path.join(log, "codex");
      const count = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".json")).length : 0;
      const calls = Array.from({ length: count }, (_, i) => ({
        args: JSON.parse(readFileSync(path.join(dir, `call-${i + 1}.json`), "utf8")).args,
        stdin: readFileSync(path.join(dir, `call-${i + 1}.stdin`)),
      }));
      let report = null;
      let reportError = null;
      if (stdout.trim() !== "") {
        try {
          report = JSON.parse(stdout);
        } catch (parseError) {
          reportError = parseError;
        }
      }
      // Every gh call, in order. The download is the call that starts with "run".
      const gh = existsSync(ghLog) ? readFileSync(ghLog, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
      resolve({ code: error ? error.code : 0, stdout, stderr, calls, report, reportError, gh });
    });
  });
}

export const ledgerOf = (root) => JSON.parse(readFileSync(path.join(root, ".klaus/figma/ledger.json"), "utf8"));
export const outputOf = (report) => report.outputs[0];

/**
 * A repo for reconcile: a config for the made-up file, and a ledger the Klaus plugin left behind,
 * which only the relay's reconcile mode reads. No generator ran, so there is no release folder.
 * @param {object} components  The ledger's components, for example { Button: { "1.0.0": "generated" } }.
 */
export function reconcileRepo({ components, screens = {}, options, config = ROOMY } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "klaus-reconcile-"));
  const figma = { ...config.outputs.figma, ...(options ? { options } : {}) };
  writeFileSync(path.join(root, "klaus.config.json"), JSON.stringify({ ...config, outputs: { figma } }));
  mkdirSync(path.join(root, ".klaus/figma"), { recursive: true });
  writeFileSync(path.join(root, ".klaus/figma/ledger.json"), JSON.stringify({ version: 2, components, screens }));
  return root;
}
