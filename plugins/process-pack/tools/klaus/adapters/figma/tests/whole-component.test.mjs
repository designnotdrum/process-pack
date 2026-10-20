/**
 * The reader draws the whole component: text at any depth, overlays open with their portal content,
 * and the component's own box rather than a story decorator's.
 *
 * These run in a real browser against a small stand-in for a Storybook build
 * (fixtures/whole-component). Set KLAUS_TEST_REPO to a repo with @playwright/test and a browser
 * installed; without it they are skipped.
 */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { captureComponent, openStorybook } from "../capture.mjs";

const repo = process.env.KLAUS_TEST_REPO;
const browser = { skip: repo ? false : "set KLAUS_TEST_REPO to a repo with Playwright and a browser installed" };
const directory = fileURLToPath(new URL("./fixtures/whole-component/", import.meta.url));

async function capture(name, { label = false } = {}) {
  const storybook = await openStorybook({ root: repo, directory, globals: "" });
  try {
    return await captureComponent(storybook, { name, axes: [], states: [], label, icons: false });
  } finally {
    await storybook.close();
  }
}

/** Every node of a captured tree, root first. */
function nodesOf(node, out = []) {
  out.push(node);
  for (const child of node.children ?? []) nodesOf(child, out);
  return out;
}

const textsOf = (tree) => nodesOf(tree).filter((n) => n.kind === "text");

test("a calendar month is read whole: all 42 days, eight levels down, and the caption", browser, async () => {
  const { cells } = await capture("Calendar");
  const texts = textsOf(cells[0].tree).map((n) => n.text);
  assert.equal(texts.filter((t) => /^\d+$/.test(t)).length, 42, `read ${JSON.stringify(texts)}`);
  assert.ok(texts.includes("October 2026"));
  const nav = nodesOf(cells[0].tree).find((n) => n.tag === "nav");
  assert.equal(nav.position, "absolute", "the navigation bar is placed over the caption, not in the flow");
});

test("a story that draws more than the reader's limit is cut there, with a warning", browser, async () => {
  const { cells, warnings } = await capture("Crowded");
  const read = nodesOf(cells[0].tree).length;
  assert.ok(read > 60 && read < 3000, `read ${read} nodes`);
  assert.ok(warnings.some((w) => /Crowded draws more than \d+ elements/.test(w)), `warnings: ${JSON.stringify(warnings)}`);
});

test("an input's value and placeholder are read as text, the placeholder in its own colour", browser, async () => {
  const { cells } = await capture("Field");
  const texts = textsOf(cells[0].tree);
  const placeholder = texts.find((n) => n.text === "Enter text...");
  const value = texts.find((n) => n.text === "Pedro Duarte");
  assert.ok(placeholder && value, `read ${JSON.stringify(texts.map((n) => n.text))}`);
  assert.deepEqual(placeholder.color, [136, 136, 136, 1]);
  assert.deepEqual(value.color, [17, 17, 17, 1]);
  // The browser centres an input's one line in its content box, 36 - 2 * (4 + 1) = 26 pixels high.
  assert.equal(placeholder.lineHeight, 26);
});

test("an overlay drawn closed is opened with a click, and its portal content is read with the trigger", browser, async () => {
  const { cells } = await capture("Popover");
  const tree = cells[0].tree;
  const texts = textsOf(tree).map((n) => n.text);
  assert.ok(texts.includes("Open popover"), "the trigger");
  assert.ok(texts.includes("Dimensions") && texts.includes("Set the dimensions for the layer."), `the content: ${JSON.stringify(texts)}`);
  assert.ok(!texts.includes("Not drawn"), "content kept out of the document is not read");
  const content = tree.children.find((n) => n.kind === "box" && n.position === "fixed");
  assert.ok(content, "the content is a part of the component");
  // The story root's 16px padding puts the trigger at 16, 16. The panel is 4px below its wrapper.
  assert.deepEqual([tree.x, tree.y], [16, 16], "the component's box starts at the trigger");
  const panel = content.children[0];
  assert.equal(panel.y, content.y + 4);
  assert.equal(tree.y + tree.h, content.y + 4 + panel.h, "the component's box holds the whole panel, 4px below its wrapper");
  const input = nodesOf(tree).find((n) => n.tag === "input");
  assert.deepEqual(input.borderColor, [204, 204, 204, 1], "drawn at rest: the focus the overlay moved into the input is let go");
});

test("an overlay with a defaultOpen arg opens from the arg, and a modal's backdrop and what it covers are left out", browser, async () => {
  const { cells } = await capture("Dialog");
  const tree = cells[0].tree;
  const texts = textsOf(tree).map((n) => n.text);
  assert.ok(texts.includes("Make changes to your profile here."), `read ${JSON.stringify(texts)}`);
  assert.ok(!texts.includes("Open dialog"), "the trigger sits under the backdrop");
  assert.equal(tree.w, 300, "the dialog's own width, not the window's");
  assert.ok(!nodesOf(tree).some((n) => n.kind === "box" && n.background?.[3] === 0.8), "no backdrop");
});

test("a story decorator is left out: padding and size come from the component's own box", browser, async () => {
  const { cells } = await capture("Panel");
  const tree = cells[0].tree;
  assert.deepEqual(tree.padding, [12, 12, 12, 12]);
  assert.equal(tree.w, 186, "160 wide, 12 of padding and a 1px border each side");
  const texts = textsOf(tree).map((n) => n.text);
  assert.deepEqual(texts, ["Panel body"]);
});

test("the label replaces a story's text children only, not markup", browser, async () => {
  const { cells } = await capture("Panel", { label: "Panel" });
  assert.deepEqual(textsOf(cells[0].tree).map((n) => n.text), ["Panel body"]);
});
