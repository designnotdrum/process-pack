/**
 * The code built from data holds no backslash where it can avoid one, because a model copying
 * it into use_figma tends to drop backslashes (all of them, in one real call on 2026-10-18).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { codeFor, dataFor, RUNTIME_CODE, templateSafe } from "../codegen.mjs";
import { buildComponentUnit } from "../spec.mjs";
import { createFigma, runCode, walk } from "./fake-figma.mjs";
import { buttonCapture, CONFIG, OPTIONS } from "./helpers.mjs";

const BACKSLASH = String.fromCharCode(92);

/** Meridian's Button with its icon: 18 variants, each with a hidden Icon layer. */
function buttonWithIcon(capture = buttonCapture()) {
  const item = { id: "Button", name: "Button", version: "1.1.0", page: "Runtime check", description: "Use when: any action a person clicks." };
  return buildComponentUnit({ item, capture, options: { ...OPTIONS, icons: true } });
}

test("the runtime holds no backslash", () => {
  assert.equal(RUNTIME_CODE.includes(BACKSLASH), false);
});

test("a Button with icons comes out with no backslash, its SVG markup in template literals, and draws the same", async () => {
  const unit = buttonWithIcon();
  assert.ok(unit.svgs.length > 0 && unit.svgs.every((svg) => svg.includes('"')), "the markup has double quotes, which JSON would escape");
  const code = codeFor(dataFor({ units: [unit], config: CONFIG, header: "test" }));
  assert.equal(code.includes(BACKSLASH), false, "no backslash anywhere in the code");

  const figma = createFigma({ pages: ["Runtime check"] });
  const result = await runCode(code, figma);
  assert.equal(result.units[0].status, "written");
  const set = figma.page("Runtime check").children[0];
  assert.equal(set.children.length, 18);
  for (const variant of set.children) {
    const icons = [];
    walk(variant, (n) => n.name === "Icon" && icons.push(n));
    assert.equal(icons.length, 1, `${variant.name} has one Icon layer`);
    assert.equal(icons[0].visible, false, `${variant.name}'s Icon is hidden`);
    // Figma gives the frame around an SVG a white fill. Left in, it shows as a white square behind the icon.
    assert.deepEqual(icons[0].fills, [], `${variant.name}'s Icon frame has no fill`);
    assert.ok(variant.properties?.["Show icon"], `${variant.name} has the Show icon property`);
  }
});

test("markup a template literal would change, or could leave, stays a JSON string", async () => {
  for (const text of ["<svg>`</svg>", "<svg>${figma.root.remove()}</svg>", `<svg>${BACKSLASH}n</svg>`, "<svg>café</svg>"]) {
    assert.equal(templateSafe(text), false, text);
  }
  assert.equal(templateSafe('<svg viewBox="0 0 24 24">\n<path d="M5 12h14"/></svg>'), true);

  // Markup with a template substitution in it reaches Figma as the same text, not as code.
  const unit = buttonWithIcon();
  const odd = "<svg data-x=\"${figma.root.children.length}\">`</svg>";
  unit.svgs = [odd, ...unit.svgs.slice(1)];
  const code = codeFor(dataFor({ units: [unit], config: CONFIG, header: "test" }));
  const figma = createFigma({ pages: ["Runtime check"] });
  const seen = [];
  const create = figma.createNodeFromSvg;
  figma.createNodeFromSvg = (svg) => {
    seen.push(svg);
    return create(svg);
  };
  await runCode(code, figma);
  assert.ok(seen.includes(odd), "the runtime was given the markup exactly");
});
