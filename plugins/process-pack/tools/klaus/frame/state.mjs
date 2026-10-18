/**
 * The state file: what Klaus recorded at the end of its last runs.
 *
 * One entry per output, so an output that failed, or was switched on later,
 * covers its own range of releases:
 *
 *   {
 *     "version": 1,
 *     "outputs": {
 *       "storybook": { "lastRelease": "v1.4.0", "lastRunAt": "2026-10-18T06:00:00.000Z", "unwritten": ["Card"] }
 *     }
 *   }
 *
 * "unwritten" holds the ids a run planned and did not write, whether the cap
 * deferred them or the write failed. The next run hands them back to the plan.
 */
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { UserError } from "./errors.mjs";

export const STATE_VERSION = 1;

export function emptyState() {
  return { version: STATE_VERSION, outputs: {} };
}

function assertShape(state, file) {
  const bad = (why) => new UserError(`${file} is not a Klaus state file (${why}). Delete it to start again from the newest release.`);
  if (!state || typeof state !== "object" || state.version !== STATE_VERSION) throw bad("wrong version");
  if (!state.outputs || typeof state.outputs !== "object") throw bad("no outputs");
  for (const [name, entry] of Object.entries(state.outputs)) {
    if (typeof entry !== "object" || entry === null) throw bad(`${name} is not an object`);
    if (entry.lastRelease !== undefined && typeof entry.lastRelease !== "string") throw bad(`${name}.lastRelease`);
    if (entry.lastRunAt !== undefined && typeof entry.lastRunAt !== "string") throw bad(`${name}.lastRunAt`);
    if (!Array.isArray(entry.unwritten) || entry.unwritten.some((id) => typeof id !== "string")) throw bad(`${name}.unwritten`);
  }
}

/** Reads the state file. A missing file is a first run and gives an empty state. */
export function readState(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return emptyState();
    throw error;
  }
  let state;
  try {
    state = JSON.parse(text);
  } catch {
    throw new UserError(`${file} is not valid JSON. Delete it to start again from the newest release.`);
  }
  assertShape(state, file);
  return state;
}

/** Writes the state file through a temporary file so a crash cannot leave half a file. */
export function writeState(file, state) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`);
  try {
    renameSync(temp, file);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      // Keep the rename error, which is the one that matters.
    }
    throw error;
  }
}
