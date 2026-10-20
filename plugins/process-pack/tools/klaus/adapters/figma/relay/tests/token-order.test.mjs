/**
 * The relay holds a changed token value back until the call that sends the release's last component
 * unit, so a version moved to Older versions keeps the colours it shipped with. The stub codex runs
 * each call's code in the fake Plugin API (the "figma" scenario), and the test runs the same calls
 * again in its own fake file to look at the result.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { codeFor, newKey } from "../../codegen.mjs";
import { runCode } from "../../tests/fake-figma.mjs";
import { newFigma } from "../../tests/helpers.mjs";
import { reconcileCode } from "../reconcile.mjs";
import { generatedRepo, KEY, ledgerOf, outputOf, relay } from "./helpers.mjs";

// The colours Figma holds before the release, and the ones the release sends.
const OLD_PRIMARY = [10, 20, 30, 1];
const NEW_PRIMARY = [124, 58, 237];
const OLD_CARD_ONLY = [1, 2, 3, 1];
const NEW_CARD_ONLY = [200, 100, 50, 1];

const rgb = (color) => [color.r, color.g, color.b].map((v) => Math.round(v * 255));
const readJson = (folder, name) => JSON.parse(readFileSync(path.join(folder, name), "utf8"));

/** A set's primary fill, as Figma shows it now. */
const fillOf = (figma, page, setName) => figma.page(page).children.find((n) => n.name === setName).children.find((c) => c.name === "Variant=primary, Size=md").fills[0];
const variableOf = (figma, name) => rgb(figma.variableList.find((v) => v.name === name).valuesByMode.m1);

/**
 * The release Button 1.1.0 and Card 1.1.0, one file a call, with color/primary changed. Figma holds
 * 1.0.0 of both, drawn with the old color/primary. With cardOnly, a token only Card's file carries has
 * changed too.
 * @returns {Promise<object>}  The generated repo, and seed: the code that builds the file as it was before the release.
 */
async function release({ cardOnly = false } = {}) {
  const repo = await generatedRepo({ components: ["Button", "Card"], perFile: 1, version: "1.1.0", release: "v1.1.0" });
  const names = repo.manifest.files.map((file) => file.name);
  if (cardOnly) {
    const data = readJson(repo.folder, names[1]);
    data.tokens.push({ name: "color/card-only", syntax: "hsl(var(--card-only))", rgba: NEW_CARD_ONLY, scopes: ["FRAME_FILL"] });
    writeFileSync(path.join(repo.folder, names[1]), JSON.stringify(data));
  }
  const seed = names.map((name) => {
    const data = readJson(repo.folder, name);
    for (const unit of data.units) unit.version = "1.0.0";
    data.tokens.find((token) => token.name === "color/primary").rgba = OLD_PRIMARY;
    const only = data.tokens.find((token) => token.name === "color/card-only");
    if (only) only.rgba = OLD_CARD_ONLY;
    return codeFor(data);
  });
  return { ...repo, seed };
}

/** A new fake file in the state the seed leaves it in. */
async function fileBefore(seed) {
  const figma = newFigma();
  for (const code of seed) await runCode(code, figma);
  return figma;
}

const modeOf = (stdin) => /^const TOKEN_VALUES = "(\w+)";$/m.exec(stdin.toString())?.[1];

test("two calls, one token change: the older version in the second call keeps the colour it shipped with, and both new versions show the new colour", async () => {
  const { root, folder, seed } = await release();

  // An empty shared record for this file, so a missing KLAUS_FIGMA_LEDGER adds no warning.
  const variable = JSON.stringify({ version: 2, fileKey: KEY, components: {}, screens: {} });
  const run = await relay(root, [folder], { scenarios: "figma", figmaSeed: seed, variable });

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.calls.length, 2, "one call a component version");
  assert.deepEqual(ledgerOf(root).components, { Button: { "1.1.0": "sent" }, Card: { "1.1.0": "sent" } });

  const figma = await fileBefore(seed);
  assert.deepEqual(variableOf(figma, "color/primary"), OLD_PRIMARY.slice(0, 3));
  await runCode(run.calls[0].stdin.toString(), figma);
  const afterFirst = variableOf(figma, "color/primary");
  await runCode(run.calls[1].stdin.toString(), figma);

  assert.deepEqual(rgb(fillOf(figma, "Older versions", "Button 1.0.0").color), OLD_PRIMARY.slice(0, 3));
  assert.deepEqual(rgb(fillOf(figma, "Older versions", "Card 1.0.0").color), OLD_PRIMARY.slice(0, 3), "frozen before the value changed, not at the new colour");
  assert.deepEqual(afterFirst, OLD_PRIMARY.slice(0, 3), "the first call changes no existing value");
  assert.deepEqual(variableOf(figma, "color/primary"), NEW_PRIMARY, "the second call writes the value");
  for (const [page, set] of [["Button", "Button 1.1.0"], ["Card", "Card 1.1.0"]]) {
    const fill = fillOf(figma, page, set);
    assert.ok(fill.boundVariables?.color, `${set} stays bound to the variable`);
    assert.deepEqual(rgb(fill.color), NEW_PRIMARY, `${set} shows the new colour`);
  }

  assert.deepEqual(run.calls.map((call) => modeOf(call.stdin)), ["hold", "last"], "only the call that sends the last component unit writes token values");
  assert.deepEqual(outputOf(run.report).adapter.details.tokenChanges, { written: 1, waiting: 0 });
  assert.deepEqual(outputOf(run.report).warnings, []);
});

test("a run that stops after the first call changes no token value, and the report counts the change that waits", async () => {
  const { root, folder, seed } = await release();

  const run = await relay(root, [folder, "--max-calls", "1"], { scenarios: "figma", figmaSeed: seed });

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.calls.length, 1);
  const figma = await fileBefore(seed);
  await runCode(run.calls[0].stdin.toString(), figma);
  assert.deepEqual(variableOf(figma, "color/primary"), OLD_PRIMARY.slice(0, 3), "no token value changed");
  assert.deepEqual(rgb(fillOf(figma, "Button", "Button 1.1.0").color), OLD_PRIMARY.slice(0, 3), "the new version is bound to the variable, which still holds the old colour");
  assert.equal(modeOf(run.calls[0].stdin), "hold");

  const output = outputOf(run.report);
  assert.deepEqual(output.adapter.details.tokenChanges, { written: 0, waiting: 1 });
  assert.match(output.adapter.summary, /1 token change waiting for the release's last call\./);
  assert.ok(output.warnings.some((warning) => /^Changed token values wait for the call that sends the release's last component unit/.test(warning)), output.warnings.join("\n"));
  assert.deepEqual(output.deferred.map((unit) => [unit.id, unit.reason]), [["Card", "call-cap"]]);
  assert.deepEqual(ledgerOf(root).components, { Button: { "1.1.0": "sent" }, Card: { "1.1.0": "generated" } });
});

test("the next run sends the release's last unit and writes the value that waited", async () => {
  const { root, folder, seed } = await release();
  const first = await relay(root, [folder, "--max-calls", "1"], { scenarios: "figma", figmaSeed: seed });

  // The second run starts from the file the first run left.
  const second = await relay(root, [folder], { scenarios: "figma", figmaSeed: [...seed, first.calls[0].stdin.toString()] });

  assert.equal(second.code, 0, second.stderr);
  assert.equal(second.calls.length, 1, "Button is already sent");
  assert.equal(modeOf(second.calls[0].stdin), "last");
  const figma = await fileBefore([...seed, first.calls[0].stdin.toString()]);
  await runCode(second.calls[0].stdin.toString(), figma);
  assert.deepEqual(variableOf(figma, "color/primary"), NEW_PRIMARY);
  assert.deepEqual(rgb(fillOf(figma, "Older versions", "Button 1.0.0").color), OLD_PRIMARY.slice(0, 3));
  assert.deepEqual(rgb(fillOf(figma, "Older versions", "Card 1.0.0").color), OLD_PRIMARY.slice(0, 3));
  assert.deepEqual(outputOf(second.report).adapter.details.tokenChanges, { written: 1, waiting: 0 });
});

test("a failed call keeps the values waiting even when a later call is the last file", async () => {
  const { root, folder, seed } = await release({ cardOnly: true });

  // Button's call fails, so its older version is not frozen yet. Card's call is the last file, but Button is not sent.
  const run = await relay(root, [folder], { scenarios: "tool-error,figma", figmaSeed: seed });

  assert.equal(run.code, 1);
  assert.equal(run.calls.length, 2);
  assert.deepEqual(run.calls.map((call) => modeOf(call.stdin)), ["hold", "hold"]);
  const figma = await fileBefore(seed);
  await runCode(run.calls[1].stdin.toString(), figma);
  assert.deepEqual(variableOf(figma, "color/primary"), OLD_PRIMARY.slice(0, 3));
  assert.deepEqual(variableOf(figma, "color/card-only"), OLD_CARD_ONLY.slice(0, 3));
  assert.deepEqual(outputOf(run.report).adapter.details.tokenChanges, { written: 0, waiting: 2 });
  assert.deepEqual(ledgerOf(root).components, { Button: { "1.1.0": "generated" }, Card: { "1.1.0": "sent" } });

  // The run that sends Button is the release's last. Its code carries the token only Card's file holds.
  const again = await relay(root, [folder], { scenarios: "figma", figmaSeed: [...seed, run.calls[1].stdin.toString()] });

  assert.equal(again.code, 0, again.stderr);
  assert.equal(again.calls.length, 1);
  assert.equal(modeOf(again.calls[0].stdin), "last");
  const resumed = await fileBefore([...seed, run.calls[1].stdin.toString()]);
  await runCode(again.calls[0].stdin.toString(), resumed);
  assert.deepEqual(variableOf(resumed, "color/primary"), NEW_PRIMARY);
  assert.deepEqual(variableOf(resumed, "color/card-only"), NEW_CARD_ONLY.slice(0, 3), "a token only another file carries is written by the last call too");
  assert.deepEqual(rgb(fillOf(resumed, "Older versions", "Button 1.0.0").color), OLD_PRIMARY.slice(0, 3));
  assert.deepEqual(rgb(fillOf(resumed, "Older versions", "Card 1.0.0").color), OLD_PRIMARY.slice(0, 3));
  assert.deepEqual(outputOf(again.report).adapter.details.tokenChanges, { written: 2, waiting: 0 });
});

test("a component that fails in the last call keeps the values waiting, because its retry would freeze at the new colour", async () => {
  const { root, folder, seed, manifest } = await release();
  // Card has an icon the fake Plugin API refuses to draw (the stub's failDrawing), so Card's set fails.
  const name = manifest.files[1].name;
  const data = readJson(folder, name);
  data.units[0].svgs = ["<svg>FAIL</svg>"];
  data.units[0].nodes.push({ k: "v", s: 0, w: 16, h: 16 });
  data.units[0].cells[0][1][1].push([data.units[0].nodes.length - 1, []]);
  writeFileSync(path.join(folder, name), JSON.stringify(data));

  const run = await relay(root, [folder], { scenarios: "figma", figmaSeed: seed, failDrawing: "FAIL" });

  assert.equal(run.code, 1);
  assert.deepEqual(run.calls.map((call) => modeOf(call.stdin)), ["hold", "last"]);
  const output = outputOf(run.report);
  assert.deepEqual(output.failed.map((unit) => unit.id), ["Card"]);
  assert.deepEqual(output.adapter.details.tokenChanges, { written: 0, waiting: 1 });
  assert.ok(output.warnings.some((warning) => /Changed token values were not written, because a component of this call failed/.test(warning)), output.warnings.join("\n"));
  assert.deepEqual(ledgerOf(root).components, { Button: { "1.1.0": "sent" }, Card: { "1.1.0": "generated" } });
});

test("a dry run says which call writes the token values", async () => {
  const { root, folder } = await release();

  const run = await relay(root, [folder, "--dry-run"]);

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.calls.length, 0);
  assert.deepEqual(outputOf(run.report).adapter.details.files.map((file) => file.tokenValues), ["held", "written at the end of the call"]);
});

test("a token with another colour in another file of the release stops the run before any call", async () => {
  const { root, folder, manifest } = await release();
  const name = manifest.files[1].name;
  const data = readJson(folder, name);
  data.tokens.find((token) => token.name === "color/primary").rgba = [1, 1, 1, 1];
  writeFileSync(path.join(folder, name), JSON.stringify(data));

  const run = await relay(root, [folder]);

  assert.equal(run.code, 2);
  assert.equal(run.calls.length, 0);
  assert.match(run.stderr, /is refused, so nothing was sent: The token color\/primary has another colour or code syntax in another file of the release\./);
});

test("reconcile never writes a token value: its code touches no variable", async () => {
  const { seed } = await release();
  const key = newKey();
  const code = reconcileCode(["Button", "Older versions"], ["Button 1.0.0"], key);
  assert.doesNotMatch(code, /variables|setValueForMode|createVariable|valuesByMode/);

  const figma = await fileBefore(seed);
  const before = figma.variableList.map((variable) => JSON.stringify(variable.valuesByMode));
  const result = await runCode(code, figma);

  assert.deepEqual(result, { found: [true] });
  assert.deepEqual(figma.variableList.map((variable) => JSON.stringify(variable.valuesByMode)), before);
  assert.deepEqual(variableOf(figma, "color/primary"), OLD_PRIMARY.slice(0, 3));
});
