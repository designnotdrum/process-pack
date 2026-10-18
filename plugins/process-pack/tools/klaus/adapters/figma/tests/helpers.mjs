/** Shared fixtures for the Figma adapter's tests. */
import { readFileSync } from "node:fs";
import { renderFile } from "../codegen.mjs";
import { buildComponentUnit } from "../spec.mjs";
import { createFigma, runCode } from "./fake-figma.mjs";

export const CONFIG = { collection: "Meridian tokens", mode: "Light" };

/** What the browser read for Meridian's Button: 6 variants, 3 sizes, a disabled state, an icon and a spinner. */
export function buttonCapture({ states = false } = {}) {
  const capture = JSON.parse(readFileSync(new URL("./fixtures/button-capture.json", import.meta.url), "utf8"));
  if (states) return capture;
  return {
    ...capture,
    axes: capture.axes.filter((axis) => axis.name !== "State"),
    cells: capture.cells.filter((cell) => cell.key.State === "default").map((cell) => ({ ...cell, key: { Variant: cell.key.Variant, Size: cell.key.Size } })),
  };
}

export const OPTIONS = { icons: false, olderVersionsPage: "Older versions", screenVersionsKept: 20 };

/** A component unit for Button at a version, from the recorded capture. */
export function buttonUnit({ version = "1.0.0", page = "Generator test", options = OPTIONS, capture = buttonCapture() } = {}) {
  const item = { id: "Button", name: "Button", version, page, description: "Use when: any action a person clicks. Not for: navigation that should be a link." };
  return buildComponentUnit({ item, capture, options });
}

/** The code for one file of units. */
export function codeFor(units) {
  return renderFile({ units, config: CONFIG, header: "test" });
}

/** Runs units in Figma's place and returns what the code returned. */
export function run(figma, units) {
  return runCode(codeFor(units), figma);
}

export function newFigma(pages = ["Button"]) {
  return createFigma({ pages });
}

/** A tiny component unit with no variants, for tests that care about count and size. */
export function tinyUnit(id, { description = "", page = id, version = "1.0.0" } = {}) {
  return {
    kind: "component",
    id,
    name: id,
    version,
    page,
    older: "Older versions",
    description,
    axes: [],
    iconProperty: 0,
    cells: [[[], [0, []]]],
    nodes: [{ k: "b", n: "box", w: 10, h: 10 }],
    svgs: [],
    tokens: [],
    warnings: [],
  };
}

/** An editable screen unit: a frame with one text on it. */
export function screenUnit(route, release, { keep = 20, page = "Screens" } = {}) {
  return {
    kind: "screen",
    id: `screen:${route}`,
    route,
    release,
    page,
    keep,
    width: 400,
    height: 300,
    tree: [0, [[1, []]]],
    nodes: [
      { k: "b", n: "body", w: 400, h: 300 },
      { k: "t", v: "Hello", ff: "DM Sans", wt: 400, fs: 14, lh: 20, c: [-1, 0, 0, 0, 1], x: 10, y: 10, w: 40 },
    ],
    svgs: [],
    tokens: [],
    warnings: [],
  };
}
