/**
 * Builds the repo's Storybook into a folder of static files.
 *
 * Storybook is built from the folder that holds `.storybook`. Klaus looks in the
 * repo root and in each inventory folder and the folders above it, so a monorepo
 * with Storybook in `packages/ui` is found from the inventory's `packages/ui/src`.
 * The `storybook` command must already be installed in that folder or above it.
 * Klaus does not install anything.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const toPosix = (p) => p.split(path.sep).join("/");

/** The folders an inventory lists, as paths. The inventory script writes objects, older files hold strings. */
function inventoryFolders(inventory) {
  const folders = Array.isArray(inventory?.folders) ? inventory.folders : [];
  return folders.map((f) => (typeof f === "string" ? f : f?.path)).filter((p) => typeof p === "string" && p !== "");
}

function isDirectory(dir) {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The folder that holds `.storybook`, relative to the repo root ("" for the root).
 * Each inventory folder is tried first, nearest folder first, then the root.
 * @param {{ root: string, inventory: object }} args
 * @returns {string | null}
 */
export function findStorybookDir({ root: given, inventory }) {
  const root = path.resolve(given);
  const candidates = [];
  for (const folder of inventoryFolders(inventory)) {
    let dir = path.resolve(root, folder);
    const relative = path.relative(root, dir);
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
    while (true) {
      candidates.push(dir);
      if (dir === root) break;
      dir = path.dirname(dir);
    }
  }
  candidates.push(root);
  const found = candidates.find((dir) => isDirectory(path.join(dir, ".storybook")));
  return found === undefined ? null : toPosix(path.relative(root, found));
}

/**
 * The `storybook` command that is installed for this folder: the nearest
 * `node_modules/.bin/storybook` between the folder and the repo root.
 * @returns {string | null}
 */
export function findStorybookBin({ root: given, dir: start }) {
  const root = path.resolve(given);
  let current = path.resolve(start);
  while (true) {
    const bin = path.join(current, "node_modules", ".bin", "storybook");
    if (existsSync(bin)) return bin;
    if (current === root || path.dirname(current) === current) return null;
    current = path.dirname(current);
  }
}

/**
 * Builds Storybook into `outDir`.
 * @param {object} args
 * @param {import("./exec.mjs").Exec} args.exec
 * @param {string} args.root        The repo root.
 * @param {string} args.storybookDir  From findStorybookDir, relative to the root.
 * @param {string} args.outDir
 */
export async function buildStorybook({ exec, root, storybookDir, outDir }) {
  const dir = path.resolve(root, storybookDir);
  const bin = findStorybookBin({ root, dir });
  if (!bin) {
    throw new Error(
      `The storybook command is not installed in ${storybookDir || "the repo root"} or above it. Install the repo's dependencies before the Klaus run.`,
    );
  }
  try {
    await exec(bin, ["build", "--output-dir", outDir, "--quiet", "--disable-telemetry"], { cwd: dir });
  } catch (error) {
    throw new Error(`storybook build failed: ${error.message}`);
  }
  if (!existsSync(path.join(outDir, "index.html"))) {
    throw new Error("storybook build finished but wrote no index.html.");
  }
}

/** Total size in bytes of every file under a folder. A symbolic link is skipped: its entry is neither a file nor a folder. */
export function directorySize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) total += directorySize(file);
    else if (entry.isFile()) total += statSync(file).size;
  }
  return total;
}
