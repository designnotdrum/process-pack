/** From what the browser read to the data the generated code builds from. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { dataFor } from "../codegen.mjs";
import { readData } from "../data-file.mjs";
import { buildComponentUnit, describe, tokenName } from "../spec.mjs";
import { buttonCapture, buttonUnit, newFigma, OPTIONS, run } from "./helpers.mjs";
import { walk } from "./fake-figma.mjs";

const root = (unit, variant, size) => {
  const at = [unit.axes[0].values.indexOf(variant), unit.axes[1].values.indexOf(size)];
  const cell = unit.cells.find(([a]) => a[0] === at[0] && a[1] === at[1]);
  return { box: unit.nodes[cell[1][0]], children: cell[1][1].map(([id]) => unit.nodes[id]) };
};

test("variants are named Variant=..., Size=... in the order of the axes", () => {
  const unit = buttonUnit();
  assert.deepEqual(unit.axes, [
    { name: "Variant", values: ["primary", "secondary", "destructive", "outline", "ghost", "link"] },
    { name: "Size", values: ["sm", "md", "lg"] },
  ]);
  assert.equal(unit.cells.length, 18);
});

test("a token is named from its CSS variable", () => {
  assert.equal(tokenName("--primary"), "color/primary");
  assert.equal(tokenName("--primary-foreground"), "color/primary-foreground");
  assert.equal(tokenName("--color-primary"), "color/primary");
});

test("colours bind to the token they came from, with the CSS variable as the WEB code syntax", () => {
  const unit = buttonUnit();
  const byName = Object.fromEntries(unit.tokens.map((t) => [t.name, t]));

  assert.equal(byName["color/primary"].syntax, "hsl(var(--primary))");
  assert.deepEqual(byName["color/primary"].scopes.toSorted(), ["FRAME_FILL", "SHAPE_FILL", "TEXT_FILL"]);
  assert.deepEqual(byName["color/secondary"].scopes, ["STROKE_COLOR"]);
  assert.deepEqual(byName["color/primary-foreground"].scopes, ["TEXT_FILL"]);

  const primary = root(unit, "primary", "md");
  assert.equal(unit.tokens[primary.box.f[0]].name, "color/primary");
  assert.equal(unit.tokens[primary.children[0].c[0]].name, "color/primary-foreground");
});

test("two tokens that hold the same colour stay two variables", () => {
  const unit = buttonUnit();
  const names = unit.tokens.map((t) => t.name);
  // foreground and secondary-foreground are both #0f172a in the fixture. The browser told them apart by use.
  assert.ok(names.includes("color/foreground") && names.includes("color/secondary-foreground"));
  const outline = root(unit, "outline", "md");
  const secondary = root(unit, "secondary", "md");
  assert.equal(unit.tokens[outline.children[0].c[0]].name, "color/foreground");
  assert.equal(unit.tokens[secondary.children[0].c[0]].name, "color/secondary-foreground");
});

test("sizes come from the computed styles: a fixed height, hugging width, and the radius that is drawn", () => {
  const unit = buttonUnit();
  const md = root(unit, "primary", "md").box;
  assert.equal(md.h, 40);
  assert.equal(md.fh, 1, "the height is fixed");
  assert.equal(md.fw, undefined, "the width hugs the text");
  assert.deepEqual(md.p, [0, 16, 0, 16]);
  assert.equal(md.r, 6, "the browser draws 6px, not the 8px of the CSS file");
  assert.equal(md.L, "H");
  assert.equal(md.pa, "C");
  assert.equal(md.ca, "C");
  assert.equal(md.g, 8);

  const link = root(unit, "link", "md").box;
  assert.equal(link.fh, undefined, "a link is as tall as its text");
  assert.equal(link.p, undefined);
});

test("an outline has a 1px stroke bound to a token and no fill", () => {
  const unit = buttonUnit();
  const outline = root(unit, "outline", "sm").box;
  assert.equal(outline.sw, 1);
  assert.equal(unit.tokens[outline.sc[0]].name, "color/secondary");
  assert.equal(outline.f, undefined);
});

test("text carries the computed font", () => {
  const text = root(buttonUnit(), "primary", "md").children[0];
  assert.deepEqual({ v: text.v, ff: text.ff, wt: text.wt, fs: text.fs, lh: text.lh }, { v: "Button", ff: "DM Sans", wt: 500, fs: 14, lh: 20 });
});

test("a repeated box or text is stored once", () => {
  const unit = buttonUnit();
  // 18 variants are 36 boxes and texts. Secondary and ghost draw the same box, so the set has
  // 13 distinct boxes (3 each for primary, secondary, destructive and outline, and 1 for link)
  // and 6 distinct texts (one for each text colour).
  assert.equal(unit.nodes.length, 19);
  assert.ok(JSON.stringify(unit).length < 6000, "a 6 x 3 set is a few kilobytes");
});

test("the description is the purpose in the inventory's own words", () => {
  assert.equal(describe({ useWhen: "any action a person clicks.", notFor: "navigation that should be a link", text: "" }), "Use when: any action a person clicks. Not for: navigation that should be a link.");
  assert.equal(describe({ useWhen: null, notFor: null, text: "A free-form comment" }), "A free-form comment");
  assert.equal(describe(null), "");
});

test("disabled and loading are a State property when asked for, with the opacity the browser drew", async () => {
  const capture = buttonCapture({ states: true });
  const unit = buildComponentUnit({
    item: { id: "Button", name: "Button", version: "1.0.0", page: "Generator test", description: "" },
    capture,
    options: OPTIONS,
  });
  assert.deepEqual(unit.axes.map((a) => a.name), ["Variant", "Size", "State"]);
  assert.deepEqual(unit.axes[2].values, ["default", "disabled"]);
  assert.equal(unit.cells.length, 36);

  const figma = newFigma();
  await run(figma, [unit]);
  const set = figma.page("Generator test").children[0];
  const names = set.children.map((c) => c.name);
  assert.ok(names.includes("Variant=destructive, Size=md, State=disabled"));
  assert.equal(set.children.find((c) => c.name === "Variant=primary, Size=md, State=disabled").opacity, 0.5);
  assert.equal(set.children.find((c) => c.name === "Variant=primary, Size=md, State=default").opacity, 1);
});

test("an icon is a hidden layer behind a Show icon property when icons are on", async () => {
  const unit = buildComponentUnit({
    item: { id: "Button", name: "Button", version: "1.0.0", page: "Generator test", description: "" },
    capture: buttonCapture(),
    options: { ...OPTIONS, icons: true },
  });
  assert.equal(unit.iconProperty, 1);
  const figma = newFigma();
  const result = await run(figma, [unit]);
  assert.equal(result.units[0].status, "written");

  const variant = figma.page("Generator test").children[0].children[0];
  const icon = variant.children.find((c) => c.name === "Icon");
  assert.ok(icon, "the variant has an Icon layer");
  assert.equal(icon.visible, false);
  assert.deepEqual(Object.keys(variant.properties), ["Show icon"]);
  assert.equal(variant.children[0], icon, "a leading icon comes before the text");

  // The icon is drawn in the colour of the words beside it, as a variable, so it shows on every variant.
  const variable = (name) => figma.variableList.find((v) => v.name === name).id;
  const strokeOf = (component) => component.children.find((c) => c.name === "Icon").children[0].strokes[0].boundVariables.color.id;
  const set = figma.page("Generator test").children[0];
  assert.equal(strokeOf(set.children.find((c) => c.name === "Variant=primary, Size=md")), variable("color/primary-foreground"));
  assert.equal(strokeOf(set.children.find((c) => c.name === "Variant=outline, Size=md")), variable("color/foreground"));
  assert.deepEqual(figma.variableList.find((v) => v.name === "color/foreground").scopes.toSorted(), ["SHAPE_FILL", "STROKE_COLOR", "TEXT_FILL"]);
});

test("the code binds colours to variables and sets the code syntax once", async () => {
  const figma = newFigma();
  const result = await run(figma, [buttonUnit()]);
  assert.equal(figma.collections.length, 1);
  assert.equal(figma.collections[0].name, "Meridian tokens");
  assert.equal(figma.collections[0].modes[0].name, "Light");

  const primary = figma.variableList.find((v) => v.name === "color/primary");
  assert.equal(primary.codeSyntax.WEB, "hsl(var(--primary))");
  assert.deepEqual(primary.scopes.toSorted(), ["FRAME_FILL", "SHAPE_FILL", "TEXT_FILL"]);
  assert.equal(result.tokens.made.length, 8);

  const variant = figma.page("Generator test").children[0].children.find((c) => c.name === "Variant=primary, Size=md");
  assert.equal(variant.fills[0].boundVariables.color.id, primary.id);
  const text = variant.children[0];
  const foreground = figma.variableList.find((v) => v.name === "color/primary-foreground");
  assert.equal(text.fills[0].boundVariables.color.id, foreground.id);
  assert.equal(variant.cornerRadius, 6);
  assert.equal(variant.height, 40);

  // A second version reuses the variables.
  const again = await run(figma, [buttonUnit({ version: "1.1.0" })]);
  assert.equal(again.tokens.made.length, 0);
  assert.equal(figma.variableList.length, 8);
});

test("a token that changed in the app is written through to its variable", async () => {
  const figma = newFigma();
  await run(figma, [buttonUnit()]);
  const unit = buttonUnit({ version: "1.1.0" });
  unit.tokens.find((t) => t.name === "color/primary").rgba = [10, 20, 30, 1];

  const result = await run(figma, [unit]);

  assert.deepEqual(result.tokens.updated, ["color/primary"]);
  assert.deepEqual(figma.variableList.find((v) => v.name === "color/primary").valuesByMode.m1, { r: 10 / 255, g: 20 / 255, b: 30 / 255, a: 1 });
});

test("a font missing from the file falls back to Inter and says so", async () => {
  const figma = newFigma();
  const unit = buttonUnit();
  unit.nodes = unit.nodes.map((n) => (n.k === "t" ? { ...n, ff: "Fancy Sans" } : n));
  const result = await run(figma, [unit]);
  assert.equal(result.units[0].status, "written");
  assert.match(result.warnings[0], /Fancy Sans is not in this file, so Inter is used/);
  let fonts = new Set();
  walk(figma.root, (n) => n.type === "TEXT" && fonts.add(n.fontName.family));
  assert.deepEqual([...fonts], ["Inter"]);
});

/** A captured box, as capture-browser.mjs readStory returns it. */
function capturedBox(fields) {
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
    borderWidth: [0, 0, 0, 0],
    borderStyle: "none",
    borderColor: [0, 0, 0, 0],
    radius: [0, 0, 0, 0],
    background: [0, 0, 0, 0],
    backgroundImage: false,
    opacity: 1,
    clip: false,
    children: [],
    ...fields,
  };
}

/** A calendar's column: a navigation bar placed over the caption, then the month, in auto layout. */
function calendarUnit() {
  const nav = capturedBox({ tag: "nav", x: 30, y: 40, w: 224, h: 28, position: "absolute", display: "flex" });
  const month = capturedBox({ tag: "div", x: 12, y: 12, w: 224, h: 260 });
  const column = capturedBox({ x: 12, y: 12, w: 224, h: 260, display: "flex", direction: "column", children: [nav, month] });
  const tree = capturedBox({ x: 0, y: 0, w: 250, h: 286, padding: [12, 12, 12, 12], borderWidth: [1, 1, 1, 1], children: [column] });
  const capture = { axes: [], tokens: [], cells: [{ key: {}, tree }], icon: null, spinner: null, warnings: [] };
  const item = { id: "Calendar", name: "Calendar", version: "1.0.0", page: "Calendar", description: "" };
  return buildComponentUnit({ item, capture, options: OPTIONS });
}

test("a child placed absolutely inside an auto layout keeps its place and does not size its parent", () => {
  const unit = calendarUnit();
  const [, [[columnId, [[navId], [monthId]]]]] = unit.cells[0][1];
  const column = unit.nodes[columnId];
  assert.equal(column.L, "V");
  assert.equal(column.fh, undefined, "the column hugs the month alone");
  assert.deepEqual({ ...unit.nodes[navId] }, { k: "b", n: "nav", w: 224, h: 28, x: 18, y: 28, ap: 1, L: "H", fw: 1, fh: 1 });
  assert.equal(unit.nodes[monthId].ap, undefined);
  assert.equal(unit.nodes[monthId].x, undefined, "the month flows");
  // The data file reader takes the new key.
  readData(JSON.stringify(dataFor({ units: [unit], config: { collection: "Tokens", mode: "Light" }, header: "test" })));
});

test("the code places an absolute child by position inside its auto layout", async () => {
  const figma = newFigma(["Calendar"]);
  const result = await run(figma, [calendarUnit()]);
  assert.equal(result.units[0].status, "written", JSON.stringify(result));
  const component = figma.page("Calendar").children[0];
  const column = component.children[0];
  const [nav, month] = column.children;
  assert.equal(column.layoutMode, "VERTICAL");
  assert.equal(nav.layoutPositioning, "ABSOLUTE");
  assert.deepEqual([nav.x, nav.y], [18, 28]);
  assert.equal(month.layoutPositioning, undefined);
});

/** A captured run of text, as readStory returns it. */
function capturedText(fields) {
  return { kind: "text", text: "Words", x: 0, y: 0, w: 40, h: 20, family: "Inter", weight: 400, size: 14, lineHeight: 20, letterSpacing: 0, decoration: "none", transform: "none", color: [0, 0, 0, 1], ...fields };
}

/** A dialog's header: a title and a two-line description, 6px apart by the description's top margin. */
function headerUnit() {
  const title = capturedBox({ tag: "h2", x: 25, y: 25, w: 375, h: 18, children: [capturedText({ text: "Edit profile", x: 25, y: 25, w: 90, h: 18, lineHeight: 18 })] });
  const description = capturedBox({ tag: "p", x: 25, y: 49, w: 375, h: 40, margin: [6, 0, 0, 0], children: [capturedText({ text: "Make changes to your profile here. Click save when you're done.", x: 25, y: 49, w: 360, h: 40 })] });
  const header = capturedBox({ x: 25, y: 25, w: 375, h: 64, display: "flex", direction: "column", margin: [0, 0, 0, 0], children: [title, description] });
  const capture = { axes: [], tokens: [], cells: [{ key: {}, tree: header }], icon: null, spinner: null, warnings: [] };
  const item = { id: "Dialog", name: "Dialog", version: "1.0.0", page: "Dialog", description: "" };
  return buildComponentUnit({ item, capture, options: OPTIONS });
}

test("text that wraps inside an auto layout keeps its width and wraps there too", () => {
  const unit = headerUnit();
  const [, [, [descriptionId]]] = unit.cells[0][1];
  const description = unit.nodes[descriptionId];
  assert.equal(description.wrap, 1);
  assert.equal(description.w, 375, "the header's content width, where the browser wrapped it");
  assert.equal(description.x, undefined, "it still flows");
});

test("margins between auto layout children become the spacing between them", () => {
  const unit = headerUnit();
  const header = unit.nodes[unit.cells[0][1][0]];
  assert.equal(header.g, 6, "the description's 6px top margin");
  assert.equal(header.fh, undefined, "18 + 6 + 40 is the header's height, so it hugs");
});

test("an icon keeps the opacity the browser drew it at", async () => {
  const svg = { kind: "svg", html: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path d="M0 0h16v16H0z"/></svg>', x: 150, y: 10, w: 16, h: 16, position: "static", opacity: 0.5 };
  const trigger = capturedBox({ tag: "button", w: 180, h: 36, display: "flex", children: [capturedText({ text: "Select a fruit", x: 12, y: 8, w: 90 }), svg] });
  const capture = { axes: [], tokens: [], cells: [{ key: {}, tree: trigger }], icon: null, spinner: null, warnings: [] };
  const unit = buildComponentUnit({ item: { id: "Select", name: "Select", version: "1.0.0", page: "Select", description: "" }, capture, options: OPTIONS });
  assert.equal(unit.nodes.find((n) => n.k === "v").o, 0.5);
  readData(JSON.stringify(dataFor({ units: [unit], config: { collection: "Tokens", mode: "Light" }, header: "test" })));

  const figma = newFigma(["Select"]);
  const result = await run(figma, [unit]);
  assert.equal(result.units[0].status, "written", JSON.stringify(result));
  const icon = figma.page("Select").children[0].children.find((n) => n.name === "Icon");
  assert.equal(icon.opacity, 0.5);
});
