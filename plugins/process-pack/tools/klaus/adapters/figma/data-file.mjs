/**
 * Reads a data file: what one use_figma call writes, as data, with no code in it.
 *
 * The generator writes one per call (codegen.mjs dataFor). Whatever sends it to Figma (the relay,
 * and the Klaus Figma plugin) reads it here, checks its targets against the repo's own settings,
 * and builds the call's code with codegen.mjs codeFor, from the runtime in its own checkout. So an
 * artifact from CI supplies data and never code, and this one reader decides what data is allowed.
 *
 *   {
 *     "version": 1,
 *     "header": "Klaus Figma code, file 1 of 2: Button",
 *     "config": { "collection": "Tokens", "mode": "Light" },
 *     "tokens": [{ "name": "color/primary", "syntax": "hsl(var(--primary))", "rgba": [124, 58, 237, 1], "scopes": ["FRAME_FILL"] }],
 *     "units": [ component, screen and retain units, as spec.mjs and index.mjs build them, each with "tk" ]
 *   }
 *
 * readData refuses anything that is not that shape: unknown keys, wrong types, numbers out of
 * range, node and token indexes that point nowhere, and a header that is not one printable line.
 */
import { DATA_FILE_VERSION } from "./codegen.mjs";
import { MAX_CODE_CHARS, MODE_NAME, OLDER_VERSIONS_PAGE, SCREENS_PAGE } from "./settings.mjs";

export class DataError extends Error {}

/** The most a data file may hold. A call carries at most 50,000 characters of code, so data is well under this. */
const MAX_BYTES = 2 * MAX_CODE_CHARS;
const MAX_UNITS = 50;
/** The most values one variant property may have. */
export const MAX_AXIS_VALUES = 100;
const MAX_NODES = 20000;
const MAX_DEPTH = 64;
const VERSION = /^\d+(\.\d+)*([-+][0-9A-Za-z.-]+)?$/;
const NAME = /^[^\u0000-\u001f\u007f]{1,200}$/;
const SCOPE = /^[A-Z_]{1,40}$/;

const fail = (where, what) => {
  throw new DataError(`${where} ${what}`);
};
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function object(value, where, allowed) {
  if (!isObject(value)) fail(where, "must be an object.");
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(where, `has a key the generator does not write: ${JSON.stringify(key.slice(0, 40))}.`);
  return value;
}

function list(value, where, max) {
  if (!Array.isArray(value)) fail(where, "must be a list.");
  if (value.length > max) fail(where, `has more than ${max} entries.`);
  return value;
}

function text(value, where, max = 10000) {
  if (typeof value !== "string" || value.length > max) fail(where, `must be text of at most ${max} characters.`);
  return value;
}

function name(value, where) {
  if (typeof value !== "string" || !NAME.test(value)) fail(where, "must be a name of 1 to 200 characters, without control characters.");
  return value;
}

function number(value, where, min = -1e6, max = 1e6) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) fail(where, `must be a number from ${min} to ${max}.`);
  return value;
}

function whole(value, where, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) fail(where, `must be a whole number from ${min} to ${max}.`);
  return value;
}

function oneOf(value, values, where) {
  if (!values.includes(value)) fail(where, `must be one of ${values.map((v) => JSON.stringify(v)).join(", ")}.`);
  return value;
}

const flag = (value, where) => oneOf(value, [1], where);

/** A number, or a list of four: a side each. */
function sides(value, where) {
  if (Array.isArray(value)) {
    if (value.length !== 4) fail(where, "must be a number or a list of four.");
    value.forEach((v, i) => number(v, `${where}[${i}]`, 0));
  } else number(value, where, 0);
}

/** [token or -1, red, green, blue, alpha]. The token is an index into the unit's own token list. */
function paint(value, where, tokenCount) {
  if (!Array.isArray(value) || value.length !== 5) fail(where, "must be a colour: [token, red, green, blue, alpha].");
  whole(value[0], `${where}[0]`, -1, tokenCount - 1);
  for (let i = 1; i <= 3; i++) whole(value[i], `${where}[${i}]`, 0, 255);
  number(value[4], `${where}[4]`, 0, 1);
}

const BOX_KEYS = ["k", "n", "w", "h", "x", "y", "L", "pa", "ca", "g", "fw", "fh", "p", "f", "sw", "sc", "r", "o", "clip", "ap", "gw", "gh", "ef", "gr", "sg"];
const TEXT_KEYS = ["k", "v", "ff", "wt", "fs", "lh", "ls", "td", "tt", "c", "x", "y", "w", "wrap", "tr", "gw"];
const ICON_KEYS = ["k", "s", "w", "h", "x", "y", "hid", "n", "c", "ap", "o", "ef"];
const MAX_EFFECTS = 16;
const MAX_GRADIENTS = 16;
const MAX_STOPS = 64;

/** [kind, x, y, blur, spread, colour]: kind 0 a drop shadow, 1 an inner shadow, 2 a drop shadow drawn behind the node. */
function effects(value, where, tokenCount) {
  list(value, where, MAX_EFFECTS).forEach((effect, i) => {
    const at = `${where}[${i}]`;
    if (!Array.isArray(effect) || effect.length !== 6) fail(at, "must be an effect: [kind, x, y, blur, spread, colour].");
    whole(effect[0], `${at}[0]`, 0, 2);
    number(effect[1], `${at}[1]`, -10000, 10000);
    number(effect[2], `${at}[2]`, -10000, 10000);
    number(effect[3], `${at}[3]`, 0, 10000);
    number(effect[4], `${at}[4]`, -10000, 10000);
    paint(effect[5], `${at}[5]`, tokenCount);
  });
}

/** [kind, transform, stops]: kind 0 linear, 1 radial, the transform as six numbers, each stop [position, red, green, blue, alpha]. */
function gradients(value, where) {
  list(value, where, MAX_GRADIENTS).forEach((gradient, i) => {
    const at = `${where}[${i}]`;
    if (!Array.isArray(gradient) || gradient.length !== 3) fail(at, "must be a gradient: [kind, transform, stops].");
    whole(gradient[0], `${at}[0]`, 0, 1);
    if (!Array.isArray(gradient[1]) || gradient[1].length !== 6) fail(`${at}[1]`, "must be a transform of six numbers.");
    gradient[1].forEach((n, j) => number(n, `${at}[1][${j}]`));
    const stops = list(gradient[2], `${at}[2]`, MAX_STOPS);
    if (stops.length < 2) fail(`${at}[2]`, "must hold at least two stops.");
    stops.forEach((stop, j) => {
      if (!Array.isArray(stop) || stop.length !== 5) fail(`${at}[2][${j}]`, "must be a stop: [position, red, green, blue, alpha].");
      number(stop[0], `${at}[2][${j}][0]`, 0, 1);
      for (let c = 1; c <= 3; c++) whole(stop[c], `${at}[2][${j}][${c}]`, 0, 255);
      number(stop[4], `${at}[2][${j}][4]`, 0, 1);
    });
  });
}

function node(value, where, { tokenCount, svgCount }) {
  if (!isObject(value)) fail(where, "must be an object.");
  const kind = oneOf(value.k, ["b", "t", "v"], `${where}.k`);
  object(value, where, kind === "b" ? BOX_KEYS : kind === "t" ? TEXT_KEYS : ICON_KEYS);
  for (const key of ["x", "y"]) if (key in value) number(value[key], `${where}.${key}`);
  if (kind === "t") {
    text(value.v, `${where}.v`);
    name(value.ff, `${where}.ff`);
    number(value.wt, `${where}.wt`, 1, 1000);
    number(value.fs, `${where}.fs`, 0, 1000);
    number(value.lh, `${where}.lh`, 0, 2000);
    if ("ls" in value) number(value.ls, `${where}.ls`, -1000, 1000);
    if ("td" in value) oneOf(value.td, ["U"], `${where}.td`);
    if ("tt" in value) oneOf(value.tt, ["U"], `${where}.tt`);
    paint(value.c, `${where}.c`, tokenCount);
    if ("w" in value) number(value.w, `${where}.w`, 0);
    for (const key of ["wrap", "tr", "gw"]) if (key in value) flag(value[key], `${where}.${key}`);
    return;
  }
  number(value.w, `${where}.w`, 0);
  number(value.h, `${where}.h`, 0);
  if ("n" in value) name(value.n, `${where}.n`);
  if (kind === "v") {
    if (svgCount === 0) fail(`${where}.s`, "points at an SVG, and the unit has none.");
    whole(value.s, `${where}.s`, 0, svgCount - 1);
    if ("hid" in value) flag(value.hid, `${where}.hid`);
    if ("ap" in value) flag(value.ap, `${where}.ap`);
    if ("o" in value) number(value.o, `${where}.o`, 0, 1);
    if ("c" in value) paint(value.c, `${where}.c`, tokenCount);
    if ("ef" in value) effects(value.ef, `${where}.ef`, tokenCount);
    return;
  }
  if ("L" in value) oneOf(value.L, ["H", "V"], `${where}.L`);
  if ("pa" in value) oneOf(value.pa, ["C", "E", "B"], `${where}.pa`);
  if ("ca" in value) oneOf(value.ca, ["C", "E", "T"], `${where}.ca`);
  if ("g" in value) number(value.g, `${where}.g`, -10000, 10000);
  for (const key of ["fw", "fh", "clip", "ap", "gw", "gh"]) if (key in value) flag(value[key], `${where}.${key}`);
  if ("p" in value) {
    if (!Array.isArray(value.p) || value.p.length !== 4) fail(`${where}.p`, "must be a list of four.");
    value.p.forEach((v, i) => number(v, `${where}.p[${i}]`, 0));
  }
  if ("f" in value) paint(value.f, `${where}.f`, tokenCount);
  if ("sc" in value) paint(value.sc, `${where}.sc`, tokenCount);
  if ("sw" in value) sides(value.sw, `${where}.sw`);
  if ("r" in value) sides(value.r, `${where}.r`);
  if ("o" in value) number(value.o, `${where}.o`, 0, 1);
  if ("ef" in value) effects(value.ef, `${where}.ef`, tokenCount);
  if ("gr" in value) gradients(value.gr, `${where}.gr`);
  if ("sg" in value) gradients(value.sg, `${where}.sg`);
}

/** [node index, [child trees]], each index pointing at a node, no deeper than MAX_DEPTH. */
function tree(value, where, nodeCount, depth = 0) {
  if (depth > MAX_DEPTH) fail(where, `is nested more than ${MAX_DEPTH} deep.`);
  if (!Array.isArray(value) || value.length !== 2) fail(where, "must be [node, children].");
  whole(value[0], `${where}[0]`, 0, nodeCount - 1);
  list(value[1], `${where}[1]`, MAX_NODES).forEach((child, i) => tree(child, `${where}[1][${i}]`, nodeCount, depth + 1));
}

function drawing(unit, where, tokenCount) {
  list(unit.tk, `${where}.tk`, 1000).forEach((t, i) => whole(t, `${where}.tk[${i}]`, 0, tokenCount - 1));
  const svgs = list(unit.svgs, `${where}.svgs`, 100);
  svgs.forEach((svg, i) => {
    text(svg, `${where}.svgs[${i}]`, MAX_CODE_CHARS);
    if (!/^<svg[\s>]/i.test(svg)) fail(`${where}.svgs[${i}]`, "must be SVG markup.");
  });
  const nodes = list(unit.nodes, `${where}.nodes`, MAX_NODES);
  if (nodes.length === 0) fail(`${where}.nodes`, "must not be empty.");
  nodes.forEach((n, i) => node(n, `${where}.nodes[${i}]`, { tokenCount: unit.tk.length, svgCount: svgs.length }));
  return nodes.length;
}

function component(unit, where, tokenCount) {
  object(unit, where, ["kind", "id", "name", "version", "page", "older", "description", "axes", "iconProperty", "cells", "nodes", "svgs", "tk"]);
  name(unit.id, `${where}.id`);
  name(unit.name, `${where}.name`);
  if (typeof unit.version !== "string" || !VERSION.test(unit.version)) fail(`${where}.version`, "must be a version such as 1.2.0.");
  name(unit.page, `${where}.page`);
  name(unit.older, `${where}.older`);
  text(unit.description, `${where}.description`);
  const axes = list(unit.axes, `${where}.axes`, 10);
  axes.forEach((axis, i) => {
    object(axis, `${where}.axes[${i}]`, ["name", "values"]);
    name(axis.name, `${where}.axes[${i}].name`);
    list(axis.values, `${where}.axes[${i}].values`, MAX_AXIS_VALUES).forEach((v, j) => name(v, `${where}.axes[${i}].values[${j}]`));
  });
  oneOf(unit.iconProperty, [0, 1], `${where}.iconProperty`);
  const nodeCount = drawing(unit, where, tokenCount);
  const cells = list(unit.cells, `${where}.cells`, 256);
  if (cells.length === 0) fail(`${where}.cells`, "must not be empty.");
  cells.forEach((cell, i) => {
    if (!Array.isArray(cell) || cell.length !== 2 || !Array.isArray(cell[0]) || cell[0].length !== axes.length) fail(`${where}.cells[${i}]`, "must be [axis values, tree].");
    cell[0].forEach((v, j) => whole(v, `${where}.cells[${i}][0][${j}]`, 0, axes[j].values.length - 1));
    tree(cell[1], `${where}.cells[${i}][1]`, nodeCount);
  });
}

function screen(unit, where, tokenCount) {
  object(unit, where, ["kind", "id", "route", "release", "page", "keep", "width", "height", "tree", "nodes", "svgs", "tk"]);
  name(unit.id, `${where}.id`);
  if (typeof unit.route !== "string" || !NAME.test(unit.route) || !unit.route.startsWith("/")) fail(`${where}.route`, "must be a route such as /settings.");
  name(unit.release, `${where}.release`);
  if (/\s/.test(unit.release)) fail(`${where}.release`, "must be one word.");
  name(unit.page, `${where}.page`);
  whole(unit.keep, `${where}.keep`, 1, 1000);
  number(unit.width, `${where}.width`, 1, 100000);
  number(unit.height, `${where}.height`, 1, 100000);
  tree(unit.tree, `${where}.tree`, drawing(unit, where, tokenCount));
}

function retain(unit, where) {
  object(unit, where, ["kind", "id", "page", "keep", "routes", "tk"]);
  name(unit.id, `${where}.id`);
  name(unit.page, `${where}.page`);
  whole(unit.keep, `${where}.keep`, 1, 1000);
  list(unit.routes, `${where}.routes`, 1000).forEach((route, i) => {
    if (typeof route !== "string" || !NAME.test(route) || !route.startsWith("/")) fail(`${where}.routes[${i}]`, "must be a route such as /settings.");
  });
  list(unit.tk, `${where}.tk`, 0);
}

/**
 * Parses and checks a data file.
 * @param {string | Buffer} source  The file's text.
 * @param {string} [label]  Names the file in messages.
 * @returns {{ version: number, header: string, config: { collection: string, mode: string }, tokens: object[], units: object[] }}
 * @throws {DataError} when it is not JSON or not the generator's shape.
 */
export function readData(source, label = "The data file") {
  const raw = String(source);
  if (raw.length > MAX_BYTES) throw new DataError(`${label} is larger than ${MAX_BYTES} characters.`);
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new DataError(`${label} is not JSON.`);
  }
  object(data, label, ["version", "header", "config", "tokens", "units"]);
  if (data.version !== DATA_FILE_VERSION) fail(label, `is version ${JSON.stringify(data.version)}, not ${DATA_FILE_VERSION}.`);
  if (typeof data.header !== "string" || !/^[\x20-\x7e]{0,200}$/.test(data.header)) fail(`${label} header`, "must be one line of printable ASCII.");
  object(data.config, `${label} config`, ["collection", "mode"]);
  name(data.config.collection, `${label} config.collection`);
  name(data.config.mode, `${label} config.mode`);
  const tokens = list(data.tokens, `${label} tokens`, 1000);
  tokens.forEach((token, i) => {
    const where = `${label} tokens[${i}]`;
    object(token, where, ["name", "syntax", "rgba", "scopes"]);
    name(token.name, `${where}.name`);
    text(token.syntax, `${where}.syntax`, 500);
    if (!Array.isArray(token.rgba) || token.rgba.length !== 4) fail(`${where}.rgba`, "must be [red, green, blue, alpha].");
    for (let c = 0; c < 3; c++) whole(token.rgba[c], `${where}.rgba[${c}]`, 0, 255);
    number(token.rgba[3], `${where}.rgba[3]`, 0, 1);
    list(token.scopes, `${where}.scopes`, 20).forEach((scope, j) => {
      if (typeof scope !== "string" || !SCOPE.test(scope)) fail(`${where}.scopes[${j}]`, "must be a Figma variable scope.");
    });
  });
  const units = list(data.units, `${label} units`, MAX_UNITS);
  if (units.length === 0) fail(`${label} units`, "must not be empty.");
  const ids = new Set();
  units.forEach((unit, i) => {
    const where = `${label} units[${i}]`;
    if (!isObject(unit)) fail(where, "must be an object.");
    const kind = oneOf(unit.kind, ["component", "screen", "retain"], `${where}.kind`);
    if (kind === "component") component(unit, where, tokens.length);
    else if (kind === "screen") screen(unit, where, tokens.length);
    else retain(unit, where);
    if (ids.has(unit.id)) fail(where, `repeats the id ${JSON.stringify(unit.id)}.`);
    ids.add(unit.id);
  });
  return data;
}

/**
 * Checks where a data file writes against the repo's own settings, so an artifact cannot pick
 * another variable collection or another page.
 *
 * @param {object} data  From readData.
 * @param {{ collectionName: string, page: string }} options  The repo's outputs.figma.options, from readOptions.
 * @param {string} [label]
 * @throws {DataError}
 */
export function checkTargets(data, options, label = "The data file") {
  const collection = options.collectionName;
  if (data.config.collection !== collection || data.config.mode !== MODE_NAME) {
    fail(label, `writes to the variable collection ${JSON.stringify(data.config.collection)} (${data.config.mode}), but the settings name ${JSON.stringify(collection)} (${MODE_NAME}).`);
  }
  data.units.forEach((unit, i) => {
    const where = `${label} units[${i}] (${unit.id})`;
    if (unit.kind === "component") {
      const page = options.page === "" ? unit.name : options.page;
      if (unit.page !== page) fail(where, `writes to the page ${JSON.stringify(unit.page)}, but the settings put it on ${JSON.stringify(page)}.`);
      if (unit.older !== OLDER_VERSIONS_PAGE) fail(where, `moves earlier versions to ${JSON.stringify(unit.older)}, not ${JSON.stringify(OLDER_VERSIONS_PAGE)}.`);
      if (unit.page === OLDER_VERSIONS_PAGE || unit.page === SCREENS_PAGE) fail(where, `cannot be drawn on the ${JSON.stringify(unit.page)} page.`);
    } else if (unit.page !== SCREENS_PAGE) {
      fail(where, `writes to the page ${JSON.stringify(unit.page)}, not ${JSON.stringify(SCREENS_PAGE)}.`);
    }
  });
}
