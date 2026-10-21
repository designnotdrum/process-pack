/**
 * Every story of a component becomes a variant of its set, under a Story property (process-pack #86).
 *
 * The browser test reads the Chip in the stand-in Storybook build (fixtures/whole-component). Set
 * KLAUS_TEST_REPO to a repo with Playwright and a browser installed; without it that test is skipped.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { codeChars, packUnits } from "../batch.mjs";
import { captureComponent, componentStories, openStorybook, sameDrawing, storyCandidates, storyKey, storyValue, storyValues } from "../capture.mjs";
import { readData } from "../data-file.mjs";
import { buildComponent, createAdapter } from "../index.mjs";
import { reconcileCode } from "../relay/reconcile.mjs";
import { MAX_CODE_CHARS } from "../settings.mjs";
import { buildComponentUnit } from "../spec.mjs";
import { runCode } from "./fake-figma.mjs";
import { buttonCapture, buttonUnit, CONFIG, newFigma, OPTIONS, run } from "./helpers.mjs";

const repo = process.env.KLAUS_TEST_REPO;
const browser = { skip: repo ? false : "set KLAUS_TEST_REPO to a repo with Playwright and a browser installed" };
const directory = fileURLToPath(new URL("./fixtures/whole-component/", import.meta.url));

const entry = (id, title, name) => ({ id, type: "story", title, name, importPath: `./${title.split("/").at(-1)}.stories.tsx` });
const item = (name = "Button", version = "1.0.0") => ({ id: name, name, version, page: "Generator test", description: "" });

/** The Button capture's primary, md variant with other words in it and another width, as a story would draw it. */
function storyTree(words, w = 120) {
  const tree = structuredClone(buttonCapture().cells[0].tree);
  tree.w = w;
  tree.children = tree.children.map((child) => (child.kind === "text" ? { ...child, text: words } : child));
  return tree;
}

/** Button with stories beside the one its axes come from. */
function withStories(stories) {
  return { ...buttonCapture(), storyValue: "Primary", stories, leftOut: [] };
}

const story = (name, key, words = name, from = Object.fromEntries(Object.keys(key).map((axis) => [axis, "arg"]))) => ({ id: `button--${name.toLowerCase().replace(/\W+/g, "-")}`, name, value: storyValue(name), key, from, tree: storyTree(words) });

test("#86 a story's name is a Story value Figma accepts: commas become semicolons and equals signs colons", () => {
  assert.equal(storyValue("First run, cannot create"), "First run; cannot create");
  assert.equal(storyValue("a=b"), "a:b");
  assert.equal(storyValue("  Needs attention: overdue "), "Needs attention: overdue");
  assert.equal(storyValue("Loading skeleton (card)"), "Loading skeleton (card)");
});

test("#86 two stories of one component with the same name are told apart by their titles", () => {
  const index = [
    entry("shadcn-ui-dropdown-menu--default", "shadcn-ui/Dropdown Menu", "Default"),
    entry("shadcn-ui-dropdown-menu--simple", "shadcn-ui/Dropdown Menu", "Simple"),
    entry("ui-dropdownmenu--default", "UI/DropdownMenu", "Default"),
  ];
  assert.deepEqual(componentStories(index, "DropdownMenu").map((e) => e.id), index.map((e) => e.id), "both files are the component's, in the index's order");
  assert.deepEqual(storyValues(index), ["Default (shadcn-ui/Dropdown Menu)", "Simple", "Default (UI/DropdownMenu)"]);
  assert.deepEqual(storyCandidates(index, "DropdownMenu"), ["shadcn-ui-dropdown-menu--default", "ui-dropdownmenu--default", "shadcn-ui-dropdown-menu--simple"], "the pick for the axes still puts Default first");
});

const AXES = [
  { prop: "variant", name: "Variant", values: ["primary", "outline"] },
  { prop: "size", name: "Size", values: ["sm", "md"] },
  { prop: "count", name: "Count", values: [1, 2] },
  { prop: null, name: "State", values: ["default", "loading", "disabled"] },
];

test("#86 label step 1: a story's own arg sets an axis when it is one of the axis's values", () => {
  assert.deepEqual(storyKey(AXES, { args: { variant: "outline", size: "md", count: 2, disabled: true } }), {
    key: { Variant: "outline", Size: "md", Count: 2, State: "disabled" },
    from: { Variant: "arg", Size: "arg", Count: "arg", State: "arg" },
  });
  const { key, from } = storyKey(AXES, { args: { variant: "huge", count: "2", loading: true, disabled: true } });
  assert.deepEqual([key.Count, from.Count, key.State, from.State], [2, "arg", "loading", "arg"], "a number given as text, and the first state set");
  assert.notEqual(from.Variant, "arg", "huge is not one of the values");
});

test("#86 label step 2: without an arg, the prop the story's component was rendered with, as Alert Destructive sets its variant in its render", () => {
  const { key, from } = storyKey(AXES, { args: {}, props: { variant: "outline", size: "huge", disabled: true } });
  assert.deepEqual([key.Variant, from.Variant], ["outline", "props"]);
  assert.deepEqual([key.State, from.State], ["disabled", "props"]);
  assert.notEqual(from.Size, "props", "huge is not one of the values");
  assert.deepEqual(storyKey(AXES, { args: { variant: "primary" }, props: { variant: "outline" } }).key.Variant, "primary", "an arg comes first");
  assert.deepEqual(storyKey([AXES[3]], { props: {} }), { key: { State: "default" }, from: { State: "props" } }, "rendered with neither state is the default state");
});

test("#86 label step 3: a prop left to the component's default takes the value whose cell draws the same root class list, when exactly one does", () => {
  const cells = [
    { key: { Variant: "primary", Size: "sm" }, classes: ["btn", "btn-primary", "h-8"] },
    { key: { Variant: "primary", Size: "md" }, classes: ["btn", "btn-primary", "h-10"] },
    { key: { Variant: "outline", Size: "sm" }, classes: ["btn", "btn-outline", "h-8"] },
    { key: { Variant: "outline", Size: "md" }, classes: ["btn", "btn-outline", "h-10"] },
  ];
  const axes = AXES.slice(0, 2);
  assert.deepEqual(storyKey(axes, { props: {}, classes: ["h-10", "btn-outline", "btn"], cells }), { key: { Variant: "outline", Size: "md" }, from: { Variant: "classes", Size: "classes" } });
  // Two sizes draw one class list: the Size match is not unique, so Size is a guess. Variant still matches.
  const same = [...cells, { key: { Variant: "outline", Size: "sm" }, classes: ["btn", "btn-outline", "h-10"] }];
  assert.deepEqual(storyKey(axes, { props: {}, classes: ["btn", "btn-outline", "h-10"], cells: same }), { key: { Variant: "outline", Size: "sm" }, from: { Variant: "classes", Size: "first" } });
  // A class the axes' story never draws, such as a story's own w-full, matches no cell.
  assert.deepEqual(storyKey(axes, { props: {}, classes: ["btn", "btn-primary", "h-10", "w-full"], cells }).from, { Variant: "first", Size: "first" });
});

test("#86 label step 4: with nothing to go by, the axis's first value, marked as a guess", () => {
  assert.deepEqual(storyKey(AXES, {}), { key: { Variant: "primary", Size: "sm", Count: 1, State: "default" }, from: { Variant: "first", Size: "first", Count: "first", State: "first" } });
});

test("#86 a drawing is the same wherever it sits on the page, and not the same with other words", () => {
  const a = storyTree("Save");
  const moved = structuredClone(a);
  moved.x += 40;
  moved.y += 8;
  for (const child of moved.children) Object.assign(child, { x: child.x + 40, y: child.y + 8 });
  assert.ok(sameDrawing(a, moved));
  assert.ok(!sameDrawing(a, storyTree("Cancel")));

  // Two reads of one story under React Flow's zoom differ by a fraction of a pixel. A pixel more is another drawing.
  const zoomed = structuredClone(a);
  Object.assign(zoomed, { w: a.w - 0.24, h: a.h + 0.12 });
  zoomed.children[0].x += 0.3;
  assert.ok(sameDrawing(a, zoomed));
  const wider = structuredClone(a);
  wider.w += 2;
  assert.ok(!sameDrawing(a, wider));
  const recoloured = structuredClone(a);
  recoloured.background = [0, 0, 0, 1];
  assert.ok(!sameDrawing(a, recoloured));
});

test("#86 a component with more than one story gets a Story property first, the axes' story keeping all its cells", () => {
  const unit = buildComponentUnit({ item: item(), capture: withStories([story("With Icons", { Variant: "outline", Size: "lg" }), story("Loading", { Variant: "primary", Size: "sm" })]), options: OPTIONS });
  assert.deepEqual(unit.axes.map((a) => a.name), ["Story", "Variant", "Size"]);
  assert.deepEqual(unit.axes[0].values, ["Primary", "With Icons", "Loading"]);
  assert.equal(unit.cells.length, 18 + 2);
  assert.ok(unit.cells.slice(0, 18).every(([at]) => at[0] === 0), "the 18 cells of Primary come first");
  assert.deepEqual(unit.cells[18][0], [1, 3, 2], "With Icons at outline, lg");
  assert.deepEqual(unit.cells[19][0], [2, 0, 0], "Loading at primary, sm");
});

test("#86 a component with one story draws as before, with no Story property", () => {
  const before = buttonUnit();
  const after = buildComponentUnit({ item: { ...item(), page: "Generator test", description: "Use when: any action a person clicks. Not for: navigation that should be a link." }, capture: withStories([]), options: OPTIONS });
  assert.deepEqual(after, before);
});

test("#86 the set has a variant per story, named Story=..., and the stories sit below the axes' grid, one to a row", async () => {
  const unit = buildComponentUnit({ item: item(), capture: withStories([story("With Icons, wide", { Variant: "outline", Size: "lg" }), story("Loading", { Variant: "primary", Size: "sm" })]), options: OPTIONS });
  const figma = newFigma(["Generator test"]);
  const result = await run(figma, [unit]);
  assert.equal(result.units[0].status, "written");
  assert.equal(result.units[0].variants, 20);
  const set = figma.page("Generator test").children[0];
  assert.equal(set.name, "Button 1.0.0");
  assert.equal(set.children[0].name, "Story=Primary, Variant=primary, Size=sm");
  assert.equal(set.children[18].name, "Story=With Icons; wide, Variant=outline, Size=lg");
  assert.ok(set.children.every((c) => c.variantProperties !== null), "Figma reads every variant's properties");
  assert.deepEqual(set.children[19].variantProperties, { Story: "Loading", Variant: "primary", Size: "sm" });

  // The grid is the one a set without stories gets.
  const plain = newFigma(["Generator test"]);
  await run(plain, [buttonUnit()]);
  const old = plain.page("Generator test").children[0];
  for (let i = 0; i < 18; i++) assert.deepEqual([set.children[i].x, set.children[i].y], [old.children[i].x, old.children[i].y]);
  const gridBottom = Math.max(...set.children.slice(0, 18).map((c) => c.y + c.height));
  const [icons, loading] = set.children.slice(18);
  assert.deepEqual([icons.x, loading.x], [24, 24]);
  assert.equal(icons.y, gridBottom + 16);
  assert.equal(loading.y, icons.y + icons.height + 16);
  assert.equal(set.height, loading.y + loading.height + 24);
  assert.ok(set.width >= old.width);
});

test("#86 a component with no axes and several stories becomes a set of its stories, one to a row", async () => {
  const capture = { ...buttonCapture(), axes: [], cells: [{ key: {}, tree: storyTree("Card") }], storyValue: "Default", stories: [story("Simple", {}), story("Long Content", {})], leftOut: [] };
  const unit = buildComponentUnit({ item: item("Card"), capture, options: OPTIONS });
  assert.deepEqual(unit.axes, [{ name: "Story", values: ["Default", "Simple", "Long Content"] }]);
  const figma = newFigma(["Generator test"]);
  await run(figma, [unit]);
  const set = figma.page("Generator test").children[0];
  assert.equal(set.type, "COMPONENT_SET");
  assert.deepEqual(set.children.map((c) => c.name), ["Story=Default", "Story=Simple", "Story=Long Content"]);
  assert.deepEqual(set.children.map((c) => c.x), [24, 24, 24]);
  assert.ok(set.children[0].y < set.children[1].y && set.children[1].y < set.children[2].y);
});

test("#86 a story's variant has no spinner added: it draws its own", () => {
  const capture = { ...buttonCapture({ states: true }), storyValue: "Primary", stories: [story("Loading", { Variant: "primary", Size: "sm", State: "loading" })], leftOut: [] };
  capture.axes = capture.axes.map((axis) => (axis.name === "State" ? { ...axis, values: ["default", "loading", "disabled"] } : axis));
  const unit = buildComponentUnit({ item: item(), capture, options: OPTIONS });
  const names = (cell) => cell[1][1].map(([id]) => unit.nodes[id].n);
  const loading = unit.cells.at(-1);
  assert.deepEqual(loading[0], [1, 0, 0, 1], "the story's variant: Story=Loading, State=loading");
  assert.ok(!names(loading).includes("Spinner"));
});

test("#86 the data file reader takes a set with a Story property, and versions and the ledger find it by name and version", async () => {
  const unit = buildComponentUnit({ item: item(), capture: withStories([story("With Icons", { Variant: "outline", Size: "lg" })]), options: OPTIONS });
  const { files } = packUnits([unit], { config: CONFIG });
  const data = readData(JSON.stringify(files[0].data));
  assert.deepEqual(data.units[0].axes[0], { name: "Story", values: ["Primary", "With Icons"] });

  const figma = newFigma(["Generator test"]);
  assert.equal((await runCode(files[0].code, figma)).units[0].status, "written");
  assert.equal((await runCode(files[0].code, figma)).units[0].status, "exists", "the same version again is left alone");
  const next = buildComponentUnit({ item: item("Button", "1.1.0"), capture: withStories([story("With Icons", { Variant: "outline", Size: "lg" })]), options: OPTIONS });
  const moved = await run(figma, [next]);
  assert.deepEqual(moved.units[0].movedToOlder, ["Button 1.0.0"]);
  const key = Array.from({ length: 32 }, (_, i) => (i * 5 + 1) % 256);
  assert.deepEqual(await runCode(reconcileCode(["Generator test", "Older versions"], ["Button 1.0.0", "Button 1.1.0", "Button 1.2.0"], key), figma), { found: [true, true, false] });
});

/** A capture whose stories are each about size characters of the relay's code. */
function bulkyCapture(sizes) {
  const stories = sizes.map((size, i) => ({ ...story(`Story ${i}`, { Variant: "primary", Size: "sm" }, `Words ${i} ${"w".repeat(size)}`) }));
  return { ...withStories(stories), leftOut: [{ id: "button--same", name: "Same", reason: "same" }] };
}

test("#86 stories that would take the set past one relay call are left out, the others kept in index order", async () => {
  const sizes = [4000, 30000, 4000, 4000, 8000];
  const options = { ...OPTIONS, states: [], label: false, stories: {} };
  const { unit, leftOut } = await buildComponent(null, { ...item(), axes: [] }, options, async () => bulkyCapture(sizes), CONFIG);
  assert.ok(codeChars([unit], CONFIG) <= MAX_CODE_CHARS, `${codeChars([unit], CONFIG)} characters`);
  assert.deepEqual(unit.axes[0].values, ["Primary", "Story 0", "Story 2", "Story 3"]);
  assert.deepEqual(leftOut.map((s) => [s.name, s.reason]), [["Same", "same"], ["Story 1", "size"], ["Story 4", "size"]]);
  assert.ok(unit.warnings.some((w) => /Story 1, Story 4 were left out, because with them the set would not fit one relay call/.test(w)), unit.warnings.join("\n"));

  // Without the large ones every story fits, and nothing is left out for its size.
  const small = await buildComponent(null, { ...item(), axes: [] }, options, async () => bulkyCapture([4000, 4000]), CONFIG);
  assert.deepEqual(small.unit.axes[0].values, ["Primary", "Story 0", "Story 1"]);
  assert.deepEqual(small.leftOut.map((s) => s.reason), ["same"]);
});

test("#86 a story variant whose axis value is a guess is named, and one left out for its size is not", async () => {
  const options = { ...OPTIONS, states: [], label: false, stories: {} };
  const guessed = { ...story("Full Width", { Variant: "primary", Size: "sm" }, "Full Width"), from: { Variant: "first", Size: "classes" } };
  const huge = { ...story("Huge", { Variant: "primary", Size: "sm" }, `Huge ${"w".repeat(30000)}`), from: { Variant: "first", Size: "first" } };
  const { unit, guesses } = await buildComponent(null, { ...item(), axes: [] }, options, async () => withStories([guessed, huge]), CONFIG);
  assert.deepEqual(unit.axes[0].values, ["Primary", "Full Width"]);
  assert.deepEqual(guesses, [{ id: "button--full-width", name: "Full Width", axis: "Variant", value: "primary" }]);
  assert.ok(unit.warnings.some((w) => w === "Button: the story Full Width does not say its Variant, so its variant is labelled Variant=primary, the first value, as a guess."), unit.warnings.join("\n"));
});

test("#86 stories past 256 variants, or past 100 values of the Story property, are left out", async () => {
  const options = { ...OPTIONS, states: [], label: false, stories: {} };
  // One drawing for every variant, so the code stays small and only the counts bind.
  const tree = storyTree("Same");
  const many = (n) => Array.from({ length: n }, (_, i) => ({ ...story(`S${i}`, { A: 0, B: 0 }), tree }));
  const values = (n) => Array.from({ length: n }, (_, i) => `v${i}`);
  const grid = { ...buttonCapture(), axes: [{ prop: "a", name: "A", values: values(20) }, { prop: "b", name: "B", values: values(10) }], storyValue: "Default", leftOut: [] };
  grid.cells = values(20).flatMap((a) => values(10).map((b) => ({ key: { A: a, B: b }, tree })));

  const past256 = await buildComponent(null, { ...item(), axes: [] }, options, async () => ({ ...grid, stories: many(80).map((s) => ({ ...s, key: { A: "v0", B: "v0" } })) }), CONFIG);
  assert.equal(past256.unit.cells.length, 256);
  assert.equal(past256.leftOut.length, 200 + 80 - 256);
  assert.deepEqual(past256.leftOut[0], { id: "button--s56", name: "S56", reason: "size" }, "the first story left out is the one that would be variant 257");

  const past100 = await buildComponent(null, { ...item(), axes: [] }, options, async () => ({ ...withStories(many(150).map((s) => ({ ...s, key: { Variant: "primary", Size: "sm" } }))) }), CONFIG);
  assert.equal(past100.unit.axes[0].values.length, 100);
  assert.equal(past100.unit.cells.length, 18 + 99);
  assert.equal(past100.leftOut.length, 150 - 99);
});

test("#86 write names the stories left out in the manifest and the run report, and the estimate counts a variant per story", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "klaus-figma-"));
  const capture = { ...withStories([story("With Icons", { Variant: "outline", Size: "lg" })]), leftOut: [{ id: "button--same", name: "Same", reason: "same" }, { id: "button--broken", name: "Broken", reason: "failed" }] };
  const figma = createAdapter({
    async openStorybook() {
      return { entries: [], async close() {} };
    },
    async captureComponent() {
      return capture;
    },
  }, { env: {} });
  const button = { name: "Button", kind: "shared", folder: "packages/ui", file: "packages/ui/Button.tsx", props: [], parts: [], variants: { variant: ["primary", "secondary", "destructive", "outline", "ghost", "link"], size: ["sm", "md", "lg"] }, purpose: null, version: "1.0.0", screenshot: "", usedIn: [] };
  const ctx = {
    output: "figma",
    root,
    settings: { enabled: true, target: "zSRhsvwtutOIPvHyWF9Wf2", options: {} },
    selection: { componentGroups: [], screens: { mode: "none", routes: [] }, newComponents: { rule: "all", minUsage: 2 } },
    inventory: { schemaVersion: 1, folders: ["packages/ui"], entries: [button] },
    trigger: "release",
    release: "v1.0.0",
    releases: ["v1.0.0"],
    unwrittenFromLastRun: [],
    dryRun: false,
    secret() {},
  };
  const plan = await figma.plan(ctx);
  const one = (await figma.estimate(plan, ctx)).items[0].tokens;
  const three = (await figma.estimate({ items: [{ ...plan.items[0], storyCount: 3 }] }, ctx)).items[0].tokens;
  assert.equal(three - one, 2 * 160 * 1.4, "two more stories are two more variants of 160 characters each");

  const result = await figma.write(plan, ctx);
  assert.deepEqual(result.written, ["Button"]);
  const manifest = JSON.parse(readFileSync(path.join(root, ".klaus/figma/v1.0.0/manifest.json"), "utf8"));
  assert.deepEqual(manifest.storiesLeftOut, [
    { component: "Button", id: "button--same", name: "Same", reason: "same" },
    { component: "Button", id: "button--broken", name: "Broken", reason: "failed" },
  ]);
  const report = figma.report({ written: result.written, failed: [] }, ctx);
  assert.deepEqual(report.details.storiesLeftOut, manifest.storiesLeftOut);
  assert.match(report.summary, /2 stories were left out of the sets, named in details\.storiesLeftOut\./);
  assert.deepEqual(manifest.storyAxisGuesses, []);
  assert.doesNotMatch(report.summary, /a guess/);

  // A story variant whose Variant and Size are guesses is one story named in the report.
  const guessing = { ...capture, stories: [{ ...capture.stories[0], from: { Variant: "first", Size: "first" } }] };
  const again = createAdapter({ async openStorybook() { return { entries: [], async close() {} }; }, async captureComponent() { return guessing; } }, { env: {} });
  const root2 = mkdtempSync(path.join(tmpdir(), "klaus-figma-"));
  const ctx2 = { ...ctx, root: root2 };
  await again.write(await again.plan(ctx2), ctx2);
  const manifest2 = JSON.parse(readFileSync(path.join(root2, ".klaus/figma/v1.0.0/manifest.json"), "utf8"));
  assert.deepEqual(manifest2.storyAxisGuesses, [
    { component: "Button", id: "button--with-icons", name: "With Icons", axis: "Variant", value: "outline" },
    { component: "Button", id: "button--with-icons", name: "With Icons", axis: "Size", value: "lg" },
  ]);
  const report2 = again.report({ written: ["Button"], failed: [] }, ctx2);
  assert.deepEqual(report2.details.storyAxisGuesses, manifest2.storyAxisGuesses);
  assert.match(report2.summary, /1 story variant has an axis value that is a guess, named in details\.storyAxisGuesses\./);
});

test("#86 a set near the call limit is written as a data file the relay's reader takes", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "klaus-figma-"));
  // Stories drawn eight boxes deep, as a card is, so the data nests deeply.
  const nested = (words) => {
    let tree = storyTree(words);
    for (let i = 0; i < 8; i++) tree = { ...buttonCapture().cells[0].tree, w: tree.w + 2, children: [tree] };
    return tree;
  };
  const stories = Array.from({ length: 90 }, (_, i) => ({ ...story(`Deep ${i}`, { Variant: "primary", Size: "sm" }), tree: nested(`Deep ${i}`) }));
  const figma = createAdapter({
    async openStorybook() {
      return { entries: [], async close() {} };
    },
    async captureComponent() {
      return withStories(stories);
    },
  }, { env: {} });
  const ctx = {
    root,
    settings: { enabled: true, target: "zSRhsvwtutOIPvHyWF9Wf2", options: {} },
    selection: { componentGroups: [], screens: { mode: "none", routes: [] }, newComponents: { rule: "all", minUsage: 2 } },
    inventory: { schemaVersion: 1, folders: ["packages/ui"], entries: [{ name: "Button", kind: "shared", folder: "packages/ui", file: "packages/ui/Button.tsx", variants: {}, version: "1.0.0", usedIn: [] }] },
    release: "v1.0.0",
    unwrittenFromLastRun: [],
  };
  const result = await figma.write(await figma.plan(ctx), ctx);
  assert.deepEqual(result.failed, []);
  const manifest = JSON.parse(readFileSync(path.join(root, ".klaus/figma/v1.0.0/manifest.json"), "utf8"));
  assert.ok(manifest.files[0].chars > 40000 && manifest.files[0].chars <= MAX_CODE_CHARS, `${manifest.files[0].chars} characters of code`);
  const text = readFileSync(path.join(root, ".klaus/figma/v1.0.0/figma-001.json"), "utf8");
  const data = readData(text);
  assert.ok(JSON.stringify(data, null, 2).length > 100000, "indented, the same data would be over the reader's limit");
});

test("#86 the reader draws each other story at its own args, leaves out one that draws the same and one that fails", browser, async () => {
  const storybook = await openStorybook({ root: repo, directory, globals: "" });
  let capture;
  try {
    capture = await captureComponent(storybook, { name: "Chip", axes: [{ prop: "variant", name: "Variant", values: ["plain", "bold"] }], states: [], label: false, icons: false });
  } finally {
    await storybook.close();
  }
  assert.equal(capture.story, "fixture-chip--default");
  assert.equal(capture.storyValue, "Default");
  assert.equal(capture.cells.length, 2, "the axes' story keeps both its cells");
  assert.deepEqual(capture.stories.map((s) => [s.value, s.key.Variant, s.from.Variant]), [
    ["Bold; loud", "bold", "arg"],
    ["Huge", "plain", "first"],
    ["Set in render", "bold", "props"],
    ["Own default", "bold", "classes"],
  ], "an arg, a value that is no axis value and so a guess, a prop set in the render, and the chip's own default found by its classes");
  const words = (tree) => tree.children.map((c) => c.text);
  assert.deepEqual(capture.stories.map((s) => words(s.tree)), [["Loud"], ["Huge"], ["Inside"], ["Own default"]], "each story at its own args, with no URL args");
  assert.deepEqual(capture.leftOut.map((s) => [s.id, s.reason]), [["fixture-chip--again", "same"], ["fixture-chip--broken", "failed"]]);
  assert.ok(capture.warnings.some((w) => /Chip: the story Again draws the same as a variant already in the set/.test(w)), capture.warnings.join("\n"));
  assert.ok(capture.warnings.some((w) => /Story fixture-chip--broken was skipped: .*Chip exploded/.test(w)), capture.warnings.join("\n"));
});

test("#86 a story that draws only in a portal, as a dialog open from the start does, is read and does not time out", browser, async () => {
  const storybook = await openStorybook({ root: repo, directory, globals: "" });
  const started = Date.now();
  let capture;
  try {
    capture = await captureComponent(storybook, { name: "Portal", axes: [], states: [], label: false, icons: false });
  } finally {
    await storybook.close();
  }
  assert.ok(Date.now() - started < 20000, `read in ${Date.now() - started} ms`);
  assert.equal(capture.cells[0].tree.w, 274, "the panel: 240 wide, 16 of padding and a 1px border each side");
  assert.deepEqual(capture.cells[0].tree.children.map((c) => c.text), ["Open from the start"]);
});
