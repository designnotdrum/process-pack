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
 *         clip the box clips what it holds, ap placed by its x y inside an auto layout parent,
 *         as a box the browser positions absolutely is, gw gh the box fills its auto layout
 *         parent's width or height, as a box that grows or stretches in the browser does
 *   text  k "t"  v the words, ff family, wt weight, fs size, lh line height, ls letter spacing,
 *         c colour, td "U" underline, tt "U" upper case, x y w position and width when the parent
 *         is not an auto layout, wrap the text is w wide and wraps there, in an auto layout too,
 *         tr the text is w wide on one line and cut with an ellipsis, gw it fills its auto layout
 *         parent's width
 *   icon  k "v"  s position in the svg table, w h size, x y position, hid hidden, n name, c colour
 *         to draw its lines and fills in, o opacity, ap as for a box
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

/** A box or icon the browser positions out of the flow, over its siblings. */
const outOfFlow = (node) => node.position === "absolute" || node.position === "fixed";

/** A box with nothing drawn on it that only wraps one run of text. */
function isBareWrapper(node) {
  return (
    node.kind === "box" &&
    !outOfFlow(node) &&
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
    // The wrapper is drawn as its text. Its width and how it sits in its parent go to the text.
    if (isBareWrapper(node) && parent) return [this.text(node.children[0], parent, node), []];
    return this.box(node, parent);
  }

  place(node, parent) {
    if (!parent) return {};
    const at = { x: round(node.x - parent.x), y: round(node.y - parent.y) };
    if (!parent.flow || this.absolute) return at;
    return outOfFlow(node) ? { ...at, ap: 1 } : {};
  }

  /**
   * Whether a box fills its auto layout parent, on each axis. It fills the parent's main axis when
   * it grows (flex-grow). It fills the counter axis when it stretches (align-self stretch, its own
   * or the parent's align-items, with an auto width or height) or is sized as a percentage, and the
   * browser drew it as wide as the parent's content box there. A box with a margin on that axis is
   * narrower than the content box, so it keeps its own size.
   */
  fills(node, parent) {
    if (!parent?.flow || this.absolute || outOfFlow(node)) return {};
    const out = {};
    const [main, counter] = parent.column ? ["gh", "gw"] : ["gw", "gh"];
    if (node.grow > 0) out[main] = 1;
    if (node.size) {
      const across = parent.column ? 0 : 1;
      const align = !node.alignSelf || node.alignSelf === "auto" ? parent.node.alignItems : node.alignSelf;
      const stretched = ["normal", "stretch"].includes(align) && node.size[across] === "auto";
      const size = parent.column ? node.w : node.h;
      const room = parent.column ? parent.content.w : parent.content.h;
      if ((stretched || node.size[across] === "%") && Math.abs(size - room) <= 1) out[counter] = 1;
    }
    return out;
  }

  /**
   * A run of text. wrapper is the box it stands for, when the box only wraps it (isBareWrapper).
   *
   * The text is drawn at its own width, unless the browser gave it another one: a wrapper that grows
   * or stretches keeps its width and fills its parent, a text area's text takes the text area's
   * content width, and text the browser cuts with an ellipsis takes the width up to the clipping
   * box's content edge, on one line.
   */
  text(node, parent, wrapper = null) {
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

    let width = null;
    let fill = false;
    // A wrapper as wide as its own text, such as one in a column only as wide as that text, is
    // drawn at the text's own width: Figma's glyphs can be a little wider than the browser's.
    if (wrapper && Math.abs(wrapper.w - node.w) > 1) {
      fill = this.fills(wrapper, parent).gw === 1;
      if (fill) width = wrapper.w;
    }
    if (parent?.node.tag === "textarea") {
      width = node.w;
      fill = Boolean(flowed);
    }
    // The box that cuts the text with an ellipsis: the wrapper, or the box the text sits in. The text
    // is cut where the browser cut it, or where it fills a box wider than itself. Text that fits a
    // box of its own width keeps its own width, because Figma's glyphs can be a little wider than
    // the browser's and a fixed width would cut it.
    const cutter = wrapper?.ellipsis ? wrapper : !wrapper && parent?.node?.ellipsis ? parent.node : null;
    let cut = false;
    if (cutter) {
      const edge = cutter.x + cutter.w - cutter.padding[1] - cutter.borderWidth[1];
      if (width !== null || node.x + node.w > edge + 0.5) {
        width = round(edge - node.x);
        cut = true;
      }
    }

    if (!flowed && parent) {
      // The browser reports the glyph box, which sits in the middle of the line box.
      Object.assign(entry, { x: round(node.x - parent.x), y: round(node.y - parent.y - (high - node.h) / 2), w: width ?? node.w });
      if (lines > 1 || (width !== null && !cut)) entry.wrap = 1;
    } else if (flowed && lines > 1) {
      // Text that wraps in an auto layout wraps at the width the browser wrapped it at: a column's
      // content width, or the text's own width in a row.
      Object.assign(entry, { w: width ?? parent.inner ?? node.w, wrap: 1 });
    } else if (flowed && width !== null) {
      Object.assign(entry, { w: width, wrap: 1 });
    }
    if (cut) {
      delete entry.wrap;
      entry.tr = 1;
    }
    if (flowed && fill) entry.gw = 1;
    if (!entry.c) entry.c = [-1, 0, 0, 0, 1];
    return this.nodes.add(entry);
  }

  icon(node, parent) {
    const entry = { k: "v", s: this.svgs.add(node.html), w: node.w, h: node.h, ...this.place(node, parent) };
    if (node.opacity !== undefined && node.opacity < 1) entry.o = Math.round(node.opacity * 1000) / 1000;
    return this.nodes.add(entry);
  }

  box(node, parent) {
    const column = node.direction.startsWith("column");
    const reverse = node.direction.endsWith("reverse");
    // The spacing comes before the children. A flex box whose children are not evenly spaced is
    // drawn as a box that is not flex, with every child placed by position, and how a child is
    // built depends on which of the two its parent is.
    const laid = /flex/.test(node.display) && !this.absolute ? this.spacing(node, column, reverse) : null;
    const flex = laid !== null && laid.even;
    const content = {
      w: round(node.w - node.padding[1] - node.padding[3] - node.borderWidth[1] - node.borderWidth[3]),
      h: round(node.h - node.padding[0] - node.padding[2] - node.borderWidth[0] - node.borderWidth[2]),
    };
    const self = { x: node.x, y: node.y, flow: flex, inner: column ? content.w : null, column, node, content };
    let children = node.children.map((child) => this.build(child, self));
    if (reverse) children = children.reverse();

    const entry = { k: "b", n: node.tag, w: node.w, h: node.h };
    Object.assign(entry, this.place(node, parent), this.fills(node, parent));
    let padding = node.padding;
    if (flex) {
      entry.L = column ? "V" : "H";
      const primary = PRIMARY_ALIGN[node.justifyContent];
      const counter = COUNTER_ALIGN[node.alignItems];
      if (primary) entry.pa = primary;
      if (counter) entry.ca = counter;
      if (laid.spacing) entry.g = laid.spacing;
      Object.assign(entry, this.sizing(node, column, laid.spacing, laid.padding));
      padding = laid.padding;
      // A child that fills this box on an axis fixes the box on that axis. FILL in a frame that
      // hugs leaves the child at its own size in Figma.
      for (const [id] of children) {
        if (this.nodes.items[id].gw) entry.fw = 1;
        if (this.nodes.items[id].gh) entry.fh = 1;
      }
    }
    if (padding.some((p) => p !== 0)) entry.p = padding;

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

    return [this.nodes.add(entry), children];
  }

  /**
   * The spacing and padding of a flex box in Figma, and whether auto layout can draw it at all.
   *
   * Auto layout has no margins, so the margins between its children, such as Tailwind's space-y,
   * join the gap, and the first and last child's outer margins join the padding. Auto layout has
   * one spacing for every pair, so that works only when every pair of children is the same distance
   * apart where the browser put them. A row with mr-2 on an icon and ml-auto on a shortcut is not:
   * then `even` is false, and the box places its children by position instead. The distances are
   * read from the children's boxes, so a margin the reader does not see, or an auto margin, counts
   * too. Space-between spreads its children evenly by itself and keeps the gap.
   */
  spacing(node, column, reverse) {
    const gap = column ? node.gap[0] : node.gap[1];
    const kids = node.children.filter((kid) => !outOfFlow(kid));
    if (reverse) kids.reverse();
    const margin = (kid) => kid.margin ?? [0, 0, 0, 0];
    // Margin sides, as [top, right, bottom, left] positions: before and after a child on the main axis.
    const [before, after] = column ? [0, 2] : [3, 1];
    const between = kids.slice(1).map((kid, i) => round(gap + margin(kids[i])[after] + margin(kid)[before]));
    const fromMargins = between.length > 0 && between.every((s) => Math.abs(s - between[0]) < 0.5) ? between[0] : null;
    const padding = node.padding.slice();
    if (kids.length > 0) {
      padding[before] = round(Math.max(0, padding[before] + margin(kids[0])[before]));
      padding[after] = round(Math.max(0, padding[after] + margin(kids.at(-1))[after]));
    }
    // Where a child starts and ends on the main axis. Text reports its glyph box, which sits in the
    // middle of its line box, and its line box is what takes up room.
    const span = (kid) => {
      if (!column) return [kid.x, kid.x + kid.w];
      if (kid.kind !== "text") return [kid.y, kid.y + kid.h];
      const high = Math.max(1, Math.round(kid.h / kid.lineHeight)) * kid.lineHeight;
      const top = kid.y - (high - kid.h) / 2;
      return [top, top + high];
    };
    const drawn = kids.slice(1).map((kid, i) => round(span(kid)[0] - span(kids[i])[1]));
    if (drawn.length === 0 || PRIMARY_ALIGN[node.justifyContent] === "B") return { even: true, spacing: fromMargins ?? gap, padding };
    if (Math.max(...drawn) - Math.min(...drawn) > 1) return { even: false };
    const spacing = fromMargins !== null && Math.abs(fromMargins - drawn[0]) <= 1 ? fromMargins : round(drawn.reduce((a, b) => a + b, 0) / drawn.length);
    return { even: true, spacing, padding };
  }

  /**
   * Which sides of a flex box are fixed. A side is fixed when the box is not the size of its content,
   * for example a button with a height of 40 around one line of text.
   */
  sizing(node, column, spacing, padding) {
    const kids = node.children.filter((kid) => !outOfFlow(kid));
    if (kids.length === 0) return { fw: 1, fh: 1 };
    const gap = spacing * (kids.length - 1);
    const widths = kids.map((k) => k.w);
    const heights = kids.map((k) => (k.kind === "text" ? Math.max(1, Math.round(k.h / k.lineHeight)) * k.lineHeight : k.h));
    const contentW = (column ? Math.max(...widths) : widths.reduce((a, b) => a + b, 0) + gap);
    const contentH = (column ? heights.reduce((a, b) => a + b, 0) + gap : Math.max(...heights));
    const padW = padding[1] + padding[3] + node.borderWidth[1] + node.borderWidth[3];
    const padH = padding[0] + padding[2] + node.borderWidth[0] + node.borderWidth[2];
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

/**
 * A variant's root is drawn as a frame. A component whose root is an icon, such as a ring drawn as
 * one <svg>, is that icon in a frame of its size.
 */
function asRoot(tree) {
  if (tree.kind === "box") return tree;
  return {
    kind: "box",
    tag: tree.kind === "svg" ? "svg" : "span",
    x: tree.x,
    y: tree.y,
    w: tree.w,
    h: tree.h,
    display: "block",
    position: "static",
    direction: "row",
    alignItems: "normal",
    justifyContent: "normal",
    gap: [0, 0],
    padding: [0, 0, 0, 0],
    margin: [0, 0, 0, 0],
    borderWidth: [0, 0, 0, 0],
    borderStyle: "none",
    borderColor: [0, 0, 0, 0],
    radius: [0, 0, 0, 0],
    background: [0, 0, 0, 0],
    backgroundImage: false,
    opacity: 1,
    clip: false,
    children: [tree],
  };
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
    const [id, children] = builder.build(asRoot(cell.tree), null);
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
