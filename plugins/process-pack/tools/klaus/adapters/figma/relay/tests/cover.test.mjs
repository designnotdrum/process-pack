/**
 * The relay writes the release onto the cover in the call that sends the release's last component
 * unit, and only when the coverPage setting names a page.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { codeFor, newKey, withReleaseTokens } from "../../codegen.mjs";
import { runCode } from "../../tests/fake-figma.mjs";
import { newFigma } from "../../tests/helpers.mjs";
import { MAX_CODE_CHARS } from "../../settings.mjs";
import { coverFor } from "../relay.mjs";
import { generatedRepo, KEY, ledgerOf, outputOf, relay, ROOMY } from "./helpers.mjs";

const PAGE = "Title Page";
const WITH_COVER = { ...ROOMY, outputs: { figma: { ...ROOMY.outputs.figma, options: { coverPage: PAGE } } } };
const carriesCover = (call) => /^const COVER = /m.test(call.code.toString());
const release = (config = WITH_COVER, extra = {}) => generatedRepo({ components: ["Button", "Card"], perFile: 1, version: "1.1.0", release: "2026-11-05", config, ...extra });
const quiet = JSON.stringify({ version: 2, fileKey: KEY, components: {}, screens: {} });

test("coverFor reads a date tag as a version and keeps any other release as it is", () => {
  const day = new Date(2026, 10, 5, 12);
  assert.deepEqual(coverFor(PAGE, "release/2026-11-05", day), { page: PAGE, version: "Version 2026.11.05", updated: "Updated Nov 5, 2026" });
  assert.equal(coverFor(PAGE, "release/2026-09-10-2", day).version, "Version 2026.09.10-2");
  assert.equal(coverFor(PAGE, "2026-11-05", day).version, "Version 2026.11.05");
  assert.equal(coverFor(PAGE, "v1.2.0", day).version, "Version v1.2.0");
});

test("only the call that finishes the release carries the cover, and it writes both layers", async () => {
  const { root, folder } = await release();

  const run = await relay(root, [folder], { scenarios: "figma", variable: quiet });

  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(run.calls.map(carriesCover), [false, true]);
  assert.deepEqual(ledgerOf(root).components, { Button: { "1.1.0": "sent" }, Card: { "1.1.0": "sent" } });

  const figma = newFigma(["Button", "Card", PAGE]);
  const font = { family: "DM Sans", style: "Regular" };
  await figma.loadFontAsync(font);
  for (const name of ["Version", "Updated"]) {
    const text = figma.createText();
    text.name = name;
    text.fontName = font;
    text.characters = "old";
    figma.page(PAGE).appendChild(text);
  }
  await runCode(run.calls[1].code.toString(), figma);
  assert.equal(figma.page(PAGE).findOne((n) => n.name === "Version").characters, "Version 2026.11.05");
  assert.match(figma.page(PAGE).findOne((n) => n.name === "Updated").characters, /^Updated [A-Z][a-z]{2} \d{1,2}, \d{4}$/);
});

test("a run stopped by a cap before the release finishes sends no cover", async () => {
  const { root, folder } = await release();

  const run = await relay(root, [folder, "--max-calls", "1"], { scenarios: "figma", variable: quiet });

  assert.equal(run.calls.length, 1);
  assert.deepEqual(run.calls.map(carriesCover), [false]);
  const deferred = outputOf(run.report).adapter.details.files.find((file) => file.status === "deferred");
  assert.equal(deferred.cover, undefined, "the report promises no update for a call that did not run");
});

test("a repo with no coverPage sends no cover code at all", async () => {
  const { root, folder } = await release(ROOMY);

  const run = await relay(root, [folder], { scenarios: "figma", variable: quiet });

  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(run.calls.map(carriesCover), [false, false]);
});

test("a dry run says which call would update the cover", async () => {
  const { root, folder } = await release();

  const run = await relay(root, [folder, "--dry-run"], { variable: quiet });

  assert.equal(run.code, 0, run.stderr);
  const covers = outputOf(run.report).adapter.details.files.map((file) => file.cover);
  assert.deepEqual(covers, [undefined, "written at the end of the call"]);
});

test("a last call with no room for the cover goes out without it, with a warning, and the release still lands", async () => {
  const { root, folder, manifest } = await release();
  // Fills the file that takes the last call until its code just fits without the cover code.
  const where = path.join(folder, manifest.files.at(-1).name);
  const others = manifest.files.slice(0, -1).map((file) => JSON.parse(readFileSync(path.join(folder, file.name), "utf8")));
  const data = JSON.parse(readFileSync(where, "utf8"));
  const svgs = data.units[0].svgs ?? [];
  const padded = (length) => ({ ...data, units: [{ ...data.units[0], svgs: [...svgs, `<svg>${"x".repeat(length)}</svg>`] }, ...data.units.slice(1)] });
  const size = (length) => codeFor(withReleaseTokens(padded(length), others), { key: newKey(), tokenValues: "last" }).length;
  let low = 0;
  let high = MAX_CODE_CHARS;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (size(middle) <= MAX_CODE_CHARS - 50) low = middle;
    else high = middle;
  }
  writeFileSync(where, JSON.stringify(padded(low)));

  const run = await relay(root, [folder], { scenarios: "figma", variable: quiet });

  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(run.calls.map(carriesCover), [false, false]);
  assert.deepEqual(ledgerOf(root).components, { Button: { "1.1.0": "sent" }, Card: { "1.1.0": "sent" } });
  assert.ok(outputOf(run.report).warnings.some((warning) => /cover was not updated/.test(warning)), JSON.stringify(outputOf(run.report).warnings));
});
