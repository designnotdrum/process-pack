/** The built plugin applies a release in the fake Plugin API, the way the relay's code does. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { codeFor } from "../../codegen.mjs";
import { readData } from "../../data-file.mjs";
import { runCode, walk } from "../../tests/fake-figma.mjs";
import { buttonCapture, newFigma } from "../../tests/helpers.mjs";
import { readSources } from "../src/sources.mjs";
import { buttonCapture30, fakeWindow, generate, loadPlugin, looseFiles, sourcesOf, zipOf } from "./helpers.mjs";

const names = (page) => page.children.map((node) => node.name);
const boundPaints = (root) => {
  let count = 0;
  walk(root, (node) => {
    for (const key of ["fills", "strokes"]) for (const paint of node[key] ?? []) if (paint.boundVariables?.color) count += 1;
  });
  return count;
};
const rgb = (color) => [color.r, color.g, color.b].map((v) => Math.round(v * 255));

const button = (version, capture, release = `v${version}`, options = { icons: true }) =>
  generate({ components: [{ name: "Button", version, capture }], release, options });

test("Button 1.0.0, then 1.1.0 from a zip: 18 and 30 variants, with 1.0.0 frozen on Older versions", async () => {
  const figma = newFigma();
  const plugin = loadPlugin(figma);

  const first = await plugin.applyRelease(await readSources(looseFiles(await button("1.0.0", buttonCapture()))));
  assert.deepEqual(first.units.map((u) => [u.id, u.status, u.variants, u.page]), [["Button", "written", 18, "Button"]]);
  assert.deepEqual(names(figma.page("Button")), ["Button 1.0.0"]);
  assert.equal(figma.page("Older versions"), undefined);
  const one = figma.page("Button").children[0];
  assert.ok(boundPaints(one) > 0, "1.0.0 is bound to the variables while it is the current version");

  const zip = [{ name: "klaus-figma.zip", bytes: zipOf(await button("1.1.0", buttonCapture30()), "v1.1.0/") }];
  const second = await plugin.applyRelease(await readSources(zip));
  assert.deepEqual(second.units.map((u) => [u.id, u.status, u.variants, u.page, u.movedToOlder]), [["Button", "written", 30, "Button", ["Button 1.0.0"]]]);

  assert.deepEqual(names(figma.page("Button")), ["Button 1.1.0"]);
  assert.equal(figma.page("Button").children[0].children.length, 30);
  assert.deepEqual(names(figma.page("Older versions")), ["Button 1.0.0"]);
  const frozen = figma.page("Older versions").children[0];
  assert.equal(frozen, one, "the same set, moved");
  assert.equal(frozen.children.length, 18);
  assert.equal(boundPaints(frozen), 0, "no fill or stroke in the old set is bound to a variable");
  assert.match(frozen.description, /Frozen when 1\.1\.0 shipped; colours are the values at that time\.$/);
  assert.ok(boundPaints(figma.page("Button").children[0]) > 0, "1.1.0 stays bound");
  const variant = figma.page("Button").children[0].children[0];
  assert.equal(variant.children.find((c) => c.name === "Icon").visible, false, "the icon is a hidden layer behind Show icon");
  assert.deepEqual(Object.keys(variant.properties), ["Show icon"]);
});

test("applying the same release again leaves everything alone and says so", async () => {
  const figma = newFigma();
  const plugin = loadPlugin(figma);
  const files = await button("1.0.0", buttonCapture());
  await plugin.applyRelease(sourcesOf(files));
  const set = figma.page("Button").children[0];

  const again = await plugin.applyRelease(sourcesOf(files));

  assert.deepEqual(again.units.map((u) => [u.status, u.name]), [["exists", "Button 1.0.0"]]);
  assert.equal(figma.page("Button").children[0], set);
});

test("the plugin gives the results the relay's code gives for the same data", async () => {
  const files = await button("1.1.0", buttonCapture30());
  const viaPlugin = newFigma();
  const viaRelay = newFigma();
  const fromPlugin = await loadPlugin(viaPlugin).applyRelease(sourcesOf(files));
  const fromRelay = await runCode(codeFor(readData(files["figma-001.json"])), viaRelay);

  // The fake numbers its nodes across every instance, so the node ids differ between the two runs.
  const withoutIds = (result) => ({ ...result, units: result.units.map(({ nodeId: _nodeId, ...rest }) => rest) });
  assert.deepEqual(withoutIds(fromPlugin), withoutIds(fromRelay));
  assert.equal(fromPlugin.units[0].variants, 30);
  const everything = (figma) => {
    const found = [];
    walk(figma.root, (node) => found.push(`${node.type} ${node.name} ${node.visible} ${JSON.stringify(node.fills ?? [])}`));
    return found;
  };
  assert.deepEqual(everything(viaPlugin), everything(viaRelay));
});

test("every file of a release is applied, in the manifest's order, in one run", async () => {
  const files = await generate({
    components: [
      { name: "Button", version: "1.0.0", capture: buttonCapture() },
      { name: "Card", version: "1.0.0", capture: buttonCapture() },
    ],
  });
  const figma = newFigma();
  const result = await loadPlugin(figma).applyRelease(sourcesOf(files));

  assert.deepEqual(result.units.map((u) => [u.id, u.status]), [["Button", "written"], ["Card", "written"]]);
  assert.deepEqual(names(figma.page("Button")), ["Button 1.0.0"]);
  assert.deepEqual(names(figma.page("Card")), ["Card 1.0.0"]);
  const variables = figma.variableList.map((v) => v.name);
  assert.equal(new Set(variables).size, variables.length, "a token both files use is one variable");
});

test("a token that changes in a release does not recolour an older set, whichever file the set is in", async () => {
  const both = (version, primary) => generate({ components: [{ name: "Button", version, capture: buttonCapture() }, { name: "Card", version, capture: buttonCapture() }], release: `v${version}` }).then((files) => {
    for (const name of ["figma-001.json", "figma-002.json"]) {
      const data = JSON.parse(files[name]);
      if (primary) data.tokens.find((t) => t.name === "color/primary").rgba = primary;
      files[name] = JSON.stringify(data);
    }
    return files;
  });
  const fillOf = (figma, page, setName) => figma.page(page).children.find((n) => n.name === setName).children.find((c) => c.name === "Variant=primary, Size=md").fills[0].color;
  const before = await both("1.0.0");
  const after = await both("1.1.0", [10, 20, 30, 1]);

  // One run, as the plugin does it: both older sets are frozen before the variable changes.
  const plugin = newFigma();
  const apply = loadPlugin(plugin);
  await apply.applyRelease(sourcesOf(before));
  await apply.applyRelease(sourcesOf(after));
  assert.deepEqual(rgb(fillOf(plugin, "Older versions", "Button 1.0.0")), [124, 58, 237]);
  assert.deepEqual(rgb(fillOf(plugin, "Older versions", "Card 1.0.0")), [124, 58, 237]);
  assert.deepEqual(rgb(fillOf(plugin, "Card", "Card 1.1.0")), [10, 20, 30]);

  // One file at a time, as the relay sends them: the variable changes at the end of file 1, so Card 1.0.0 is frozen at the new colour.
  const relay = newFigma();
  for (const files of [before, after]) {
    for (const name of ["figma-001.json", "figma-002.json"]) await runCode(codeFor(readData(files[name])), relay);
  }
  assert.deepEqual(rgb(fillOf(relay, "Older versions", "Button 1.0.0")), [124, 58, 237]);
  assert.deepEqual(rgb(fillOf(relay, "Older versions", "Card 1.0.0")), [10, 20, 30], "frozen at the new colour, not the one it shipped with");
});

test("text in the release is data: code-like names and descriptions are drawn as text and run nothing", async () => {
  const name = 'Evil"); figma.closePlugin(); ("';
  const files = await generate({ components: [{ name, version: "1.0.0", capture: buttonCapture() }] });
  const data = JSON.parse(files["figma-001.json"]);
  data.units[0].description = "`${figma.closePlugin()}` </script><script>figma.closePlugin()</script> \\\" */ figma.closePlugin(); /*";
  files["figma-001.json"] = JSON.stringify(data);

  const figma = newFigma();
  figma.closePlugin = () => {
    throw new Error("the release ran code");
  };
  const result = await loadPlugin(figma).applyRelease(sourcesOf(files));

  assert.equal(result.units[0].status, "written");
  assert.equal(result.units[0].name, `${name} 1.0.0`);
  assert.deepEqual(names(figma.page(name)), [`${name} 1.0.0`]);
  assert.equal(figma.page(name).children[0].description, data.units[0].description);
});

test("one unit that fails is reported with its error, and the next unit still runs", async () => {
  const files = await generate({ components: [{ name: "Button", version: "1.0.0", capture: buttonCapture() }, { name: "Card", version: "1.0.0", capture: buttonCapture() }], options: { icons: true } });
  const data = JSON.parse(files["figma-001.json"]);
  data.units[0].svgs = ["<svg>FAIL</svg>"];
  files["figma-001.json"] = JSON.stringify(data);

  const figma = newFigma();
  const draw = figma.createNodeFromSvg;
  figma.createNodeFromSvg = (svg) => {
    if (svg.includes("FAIL")) throw new Error("Not an SVG.");
    return draw(svg);
  };
  const result = await loadPlugin(figma).applyRelease(sourcesOf(files));

  assert.equal(result.units[0].status, "failed");
  assert.equal(result.units[0].error, "Not an SVG.");
  assert.equal(result.units[1].status, "written");
  assert.deepEqual(names(figma.page("Button")), [], "nothing is left from the failed set");
});

test("the window talks to the main thread: load, a summary, apply, and the result", async () => {
  const figma = newFigma();
  const window = fakeWindow(figma);
  loadPlugin(figma, { html: "<html></html>" });
  assert.deepEqual(figma.calls.showUI[0], "<html></html>");
  assert.equal(figma.calls.showUI[1].themeColors, true);

  await window.onmessage({ type: "apply" });
  assert.deepEqual(window.posted.splice(0), [{ type: "refused", message: "Add the release files first." }]);

  const files = await button("1.0.0", buttonCapture());
  await window.onmessage({ type: "load", sources: sourcesOf(files) });
  const [loaded] = window.posted.splice(0);
  assert.equal(loaded.type, "loaded");
  assert.deepEqual(loaded.summary.units, [{ id: "Button", kind: "component", label: "Button 1.0.0", variants: 18 }]);
  assert.equal(figma.page("Button").children.length, 0, "loading writes nothing to the file");

  await window.onmessage({ type: "apply" });
  const [applying, applied] = window.posted.splice(0);
  assert.equal(applying.type, "applying");
  assert.equal(applied.type, "applied");
  assert.deepEqual(applied.result.units.map((u) => [u.id, u.status]), [["Button", "written"]]);
  assert.deepEqual(applied.result.tokens.error, undefined);
  assert.ok(applied.result.tokens.made.length > 0);

  await window.onmessage({ type: "close" });
  assert.equal(figma.calls.closePlugin, true);
});

test("a file that is not generator data is refused in the window and nothing is applied", async () => {
  const figma = newFigma();
  const window = fakeWindow(figma);
  loadPlugin(figma, { html: "<html></html>" });
  const files = await button("1.0.0", buttonCapture());

  await window.onmessage({ type: "load", sources: sourcesOf({ ...files, "figma-001.json": "figma.currentPage.remove();" }) });
  assert.deepEqual(window.posted.splice(0), [{ type: "refused", message: "figma-001.json is not JSON." }]);

  // A refused load also forgets an earlier good one, so Apply cannot run what is no longer on screen.
  await window.onmessage({ type: "load", sources: sourcesOf(files) });
  window.posted.splice(0);
  await window.onmessage({ type: "load", sources: sourcesOf({ ...files, "manifest.json": "x" }) });
  window.posted.splice(0);
  await window.onmessage({ type: "apply" });
  assert.deepEqual(window.posted.splice(0), [{ type: "refused", message: "Add the release files first." }]);
  assert.equal(figma.page("Button").children.length, 0);
});
