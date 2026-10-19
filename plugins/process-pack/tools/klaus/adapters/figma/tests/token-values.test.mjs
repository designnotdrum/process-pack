/**
 * When the generated code writes a changed token value: at the end of its run (the plugin and plain
 * code), never ("hold"), or at the end of the call that sends the release's last component unit ("last").
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { codeFor, dataFor, decodeText, newKey, TOKEN_VALUE_MODES, withReleaseTokens } from "../codegen.mjs";
import { runCode } from "./fake-figma.mjs";
import { buttonUnit, CONFIG, newFigma, screenUnit } from "./helpers.mjs";

const NEW = [10, 20, 30, 1];
const rgb = (color) => [color.r, color.g, color.b].map((v) => Math.round(v * 255));

/** Button at a version, with color/primary changed when a colour is given. */
const button = (version, primary) => {
  const unit = buttonUnit({ version });
  if (primary) unit.tokens.find((t) => t.name === "color/primary").rgba = primary;
  return unit;
};

const run = (figma, units, options) => runCode(codeFor(dataFor({ units, config: CONFIG, header: "test" }), options), figma);
const primary = (figma) => rgb(figma.variableList.find((v) => v.name === "color/primary").valuesByMode.m1);
const OLD = [124, 58, 237];

test("code with no tokenValues writes a changed value at the end of its run, as the plugin does", async () => {
  const figma = newFigma();
  await run(figma, [button("1.0.0")]);

  const result = await run(figma, [button("1.1.0", NEW)]);

  assert.deepEqual(primary(figma), NEW.slice(0, 3));
  assert.deepEqual(result.tokens.updated, ["color/primary"]);
  assert.deepEqual(result.tokens.held, []);
  assert.doesNotMatch(codeFor(dataFor({ units: [button("1.0.0")], config: CONFIG, header: "test" })), /TOKEN_VALUES = /, "the plugin's runtime sees no TOKEN_VALUES");
});

test("hold creates a variable that is missing and changes no existing value, and names the tokens that wait", async () => {
  const figma = newFigma();
  const first = await run(figma, [button("1.0.0")], { tokenValues: "hold" });
  assert.equal(first.tokens.made.length, 8, "a missing variable is made with its value");
  assert.deepEqual(primary(figma), OLD);

  const second = await run(figma, [button("1.1.0", NEW)], { tokenValues: "hold" });

  assert.deepEqual(primary(figma), OLD, "the existing value is not changed");
  assert.deepEqual(second.tokens.updated, []);
  assert.deepEqual(second.tokens.held, ["color/primary"]);
  // The older version is frozen at the colour it shipped with, because the value has not moved.
  const older = figma.page("Older versions").children[0];
  assert.deepEqual(rgb(older.children.find((c) => c.name === "Variant=primary, Size=md").fills[0].color), OLD);
});

test("last writes the values once every component unit of the call was written or was already there", async () => {
  const figma = newFigma();
  await run(figma, [button("1.0.0")]);

  const written = await run(figma, [button("1.1.0", NEW)], { tokenValues: "last" });
  assert.deepEqual(primary(figma), NEW.slice(0, 3));
  assert.deepEqual(written.tokens.updated, ["color/primary"]);
  assert.deepEqual(written.tokens.held, []);

  // A unit that is already in the file counts as done.
  const again = await run(figma, [button("1.1.0", [1, 2, 3, 1])], { tokenValues: "last" });
  assert.equal(again.units[0].status, "exists");
  assert.deepEqual(primary(figma), [1, 2, 3]);
});

test("last holds the values when a component of the call fails, because its retry would freeze at the new colour", async () => {
  const figma = newFigma();
  await run(figma, [button("1.0.0")]);
  const draw = figma.createNodeFromSvg;
  figma.createNodeFromSvg = (svg) => {
    if (svg.includes("FAIL")) throw new Error("Not an SVG.");
    return draw(svg);
  };
  const broken = button("1.1.0", NEW);
  broken.svgs = ["<svg>FAIL</svg>"];
  broken.nodes.push({ k: "v", s: 0, w: 16, h: 16 });
  broken.cells[0][1][1].push([broken.nodes.length - 1, []]);

  const result = await run(figma, [broken], { tokenValues: "last" });

  assert.equal(result.units[0].status, "failed");
  assert.deepEqual(primary(figma), OLD, "no value was written");
  assert.deepEqual(result.tokens.updated, []);
  assert.deepEqual(result.tokens.held, ["color/primary"]);
  assert.match(result.warnings.join("\n"), /Changed token values were not written, because a component of this call failed or the run stopped early/);
});

test("a failed screen does not hold the values, because a screen is never frozen", async () => {
  const figma = newFigma();
  await run(figma, [button("1.0.0")]);

  const result = await run(figma, [button("1.1.0", NEW), { ...screenUnit("/broken", "v1.1.0"), tree: [99, []] }], { tokenValues: "last" });

  assert.equal(result.units.at(-1).status, "failed");
  assert.deepEqual(primary(figma), NEW.slice(0, 3));
});

test("the relay's encoded code carries TOKEN_VALUES, and a held token comes back encoded", async () => {
  const key = newKey();
  const figma = newFigma();
  const data = dataFor({ units: [button("1.0.0")], config: CONFIG, header: "test" });
  await runCode(codeFor(data), figma);
  const changed = dataFor({ units: [button("1.1.0", NEW)], config: CONFIG, header: "test" });

  const code = codeFor(changed, { key, tokenValues: "hold" });
  assert.match(code, /^const TOKEN_VALUES = "hold";$/m);
  const result = await runCode(code, figma);

  assert.notDeepEqual(result.tokens.held, ["color/primary"], "the name is not in the result in the clear");
  assert.deepEqual(result.tokens.held.map((name) => decodeText(name, key)), ["color/primary"]);
  assert.match(codeFor(changed, { key }), /^const TOKEN_VALUES = "last";$/m, "the relay's code is the last call unless it says hold");
});

test("tokenValues takes only hold or last", () => {
  const data = dataFor({ units: [button("1.0.0")], config: CONFIG, header: "test" });
  assert.deepEqual([...TOKEN_VALUE_MODES], ["hold", "last"]);
  assert.throws(() => codeFor(data, { tokenValues: "write" }), /tokenValues must be one of hold, last/);
  assert.throws(() => codeFor(data, { key: newKey(), tokenValues: '"; figma.closePlugin(); "' }), /tokenValues must be one of/);
});

test("withReleaseTokens adds the other files' tokens after its own and leaves a unit's token indexes alone", () => {
  const own = { header: "a", tokens: [{ name: "a", syntax: "x", rgba: [1, 2, 3, 1], scopes: ["TEXT_FILL"] }], units: [{ id: "A", tk: [0] }] };
  const other = { tokens: [{ name: "b", syntax: "y", rgba: [4, 5, 6, 1], scopes: ["FRAME_FILL"] }, { name: "a", syntax: "x", rgba: [1, 2, 3, 1], scopes: ["FRAME_FILL"] }] };
  const third = { tokens: [{ name: "c", syntax: "z", rgba: [7, 8, 9, 1], scopes: [] }, { name: "b", syntax: "y", rgba: [4, 5, 6, 1], scopes: [] }] };

  const joined = withReleaseTokens(own, [other, third]);

  assert.deepEqual(joined.tokens.map((t) => t.name), ["a", "b", "c"]);
  assert.deepEqual(joined.units, own.units);
  assert.deepEqual(own.tokens.map((t) => t.name), ["a"], "the data it was given is not changed");
  assert.deepEqual(joined.tokens[0].scopes, ["TEXT_FILL"]);
});

test("withReleaseTokens refuses a token with another colour or code syntax in another file", () => {
  const own = { tokens: [{ name: "a", syntax: "x", rgba: [1, 2, 3, 1], scopes: [] }], units: [] };
  assert.throws(() => withReleaseTokens(own, [{ tokens: [{ name: "a", syntax: "x", rgba: [9, 2, 3, 1], scopes: [] }] }]), /The token a has another colour or code syntax in another file of the release/);
  assert.throws(() => withReleaseTokens(own, [{ tokens: [{ name: "a", syntax: "other", rgba: [1, 2, 3, 1], scopes: [] }] }]), /another colour or code syntax/);
  assert.throws(
    () => withReleaseTokens(own, [{ tokens: [{ name: "b", syntax: "x", rgba: [1, 2, 3, 1], scopes: [] }] }, { tokens: [{ name: "b", syntax: "x", rgba: [1, 2, 4, 1], scopes: [] }] }]),
    /The token b has another colour/,
  );
});
