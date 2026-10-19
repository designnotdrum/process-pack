/** The committed plugin files are what the build makes, and they hold the same runtime and reader the relay uses. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DataError, readData } from "../../data-file.mjs";
import { buttonCapture } from "../../tests/helpers.mjs";
import { buildPlugin } from "../build.mjs";
import { generate, loadPlugin, sourcesOf } from "./helpers.mjs";
import { newFigma } from "../../tests/helpers.mjs";

const here = (relative) => new URL(`../${relative}`, import.meta.url);
const committed = (relative) => readFileSync(here(relative), "utf8");
const MESSAGE = "Run: node plugin/build.mjs (from adapters/figma), then commit code.js and ui.html.";

test("code.js and ui.html are what the build makes from the sources, so the runtime has not drifted", async () => {
  const built = await buildPlugin();
  assert.equal(committed("code.js"), built["code.js"], `plugin/code.js is out of date. ${MESSAGE}`);
  assert.equal(committed("ui.html"), built["ui.html"], `plugin/ui.html is out of date. ${MESSAGE}`);
});

test("code.js holds runtime.js word for word, once, as the body of applyData", () => {
  const runtime = readFileSync(new URL("../../runtime.js", import.meta.url), "utf8").trimEnd();
  const code = committed("code.js");
  assert.equal(code.split(runtime).length - 1, 1, "the runtime appears exactly once");
  assert.match(code, /async function applyData\(CONFIG, TOKENS, UNITS, SVGS\) \{\n {2}const KEY = null;\n/, "its data arrives as arguments, and it has no key");
  assert.ok(code.indexOf(runtime) > code.indexOf("async function applyData("));
  assert.ok(code.indexOf(runtime) + runtime.length < code.indexOf("function applyLoaded("), "the runtime ends before the plugin's own code");
});

test("the reader in code.js refuses what data-file.mjs refuses, with the same words", async () => {
  const files = await generate();
  const { reader } = loadPlugin(newFigma());
  const good = files["figma-001.json"];
  assert.deepEqual(reader.readData(good, "x"), readData(good, "x"));

  const data = JSON.parse(good);
  const bad = [
    "figma.closePlugin();",
    JSON.stringify({ ...data, script: "x" }),
    JSON.stringify({ ...data, header: "a\nb" }),
    JSON.stringify({ ...data, version: 2 }),
    JSON.stringify({ ...data, units: [{ ...data.units[0], version: "1.0.0; x" }] }),
    JSON.stringify({ ...data, units: [{ ...data.units[0], nodes: [{ k: "script" }] }] }),
    "x".repeat(100001),
  ];
  for (const text of bad) {
    let expected = null;
    try {
      readData(text, "x");
    } catch (error) {
      expected = error;
    }
    assert.ok(expected instanceof DataError, `data-file.mjs refuses ${text.slice(0, 40)}`);
    assert.throws(() => reader.readData(text, "x"), (error) => error instanceof reader.DataError && error.message === expected.message);
  }
});

test("the build puts the reader's constants in by value, from the modules that own them", () => {
  const code = committed("code.js");
  for (const line of ['const DATA_FILE_VERSION = 1;', 'const MAX_CODE_CHARS = 50000;', 'const MODE_NAME = "Light";', 'const OLDER_VERSIONS_PAGE = "Older versions";', 'const SCREENS_PAGE = "Screens";']) {
    assert.ok(code.includes(line), line);
  }
  assert.doesNotMatch(code, /^\s*(import|export)\b/m, "no module syntax is left, because Figma loads code.js as a plain script");
});

test("the manifest names the built files, allows no network, and asks for dynamic page loading", () => {
  const manifest = JSON.parse(committed("manifest.json"));
  assert.deepEqual(manifest.networkAccess, { allowedDomains: ["none"] });
  assert.equal(manifest.main, "code.js");
  assert.equal(manifest.ui, "ui.html");
  assert.equal(manifest.documentAccess, "dynamic-page");
  assert.deepEqual(manifest.editorType, ["figma"]);
  assert.ok(manifest.id && manifest.name && manifest.api);
});

test("neither built file can run text from a release or reach the network", () => {
  for (const file of ["code.js", "ui.html"]) {
    const text = committed(file);
    for (const [name, pattern] of [
      ["eval", /\beval\s*\(/],
      ["new Function", /\bnew\s+Function\b/],
      ["Function()", /\bFunction\s*\(/],
      ["dynamic import", /\bimport\s*\(/],
      ["importScripts", /\bimportScripts\b/],
      ["fetch", /\bfetch\s*\(/],
      ["XMLHttpRequest", /\bXMLHttpRequest\b/],
      ["WebSocket", /\bWebSocket\b/],
      ["sendBeacon", /\bsendBeacon\b/],
      ["a script from elsewhere", /<script[^>]*\ssrc=/i],
      ["a web address", /https?:\/\//i],
      ["innerHTML", /\binnerHTML\b/],
      ["document.write", /\bdocument\.write\b/],
      ["setTimeout with text", /\bsetTimeout\s*\(\s*["'`]/],
    ]) {
      assert.doesNotMatch(text, pattern, `${file} must not contain ${name}`);
    }
  }
});

test("ui.html carries the window's file reader as it is in src/sources.mjs", () => {
  const sources = readFileSync(here("src/sources.mjs"), "utf8").replace(/^export\s+/gm, "").trimEnd();
  assert.ok(committed("ui.html").includes(sources));
});
