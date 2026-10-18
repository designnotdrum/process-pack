/** The parts of the browser reader that do not need a browser, and one test that does when a build is at hand. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { argsParam, captureComponent, combinations, loadPlaywright, openStorybook, readStoryIndex, serve, storyCandidates } from "../capture.mjs";

const story = (id, title, name, importPath = "./x.stories.tsx") => ({ id, type: "story", title, name, importPath });

test("story args are written the way a Storybook URL takes them", () => {
  assert.equal(argsParam({ variant: "secondary", size: "compact-sm", children: "Save changes", disabled: true, loading: false }), "variant:secondary;size:compact-sm;children:Save+changes;disabled:!true;loading:!false");
  assert.equal(argsParam({}), "");
  assert.equal(argsParam({ size: "1.5" }), "size:1.5");
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

test("the local server answers a bad request with an error and keeps running", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "klaus-serve-"));
  writeFileSync(path.join(dir, "iframe.html"), "<html></html>");
  const { server, port } = await serve(dir);
  try {
    const get = (url, init) => fetch(`http://127.0.0.1:${port}${url}`, init);
    assert.equal((await get("/iframe.html")).status, 200);
    assert.equal((await get("/%ZZ")).status, 400, "a malformed percent sequence");
    assert.equal((await get("/..%2f..%2fetc%2fpasswd")).status, 403, "a path out of the folder");
    assert.equal((await get("/iframe.html", { method: "POST", body: "x" })).status, 405);
    assert.equal((await get("/missing.js")).status, 404);
    assert.equal((await get("/iframe.html")).status, 200, "still serving after the bad requests");
  } finally {
    server.close();
  }
});

test("when every story fails to render, the error says that and not that the args do nothing", async () => {
  const storybook = {
    entries: [story("ui-button--primary", "UI/Button", "Primary")],
    page: {},
    async show() {
      throw new Error("The story ui-button--primary failed to render: boom");
    },
  };
  const request = { name: "Button", axes: [{ prop: "variant", name: "Variant", values: ["a", "b"] }], states: [], label: "Button", icons: false };
  await assert.rejects(captureComponent(storybook, request), /could not be rendered\. The last error: The story ui-button--primary failed to render: boom/);
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
    assert.ok(capture.tokens.some((t) => t.name === "--primary"), `expected the primary token, got ${capture.tokens.map((t) => t.name)}`);
    const primary = capture.cells[0].tree;
    assert.equal(primary.kind, "box");
    assert.equal(primary.children[0].text, "Button");
    assert.ok(primary.bind.background, "the fill is traced to a token");
  } finally {
    await storybook.close();
  }
});
