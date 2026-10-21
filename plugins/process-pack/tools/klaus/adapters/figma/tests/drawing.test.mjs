/**
 * The six drawing faults of process-pack issue #83, seen in Meridian's first load on 2026-10-20.
 * Each test drives the spec and the generated code against the fake Plugin API, which does what a
 * scratch Figma file did in probes on 2026-10-21 (see fake-figma.mjs). The browser tests read the
 * stand-in Storybook build (fixtures/whole-component) and run only when KLAUS_TEST_REPO names a
 * repo with @playwright/test and a browser installed.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { captureComponent, openStorybook } from "../capture.mjs";
import { dataFor } from "../codegen.mjs";
import { readData } from "../data-file.mjs";
import { buildComponentUnit } from "../spec.mjs";
import { newFigma, OPTIONS, run } from "./helpers.mjs";
import { walk } from "./fake-figma.mjs";

/** A captured box, as capture-browser.mjs readStory returns it. */
function box(fields) {
  return {
    kind: "box",
    tag: "div",
    x: 0,
    y: 0,
    w: 10,
    h: 10,
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
    grow: 0,
    alignSelf: "auto",
    size: ["auto", "auto"],
    ellipsis: false,
    children: [],
    ...fields,
  };
}

/** A captured run of text. */
function text(fields) {
  return { kind: "text", text: "Words", x: 0, y: 0, w: 40, h: 18, family: "DM Sans", weight: 400, size: 14, lineHeight: 20, letterSpacing: 0, decoration: "none", transform: "none", color: [0, 0, 0, 1], ...fields };
}

/** A captured icon. */
function svg(fields) {
  return { kind: "svg", html: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path d="M0 0h16v16H0z"/></svg>', x: 0, y: 0, w: 16, h: 16, position: "static", opacity: 1, ...fields };
}

/** A one-variant unit for a captured tree, checked by the data file reader as the plugin and the relay check it. */
function unitOf(name, tree, { tokens = [], icon = null, icons = false } = {}) {
  const capture = { axes: [], tokens, cells: [{ key: {}, tree }], icon, spinner: null, warnings: [] };
  const unit = buildComponentUnit({ item: { id: name, name, version: "1.0.0", page: name, description: "" }, capture, options: { ...OPTIONS, icons } });
  readData(JSON.stringify(dataFor({ units: [unit], config: { collection: "Tokens", mode: "Light" }, header: "test" })));
  return unit;
}

/** The unit's only variant as a tree of its nodes: { node, children }. */
function treeOf(unit) {
  const expand = ([id, children]) => ({ node: unit.nodes[id], children: children.map(expand) });
  return expand(unit.cells[0][1]);
}

/** Writes a unit to a fake Figma file and returns its one component. */
async function draw(unit) {
  const figma = newFigma([unit.page]);
  const result = await run(figma, [unit]);
  assert.equal(result.units[0].status, "written", JSON.stringify(result));
  return { figma, component: figma.page(unit.page).children[0] };
}

// 1. Uneven spacing between children is dropped.

/** A Command item: an icon with mr-2, its label, and a shortcut pushed to the right edge by ml-auto. */
function commandItem() {
  const icon = svg({ x: 371, y: 235, margin: [0, 8, 0, 0] });
  const label = box({ tag: "span", x: 395, y: 233, w: 40.3, h: 20, children: [text({ text: "Profile", x: 395, y: 234, w: 40.3 })] });
  const shortcut = box({ tag: "span", x: 708.58, y: 235, w: 20.42, h: 16, margin: [0, 0, 0, 273.28], children: [text({ text: "⌘P", x: 708.58, y: 235, w: 20.42, h: 16, size: 12, lineHeight: 16 })] });
  return box({ x: 363, y: 227, w: 374, h: 32, display: "flex", alignItems: "center", padding: [6, 8, 6, 8], children: [icon, label, shortcut] });
}

test("1. a flex row whose children are not evenly spaced places each child where the browser put it", async () => {
  const tree = treeOf(unitOf("Command", commandItem()));
  assert.equal(tree.node.L, undefined, "not an auto layout, which has one spacing for every pair");
  const placed = tree.children.map(({ node }) => [node.x, node.y]);
  // The label's line box is 20 high around its 18px glyph box, so it starts 1px above the glyphs.
  assert.deepEqual(placed, [[8, 8], [32, 6], [345.58, 8]]);

  const { component } = await draw(unitOf("Command", commandItem()));
  assert.equal(component.layoutMode, undefined);
  assert.deepEqual(component.children.map((n) => [n.x, n.y]), [[8, 8], [32, 6], [345.58, 8]]);
});

test("1. the spacing of an auto layout is where the browser put the children, so a margin the reader did not see still counts", () => {
  // An icon with mr-2 beside its label. The icon's margin is not in the capture.
  const row = box({ x: 363, y: 94, w: 374, h: 32, display: "flex", alignItems: "center", padding: [6, 8, 6, 8], children: [svg({ x: 371, y: 102 }), box({ tag: "span", x: 395, y: 100, w: 58.34, h: 20, children: [text({ text: "Calendar", x: 395, y: 101, w: 58.34 })] })] });
  const tree = treeOf(unitOf("Command", row));
  assert.equal(tree.node.L, "H");
  assert.equal(tree.node.g, 8);
});

// 2. A box that fills its parent is drawn at the size of its text.

/** A MemberSelect option: an avatar, a name in a flex-1 span 222 wide, and a selection circle at the right edge. */
function memberOption() {
  const avatar = box({ tag: "span", x: 403, y: 128, w: 32, h: 32, display: "flex", background: [238, 239, 241, 1], children: [text({ text: "JD", x: 411.78, y: 136, w: 14.42, h: 16, lineHeight: 16 })] });
  const name = box({ tag: "span", x: 443, y: 134, w: 222, h: 20, grow: 1, children: [text({ text: "John Doe", x: 443, y: 135, w: 61.02 })] });
  const circle = box({ x: 673, y: 132, w: 24, h: 24, display: "flex", justifyContent: "center", alignItems: "center", borderStyle: "solid", borderWidth: [1, 1, 1, 1], borderColor: [0, 0, 0, 1], radius: [12, 12, 12, 12], children: [svg({ x: 677, y: 136 })] });
  return box({ tag: "button", x: 395, y: 120, w: 310, h: 48, display: "flex", alignItems: "center", gap: [8, 8], padding: [8, 8, 8, 8], children: [avatar, name, circle] });
}

test("2. a wrapper span that grew keeps its width: its text fills the row, and the row is fixed on that axis", async () => {
  const tree = treeOf(unitOf("MemberSelect", memberOption()));
  const words = tree.children[1].node;
  assert.equal(words.k, "t", "the wrapper is still drawn as its text");
  assert.equal(words.w, 222, "the span's width, not the text's 61");
  assert.equal(words.gw, 1, "it fills the row");
  assert.equal(tree.node.fw, 1, "FILL in a frame that hugs does nothing, so the row is fixed");

  const { component } = await draw(unitOf("MemberSelect", memberOption()));
  const label = component.children[1];
  assert.equal(label.layoutSizingHorizontal, "FILL");
  assert.equal(component.primaryAxisSizingMode, "FIXED");
  assert.equal(component.width, 310);
});

test("2. a text area's text is drawn at the text area's content width, so the text area keeps its width", async () => {
  const area = box({ tag: "textarea", x: 459, y: 16, w: 201, h: 60, display: "flex", padding: [8, 12, 8, 12], borderStyle: "solid", borderWidth: [1, 1, 1, 1], borderColor: [0, 0, 0, 1], clip: true, children: [text({ text: "Type your message here.", x: 472, y: 25, w: 175, h: 20 })] });
  const tree = treeOf(unitOf("Textarea", area));
  assert.equal(tree.children[0].node.w, 175, "201 less 12 of padding and 1 of border each side");
  assert.equal(tree.children[0].node.gw, 1);
  assert.equal(tree.node.fw, 1);

  const { component } = await draw(unitOf("Textarea", area));
  assert.equal(component.width, 201);
  assert.equal(component.children[0].layoutSizingHorizontal, "FILL");
  assert.equal(component.children[0].textAutoResize, "HEIGHT", "a fixed width, not the text's own");
});

test("2. a box that stretches across its column fills it, and a box that does not stretch hugs", async () => {
  // The AttachFileToCardsModal column: a footer that stretches across it, a box with self-start, and a w-full box.
  const footer = box({ tag: "footer", x: 311, y: 100, w: 478, h: 53, display: "flex", alignItems: "center", padding: [12, 16, 12, 16], children: [box({ tag: "button", x: 327, y: 112, w: 60, h: 28, display: "flex", padding: [4, 8, 4, 8], children: [text({ text: "Attach", x: 335, y: 117, w: 44 })] })] });
  const narrow = box({ x: 311, y: 153, w: 80, h: 28, display: "flex", alignSelf: "flex-start", padding: [4, 4, 4, 4], children: [text({ text: "Narrow", x: 315, y: 158, w: 50 })] });
  const full = box({ x: 311, y: 181, w: 478, h: 20, size: ["%", "auto"], children: [box({ x: 311, y: 181, w: 20, h: 20, background: [0, 0, 0, 1] })] });
  const column = box({ x: 310, y: 99, w: 480, h: 103, display: "flex", direction: "column", borderStyle: "solid", borderWidth: [1, 1, 1, 1], borderColor: [0, 0, 0, 1], children: [footer, narrow, full] });
  const tree = treeOf(unitOf("AttachFileToCardsModal", column));
  assert.deepEqual(tree.children.map(({ node }) => node.gw), [1, undefined, 1]);
  assert.equal(tree.node.fw, 1);

  const { component } = await draw(unitOf("AttachFileToCardsModal", column));
  assert.deepEqual(component.children.map((n) => n.layoutSizingHorizontal), ["FILL", "FIXED", "FILL"]);
  assert.equal(component.counterAxisSizingMode, "FIXED");
  assert.equal(component.children[0].width, 478, "the footer, and its top border, reach across the column");
});

// 3. Colours with transparency are drawn solid.

test("3. a colour with transparency that is bound to a variable keeps its opacity, in fills, strokes, text and icons", async () => {
  const tokens = [{ name: "--primary", kind: "hsl", syntax: "hsl(var(--primary))", rgba: [74, 90, 232, 1] }];
  const bind = { background: "--primary", border: "--primary", color: "--primary" };
  // Skeleton is bg-primary/10. The border and the text are tints of the same token.
  const words = text({ text: "Loading", x: 4, y: 4, color: [74, 90, 232, 0.5], bind });
  const tree = box({ w: 256, h: 32, display: "flex", padding: [4, 4, 4, 4], background: [74, 90, 232, 0.1], borderStyle: "solid", borderWidth: [1, 1, 1, 1], borderColor: [74, 90, 232, 0.2], bind, children: [words] });
  const icon = { html: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path d="M0 0h16v16H0z"/></svg>', w: 16, h: 16, position: "leading" };
  const { figma, component } = await draw(unitOf("Skeleton", tree, { tokens, icon, icons: true }));
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.001, `${actual} is not ${expected}`);
  near(component.fills[0].opacity, 0.1);
  near(component.strokes[0].opacity, 0.2);
  assert.ok(component.fills[0].boundVariables.color, "still bound to the variable");
  const label = component.children.find((n) => n.type === "TEXT");
  near(label.fills[0].opacity, 0.5);
  const drawing = component.children.find((n) => n.name === "Icon").children[0];
  near(drawing.strokes[0].opacity, 0.5);
  assert.equal(figma.variableList[0].name, "color/primary");
});

// 4. Symbols such as ⌘ and ⇧ are blank.

test("4. symbols DM Sans has no glyph for, such as ⇧ and ⌘, are set in Inter in the nearest style", async () => {
  const shortcut = text({ text: "⇧⌘P", x: 4, y: 4, w: 33.39, h: 16, weight: 500, size: 12, lineHeight: 16 });
  const arrows = text({ text: "Back ← ⌫", x: 4, y: 24, w: 60, h: 16, family: "Inter", size: 12, lineHeight: 16 });
  const tree = box({ w: 100, h: 44, children: [shortcut, arrows] });
  const { component } = await draw(unitOf("DropdownMenu", tree));
  const [dm, inter] = component.children;
  assert.deepEqual(dm.getRangeFontName(0, 2), { family: "Inter", style: "Medium" }, "⇧ (U+21E7) and ⌘ (U+2318)");
  assert.deepEqual(dm.getRangeFontName(2, 3), { family: "DM Sans", style: "Medium" }, "the letter keeps its family");
  assert.deepEqual(inter.fontName, { family: "Inter", style: "Regular" }, "text in Inter is left alone");
});

// 5. A component whose root is an <svg> is read as boxes.

test("5. a component whose root is an svg is drawn as that icon, in a frame of its size", async () => {
  const ring = svg({ html: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><defs><linearGradient id="g"><stop offset="0" stop-color="#4a5ae8"/></linearGradient></defs><circle cx="16" cy="16" r="14" stroke="url(#g)"/></svg>', x: 614, y: 40, w: 32, h: 32 });
  const unit = unitOf("PrimaRing", ring);
  assert.equal(treeOf(unit).node.k, "b", "the root is a frame");
  assert.equal(treeOf(unit).children[0].node.k, "v");
  const { component } = await draw(unit);
  assert.deepEqual([component.width, component.height], [32, 32]);
  assert.equal(component.children.length, 1);
  assert.equal(component.children[0].name, "Icon");
});

// 6. Text that the browser truncates with an ellipsis spills out.

test("6. text the browser truncates with an ellipsis is drawn at the clipping box's content width, on one line, truncated", async () => {
  // The FileCardNode header: a PDF badge, then the file name in a flex-1 truncate span 200.8 wide. The name is 213 wide.
  const badge = box({ tag: "span", x: 431, y: 66.39, w: 29.2, h: 18, padding: [1, 5, 1, 5], background: [0, 0, 0, 0.03], children: [text({ text: "PDF", x: 436, y: 68.39, w: 19.2, h: 13, family: "JetBrains Mono", size: 11, lineHeight: 16 })] });
  const name = box({ tag: "span", x: 468.2, y: 65, w: 200.8, h: 20.8, grow: 1, clip: true, ellipsis: true, children: [text({ text: "onboarding-session-synthesis.pdf", x: 468.2, y: 66, w: 213.19, h: 17, size: 13, lineHeight: 20.8 })] });
  const header = box({ x: 421, y: 57, w: 258, h: 36.8, display: "flex", alignItems: "center", gap: [8, 8], padding: [8, 10, 8, 10], children: [badge, name] });
  const tree = treeOf(unitOf("FileCardNode", header));
  const words = tree.children[1].node;
  assert.equal(words.w, 200.8);
  assert.equal(words.tr, 1);

  const { component } = await draw(unitOf("FileCardNode", header));
  const label = component.children[1];
  assert.equal(label.width, 200.8);
  assert.equal(label.textTruncation, "ENDING");
  assert.equal(label.maxLines, 1);
  assert.equal(label.textAutoResize, "HEIGHT");
});

test("6. text in a truncating box that fits is drawn as before", () => {
  const title = box({ tag: "h2", x: 327, y: 48, w: 414, h: 24, clip: true, ellipsis: true, children: [text({ text: "Attach", x: 327, y: 49, w: 55, h: 21, lineHeight: 24 }), text({ text: "notes.pdf", x: 382, y: 49, w: 70, h: 21, lineHeight: 24 })] });
  const tree = treeOf(unitOf("Title", box({ w: 500, h: 60, children: [title] })));
  for (const { node } of tree.children[0].children) {
    assert.equal(node.tr, undefined);
    assert.equal(node.wrap, undefined);
  }
  // FileCardNode's "6 pages" sits in a truncate span exactly its own width. Figma's glyphs can be a
  // little wider than the browser's, so a fixed width there would cut text the browser did not cut.
  const pages = box({ tag: "span", x: 431, y: 231.8, w: 40.56, h: 17.59, clip: true, ellipsis: true, children: [text({ text: "6 pages", x: 431, y: 232.8, w: 40.56, h: 14, size: 11, lineHeight: 17.6 })] });
  const footer = box({ x: 421, y: 225.8, w: 258, h: 29.59, display: "flex", alignItems: "center", gap: [8, 8], padding: [6, 10, 6, 10], children: [pages] });
  const words = treeOf(unitOf("FileCardNode", footer)).children[0].node;
  assert.equal(words.tr, undefined);
  assert.equal(words.w, undefined, "drawn at its own width");

  // AttachFileToCardsModal's item titles: truncate spans in a column that is as wide as its widest
  // title. That span "stretches", but only to its own text's width, so it is drawn at its own width.
  const itemTitle = box({ tag: "span", x: 355, y: 505.27, w: 157.03, h: 20.8, clip: true, ellipsis: true, children: [text({ text: "What we still do not know", x: 355, y: 506.27, w: 157.03, h: 17, size: 13, lineHeight: 20.8 })] });
  const kind = box({ tag: "span", x: 355, y: 526.07, w: 157.03, h: 17.59, clip: true, ellipsis: true, children: [text({ text: "Section", x: 355, y: 527.07, w: 38.77, h: 14, size: 11, lineHeight: 17.6 })] });
  const column = box({ tag: "span", x: 355, y: 505.27, w: 157.03, h: 38.39, display: "flex", direction: "column", children: [itemTitle, kind] });
  const [first, second] = treeOf(unitOf("AttachFileToCardsModal", column)).children.map(({ node }) => node);
  assert.deepEqual([first.w, first.tr, first.gw], [undefined, undefined, undefined], "a title as wide as its box keeps its own width");
  assert.deepEqual([second.w, second.tr, second.gw], [157.03, 1, 1], "a shorter one fills the column and is cut there");
});

// The reader, in a real browser.

const repo = process.env.KLAUS_TEST_REPO;
const browser = { skip: repo ? false : "set KLAUS_TEST_REPO to a repo with Playwright and a browser installed" };
const directory = fileURLToPath(new URL("./fixtures/whole-component/", import.meta.url));

async function capture(name) {
  const storybook = await openStorybook({ root: repo, directory, globals: "" });
  try {
    return await captureComponent(storybook, { name, axes: [], states: [], label: false, icons: false });
  } finally {
    await storybook.close();
  }
}

const nodesOf = (node, out = []) => {
  out.push(node);
  for (const child of node.children ?? []) nodesOf(child, out);
  return out;
};

test("1. the reader reads an icon's margin, and a row with an icon, a label and a shortcut at the right edge lands where the browser put it", browser, async () => {
  const read = await capture("Row");
  const tree = read.cells[0].tree;
  const icon = tree.children.find((n) => n.kind === "svg");
  assert.deepEqual(icon.margin, [0, 8, 0, 0]);
  assert.equal(icon.opacity, 0.5);
  assert.doesNotMatch(icon.html, /opacity=/, "the icon's own opacity is carried once, as the icon's opacity, not again in its markup");
  const unit = buildComponentUnit({ item: { id: "Row", name: "Row", version: "1.0.0", page: "Row", description: "" }, capture: read, options: OPTIONS });
  const drawn = treeOf(unit);
  assert.equal(drawn.node.L, undefined);
  const [first, label, shortcut] = drawn.children.map(({ node }) => node);
  const at = (node) => Math.round(node.x);
  assert.equal(at(first), 8);
  assert.equal(at(label), 32, "8 of padding, 16 of icon and 8 of margin");
  const right = tree.children.at(-1);
  assert.equal(Math.round(shortcut.x), Math.round(right.x - tree.x), "the shortcut sits at the right edge, as the browser drew it");
});

test("2. the reader reads which boxes grow and stretch, and a box's own width and height", browser, async () => {
  const read = await capture("Footer");
  const tree = read.cells[0].tree;
  const [footer, narrow, full] = tree.children;
  assert.deepEqual(footer.size, ["auto", "auto"]);
  assert.equal(footer.alignSelf, "auto");
  const note = footer.children[0];
  assert.equal(note.grow, 1);
  assert.equal(narrow.alignSelf, "flex-start");
  assert.deepEqual(full.size, ["%", "auto"]);

  const unit = buildComponentUnit({ item: { id: "Footer", name: "Footer", version: "1.0.0", page: "Footer", description: "" }, capture: read, options: OPTIONS });
  const drawn = treeOf(unit);
  assert.deepEqual(drawn.children.map(({ node }) => node.gw), [1, undefined, 1]);
  const words = drawn.children[0].children[0].node;
  assert.equal(words.gw, 1, "the line of text grows across the footer");
  assert.equal(words.w, note.w);
});

test("5. a component whose root is an svg is read as an icon, with its gradient and the paint its style sheet gives it", browser, async () => {
  const read = await capture("Ring");
  const tree = read.cells[0].tree;
  assert.equal(tree.kind, "svg");
  assert.match(tree.html, /linearGradient/);
  assert.deepEqual([tree.w, tree.h], [32, 32]);
  const circle = /<circle[^>]*>/.exec(tree.html)[0];
  assert.match(circle, /fill="none"/, "no fill, from the style sheet");
  assert.match(circle, /stroke-width="3"/);
  assert.match(circle, /stroke="url\(#ring\)"/, "an attribute without a var() stays");
  assert.doesNotMatch(tree.html, /var\(/, "a stop colour given as a var() is written as the colour it resolved to");
  assert.match(tree.html, /stop-color="rgb\(74, 90, 232\)"/);
});

test("6. the reader reads a box that truncates its text with an ellipsis", browser, async () => {
  const read = await capture("Footer");
  const note = read.cells[0].tree.children[0].children[0];
  assert.equal(note.ellipsis, true);
  const words = note.children[0];
  assert.ok(words.w > note.w, `the text is ${words.w} wide, wider than its ${note.w} box`);
  const unit = buildComponentUnit({ item: { id: "Footer", name: "Footer", version: "1.0.0", page: "Footer", description: "" }, capture: read, options: OPTIONS });
  const drawn = treeOf(unit).children[0].children[0].node;
  assert.equal(drawn.tr, 1);
  assert.equal(drawn.w, note.w);
});

test("every node of a drawn unit is one the data file reader accepts", async () => {
  const units = [unitOf("Command", commandItem()), unitOf("MemberSelect", memberOption())];
  readData(JSON.stringify(dataFor({ units, config: { collection: "Tokens", mode: "Light" }, header: "test" })));
  const figma = newFigma(["Command", "MemberSelect"]);
  const result = await run(figma, units);
  assert.deepEqual(result.units.map((u) => u.status), ["written", "written"]);
  let texts = 0;
  walk(figma.root, (n) => n.type === "TEXT" && (texts += 1));
  assert.ok(texts >= 4);
});
