/**
 * Writes the text of one code file: three constants, then the runtime.
 *
 * A file is plain Plugin API code that use_figma can run as it is. It starts
 * with the colour tokens its units use, then the units (component sets and
 * screens) as data, then runtime.js, which builds them.
 */
import { readFileSync } from "node:fs";

const RUNTIME = readFileSync(new URL("./runtime.js", import.meta.url), "utf8");

/** Drops comments, indentation and blank lines from the runtime. The code is read by Figma, not by people. */
export function compact(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("//"))
    .join("\n");
}

export const RUNTIME_CODE = compact(RUNTIME);

/** JSON that carries only ASCII, so the character count is the same in every encoding. */
export function asciiJson(value) {
  return JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/**
 * The tokens the units share, and for each unit where its own tokens sit in that list.
 * A token used as a fill by one unit and as text by another keeps both scopes.
 */
export function mergeTokens(units) {
  const merged = new Map();
  const maps = units.map((unit) =>
    unit.tokens.map((token) => {
      if (!merged.has(token.name)) merged.set(token.name, { name: token.name, syntax: token.syntax, rgba: token.rgba, scopes: new Set() });
      for (const scope of token.scopes) merged.get(token.name).scopes.add(scope);
      return [...merged.keys()].indexOf(token.name);
    }),
  );
  return { tokens: [...merged.values()].map((t) => ({ ...t, scopes: [...t.scopes] })), maps };
}

/** The data file format's version. data-file.mjs reads this format. */
export const DATA_FILE_VERSION = 1;

/**
 * The data of one call: what a data file holds. It is plain JSON and holds no code.
 *
 * @param {object} args
 * @param {object[]} args.units     Units from spec.mjs, or retention units.
 * @param {{ collection: string, mode: string }} args.config
 * @param {string} args.header      One line that says which file this is.
 */
export function dataFor({ units, config, header }) {
  const { tokens, maps } = mergeTokens(units);
  const body = units.map(({ tokens: _tokens, warnings: _warnings, ...unit }, i) => ({ ...unit, tk: maps[i] }));
  return { version: DATA_FILE_VERSION, header, config, tokens, units: body };
}

/**
 * The code of one call: the data as three constants, then the runtime from this checkout. Every
 * value is written as JSON, and the header must be one line of printable ASCII (data-file.mjs
 * checks it), so no part of the data can become code.
 */
export function codeFor(data) {
  if (!/^[\x20-\x7e]*$/.test(data.header)) throw new Error("A file header must be one line of printable ASCII.");
  return [
    `// ${data.header}`,
    `const CONFIG = ${asciiJson(data.config)};`,
    `const TOKENS = ${asciiJson(data.tokens)};`,
    `const UNITS = ${asciiJson(data.units)};`,
    RUNTIME_CODE,
    "",
  ].join("\n");
}

/** The code for one file of units. */
export function renderFile(args) {
  return codeFor(dataFor(args));
}
