/**
 * Writes into a repo without following a symbolic link out of it.
 *
 * A repo can hold a link where Klaus expects a folder or a file (`scripts/klaus`, or
 * `.github/workflows/klaus.yml`). Writing through it would change a file somewhere
 * else, outside the repo. So every folder from the repo root down to the file, and
 * the file itself, must be a real folder or file, or not exist yet. A file is written
 * to a temporary name in its own folder and then renamed into place, so a half-written
 * file is never seen and a link that appears in between is replaced, not followed.
 */
import fs from "node:fs";
import path from "node:path";
import { UserError } from "../frame/errors.mjs";

const inside = (root, target) => {
  const relative = path.relative(root, target);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

/**
 * Throws unless target, a path below repo, is made only of real folders and a real file
 * (or of parts that do not exist yet), and whatever exists resolves inside the repo.
 * The repo folder itself may be a link: it is the base.
 */
export function assertPlainPath(repo, target) {
  const given = path.resolve(repo);
  const wanted = path.resolve(target);
  if (!inside(given, wanted)) throw new UserError(`${target} is not inside the repo.`);
  const root = fs.realpathSync(given);
  let current = root;
  for (const part of path.relative(given, wanted).split(path.sep)) {
    current = path.join(current, part);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code === "ENOENT") return wanted; // nothing below here exists, so nothing can be a link
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new UserError(`${path.relative(root, current)} is a symbolic link. Klaus will not write through it. Remove the link, or move the real folder into place, and run again.`);
    }
    if (!inside(root, fs.realpathSync(current))) throw new UserError(`${path.relative(root, current)} resolves outside the repo.`);
  }
  return wanted;
}

/** Every symbolic link below dir, as paths relative to it. */
export function linksBelow(dir) {
  const found = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) found.push(path.relative(dir, full));
      else if (entry.isDirectory()) walk(full);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return found;
}

/** Makes the folders on the way, one at a time, after checking each. */
export function mkdirPlain(repo, directory) {
  const wanted = assertPlainPath(repo, directory);
  fs.mkdirSync(wanted, { recursive: true });
  assertPlainPath(repo, directory);
  return wanted;
}

/**
 * Writes a file: to a temporary name in the same folder, then renamed over the destination.
 * @param {string} repo
 * @param {string} file   The destination, in the repo.
 * @param {string | Buffer} data
 */
export function writePlainFile(repo, file, data) {
  const wanted = assertPlainPath(repo, file);
  mkdirPlain(repo, path.dirname(wanted));
  const temporary = path.join(path.dirname(wanted), `.${path.basename(wanted)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temporary, data, { flag: "wx" });
    assertPlainPath(repo, wanted); // a link that appeared since the first check is refused here
    fs.renameSync(temporary, wanted);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return wanted;
}

/** Removes a file the repo holds, after checking the path to it. */
export function removePlainFile(repo, file) {
  const wanted = assertPlainPath(repo, file);
  fs.rmSync(wanted, { force: true });
}
