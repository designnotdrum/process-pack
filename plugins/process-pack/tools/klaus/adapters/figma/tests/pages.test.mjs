/**
 * Which pages the runtime touches. It must create, move and delete nodes only on the page a unit
 * names, Older versions and Screens, even though Figma puts every new node on the current page.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createFigma, walk } from "./fake-figma.mjs";
import { buttonUnit, run, screenUnit } from "./helpers.mjs";

/** A file whose current page is a person's own, with a frame of their own on it. */
function fileWithAPersonsPage() {
  const figma = createFigma({ pages: ["Cover", "Button"] });
  const cover = figma.page("Cover");
  assert.equal(figma.currentPage, cover);
  // A frame of the person's own, made the way Figma makes any node: on the current page.
  const own = figma.createFrame();
  own.name = "Button 0.9.0";
  return { figma, cover, own };
}

/** Every node id on a page, for a before and after comparison. */
function idsOn(page) {
  const ids = [];
  walk(page, (n) => ids.push(n.id));
  return ids;
}

test("writing two versions touches only the component's page and Older versions", async () => {
  const { figma, cover, own } = fileWithAPersonsPage();
  const before = idsOn(cover);

  const first = await run(figma, [buttonUnit({ version: "1.0.0", page: "Button" })]);
  const second = await run(figma, [buttonUnit({ version: "1.1.0", page: "Button" })]);

  assert.deepEqual([first.units[0].status, second.units[0].status], ["written", "written"]);
  assert.deepEqual(idsOn(cover), before, "the current page is as it was");
  assert.equal(own.name, "Button 0.9.0", "a set-like name on another page is not taken for a version");
  assert.deepEqual(figma.page("Button").children.map((n) => n.name), ["Button 1.1.0"]);
  assert.deepEqual(figma.page("Older versions").children.map((n) => n.name), ["Button 1.0.0"]);
  assert.deepEqual(figma.root.children.map((p) => p.name), ["Cover", "Button", "Older versions"], "the only new page is Older versions");
});

test("a unit that fails part way leaves nothing behind, on its page or on the current page", async () => {
  const { figma, cover } = fileWithAPersonsPage();
  const before = idsOn(cover);
  // The font fails after the first text node exists: Figma has already put that node somewhere.
  figma.loadFontAsync = async () => {
    throw new Error("The font server did not answer.");
  };

  const result = await run(figma, [buttonUnit({ page: "Button" })]);

  assert.equal(result.units[0].status, "failed");
  assert.deepEqual(idsOn(cover), before, "no node was left on the current page");
  assert.deepEqual(figma.page("Button").children, [], "no node was left on the component's page");
});

test("editable screens and their retention touch only Screens", async () => {
  const { figma, cover } = fileWithAPersonsPage();
  const before = idsOn(cover);
  for (const release of ["v1", "v2", "v3"]) {
    const result = await run(figma, [screenUnit("/settings", release, { keep: 2 })]);
    assert.equal(result.units[0].status, "written");
  }
  assert.deepEqual(idsOn(cover), before);
  assert.deepEqual(figma.page("Screens").children.map((n) => n.name), ["/settings v2", "/settings v3"], "Screens keeps the last two");
});
