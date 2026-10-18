/**
 * The part of every generated code file that is the same each time.
 *
 * codegen.mjs puts three constants in front of this text and sends the result
 * to Figma:
 *   CONFIG  { collection, mode }
 *   TOKENS  the colour variables the units in this file use
 *   UNITS   the component sets and screens to write, as built by spec.mjs
 *
 * This file is not run by Node. It is plain JavaScript for the Figma Plugin API
 * and it avoids newer syntax on purpose. It uses top-level await and return,
 * which use_figma allows. It never switches the current page, because a call
 * may switch only once. It touches other pages by loading them and moving nodes
 * onto them.
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
const VERSION = /^\d+(\.\d+)*([-+][0-9A-Za-z.-]+)?$/;
const warnings = [];
const loadedFonts = {};
let fontStyles = null;
let VARIABLES = [];

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
    // Variables hold the app's current tokens, so a changed colour is written through.
    const old = variable.valuesByMode[mode];
    const moved = !old || Math.abs(old.r - value.r) > 0.002 || Math.abs(old.g - value.g) > 0.002 || Math.abs(old.b - value.b) > 0.002 || Math.abs((old.a === undefined ? 1 : old.a) - value.a) > 0.002;
    if (moved) {
      variable.setValueForMode(mode, value);
      updated.push(t.name);
    }
    const scopes = variable.scopes.filter(function (s) { return s !== "ALL_SCOPES"; });
    t.scopes.forEach(function (s) { if (scopes.indexOf(s) < 0) scopes.push(s); });
    variable.scopes = scopes;
    return variable;
  });
  return { made: made, updated: updated };
}

function paintOf(U, c) {
  const base = { type: "SOLID", color: { r: c[1] / 255, g: c[2] / 255, b: c[3] / 255 } };
  const variable = c[0] >= 0 ? VARIABLES[U.tk[c[0]]] : null;
  const bound = variable ? figma.variables.setBoundVariableForPaint(base, "color", variable) : base;
  return c[4] < 1 ? Object.assign({}, bound, { opacity: c[4] }) : bound;
}

async function makeText(U, n) {
  const t = figma.createText();
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

function makeIcon(U, n) {
  const icon = figma.createNodeFromSvg(U.svgs[n.s]);
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
    const node = await makeNode(U, child);
    f.appendChild(node);
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

async function makeNode(U, tree) {
  const n = U.nodes[tree[0]];
  if (n.k === "t") return makeText(U, n);
  if (n.k === "v") return makeIcon(U, n);
  return fillBox(U, tree, figma.createFrame());
}

function parseVersion(node, name) {
  if (node.type !== "COMPONENT_SET" && node.type !== "COMPONENT") return null;
  if (node.name.indexOf(name + " ") !== 0) return null;
  const version = node.name.slice(name.length + 1);
  return VERSION.test(version) ? version : null;
}

function compareVersions(a, b) {
  const left = a.split(/[-+]/)[0].split(".").map(Number);
  const right = b.split(/[-+]/)[0].split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const d = (left[i] || 0) - (right[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
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

function freeX(page) {
  let right = -80;
  for (const n of page.children) right = Math.max(right, n.x + n.width);
  return right + 80;
}

function freeY(page) {
  let bottom = -120;
  for (const n of page.children) bottom = Math.max(bottom, n.y + n.height);
  return bottom + 120;
}

async function buildSet(U, created) {
  const name = U.name + " " + U.version;
  const parts = [];
  for (const cell of U.cells) {
    const component = figma.createComponent();
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
  const set = figma.combineAsVariants(parts.map(function (p) { return p.component; }), figma.currentPage);
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
    const node = await buildSet(U, created);
    const moved = [];
    let archive = older;
    if (latest) {
      const x = newest ? newest.x : freeX(page);
      const y = newest ? newest.y : 0;
      for (const old of siblings) {
        archive = archive || (await pageNamed(U.older));
        const at = freeX(archive);
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
      const at = freeX(archive);
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
    return { id: U.id, status: "failed", error: String(e && e.message ? e.message : e) };
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
    const frame = figma.createFrame();
    created.push(frame);
    await fillBox(U, U.tree, frame);
    frame.name = name;
    frame.clipsContent = true;
    const earlier = page.children.filter(function (n) { return n.type === "FRAME" && screenKey(n.name) === U.route; });
    const x = earlier.length > 0 ? freeXOf(earlier) : 0;
    const y = earlier.length > 0 ? earlier[0].y : freeY(page);
    page.appendChild(frame);
    frame.x = x;
    frame.y = y;
    const removed = trimScreen(page, U.route, U.keep);
    return { id: U.id, status: "written", name: name, nodeId: frame.id, removed: removed };
  } catch (e) {
    for (const n of created) {
      try { n.remove(); } catch (ignored) { /* already gone */ }
    }
    return { id: U.id, status: "failed", error: String(e && e.message ? e.message : e) };
  }
}

function freeXOf(nodes) {
  let right = -80;
  for (const n of nodes) right = Math.max(right, n.x + n.width);
  return right + 80;
}

async function retainScreens(U) {
  try {
    const page = await pageNamed(U.page);
    const removed = [];
    for (const route of U.routes) removed.push.apply(removed, trimScreen(page, route, U.keep));
    return { id: U.id, status: "written", removed: removed };
  } catch (e) {
    return { id: U.id, status: "failed", error: String(e && e.message ? e.message : e) };
  }
}

const result = { tokens: { made: [], updated: [] }, units: [], warnings: warnings };
try {
  result.tokens = await ensureTokens();
} catch (e) {
  result.tokens = { error: String(e && e.message ? e.message : e), made: [], updated: [] };
  note("The variables could not be written, so colours are not bound: " + result.tokens.error);
}
for (const U of UNITS) {
  if (U.kind === "component") result.units.push(await writeComponent(U));
  else if (U.kind === "screen") result.units.push(await writeScreen(U));
  else if (U.kind === "retain") result.units.push(await retainScreens(U));
}
return result;
