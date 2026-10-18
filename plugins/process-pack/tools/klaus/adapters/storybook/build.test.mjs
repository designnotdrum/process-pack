/** Finding and building the repo's Storybook. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildStorybook, directorySize, findStorybookBin, findStorybookDir } from "./build.mjs";

function repo(dirs) {
  const root = mkdtempSync(path.join(tmpdir(), "klaus-sb-repo-"));
  for (const dir of dirs) mkdirSync(path.join(root, dir), { recursive: true });
  return root;
}

test("finds .storybook above an inventory folder, as a monorepo package has it", () => {
  const root = repo(["packages/ui/.storybook", "packages/ui/src", "apps/web/app"]);
  const inventory = { folders: [{ path: "packages/ui/src", role: "shared" }, { path: "apps/web/app", role: "app" }] };
  assert.equal(findStorybookDir({ root, inventory }), "packages/ui");
});

test("reads inventory folders given as plain strings, and falls back to the repo root", () => {
  assert.equal(findStorybookDir({ root: repo(["packages/ui/.storybook"]), inventory: { folders: ["packages/ui"] } }), "packages/ui");
  assert.equal(findStorybookDir({ root: repo([".storybook", "src"]), inventory: { folders: ["src"] } }), "");
  assert.equal(findStorybookDir({ root: repo([".storybook"]), inventory: {} }), "");
});

test("returns null when there is no .storybook, and ignores a folder outside the repo", () => {
  const root = repo(["src"]);
  assert.equal(findStorybookDir({ root, inventory: { folders: ["src", "../elsewhere"] } }), null);
});

test("uses the storybook command nearest the Storybook folder, up to the repo root", () => {
  const root = repo(["node_modules/.bin", "packages/ui/node_modules/.bin"]);
  writeFileSync(path.join(root, "node_modules/.bin/storybook"), "");
  assert.equal(findStorybookBin({ root, dir: path.join(root, "packages/ui") }), path.join(root, "node_modules/.bin/storybook"));
  writeFileSync(path.join(root, "packages/ui/node_modules/.bin/storybook"), "");
  assert.equal(findStorybookBin({ root, dir: path.join(root, "packages/ui") }), path.join(root, "packages/ui/node_modules/.bin/storybook"));
  assert.equal(findStorybookBin({ root: repo(["packages/ui"]), dir: "x" }), null);
});

test("builds into the output folder from the Storybook folder, with telemetry off", async () => {
  const root = repo(["packages/ui/node_modules/.bin"]);
  writeFileSync(path.join(root, "packages/ui/node_modules/.bin/storybook"), "");
  const outDir = path.join(repo([]), "out");
  const calls = [];
  const exec = async (file, args, options) => {
    calls.push({ file, args, options });
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, "index.html"), "<html></html>");
    return { stdout: "", stderr: "" };
  };
  await buildStorybook({ exec, root, storybookDir: "packages/ui", outDir });

  assert.equal(calls[0].file, path.join(root, "packages/ui/node_modules/.bin/storybook"));
  assert.deepEqual(calls[0].args, ["build", "--output-dir", outDir, "--quiet", "--disable-telemetry"]);
  assert.equal(calls[0].options.cwd, path.join(root, "packages/ui"));
});

test("says what to do when storybook is not installed, and when the build writes nothing", async () => {
  const root = repo(["packages/ui"]);
  await assert.rejects(buildStorybook({ exec: async () => ({}), root, storybookDir: "packages/ui", outDir: "/tmp/none" }), /not installed in packages\/ui or above it/);

  writeFileSync(path.join(root, "packages/ui/storybook"), "");
  mkdirSync(path.join(root, "packages/ui/node_modules/.bin"), { recursive: true });
  writeFileSync(path.join(root, "packages/ui/node_modules/.bin/storybook"), "");
  await assert.rejects(
    buildStorybook({ exec: async () => ({}), root, storybookDir: "packages/ui", outDir: path.join(repo([]), "empty") }),
    /wrote no index.html/,
  );
  await assert.rejects(
    buildStorybook({ exec: async () => { throw new Error("Cannot find module vite"); }, root, storybookDir: "packages/ui", outDir: "/tmp/none" }),
    /storybook build failed: Cannot find module vite/,
  );
});

test("adds up the size of every file in the output", () => {
  const dir = repo(["a/b"]);
  writeFileSync(path.join(dir, "one.txt"), "12345");
  writeFileSync(path.join(dir, "a/two.txt"), "123");
  writeFileSync(path.join(dir, "a/b/three.txt"), "12");
  assert.equal(directorySize(dir), 10);
});
