/** The data file reader: the generator's output passes, anything else is refused with a reason. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { packUnits } from "../batch.mjs";
import { codeFor, renderFile } from "../codegen.mjs";
import { checkTargets, DataError, readData } from "../data-file.mjs";
import { OLDER_VERSIONS_PAGE, SCREENS_PAGE } from "../settings.mjs";
import { buttonUnit, CONFIG, screenUnit, tinyUnit } from "./helpers.mjs";

const OPTIONS = { collectionName: CONFIG.collection, page: "" };

/** One data file holding a Button, a small component and an editable screen, as the generator packs them. */
function generated() {
  const units = [buttonUnit({ page: "Button" }), tinyUnit("Card"), screenUnit("/settings", "v1.0.0")];
  const [file] = packUnits(units, { config: CONFIG, perFile: 10 }).files;
  return file;
}

const copy = (value) => JSON.parse(JSON.stringify(value));
const refused = (data, pattern) => assert.throws(() => readData(JSON.stringify(data)), (error) => error instanceof DataError && pattern.test(error.message));

test("the generator's data passes, and the code built from it is the code the generator sized", () => {
  const file = generated();
  const data = readData(JSON.stringify(file.data));
  checkTargets(data, OPTIONS);
  assert.equal(codeFor(data), file.code);
  assert.equal(codeFor(data), renderFile({ units: file.units, config: CONFIG, header: file.data.header }));
});

test("text that is not JSON, or JSON of another version, is refused", () => {
  assert.throws(() => readData("figma.closePlugin();"), /is not JSON/);
  refused({ ...copy(generated().data), version: 2 }, /is version 2, not 1/);
  assert.throws(() => readData("x".repeat(200001)), /is larger than/);
});

test("a header must stay one printable line, so it cannot end the comment and start code", () => {
  refused({ ...copy(generated().data), header: "file\nfigma.root.children[0].remove();" }, /header must be one line of printable ASCII/);
  assert.throws(() => codeFor({ ...copy(generated().data), header: "a b" }), /printable ASCII/);
});

test("unknown keys, kinds and out-of-range values are refused", () => {
  const base = generated().data;
  const cases = [
    [(d) => { d.script = "x"; }, /has a key the generator does not write: "script"/],
    [(d) => { d.units[0].kind = "plugin"; }, /units\[0\]\.kind must be one of/],
    [(d) => { d.tokens[0].rgba[0] = 300; }, /rgba\[0\] must be a whole number from 0 to 255/],
    [(d) => { d.units[0].nodes[0].k = "script"; }, /nodes\[0\]\.k must be one of/],
    [(d) => { d.units[0].nodes[0].onload = "x"; }, /has a key the generator does not write: "onload"/],
    [(d) => { d.units[0].tk[0] = 999; }, /tk\[0\] must be a whole number from 0 to/],
    [(d) => { d.units[0].version = "1.0.0; figma.closePlugin()"; }, /version must be a version/],
    [(d) => { d.units[1].id = d.units[0].id; }, /repeats the id "Button"/],
    [(d) => { d.units[2].route = "settings"; }, /route must be a route such as \/settings/],
    [(d) => { d.units[2].release = "v1 v2"; }, /release must be one word/],
  ];
  for (const [change, pattern] of cases) {
    const data = copy(base);
    change(data);
    refused(data, pattern);
  }
});

test("a node or SVG index that points nowhere, and a tree nested too deep, are refused", () => {
  const unit = tinyUnit("Deep");
  unit.nodes.push({ k: "v", s: 0, w: 1, h: 1 });
  let tree = [0, []];
  for (let i = 0; i < 70; i++) tree = [0, [tree]];
  const deep = copy(packUnits([{ ...tinyUnit("Deep"), cells: [[[], tree]] }], { config: CONFIG }).files[0].data);
  refused(deep, /is nested more than 64 deep/);
  const noSvg = copy(packUnits([{ ...unit, cells: [[[], [0, [[1, []]]]]] }], { config: CONFIG }).files[0].data);
  refused(noSvg, /nodes\[1\]\.s points at an SVG, and the unit has none/);
  const badSvg = copy(noSvg);
  badSvg.units[0].svgs = ["<script>alert(1)</script>"];
  refused(badSvg, /svgs\[0\] must be SVG markup/);
});

test("checkTargets holds the data to the settings' collection and pages", () => {
  const data = readData(JSON.stringify(generated().data));
  assert.throws(() => checkTargets(data, { ...OPTIONS, collectionName: "Tokens" }), /writes to the variable collection "Meridian tokens" \(Light\), but the settings name "Tokens"/);
  assert.throws(() => checkTargets(data, { ...OPTIONS, page: "Components" }), /writes to the page "Button", but the settings put it on "Components"/);
  const moved = copy(data);
  moved.units[0].older = "Archive";
  assert.throws(() => checkTargets(moved, OPTIONS), new RegExp(`moves earlier versions to "Archive", not "${OLDER_VERSIONS_PAGE}"`));
  const screen = copy(data);
  screen.units[2].page = "Cover";
  assert.throws(() => checkTargets(screen, OPTIONS), new RegExp(`writes to the page "Cover", not "${SCREENS_PAGE}"`));
  const named = copy(data);
  named.units[1] = { ...named.units[1], name: SCREENS_PAGE, page: SCREENS_PAGE };
  assert.throws(() => checkTargets(named, OPTIONS), /cannot be drawn on the "Screens" page/);
});
