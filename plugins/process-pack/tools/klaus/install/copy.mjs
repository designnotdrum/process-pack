/**
 * Copies Klaus into a repo, as `scripts/klaus/`, with a version line.
 *
 * The copy holds what runs: the frame, the inventory, the version picker, the
 * reuse check and the adapters, with the Figma plugin's built files. It leaves
 * out tests, fixtures, the lockfile, .gitignore, package.json (the folder runs with plain
 * node and installs nothing), the workflow template and this install folder.
 *
 * `VERSION.txt` is one line: the Klaus version, the process-pack version it came
 * from, and a short hash of the copied files. Re-running the step compares that
 * hash with the files on disk, so a hand edit is found before it is overwritten.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UserError } from "../frame/errors.mjs";
import { assertPlainPath, linksBelow, removePlainFile, writePlainFile } from "./safe-write.mjs";

/** The tools/klaus folder this script sits in. */
export const SOURCE_ROOT = fileURLToPath(new URL("..", import.meta.url));

const SKIP_DIRECTORIES = new Set(["test", "tests", "fixtures", "node_modules", "install", "templates"]);
const SKIP_FILES = new Set(["package.json", "pnpm-lock.yaml", ".gitignore"]);

/** A macOS folder note. It is never copied and never counts as an edit, in the source or the copy. */
const IGNORED = ".DS_Store";

/** Not VERSION: on a case-insensitive disk (macOS) that name is also the version/ folder. */
export const VERSION_FILE = "VERSION.txt";

/**
 * Files under root, as sorted repo-style paths. Links are not followed.
 * @param {string} root
 * @param {{ filter?: boolean }} [options]  filter false lists everything, as when checking an installed copy.
 */
export function listFiles(root, { filter = true } = {}) {
  const found = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const relative = directory === "" ? entry.name : `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!filter || !SKIP_DIRECTORIES.has(entry.name)) walk(relative);
      } else if (entry.isFile() && entry.name !== IGNORED) {
        if (!filter || !(SKIP_FILES.has(entry.name) || entry.name.endsWith(".test.mjs"))) found.push(relative);
      }
    }
  };
  walk("");
  return found.sort();
}

/** A short hash of file names and contents, so two folders with the same files give the same value. */
export function hashFiles(root, files) {
  const hash = createHash("sha256");
  for (const file of files) hash.update(`${file}\0`).update(fs.readFileSync(path.join(root, file))).update("\0");
  return hash.digest("hex").slice(0, 12);
}

function jsonField(file, field) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"))[field];
  } catch {
    value = undefined;
  }
  if (typeof value !== "string" || value === "") {
    throw new UserError(`Could not read "${field}" from ${file}. The version line records where a copy came from, so run this from process-pack's plugin folder.`);
  }
  return value;
}

/** The version line for a source folder. */
export function versionLine(source = SOURCE_ROOT) {
  const files = listFiles(source);
  const klaus = jsonField(path.join(source, "package.json"), "version");
  const pack = jsonField(path.join(source, "..", "..", ".claude-plugin", "plugin.json"), "version");
  return `klaus ${klaus} from process-pack ${pack}, files ${hashFiles(source, files)}`;
}

/**
 * Copies Klaus into repo/<to>.
 *
 * Refuses when the folder holds files this installer did not put there, or
 * holds a copy that was edited since, unless force is set. Files from an older
 * copy that the new one no longer has are removed.
 *
 * Refuses, with or without force, when the folder or any folder on the way to it, or any
 * file in it, is a symbolic link: a write through a link would change a file outside the repo.
 * Every file is written to a temporary name in its own folder and then renamed into place.
 *
 * @param {object} options
 * @param {string} options.repo
 * @param {string} [options.to]  Folder in the repo. Default scripts/klaus.
 * @param {boolean} [options.force]
 * @param {string} [options.source]
 * @returns {{ destination: string, line: string, previousLine: string | null, added: string[], changed: string[], removed: string[], unchanged: number }}
 */
export function copyKlaus({ repo, to = "scripts/klaus", force = false, source = SOURCE_ROOT }) {
  if (!fs.existsSync(repo) || !fs.statSync(repo).isDirectory()) throw new UserError(`The repo ${repo} does not exist.`);
  const destination = path.resolve(repo, to);
  const inside = path.relative(path.resolve(repo), destination);
  if (inside === "" || inside === ".." || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) {
    throw new UserError(`The folder ${to} is not inside the repo.`);
  }

  assertPlainPath(repo, destination);
  const links = linksBelow(destination);
  if (links.length > 0) {
    throw new UserError(`${to} holds symbolic links (${links.slice(0, 3).join(", ")}${links.length > 3 ? ", ..." : ""}). Klaus will not write through them. Remove the links and run again.`);
  }

  const files = listFiles(source);
  const line = versionLine(source);
  const existing = fs.existsSync(destination) ? listFiles(destination, { filter: false }) : [];
  let previousLine = null;

  if (existing.length > 0) {
    const versionPath = path.join(destination, VERSION_FILE);
    if (!existing.includes(VERSION_FILE)) {
      if (!force) throw new UserError(`${to} already holds files and has no ${VERSION_FILE} line, so Klaus did not put them there. Move them, or run again with --force.`);
    } else {
      previousLine = fs.readFileSync(versionPath, "utf8").trim();
      const recorded = /files ([0-9a-f]{12})$/.exec(previousLine)?.[1];
      const current = hashFiles(destination, existing.filter((f) => f !== VERSION_FILE));
      if (recorded !== current && !force) {
        throw new UserError(`${to} was edited after it was copied (its files hash to ${current}, ${VERSION_FILE} says ${recorded ?? "nothing"}). See \`git diff ${to}\`. Keep the edit upstream, or run again with --force to overwrite it.`);
      }
    }
  }

  const before = new Map(existing.map((file) => [file, fs.readFileSync(path.join(destination, file))]));
  const added = [];
  const changed = [];
  let unchanged = 0;
  for (const file of files) {
    const bytes = fs.readFileSync(path.join(source, file));
    const old = before.get(file);
    if (old === undefined) added.push(file);
    else if (!old.equals(bytes)) changed.push(file);
    else unchanged += 1;
  }
  const removed = existing.filter((file) => file !== VERSION_FILE && !files.includes(file));

  for (const file of removed) removePlainFile(repo, path.join(destination, file));
  // Folders the removal emptied go too, deepest first, so an old layout leaves nothing behind.
  const emptied = new Set(removed.map((file) => path.dirname(file)).filter((directory) => directory !== "."));
  for (const directory of [...emptied].sort((a, b) => b.length - a.length)) {
    let current = path.join(destination, directory);
    while (current !== destination && fs.existsSync(current) && fs.readdirSync(current).length === 0) {
      assertPlainPath(repo, current);
      fs.rmdirSync(current);
      current = path.dirname(current);
    }
  }
  for (const file of [...added, ...changed]) writePlainFile(repo, path.join(destination, file), fs.readFileSync(path.join(source, file)));
  writePlainFile(repo, path.join(destination, VERSION_FILE), `${line}\n`);
  return { destination, line, previousLine, added, changed, removed, unchanged };
}
