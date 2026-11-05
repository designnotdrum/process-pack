/**
 * The cover update: the release's version and date on the page the coverPage setting names, written
 * only by the call that finishes a release. A problem with the cover never fails the release.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { codeFor, dataFor, decodeText, newKey, RUNTIME_CODE, RUNTIME_CODE_WITH_COVER } from "../codegen.mjs";
import { readOptions } from "../settings.mjs";
import { runCode } from "./fake-figma.mjs";
import { buttonUnit, CONFIG, newFigma } from "./helpers.mjs";

const PAGE = "Title Page";
const COVER = { page: PAGE, version: "Version 2026.11.05", updated: "Updated Nov 5, 2026" };
const data = (units = [buttonUnit()]) => dataFor({ units, config: CONFIG, header: "test" });

/** A file whose cover page has the named text layers. */
async function fileWith(layers = ["Version", "Updated"]) {
  const figma = newFigma(["Button", PAGE]);
  const font = { family: "DM Sans", style: "Regular" };
  await figma.loadFontAsync(font);
  for (const name of layers) {
    const text = figma.createText();
    text.name = name;
    text.fontName = font;
    text.characters = "old";
    figma.page(PAGE).appendChild(text);
  }
  return figma;
}

const textOf = (figma, name) => figma.page(PAGE).findOne((n) => n.name === name)?.characters;

test("the last call writes the version and the date onto the cover", async () => {
  const figma = await fileWith();
  const key = newKey();

  const result = await runCode(codeFor(data(), { key, tokenValues: "last", cover: COVER }), figma);

  assert.equal(textOf(figma, "Version"), "Version 2026.11.05");
  assert.equal(textOf(figma, "Updated"), "Updated Nov 5, 2026");
  assert.equal(result.cover.status, "written");
  assert.deepEqual(result.units.map((unit) => unit.status), ["written"]);
});

test("a call with a failed component leaves the cover alone", async () => {
  const figma = await fileWith();
  figma.createNodeFromSvg = () => {
    throw new Error("Not an SVG.");
  };
  const broken = buttonUnit();
  broken.svgs = ["<svg>FAIL</svg>"];
  broken.nodes.push({ k: "v", s: 0, w: 16, h: 16 });
  broken.cells[0][1][1].push([broken.nodes.length - 1, []]);

  const result = await runCode(codeFor(data([broken]), { key: newKey(), tokenValues: "last", cover: COVER }), figma);

  assert.equal(result.units[0].status, "failed");
  assert.equal(result.cover.status, "held");
  assert.equal(textOf(figma, "Version"), "old");
});

test("a file with no cover page gets a warning and the release still goes through", async () => {
  const figma = newFigma(["Button"]);
  const key = newKey();

  const result = await runCode(codeFor(data(), { key, tokenValues: "last", cover: COVER }), figma);

  assert.equal(result.cover.status, "failed");
  assert.deepEqual(result.units.map((unit) => unit.status), ["written"]);
  assert.match(decodeText(result.warnings.at(-1), key), /no page named Title Page/);
});

test("a missing layer gets a warning, and the layer that is there is still written", async () => {
  const figma = await fileWith(["Version"]);
  const key = newKey();

  const result = await runCode(codeFor(data(), { key, tokenValues: "last", cover: COVER }), figma);

  assert.equal(textOf(figma, "Version"), "Version 2026.11.05");
  assert.equal(result.cover.status, "failed");
  assert.match(decodeText(result.warnings.at(-1), key), /no text layer named Updated/);
});

test("the cover's text is encoded, so the relaying model reads none of it", () => {
  const code = codeFor(data(), { key: newKey(), tokenValues: "last", cover: COVER });

  assert.match(code, /^const COVER = /m);
  assert.doesNotMatch(code, /2026\.11\.05|Title Page/);
});

test("the shared runtime carries none of the cover code, so a large component's call does not grow", () => {
  assert.doesNotMatch(RUNTIME_CODE, /COVER/);
  assert.doesNotMatch(codeFor(data(), { key: newKey(), tokenValues: "hold" }), /COVER/);
  assert.doesNotMatch(codeFor(data(), { key: newKey(), tokenValues: "last" }), /COVER/);
  assert.ok(RUNTIME_CODE_WITH_COVER.endsWith('return KEY ? encodeResult(result, "") : result;'), "the cover runs before the result is returned");
  assert.ok(RUNTIME_CODE_WITH_COVER.length > RUNTIME_CODE.length);
  assert.doesNotMatch(RUNTIME_CODE_WITH_COVER, /\\/, "the code holds no backslash");
});

test("only the relay's code carries a cover", () => {
  assert.throws(() => codeFor(data(), { cover: COVER }), /Only the relay/);
});

test("coverPage is off by default and cannot be a page Klaus writes itself", () => {
  assert.equal(readOptions({}).coverPage, "");
  assert.equal(readOptions({ options: { coverPage: PAGE } }).coverPage, PAGE);
  for (const page of ["Older versions", "Screens"]) assert.throws(() => readOptions({ options: { coverPage: page } }), /coverPage/);
});
