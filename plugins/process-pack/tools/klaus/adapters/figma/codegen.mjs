/**
 * Writes the text of one call's code: the data as constants, then the runtime.
 *
 * The code is plain Plugin API code that use_figma can run as it is. It starts
 * with the colour tokens its units use, then the units (component sets and
 * screens) as data, then runtime.js, which builds them.
 *
 * The relay builds it with a key, so every piece of text from the data reaches
 * the relaying model as noise it cannot read (see codeFor). The Klaus Figma
 * plugin builds it without one, because no model reads what a plugin runs.
 */
import { randomBytes } from "node:crypto";
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
 * True when text can go in a template literal and read back the same: printable ASCII, tabs and
 * line breaks, and no backtick, backslash or "${", which are the only things a template literal treats
 * as code or escapes.
 */
export function templateSafe(text) {
  return /^[\x20-\x7e\n\t]*$/.test(text) && !text.includes("`") && !text.includes("\\") && !text.includes("${");
}

/**
 * The code of one call: the data as constants, then the runtime from this checkout. Every value is
 * written as JSON, except SVG markup, and the header must be one line of printable ASCII
 * (data-file.mjs checks it), so no part of the data can become code.
 *
 * SVG markup is full of double quotes, which JSON writes as backslash-quote. A model copying the
 * code into use_figma tends to drop backslashes (gpt-5.6-terra dropped all 46 in one call on
 * 2026-10-18), so markup that templateSafe allows goes in SVGS as a template literal, and the unit
 * keeps its index. Other markup stays a JSON string. The runtime holds no backslash either.
 *
 * @param {object} data  From dataFor, or from data-file.mjs readData.
 * @param {{ key?: number[] }} [options]  With a key, the relay's code: every string encoded (encodedCode).
 *   Without one, plain code for the Klaus Figma plugin, which no model reads.
 */
export function codeFor(data, { key } = {}) {
  if (key !== undefined) return encodedCode(data, key);
  if (!/^[\x20-\x7e]*$/.test(data.header)) throw new Error("A file header must be one line of printable ASCII.");
  const svgs = [];
  const units = data.units.map((unit) => {
    if (!Array.isArray(unit.svgs)) return unit;
    return { ...unit, svgs: unit.svgs.map((svg) => (templateSafe(svg) ? svgs.push(svg) - 1 : svg)) };
  });
  return [
    `// ${data.header}`,
    "const KEY = null;",
    `const CONFIG = ${asciiJson(data.config)};`,
    `const TOKENS = ${asciiJson(data.tokens)};`,
    `const UNITS = ${asciiJson(units)};`,
    `const SVGS = [${svgs.map((svg) => `\`${svg}\``).join(",")}];`,
    RUNTIME_CODE,
    "",
  ].join("\n");
}

/** Bytes in a key. */
export const KEY_BYTES = 32;

/** A new random key, for one call. */
export const newKey = () => [...randomBytes(KEY_BYTES)];

/**
 * The key a file is sized with. Encoded text has the same length under every key, but the key's
 * own line is longest when every byte has three digits, so this gives the most a call can come to.
 */
export const SIZING_KEY = Object.freeze(Array.from({ length: KEY_BYTES }, () => 255));

/**
 * Data fields whose values the runtime branches on. data-file.mjs holds each to a few fixed
 * values, such as "component" or "H", so they carry no text and stay plain. The runtime's
 * decoder keeps the same list.
 */
export const PLAIN_FIELDS = Object.freeze(["kind", "k", "L", "pa", "ca", "td", "tt"]);

/** Text as its UTF-8 bytes XORed with the key, in base64. */
export function encodeText(text, key) {
  const bytes = Buffer.from(text, "utf8");
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= key[i % key.length];
  return bytes.toString("base64");
}

/** The inverse of encodeText. The runtime has its own copy, without Buffer. */
export function decodeText(encoded, key) {
  const bytes = Buffer.from(encoded, "base64");
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= key[i % key.length];
  return bytes.toString("utf8");
}

/** A value with every string encoded, except those of PLAIN_FIELDS. field is the key the value sits under. */
function encodeStrings(value, key, field) {
  if (typeof value === "string") return PLAIN_FIELDS.includes(field) ? value : encodeText(value, key);
  if (Array.isArray(value)) return value.map((item) => encodeStrings(item, key, field));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, encodeStrings(item, key, name)]));
  }
  return value;
}

function checkKey(key) {
  if (!Array.isArray(key) || key.length !== KEY_BYTES || key.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) {
    throw new Error(`A key must be ${KEY_BYTES} bytes.`);
  }
}

/**
 * The code of one call for the relay: every string from the data encoded with key (encodeText),
 * and the key in the code as KEY, so the runtime can decode the data before it uses any of it.
 * Text in a data file (a description, a button's words, SVG markup, a name) could be written to
 * steer the model that copies the code into use_figma. Encoded, the model sees base64 noise.
 * The header is fixed, because a file's header lists its units by name.
 *
 * The result goes back the same way. With a KEY the runtime encodes every string it returns (unit
 * names, the names of sets moved to Older versions, warnings, error messages) with the same key,
 * except the values of a status field, and the relay decodes it (relay/events.mjs decodeResult).
 * The model keeps the result in its context, and a name in the Figma file could steer it.
 */
function encodedCode(data, key) {
  checkKey(key);
  return [
    "// Klaus Figma code",
    `const KEY = [${key.join(",")}];`,
    `const CONFIG = ${asciiJson(encodeStrings(data.config, key, ""))};`,
    `const TOKENS = ${asciiJson(encodeStrings(data.tokens, key, ""))};`,
    `const UNITS = ${asciiJson(encodeStrings(data.units, key, ""))};`,
    "const SVGS = [];",
    RUNTIME_CODE,
    "",
  ].join("\n");
}

/** The code for one file of units, plain. */
export function renderFile(args) {
  return codeFor(dataFor(args));
}
