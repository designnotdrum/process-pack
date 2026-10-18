/** The adapter's settings: defaults, and errors that name the setting. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_OPTIONS, pageFor, readOptions } from "../settings.mjs";

test("an empty block gets every default", () => {
  assert.deepEqual(readOptions({ enabled: true }), { ...DEFAULT_OPTIONS });
  assert.equal(DEFAULT_OPTIONS.screenVersionsKept, 20);
  assert.equal(DEFAULT_OPTIONS.editableScreens, false);
  assert.deepEqual(DEFAULT_OPTIONS.axes, ["variant", "size"]);
  assert.deepEqual(DEFAULT_OPTIONS.states, []);
});

test("a given value replaces its default and leaves the rest", () => {
  const options = readOptions({ options: { page: "Generator test", screenVersionsKept: 5 } });
  assert.equal(options.page, "Generator test");
  assert.equal(options.screenVersionsKept, 5);
  assert.equal(options.collectionName, "Tokens");
});

test("a setting the adapter does not know is named in the error", () => {
  assert.throws(() => readOptions({ options: { screensKept: 5 } }), /outputs\.figma\.options\.screensKept: is not a setting the Figma adapter knows/);
});

test("wrong types are refused with the setting's name", () => {
  const bad = (options, pattern) => assert.throws(() => readOptions({ options }), pattern);
  bad({ icons: "yes" }, /options\.icons: must be true or false/);
  bad({ screenVersionsKept: 0 }, /options\.screenVersionsKept: must be a whole number from 1 to 1000/);
  bad({ screenVersionsKept: 2.5 }, /screenVersionsKept/);
  bad({ componentsPerCall: 51 }, /options\.componentsPerCall/);
  bad({ states: ["hover"] }, /options\.states: "hover" is not a state/);
  bad({ axes: ["size", "size"] }, /options\.axes: lists a name twice/);
  bad({ page: 7 }, /options\.page: must be text/);
  bad({ collectionName: "" }, /options\.collectionName: must be a name/);
  bad({ stories: { Button: 3 } }, /options\.stories: the story id for Button/);
});

test("editable screens need the address of the running app", () => {
  assert.throws(() => readOptions({ options: { editableScreens: true } }), /screensBaseUrl: is needed when editableScreens is true/);
  assert.equal(readOptions({ options: { editableScreens: true, screensBaseUrl: "http://localhost:3000" } }).editableScreens, true);
});

test("a component is on its own page, named after it, unless one page is set", () => {
  assert.equal(pageFor("Button", { page: "" }), "Button");
  assert.equal(pageFor("Button", { page: "Generator test" }), "Generator test");
});
