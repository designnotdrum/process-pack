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

/**
 * The code for one file.
 *
 * @param {object} args
 * @param {object[]} args.units     Units from spec.mjs, or retention units.
 * @param {{ collection: string, mode: string }} args.config
 * @param {string} args.header      One line that says which file this is.
 */
export function renderFile({ units, config, header }) {
  const { tokens, maps } = mergeTokens(units);
  const body = units.map(({ tokens: _tokens, warnings: _warnings, ...unit }, i) => ({ ...unit, tk: maps[i] }));
  return [
    `// ${header}`,
    `const CONFIG = ${asciiJson(config)};`,
    `const TOKENS = ${asciiJson(tokens)};`,
    `const UNITS = ${asciiJson(body)};`,
    RUNTIME_CODE,
    "",
  ].join("\n");
}
