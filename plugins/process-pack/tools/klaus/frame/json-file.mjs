import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { UserError } from "./errors.mjs";

/**
 * Reads and parses a JSON file. A syntax error reports the line and column
 * only, because the error text Node produces can quote the start of the file,
 * and the file may hold something that should not reach a log.
 * @param {string} file
 * @param {string} what  Used in messages, for example "Config".
 */
export function readJsonFile(file, what = "File") {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw new UserError(`${what} ${file} does not exist.`);
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    const where = /\(line \d+ column \d+\)/.exec(error.message)?.[0];
    throw new UserError(`${what} ${file} is not valid JSON${where ? ` ${where}` : ""}.`);
  }
}

/**
 * Writes a JSON file through a temporary file, so a crash cannot leave half a
 * file for the next reader. Creates the folder if it is missing.
 */
export function writeJsonFile(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(temp, file);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      // Keep the original error, which is the one that matters.
    }
    throw error;
  }
}
