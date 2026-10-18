/** From what the browser read to the data the generated code builds from. */
import assert from "node:assert/strict";
import { test } from "node:test";
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
