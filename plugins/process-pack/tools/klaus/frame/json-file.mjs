import { readFileSync } from "node:fs";
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
