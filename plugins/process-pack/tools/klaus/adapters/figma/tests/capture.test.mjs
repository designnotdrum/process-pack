/** The parts of the browser reader that do not need a browser, and one test that does when a build is at hand. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { argsParam, captureComponent, combinations, loadPlaywright, openStorybook, readStoryIndex, storyCandidates } from "../capture.mjs";

const story = (id, title, name, importPath = "./x.stories.tsx") => ({ id, type: "story", title, name, importPath });

test("story args are written the way a Storybook URL takes them", () => {
  assert.equal(argsParam({ variant: "secondary", size: "compact-sm", children: "Save changes", disabled: true, loading: false }), "variant:secondary;size:compact-sm;children:Save+changes;disabled:!true;loading:!false");
  assert.equal(argsParam({}), "");
  assert.throws(() => argsParam({ children: "a;b" }), /cannot be set from a story URL/);
  assert.throws(() => argsParam({ "bad key": "x" }), /cannot be set from a story URL/);
});

test("combinations run through the axes, the first one slowest", () => {
  const axes = [{ values: ["a", "b"] }, { values: [1, 2, 3] }];
  assert.deepEqual(combinations(axes).map((c) => c.join("")), ["a1", "a2", "a3", "b1", "b2", "b3"]);
  assert.deepEqual(combinations([]), [[]]);
});

test("a component's stories are found by the end of the title or the stories file name", () => {
  const entries = [
    story("shadcn-ui-button--variants", "shadcn-ui/Button", "Variants"),
    story("shadcn-ui-button--primary", "shadcn-ui/Button", "Primary"),
    story("shadcn-ui-input--with-button", "shadcn-ui/Input", "With Button"),
    story("custom--one", "Misc/Thing", "One", "./src/Button.stories.tsx"),
  ];
  assert.deepEqual(storyCandidates(entries, "Button"), ["shadcn-ui-button--primary", "shadcn-ui-button--variants", "custom--one"]);
  assert.deepEqual(storyCandidates(entries, "Data Table"), []);
  assert.deepEqual(storyCandidates(entries, "Button", "mine--story"), ["mine--story"]);
});

test("a Storybook index is read from index.json, and docs entries are not stories", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "klaus-sb-"));
  writeFileSync(path.join(dir, "index.json"), JSON.stringify({ v: 5, entries: { a: story("a", "T", "A"), b: { id: "b", type: "docs", title: "T", name: "Docs" } } }));
  assert.deepEqual(readStoryIndex(dir).map((e) => e.id), ["a"]);
  assert.throws(() => readStoryIndex(mkdtempSync(path.join(tmpdir(), "klaus-sb-"))), /not a Storybook build/);
});

test("a folder that is not a static build is refused with the way to fix it", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "klaus-sb-"));
  mkdirSync(path.join(root, "nope"));
  await assert.rejects(openStorybook({ root, directory: "nope", globals: "" }), /not a static Storybook build\. Run "storybook build" first/);
});

test("Playwright is looked for in the repo the design files are for", () => {
  const root = mkdtempSync(path.join(tmpdir(), "klaus-pw-"));
  writeFileSync(path.join(root, "package.json"), "{}");
  assert.throws(() => loadPlaywright(root), /Playwright is not installed in /);
});

// A real browser, against a real build. Set KLAUS_TEST_STORYBOOK to a static Storybook build that
// has a Button story, and KLAUS_TEST_REPO to a repo that has Playwright installed.
test("a real build is read cell by cell", { skip: !process.env.KLAUS_TEST_STORYBOOK || !process.env.KLAUS_TEST_REPO }, async () => {
  const storybook = await openStorybook({ root: process.env.KLAUS_TEST_REPO, directory: process.env.KLAUS_TEST_STORYBOOK, globals: "theme:light" });
  try {
    const capture = await captureComponent(storybook, {
      name: "Button",
      axes: [{ prop: "variant", name: "Variant", values: ["primary", "outline"] }, { prop: "size", name: "Size", values: ["sm", "md"] }],
      states: [],
      label: "Button",
      icons: false,
    });
    assert.equal(capture.cells.length, 4);
    assert.ok(capture.tokens.length > 0);
    const primary = capture.cells[0].tree;
    assert.equal(primary.kind, "box");
    assert.equal(primary.children[0].text, "Button");
    assert.ok(primary.bind.background, "the fill is traced to a token");
  } finally {
    await storybook.close();
  }
});
