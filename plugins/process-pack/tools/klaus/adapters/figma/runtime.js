/**
 * The part of every generated code file that is the same each time.
 *
 * codegen.mjs puts four constants in front of this text and sends the result
 * to Figma:
 *   CONFIG  { collection, mode }
 *   TOKENS  the colour variables the units in this file use
 *   UNITS   the component sets and screens to write, as built by spec.mjs
 *   SVGS    SVG markup, as template literals; a unit's svgs list holds indexes into it
 *   KEY     null, or the key the relay encoded every string of the data with
 *
 * With a KEY, every string in CONFIG, TOKENS and UNITS is base64 of its UTF-8
 * bytes XORed with the key, except the fields in PLAIN_FIELDS. decodeData turns
 * them back before anything else runs, so the rest of this file sees plain data.
 *
 * This file is not run by Node. It is plain JavaScript for the Figma Plugin API
 * and it avoids newer syntax on purpose. It uses top-level await and return,
 * which use_figma allows. It never switches the current page, because a call
 * may switch only once and the person may be looking at it.
 *
 * Pages it touches: the page each unit names (a component's page, or Screens)
 * and Older versions, found or created by name. It touches no other page. Figma
 * creates every new node on the current page, so each node is appended to its
 * parent in the same step it is created, with no await in between, and never
 * stays on the current page. The variables it writes are in CONFIG.collection.
 *
 * Nothing is overwritten. A set that already exists is left alone and reported
 * as "exists". A set that fails is removed again and reported as "failed", and
 * the units after it still run.
 */

const WEIGHT_STYLES = {
  100: ["Thin"],
  200: ["ExtraLight", "Extra Light"],
  300: ["Light"],
  400: ["Regular"],
  500: ["Medium"],
  600: ["SemiBold", "Semi Bold"],
  700: ["Bold"],
  800: ["ExtraBold", "Extra Bold"],
  900: ["Black"],
};
const PRIMARY = { C: "CENTER", E: "MAX", B: "SPACE_BETWEEN" };
const COUNTER = { C: "CENTER", E: "MAX", T: "BASELINE" };
// The code holds no backslash: a model copying it into use_figma tends to drop them.
const VERSION = /^[0-9]+([.][0-9]+)*([-+][0-9A-Za-z.-]+)?$/;
const DIGITS = /^[0-9]+$/;
const NEWLINE = String.fromCharCode(10);
// The same list as codegen.mjs PLAIN_FIELDS.
const PLAIN_FIELDS = ["kind", "k", "L", "pa", "ca", "td", "tt"];
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const warnings = [];
const loadedFonts = {};
let fontStyles = null;
let VARIABLES = [];
const PENDING = [];

function note(text) {
  if (warnings.indexOf(text) < 0) warnings.push(text);
}

async function fontFor(family, weight) {
  if (fontStyles === null) {
    fontStyles = {};
    const all = await figma.listAvailableFontsAsync();
    for (const f of all) {
      if (!fontStyles[f.fontName.family]) fontStyles[f.fontName.family] = [];
      fontStyles[f.fontName.family].push(f.fontName.style);
    }
  }
  let used = family;
  if (!fontStyles[family]) {
    used = "Inter";
    note("The font " + family + " is not in this file, so Inter is used.");
  }
  const styles = fontStyles[used] || ["Regular"];
  const wanted = WEIGHT_STYLES[Math.round(weight / 100) * 100] || ["Regular"];
  let style = wanted.find(function (s) { return styles.indexOf(s) >= 0; });
  if (!style) {
    style = styles.indexOf("Regular") >= 0 ? "Regular" : styles[0];
    note(used + " has no " + wanted[0] + " style, so " + style + " is used.");
  }
  const font = { family: used, style: style };
  const key = used + "/" + style;
  if (!loadedFonts[key]) {
    await figma.loadFontAsync(font);
    loadedFonts[key] = true;
  }
  return font;
}

async function ensureTokens() {
  const made = [];
  const updated = [];
  if (TOKENS.length === 0) return { made: made, updated: updated };
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  let collection = collections.find(function (c) { return c.name === CONFIG.collection; });
  if (!collection) {
    collection = figma.variables.createVariableCollection(CONFIG.collection);
    collection.renameMode(collection.modes[0].modeId, CONFIG.mode);
  }
  const mode = (collection.modes.find(function (m) { return m.name === CONFIG.mode; }) || collection.modes[0]).modeId;
  const existing = await figma.variables.getLocalVariablesAsync("COLOR");
  VARIABLES = TOKENS.map(function (t) {
    const value = { r: t.rgba[0] / 255, g: t.rgba[1] / 255, b: t.rgba[2] / 255, a: t.rgba[3] };
    let variable = existing.find(function (v) { return v.name === t.name && v.variableCollectionId === collection.id; });
    if (!variable) {
      variable = figma.variables.createVariable(t.name, collection, "COLOR");
      variable.setValueForMode(mode, value);
      variable.scopes = t.scopes;
      variable.setVariableCodeSyntax("WEB", t.syntax);
      made.push(t.name);
      return variable;
    }
    // Variables hold the app's current tokens, so a changed colour is written through. It waits until
    // every unit has run, because a version that moves to Older versions is frozen at the colours it
    // shipped with, and those are the variable's colours until this write.
    const old = variable.valuesByMode[mode];
    const moved = !old || Math.abs(old.r - value.r) > 0.002 || Math.abs(old.g - value.g) > 0.002 || Math.abs(old.b - value.b) > 0.002 || Math.abs((old.a === undefined ? 1 : old.a) - value.a) > 0.002;
    if (moved) {
      PENDING.push({ variable: variable, mode: mode, value: value });
      updated.push(t.name);
    }
    const scopes = variable.scopes.filter(function (s) { return s !== "ALL_SCOPES"; });
    t.scopes.forEach(function (s) { if (scopes.indexOf(s) < 0) scopes.push(s); });
    variable.scopes = scopes;
    return variable;
  });
  return { made: made, updated: updated };
}

/** A paint without its variable binding, in the colour the variable has now. */
function plainPaint(paint) {
  if (!paint.boundVariables || !paint.boundVariables.color) return paint;
  const copy = Object.assign({}, paint);
  delete copy.boundVariables;
  return copy;
}

/**
 * Freezes a set that is moving to Older versions: every bound fill and stroke, on the set and
 * on everything inside it, becomes the plain colour it has at this moment. The set keeps looking
 * the way it shipped when a token changes later. The note says so on its description.
 */
function freeze(root, shipped) {
  const nodes = [root].concat(root.findAll(function () { return true; }));
  nodes.forEach(function (node) {
    ["fills", "strokes"].forEach(function (key) {
      const paints = node[key];
      if (!Array.isArray(paints)) return;
      if (paints.some(function (p) { return p.boundVariables && p.boundVariables.color; })) node[key] = paints.map(plainPaint);
    });
  });
  const note = "Frozen when " + shipped + " shipped; colours are the values at that time.";
  root.description = root.description ? root.description + NEWLINE + note : note;
}

function paintOf(U, c) {
  const base = { type: "SOLID", color: { r: c[1] / 255, g: c[2] / 255, b: c[3] / 255 } };
  const variable = c[0] >= 0 ? VARIABLES[U.tk[c[0]]] : null;
  const bound = variable ? figma.variables.setBoundVariableForPaint(base, "color", variable) : base;
  return c[4] < 1 ? Object.assign({}, bound, { opacity: c[4] }) : bound;
}

async function makeText(U, n, parent) {
  const t = figma.createText();
  parent.appendChild(t);
  t.fontName = await fontFor(n.ff, n.wt);
  t.characters = n.v;
  t.fontSize = n.fs;
  t.lineHeight = { unit: "PIXELS", value: n.lh };
  t.letterSpacing = { unit: "PIXELS", value: n.ls || 0 };
  if (n.td) t.textDecoration = "UNDERLINE";
  if (n.tt) t.textCase = "UPPER";
  t.fills = [paintOf(U, n.c)];
  if (n.wrap) {
    t.resize(Math.max(n.w, 1), t.height);
    t.textAutoResize = "HEIGHT";
  } else {
    t.textAutoResize = "WIDTH_AND_HEIGHT";
  }
  return t;
}

function makeIcon(U, n, parent) {
  // codegen.mjs moves SVG markup into SVGS and leaves its index here, unless the markup cannot go in a template literal.
  const svg = typeof U.svgs[n.s] === "number" ? SVGS[U.svgs[n.s]] : U.svgs[n.s];
  const icon = figma.createNodeFromSvg(svg);
  parent.appendChild(icon);
  // Figma gives the frame around the drawing a white fill, which shows as a square behind the icon.
  icon.fills = [];
  icon.name = n.n || "Icon";
  if (Math.abs(icon.width - n.w) > 0.5 || Math.abs(icon.height - n.h) > 0.5) icon.resize(Math.max(n.w, 1), Math.max(n.h, 1));
  if (n.c) {
    // Draw the icon in the colour given, whatever colour the story drew it in.
    const paint = paintOf(U, n.c);
    icon.findAll(function (x) { return x.type !== "FRAME" && "strokes" in x; }).forEach(function (x) {
      if (x.strokes.length > 0) x.strokes = [paint];
      if (x.fills.length > 0) x.fills = [paint];
    });
  }
  if (n.hid) icon.visible = false;
  return icon;
}

async function fillBox(U, tree, f) {
  const n = U.nodes[tree[0]];
  f.name = n.n || "box";
  f.fills = n.f ? [paintOf(U, n.f)] : [];
  f.strokes = n.sc ? [paintOf(U, n.sc)] : [];
  if (n.sc) {
    f.strokeAlign = "INSIDE";
    if (Array.isArray(n.sw)) {
      f.strokeTopWeight = n.sw[0];
      f.strokeRightWeight = n.sw[1];
      f.strokeBottomWeight = n.sw[2];
      f.strokeLeftWeight = n.sw[3];
    } else {
      f.strokeWeight = n.sw;
    }
  }
  if (Array.isArray(n.r)) {
    f.topLeftRadius = n.r[0];
    f.topRightRadius = n.r[1];
    f.bottomRightRadius = n.r[2];
    f.bottomLeftRadius = n.r[3];
  } else {
    f.cornerRadius = n.r || 0;
  }
  f.opacity = n.o === undefined ? 1 : n.o;
  f.clipsContent = !!n.clip;
  if (n.L) {
    f.layoutMode = n.L === "V" ? "VERTICAL" : "HORIZONTAL";
    f.itemSpacing = n.g || 0;
    const p = n.p || [0, 0, 0, 0];
    f.paddingTop = p[0];
    f.paddingRight = p[1];
    f.paddingBottom = p[2];
    f.paddingLeft = p[3];
    f.primaryAxisAlignItems = PRIMARY[n.pa] || "MIN";
    f.counterAxisAlignItems = COUNTER[n.ca] || "MIN";
    if (n.sc) f.strokesIncludedInLayout = true;
  }
  for (const child of tree[1]) {
    const node = await makeNode(U, child, f);
    const c = U.nodes[child[0]];
    if (!n.L && c.x !== undefined) {
      node.x = c.x;
      node.y = c.y;
    }
  }
  f.resize(Math.max(n.w, 1), Math.max(n.h, 1));
  if (n.L) {
    const column = n.L === "V";
    f.primaryAxisSizingMode = (column ? n.fh : n.fw) ? "FIXED" : "AUTO";
    f.counterAxisSizingMode = (column ? n.fw : n.fh) ? "FIXED" : "AUTO";
  }
  return f;
}

/** Makes a node inside parent. It is appended before anything else happens to it. */
async function makeNode(U, tree, parent) {
  const n = U.nodes[tree[0]];
  if (n.k === "t") return makeText(U, n, parent);
  if (n.k === "v") return makeIcon(U, n, parent);
  const frame = figma.createFrame();
  parent.appendChild(frame);
  return fillBox(U, tree, frame);
}

function parseVersion(node, name) {
  if (node.type !== "COMPONENT_SET" && node.type !== "COMPONENT") return null;
  if (node.name.indexOf(name + " ") !== 0) return null;
  const version = node.name.slice(name.length + 1);
  return VERSION.test(version) ? version : null;
}

/** The part of a version after its first dash and before any build tag, or null. */
function preRelease(version) {
  const found = /^[^-+]*-([^+]*)/.exec(version);
  return found ? found[1].split(".") : null;
}

function compareVersions(a, b) {
  const left = a.split(/[-+]/)[0].split(".").map(Number);
  const right = b.split(/[-+]/)[0].split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const d = (left[i] || 0) - (right[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  // The same numbers: a pre-release is lower than the release, and tags compare part by part.
  const pa = preRelease(a);
  const pb = preRelease(b);
  if (!pa && !pb) return 0;
  if (!pa) return 1;
  if (!pb) return -1;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1;
    if (pb[i] === undefined) return 1;
    const x = DIGITS.test(pa[i]);
    const y = DIGITS.test(pb[i]);
    if (x && y && Number(pa[i]) !== Number(pb[i])) return Number(pa[i]) < Number(pb[i]) ? -1 : 1;
    if (x !== y) return x ? -1 : 1;
    if (!x && pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

function message(e) {
  return String(e && e.message ? e.message : e);
}

/** The page with this name, loaded, or null when the file has none. */
async function findPage(name) {
  const page = figma.root.children.find(function (p) { return p.name === name; });
  if (page) await page.loadAsync();
  return page || null;
}

async function pageNamed(name) {
  const found = await findPage(name);
  if (found) return found;
  const page = figma.createPage();
  page.name = name;
  return page;
}

function freeX(nodes) {
  let right = -80;
  for (const n of nodes) right = Math.max(right, n.x + n.width);
  return right + 80;
}

function freeY(page) {
  let bottom = -120;
  for (const n of page.children) bottom = Math.max(bottom, n.y + n.height);
  return bottom + 120;
}

async function buildSet(U, page, created) {
  const name = U.name + " " + U.version;
  const parts = [];
  for (const cell of U.cells) {
    const component = figma.createComponent();
    page.appendChild(component);
    created.push(component);
    await fillBox(U, cell[1], component);
    component.name = U.axes.map(function (a, i) { return a.name + "=" + a.values[cell[0][i]]; }).join(", ");
    if (U.iconProperty) {
      const icon = component.children.find(function (c) { return c.name === "Icon"; });
      if (icon) icon.componentPropertyReferences = { visible: component.addComponentProperty("Show icon", "BOOLEAN", false) };
    }
    parts.push({ component: component, at: cell[0] });
  }
  if (U.axes.length === 0) {
    const only = parts[0].component;
    only.name = name;
    only.description = U.description;
    return only;
  }
  const set = figma.combineAsVariants(parts.map(function (p) { return p.component; }), page);
  created.push(set);
  set.name = name;
  set.description = U.description;
  // Rows are the first axis. Columns run through the other axes, the last one fastest.
  const rest = U.axes.slice(1);
  const column = function (at) {
    if (U.axes.length === 1) return at[0];
    let index = 0;
    for (let i = 0; i < rest.length; i++) index = index * rest[i].values.length + at[i + 1];
    return index;
  };
  const row = function (at) { return U.axes.length === 1 ? 0 : at[0]; };
  const widths = {};
  const heights = {};
  for (const p of parts) {
    widths[column(p.at)] = Math.max(widths[column(p.at)] || 0, p.component.width);
    heights[row(p.at)] = Math.max(heights[row(p.at)] || 0, p.component.height);
  }
  const xs = {};
  const ys = {};
  let x = 24;
  Object.keys(widths).map(Number).sort(function (a, b) { return a - b; }).forEach(function (c) { xs[c] = x; x += widths[c] + 32; });
  let y = 24;
  Object.keys(heights).map(Number).sort(function (a, b) { return a - b; }).forEach(function (r) { ys[r] = y; y += heights[r] + 16; });
  for (const p of parts) {
    p.component.x = xs[column(p.at)];
    p.component.y = ys[row(p.at)];
  }
  set.resizeWithoutConstraints(x - 32 + 24, y - 16 + 24);
  return set;
}

async function writeComponent(U) {
  const created = [];
  try {
    const page = await pageNamed(U.page);
    const older = await findPage(U.older);
    const label = U.name + " " + U.version;
    const clash = page.children.concat(older ? older.children : []).some(function (n) { return n.name === label; });
    if (clash) return { id: U.id, status: "exists", name: label };
    const siblings = page.children.filter(function (n) { return parseVersion(n, U.name) !== null; });
    siblings.sort(function (a, b) { return compareVersions(parseVersion(a, U.name), parseVersion(b, U.name)); });
    const newest = siblings.length > 0 ? siblings[siblings.length - 1] : null;
    const latest = newest === null || compareVersions(U.version, parseVersion(newest, U.name)) > 0;
    // Where it goes is worked out before the set is on the page, so the set does not count itself.
    const x = newest ? newest.x : freeX(page.children);
    const y = newest ? newest.y : 0;
    const node = await buildSet(U, page, created);
    const moved = [];
    let archive = older;
    if (latest) {
      for (const old of siblings) {
        archive = archive || (await pageNamed(U.older));
        const at = freeX(archive.children);
        freeze(old, U.version);
        archive.appendChild(old);
        old.x = at;
        old.y = 0;
        moved.push(old.name);
      }
      page.appendChild(node);
      node.x = x;
      node.y = y;
    } else {
      archive = archive || (await pageNamed(U.older));
      const at = freeX(archive.children);
      freeze(node, parseVersion(newest, U.name));
      archive.appendChild(node);
      node.x = at;
      node.y = 0;
    }
    return {
      id: U.id,
      status: "written",
      name: label,
      nodeId: node.id,
      variants: node.type === "COMPONENT_SET" ? node.children.length : 1,
      page: latest ? U.page : U.older,
      movedToOlder: moved,
    };
  } catch (e) {
    for (const n of created.slice().reverse()) {
      try { n.remove(); } catch (ignored) { /* already gone with its set */ }
    }
    return { id: U.id, status: "failed", error: message(e) };
  }
}

function screenKey(name) {
  return name.slice(0, name.lastIndexOf(" "));
}

/** Removes the oldest frames of one screen until `keep` are left. Newest frames are last on the page. */
function trimScreen(page, route, keep) {
  const frames = page.children.filter(function (n) { return n.type === "FRAME" && screenKey(n.name) === route; });
  const gone = [];
  while (frames.length > keep) {
    const old = frames.shift();
    gone.push(old.name);
    old.remove();
  }
  return gone;
}

async function writeScreen(U) {
  const created = [];
  try {
    const page = await pageNamed(U.page);
    const name = U.route + " " + U.release;
    if (page.children.some(function (n) { return n.name === name; })) return { id: U.id, status: "exists", name: name };
    // Where it goes is worked out before the frame is on the page, so the frame does not count itself.
    const earlier = page.children.filter(function (n) { return n.type === "FRAME" && screenKey(n.name) === U.route; });
    const x = earlier.length > 0 ? freeX(earlier) : 0;
    const y = earlier.length > 0 ? earlier[0].y : freeY(page);
    const frame = figma.createFrame();
    page.appendChild(frame);
    created.push(frame);
    await fillBox(U, U.tree, frame);
    frame.name = name;
    frame.clipsContent = true;
    frame.x = x;
    frame.y = y;
    const removed = trimScreen(page, U.route, U.keep);
    return { id: U.id, status: "written", name: name, nodeId: frame.id, removed: removed };
  } catch (e) {
    for (const n of created) {
      try { n.remove(); } catch (ignored) { /* already gone */ }
    }
    return { id: U.id, status: "failed", error: message(e) };
  }
}

async function retainScreens(U) {
  try {
    const page = await pageNamed(U.page);
    const removed = [];
    for (const route of U.routes) removed.push.apply(removed, trimScreen(page, route, U.keep));
    return { id: U.id, status: "written", removed: removed };
  } catch (e) {
    return { id: U.id, status: "failed", error: message(e) };
  }
}

/** The text one encoded string holds: base64 to bytes, XOR with KEY, UTF-8 to text. */
function decodeText(encoded) {
  const bytes = [];
  let value = 0;
  let bits = 0;
  for (let i = 0; i < encoded.length; i++) {
    const digit = BASE64.indexOf(encoded.charAt(i));
    if (digit < 0) continue;
    value = (value << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 255);
      value = value & ((1 << bits) - 1);
    }
  }
  for (let i = 0; i < bytes.length; i++) bytes[i] = bytes[i] ^ KEY[i % KEY.length];
  let text = "";
  let i = 0;
  while (i < bytes.length) {
    const first = bytes[i];
    let size = 1;
    let point = first;
    if (first >= 240) { size = 4; point = first & 7; } else if (first >= 224) { size = 3; point = first & 15; } else if (first >= 192) { size = 2; point = first & 31; }
    for (let j = 1; j < size; j++) point = (point << 6) | (bytes[i + j] & 63);
    i += size;
    if (point > 65535) {
      point -= 65536;
      text += String.fromCharCode(55296 + (point >> 10), 56320 + (point & 1023));
    } else {
      text += String.fromCharCode(point);
    }
  }
  return text;
}

/** Decodes every string in place, except those of PLAIN_FIELDS. field is the key the value sits under. */
function decodeData(value, field) {
  if (typeof value === "string") return PLAIN_FIELDS.indexOf(field) >= 0 ? value : decodeText(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = decodeData(value[i], field);
    return value;
  }
  if (value !== null && typeof value === "object") {
    Object.keys(value).forEach(function (name) { value[name] = decodeData(value[name], name); });
  }
  return value;
}

if (KEY) {
  decodeData(CONFIG, "");
  decodeData(TOKENS, "");
  decodeData(UNITS, "");
}

const result = { tokens: { made: [], updated: [] }, units: [], warnings: warnings };
try {
  result.tokens = await ensureTokens();
} catch (e) {
  result.tokens = { error: message(e), made: [], updated: [] };
  note("The variables could not be written, so colours are not bound: " + result.tokens.error);
}
for (const U of UNITS) {
  if (U.kind === "component") result.units.push(await writeComponent(U));
  else if (U.kind === "screen") result.units.push(await writeScreen(U));
  else if (U.kind === "retain") result.units.push(await retainScreens(U));
}
try {
  PENDING.forEach(function (p) { p.variable.setValueForMode(p.mode, p.value); });
} catch (e) {
  note("A changed token colour could not be written to its variable: " + message(e));
}
return result;
