/**
 * Turns what the browser read into a unit: plain data that the generated
 * Plugin API code builds a component set or a screen from.
 *
 * The unit is small on purpose. Every distinct box, text and icon is stored
 * once in a table, and each variant is a tree of table positions, so a set of
 * 30 variants costs a few kilobytes and about 10 sets fit in one 50,000
 * character call.
 *
 * Short keys in a node, to keep the code small:
 *   box   k "b"  n name, w h size, x y position inside an unstructured parent, L "H" or "V" for
 *         auto layout, pa and ca alignment (C centre, E end, B space between, T baseline),
 *         g gap, p padding [top, right, bottom, left], fw fh the width or height is fixed (a
 *         missing one hugs), r radius, f fill, sw stroke weight, sc stroke colour, o opacity,
 *         clip the box clips what it holds
 *   text  k "t"  v the words, ff family, wt weight, fs size, lh line height, ls letter spacing,
 *         c colour, td "U" underline, tt "U" upper case, x y w position and width when the parent
 *         is not an auto layout
 *   icon  k "v"  s position in the svg table, w h size, x y position, hid hidden, n name, c colour
 *         to draw its lines and fills in
 *
 * A colour is [token, r, g, b, a]: token is a position in the unit's token list, or -1 when the
 * colour is not bound to a variable. r, g and b are 0 to 255, a is 0 to 1.
 */

import { OLDER_VERSIONS_PAGE } from "./settings.mjs";

const SCOPES = {
  background: ["FRAME_FILL", "SHAPE_FILL"],
  text: ["TEXT_FILL"],
  border: ["STROKE_COLOR"],
  icon: ["SHAPE_FILL", "STROKE_COLOR"],
};

/** The variable name for a CSS custom property: --primary becomes color/primary. */
export function tokenName(css) {
  return `color/${css.replace(/^--/, "").replace(/^color-/, "")}`;
}

const same = (list) => list.every((v) => v === list[0]);
const round = (n) => Math.round(n * 100) / 100;

/** Keeps each distinct value once and hands out its position. */
class Table {
  constructor() {
    this.items = [];
    this.index = new Map();
  }

  add(item) {
    const key = JSON.stringify(item);
    if (!this.index.has(key)) {
      this.index.set(key, this.items.length);
      this.items.push(item);
    }
    return this.index.get(key);
  }
}

/** Colour tokens a unit uses, in order of first use. */
class Tokens {
  constructor(available) {
    this.available = new Map(available.map((t) => [t.name, t]));
    this.used = [];
    this.index = new Map();
  }

  /** A paint for a computed colour, bound to the token it came from when there is one. */
  paint(rgba, css, use) {
    if (!rgba || rgba[3] === 0) return null;
    const token = css ? this.available.get(css) : null;
    if (!token || token.rgba[3] === 0) return [-1, rgba[0], rgba[1], rgba[2], rgba[3]];
    if (!this.index.has(css)) {
      this.index.set(css, this.used.length);
      this.used.push({ css, name: tokenName(css), syntax: token.syntax, rgba: token.rgba, scopes: new Set() });
    }
    const slot = this.index.get(css);
    for (const scope of SCOPES[use]) this.used[slot].scopes.add(scope);
    const alpha = Math.min(1, rgba[3] / token.rgba[3]);
    return [slot, token.rgba[0], token.rgba[1], token.rgba[2], Math.round(alpha * 1000) / 1000];
  }

  list() {
    return this.used.map((t) => ({ ...t, scopes: [...t.scopes] }));
  }
}

const PRIMARY_ALIGN = { center: "C", "flex-end": "E", end: "E", right: "E", "space-between": "B" };
const COUNTER_ALIGN = { center: "C", "flex-end": "E", end: "E", baseline: "T" };

/** A box with nothing drawn on it that only wraps one run of text. */
function isBareWrapper(node) {
  return (
    node.kind === "box" &&
    node.children.length === 1 &&
    node.children[0].kind === "text" &&
    node.background[3] === 0 &&
    !node.backgroundImage &&
    (node.borderStyle === "none" || same([0, ...node.borderWidth])) &&
    node.opacity === 1 &&
    node.padding.every((p) => p === 0) &&
    node.radius.every((r) => r === 0)
  );
}

class Builder {
  /**
   * @param {object} args
   * @param {Array<object>} args.tokens  The colour tokens the page can draw.
   * @param {boolean} args.absolute      Place every child by position, as a screen needs.
   */
  constructor({ tokens, absolute = false }) {
    this.tokens = new Tokens(tokens);
    this.nodes = new Table();
    this.svgs = new Table();
    this.absolute = absolute;
    this.warnings = new Set();
  }

  /** A tree [nodeId, [children]] for a captured box, text or icon. */
  build(node, parent) {
    if (node.kind === "text") return [this.text(node, parent), []];
    if (node.kind === "svg") return [this.icon(node, parent), []];
    if (isBareWrapper(node) && parent) return this.build(node.children[0], parent);
    return this.box(node, parent);
  }

  place(node, parent) {
    if (!parent) return {};
    const flowed = parent.flow && !this.absolute;
    return flowed ? {} : { x: round(node.x - parent.x), y: round(node.y - parent.y) };
  }

  text(node, parent) {
    const lines = Math.max(1, Math.round(node.h / node.lineHeight));
    const high = round(lines * node.lineHeight);
    const flowed = parent?.flow && !this.absolute;
    const entry = {
      k: "t",
      v: node.text,
      ff: node.family.split(",")[0].replace(/["']/g, "").trim(),
      wt: node.weight,
      fs: node.size,
      lh: node.lineHeight,
      c: this.tokens.paint(node.color, node.bind?.color, "text"),
    };
    if (node.letterSpacing) entry.ls = node.letterSpacing;
    if (/underline/.test(node.decoration)) entry.td = "U";
    if (node.transform === "uppercase") entry.tt = "U";
    if (!flowed && parent) {
      // The browser reports the glyph box, which sits in the middle of the line box.
      Object.assign(entry, { x: round(node.x - parent.x), y: round(node.y - parent.y - (high - node.h) / 2), w: node.w });
      if (lines > 1) entry.wrap = 1;
    }
    if (!entry.c) entry.c = [-1, 0, 0, 0, 1];
    return this.nodes.add(entry);
  }

  icon(node, parent) {
    const entry = { k: "v", s: this.svgs.add(node.html), w: node.w, h: node.h, ...this.place(node, parent) };
    return this.nodes.add(entry);
  }

  box(node, parent) {
    const flex = /flex/.test(node.display) && !this.absolute;
    const column = node.direction.startsWith("column");
    const reverse = node.direction.endsWith("reverse");
    const self = { x: node.x, y: node.y, flow: flex };
    let children = node.children.map((child) => ({ child, tree: this.build(child, self) }));
    if (reverse) children = children.reverse();

    const entry = { k: "b", n: node.tag, w: node.w, h: node.h };
    Object.assign(entry, this.place(node, parent));
    if (flex) {
      entry.L = column ? "V" : "H";
      const primary = PRIMARY_ALIGN[node.justifyContent];
      const counter = COUNTER_ALIGN[node.alignItems];
      if (primary) entry.pa = primary;
      if (counter) entry.ca = counter;
      const gap = column ? node.gap[0] : node.gap[1];
      if (gap) entry.g = gap;
      Object.assign(entry, this.sizing(node, column));
    }
    if (node.padding.some((p) => p !== 0)) entry.p = node.padding;

    const fill = this.tokens.paint(node.background, node.bind?.background, "background");
    if (fill) entry.f = fill;
    if (node.backgroundImage) this.warnings.add(`${node.tag}: a background image or gradient was left out.`);

    const stroke = node.borderStyle !== "none" && node.borderWidth.some((w) => w > 0) ? this.tokens.paint(node.borderColor, node.bind?.border, "border") : null;
    if (stroke) {
      entry.sw = same(node.borderWidth) ? node.borderWidth[0] : node.borderWidth;
      entry.sc = stroke;
    }
    const limit = Math.min(node.w, node.h) / 2;
    const radius = node.radius.map((r) => round(Math.min(r, limit)));
    if (radius.some((r) => r > 0)) entry.r = same(radius) ? radius[0] : radius;
    if (node.opacity < 1) entry.o = Math.round(node.opacity * 1000) / 1000;
    if (node.clip) entry.clip = 1;

    return [this.nodes.add(entry), children.map((c) => c.tree)];
  }

  /**
   * Which sides of a flex box are fixed. A side is fixed when the box is not the size of its content,
   * for example a button with a height of 40 around one line of text.
   */
  sizing(node, column) {
    const kids = node.children;
    if (kids.length === 0) return { fw: 1, fh: 1 };
    const gap = (column ? node.gap[0] : node.gap[1]) * (kids.length - 1);
    const widths = kids.map((k) => k.w);
    const heights = kids.map((k) => (k.kind === "text" ? Math.max(1, Math.round(k.h / k.lineHeight)) * k.lineHeight : k.h));
    const contentW = (column ? Math.max(...widths) : widths.reduce((a, b) => a + b, 0) + gap);
    const contentH = (column ? heights.reduce((a, b) => a + b, 0) + gap : Math.max(...heights));
    const padW = node.padding[1] + node.padding[3] + node.borderWidth[1] + node.borderWidth[3];
    const padH = node.padding[0] + node.padding[2] + node.borderWidth[0] + node.borderWidth[2];
    const out = {};
    if (Math.abs(node.w - (contentW + padW)) > 1.5) out.fw = 1;
    if (Math.abs(node.h - (contentH + padH)) > 1.5) out.fh = 1;
    return out;
  }
}

/** "Use when: X. Not for: Y." from an inventory entry's purpose. */
export function describe(purpose) {
  if (!purpose) return "";
  const clean = (text) => String(text ?? "").trim().replace(/\.+$/, "");
  const useWhen = clean(purpose.useWhen);
  const notFor = clean(purpose.notFor);
  if (!useWhen && !notFor) return clean(purpose.text);
  return [useWhen && `Use when: ${useWhen}.`, notFor && `Not for: ${notFor}.`].filter(Boolean).join(" ");
}

/** The first run of text in a captured tree. */
function firstText(node) {
  if (node.kind === "text") return node;
  for (const child of node.children ?? []) {
    const found = firstText(child);
    if (found) return found;
  }
  return null;
}

/**
 * One component version as a unit.
 *
 * @param {object} args
 * @param {{ id: string, name: string, version: string, page: string, description: string }} args.item
 * @param {object} args.capture  From captureComponent.
 * @param {{ icons: boolean }} args.options
 */
export function buildComponentUnit({ item, capture, options }) {
  const builder = new Builder({ tokens: capture.tokens });
  const axes = capture.axes.map((axis) => ({ name: axis.name, values: axis.values.map(String) }));
  const hasIcon = options.icons && capture.icon;
  const iconIndex = hasIcon ? builder.svgs.add(capture.icon.html) : -1;
  const spinnerIndex = capture.spinner ? builder.svgs.add(capture.spinner.html) : -1;

  const cells = capture.cells.map((cell) => {
    const [id, children] = builder.build(cell.tree, null);
    // An icon is drawn in the colour of the words beside it, so it shows on every variant.
    const loading = cell.key.State === "loading" && spinnerIndex >= 0;
    const words = hasIcon || loading ? firstText(cell.tree) : null;
    const ink = words ? builder.tokens.paint(words.color, words.bind?.color, "icon") : null;
    const extra = [];
    if (hasIcon) {
      const icon = builder.nodes.add({ k: "v", s: iconIndex, w: capture.icon.w, h: capture.icon.h, hid: 1, n: "Icon", ...(ink && { c: ink }) });
      extra.push([icon, []]);
    }
    if (loading) {
      const spinner = builder.nodes.add({ k: "v", s: spinnerIndex, w: capture.spinner.w, h: capture.spinner.h, n: "Spinner", ...(ink && { c: ink }) });
      extra.push([spinner, []]);
    }
    // An icon sits before the words, or after them when the story drew it last.
    const trailing = hasIcon && capture.icon.position === "trailing";
    const merged = trailing ? [...children, ...extra] : [...extra, ...children];
    return [capture.axes.map((axis, i) => axis.values.map(String).indexOf(String(cell.key[axis.name]))), [id, merged]];
  });

  return {
    kind: "component",
    id: item.id,
    name: item.name,
    version: item.version,
    page: item.page,
    older: OLDER_VERSIONS_PAGE,
    description: item.description,
    axes,
    iconProperty: hasIcon ? 1 : 0,
    cells,
    nodes: builder.nodes.items,
    svgs: builder.svgs.items,
    tokens: builder.tokens.list(),
    warnings: [...capture.warnings, ...builder.warnings],
  };
}

/**
 * One editable screen as a unit: a frame the size of the page, with every element placed by position.
 *
 * @param {object} args
 * @param {{ id: string, route: string, release: string, page: string }} args.item
 * @param {{ tree: object, size: { w: number, h: number } }} args.capture  From captureScreen.
 * @param {{ screenVersionsKept: number }} args.options
 */
export function buildScreenUnit({ item, capture, options }) {
  const builder = new Builder({ tokens: [], absolute: true });
  const [id, children] = builder.build({ ...capture.tree, x: 0, y: 0, w: capture.size.w, h: capture.size.h }, null);
  return {
    kind: "screen",
    id: item.id,
    route: item.route,
    release: item.release,
    page: item.page,
    keep: options.screenVersionsKept,
    width: capture.size.w,
    height: capture.size.h,
    tree: [id, children],
    nodes: builder.nodes.items,
    svgs: builder.svgs.items,
    tokens: [],
    warnings: [...builder.warnings],
  };
}
