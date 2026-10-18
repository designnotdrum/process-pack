/** A new version moves the previous one to the Older versions page. Nothing is overwritten. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { walk } from "./fake-figma.mjs";
import { buttonUnit, newFigma, run } from "./helpers.mjs";

const names = (page) => page.children.map((n) => n.name);

test("the first version is written to its page, and no Older versions page is made", async () => {
  const figma = newFigma();
  const result = await run(figma, [buttonUnit({ version: "1.0.0" })]);

  assert.equal(result.units[0].status, "written");
  assert.deepEqual(names(figma.page("Generator test")), ["Button 1.0.0"]);
  assert.equal(figma.page("Older versions"), undefined);
  assert.deepEqual(result.units[0].movedToOlder, []);
});

test("the set has one component for every Variant and Size, named like the prototype", async () => {
  const figma = newFigma();
  await run(figma, [buttonUnit()]);
  const set = figma.page("Generator test").children[0];

  assert.equal(set.type, "COMPONENT_SET");
  assert.equal(set.children.length, 18);
  assert.equal(set.children[0].name, "Variant=primary, Size=sm");
  assert.equal(set.children.at(-1).name, "Variant=link, Size=lg");
  assert.equal(new Set(set.children.map((c) => c.name)).size, 18);
  assert.match(set.description, /^Use when: any action a person clicks\. Not for: /);
});

test("writing the next version moves the previous set to Older versions and keeps it whole", async () => {
  const figma = newFigma();
  await run(figma, [buttonUnit({ version: "1.0.0" })]);
  const first = figma.page("Generator test").children[0];
  first.x = 300;
  first.y = 40;

  const result = await run(figma, [buttonUnit({ version: "1.1.0" })]);

  assert.deepEqual(names(figma.page("Generator test")), ["Button 1.1.0"]);
  assert.deepEqual(names(figma.page("Older versions")), ["Button 1.0.0"]);
  assert.deepEqual(result.units[0].movedToOlder, ["Button 1.0.0"]);
  // The old set is the same node, still with all its variants.
  assert.equal(figma.page("Older versions").children[0], first);
  assert.equal(first.children.length, 18);
  // The new set takes the place the old one had.
  const latest = figma.page("Generator test").children[0];
  assert.deepEqual([latest.x, latest.y], [300, 40]);
});

test("several earlier versions stay on Older versions, oldest first", async () => {
  const figma = newFigma();
  for (const version of ["1.0.0", "1.1.0", "1.2.0", "1.10.0"]) await run(figma, [buttonUnit({ version })]);

  assert.deepEqual(names(figma.page("Generator test")), ["Button 1.10.0"]);
  assert.deepEqual(names(figma.page("Older versions")), ["Button 1.0.0", "Button 1.1.0", "Button 1.2.0"]);
  const older = figma.page("Older versions").children;
  assert.ok(older[0].x < older[1].x && older[1].x < older[2].x, "older sets sit left to right in version order");
});

test("a version that is already in the file is left alone", async () => {
  const figma = newFigma();
  await run(figma, [buttonUnit({ version: "1.0.0" })]);
  const before = figma.page("Generator test").children[0];

  const again = await run(figma, [buttonUnit({ version: "1.0.0" })]);

  assert.equal(again.units[0].status, "exists");
  assert.equal(figma.page("Generator test").children.length, 1);
  assert.equal(figma.page("Generator test").children[0], before);

  await run(figma, [buttonUnit({ version: "1.1.0" })]);
  const rerun = await run(figma, [buttonUnit({ version: "1.0.0" })]);
  assert.equal(rerun.units[0].status, "exists", "a version on Older versions is not written again either");
  assert.deepEqual(names(figma.page("Older versions")), ["Button 1.0.0"]);
});

test("a version older than the latest goes straight to Older versions", async () => {
  const figma = newFigma();
  await run(figma, [buttonUnit({ version: "1.1.0" })]);

  const result = await run(figma, [buttonUnit({ version: "1.0.5" })]);

  assert.equal(result.units[0].status, "written");
  assert.deepEqual(names(figma.page("Generator test")), ["Button 1.1.0"]);
  assert.deepEqual(names(figma.page("Older versions")), ["Button 1.0.5"]);
});

test("other components on the page are not touched, and neither are sets of a different name", async () => {
  const figma = newFigma(["Cards"]);
  const note = figma.page("Cards");
  const other = { ...buttonUnit({ version: "1.0.0", page: "Cards" }), id: "Card", name: "Card" };
  await run(figma, [other]);
  await run(figma, [buttonUnit({ version: "1.0.0", page: "Cards" })]);
  assert.deepEqual(names(note), ["Card 1.0.0", "Button 1.0.0"]);

  await run(figma, [buttonUnit({ version: "1.1.0", page: "Cards" })]);

  assert.deepEqual(names(note), ["Card 1.0.0", "Button 1.1.0"]);
  assert.deepEqual(names(figma.page("Older versions")), ["Button 1.0.0"]);
});

test("a name that only starts like the component is not mistaken for an earlier version", async () => {
  const figma = newFigma(["Cards"]);
  const long = { ...buttonUnit({ version: "1.0.0", page: "Cards" }), id: "Button Group", name: "Button Group" };
  await run(figma, [long]);

  await run(figma, [buttonUnit({ version: "1.0.0", page: "Cards" })]);

  assert.deepEqual(names(figma.page("Cards")), ["Button Group 1.0.0", "Button 1.0.0"]);
  assert.equal(figma.page("Older versions"), undefined);
});

test("a component without variants is a single component and moves the same way", async () => {
  const figma = newFigma();
  const flat = (version) => ({ ...buttonUnit({ version }), axes: [], cells: [[[], buttonUnit().cells[0][1]]] });
  await run(figma, [flat("1.0.0")]);
  assert.equal(figma.page("Generator test").children[0].type, "COMPONENT");

  await run(figma, [flat("2.0.0")]);

  assert.deepEqual(names(figma.page("Generator test")), ["Button 2.0.0"]);
  assert.deepEqual(names(figma.page("Older versions")), ["Button 1.0.0"]);
});

test("the code never switches the current page, which Figma allows once per call", async () => {
  const figma = newFigma();
  await run(figma, [buttonUnit({ version: "1.0.0" }), { ...buttonUnit({ version: "1.0.0", page: "Elsewhere" }), id: "Other" }]);
  assert.equal(figma.calls.setCurrentPage, undefined);
});

test("a set that fails is removed again and the next unit still runs", async () => {
  const figma = newFigma();
  const broken = buttonUnit({ version: "1.0.0", page: "Broken" });
  broken.nodes = broken.nodes.map((n) => (n.k === "t" ? { ...n, ff: "Nope Sans", wt: 400 } : n));
  broken.svgs = [];
  broken.nodes.push({ k: "v", s: 7, w: 16, h: 16 });
  broken.cells[5][1][1].push([broken.nodes.length - 1, []]);

  const result = await run(figma, [broken, { ...buttonUnit({ version: "1.0.0", page: "Fine" }), id: "Fine" }]);

  assert.equal(result.units[0].status, "failed");
  assert.match(result.units[0].error, /Not an SVG/, "the failure is the unreadable icon, not something else");
  assert.equal(result.units[1].status, "written");
  assert.deepEqual(names(figma.page("Broken")), [], "nothing is left on the page after a failure");
  let strays = 0;
  walk(figma.root, (n) => {
    if (n.type === "COMPONENT" && n.parent?.type === "PAGE") strays += 1;
  });
  assert.equal(strays, 0, "no loose component is left on the first page");
});

test("a pre-release is older than its release, and pre-release tags compare part by part", async () => {
  const figma = newFigma();
  for (const version of ["1.1.0-rc.2", "1.1.0-rc.10", "1.1.0", "1.1.0-rc.11"]) await run(figma, [buttonUnit({ version })]);

  assert.deepEqual(names(figma.page("Generator test")), ["Button 1.1.0"]);
  // rc.2 and rc.10 were written in turn, so rc.2 moved when rc.10 arrived. rc.11 is older than 1.1.0 and goes straight on.
  assert.deepEqual(names(figma.page("Older versions")), ["Button 1.1.0-rc.2", "Button 1.1.0-rc.10", "Button 1.1.0-rc.11"]);
});

const approx = (color) => [color.r, color.g, color.b].map((v) => Math.round(v * 255));

/** Every fill and stroke under a node, with the node's name. */
function paintsUnder(root) {
  const found = [];
  walk(root, (n) => {
    for (const key of ["fills", "strokes"]) for (const paint of n[key] ?? []) found.push({ node: n, key, paint });
  });
  return found;
}

const bound = (paint) => Boolean(paint.boundVariables?.color);

test("a version that moves to Older versions is frozen at the colours it shipped with", async () => {
  const figma = newFigma();
  await run(figma, [buttonUnit({ version: "1.0.0" })]);
  const first = figma.page("Generator test").children[0];
  const fillOf = (set, name) => set.children.find((c) => c.name === name).fills[0];
  const strokeOf = (set, name) => set.children.find((c) => c.name === name).strokes[0];
  const textFillOf = (set, name) => set.children.find((c) => c.name === name).children[0].fills[0];
  assert.deepEqual(approx(fillOf(first, "Variant=primary, Size=md").color), [124, 58, 237]);
  const boundBefore = paintsUnder(first).filter(({ paint }) => bound(paint)).length;
  assert.equal(boundBefore, 27, "9 fills, 3 strokes and 15 text fills are bound before the move");

  // The app changes three tokens: a fill, a text colour and a stroke.
  const next = buttonUnit({ version: "1.1.0" });
  const set = (name, rgba) => (next.tokens.find((t) => t.name === name).rgba = rgba);
  set("color/primary", [10, 20, 30, 1]);
  set("color/primary-foreground", [40, 50, 60, 1]);
  set("color/secondary", [1, 2, 3, 1]);
  await run(figma, [next]);

  // The old set kept the colours it shipped with, and nothing in it is bound any more.
  const frozen = figma.page("Older versions").children[0];
  assert.equal(frozen, first);
  assert.deepEqual(approx(fillOf(frozen, "Variant=primary, Size=md").color), [124, 58, 237]);
  assert.deepEqual(approx(textFillOf(frozen, "Variant=primary, Size=md").color), [248, 250, 252]);
  assert.deepEqual(approx(strokeOf(frozen, "Variant=outline, Size=md").color), [241, 245, 249]);
  const all = paintsUnder(frozen);
  assert.equal(all.length, paintsUnder(first).length);
  assert.equal(all.filter(({ paint }) => paint.color).length, boundBefore, "the 27 paints are still drawn, as plain colours");
  assert.equal(all.filter(({ paint }) => bound(paint)).length, 0, "no fill or stroke in the old set is bound to a variable");

  // The new set is bound and shows the new colours.
  const latest = figma.page("Generator test").children[0];
  const primary = figma.variableList.find((v) => v.name === "color/primary");
  assert.equal(fillOf(latest, "Variant=primary, Size=md").boundVariables.color.id, primary.id);
  assert.deepEqual(approx(fillOf(latest, "Variant=primary, Size=md").color), [10, 20, 30]);
  assert.deepEqual(approx(textFillOf(latest, "Variant=primary, Size=md").color), [40, 50, 60]);
  assert.deepEqual(approx(strokeOf(latest, "Variant=outline, Size=md").color), [1, 2, 3]);
  assert.equal(paintsUnder(latest).filter(({ paint }) => bound(paint)).length, boundBefore, "every colour in the new set is bound");

  // The variable now holds the new colour.
  assert.deepEqual(approx(primary.valuesByMode.m1), [10, 20, 30]);
});

test("a frozen set says so on its description, after the description it had", async () => {
  const figma = newFigma();
  await run(figma, [buttonUnit({ version: "1.0.0" })]);
  await run(figma, [buttonUnit({ version: "1.1.0" })]);

  const frozen = figma.page("Older versions").children[0];
  assert.equal(
    frozen.description,
    "Use when: any action a person clicks. Not for: navigation that should be a link.\nFrozen when 1.1.0 shipped; colours are the values at that time.",
  );
  assert.equal(figma.page("Generator test").children[0].description.includes("Frozen"), false, "the current version is not frozen");
});

test("a version written straight to Older versions is frozen too, and the current version stays bound", async () => {
  const figma = newFigma();
  await run(figma, [buttonUnit({ version: "1.1.0" })]);
  const backfill = buttonUnit({ version: "1.0.5" });
  backfill.tokens.find((t) => t.name === "color/primary").rgba = [9, 9, 9, 1];

  await run(figma, [backfill]);

  const older = figma.page("Older versions").children[0];
  assert.equal(older.name, "Button 1.0.5");
  assert.equal(paintsUnder(older).filter(({ paint }) => bound(paint)).length, 0);
  assert.match(older.description, /Frozen when 1\.1\.0 shipped; colours are the values at that time\.$/);
  const current = figma.page("Generator test").children[0];
  assert.ok(paintsUnder(current).some(({ paint }) => bound(paint)));
});

test("a token that changes with no new version moves the current version's colours and leaves it bound", async () => {
  const figma = newFigma();
  await run(figma, [buttonUnit({ version: "1.0.0" })]);
  const again = buttonUnit({ version: "1.0.0" });
  again.tokens.find((t) => t.name === "color/primary").rgba = [10, 20, 30, 1];

  const result = await run(figma, [again]);

  assert.equal(result.units[0].status, "exists");
  assert.deepEqual(result.tokens.updated, ["color/primary"]);
  const fill = figma.page("Generator test").children[0].children.find((c) => c.name === "Variant=primary, Size=md").fills[0];
  assert.ok(bound(fill));
  assert.deepEqual(approx(fill.color), [10, 20, 30]);
});
