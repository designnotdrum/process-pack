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
  assert.match(result.units[0].error, /./);
  assert.equal(result.units[1].status, "written");
  assert.deepEqual(names(figma.page("Broken")), [], "nothing is left on the page after a failure");
  let strays = 0;
  walk(figma.root, (n) => {
    if (n.type === "COMPONENT" && n.parent?.type === "PAGE") strays += 1;
  });
  assert.equal(strays, 0, "no loose component is left on the first page");
});
