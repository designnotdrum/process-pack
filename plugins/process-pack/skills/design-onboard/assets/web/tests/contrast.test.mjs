import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { contrastRatio, parseColor, parseThemes, checkPairs } from "../design-tokens-contrast.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures");

test("oklch(0.145 0 0) on oklch(1 0 0) matches #0a0a0a on #ffffff", () => {
  const dark = parseColor("oklch(0.145 0 0)");
  assert.deepEqual(dark.map((c) => Math.round(c)), [10, 10, 10]);
  const viaOklch = contrastRatio(dark, parseColor("oklch(1 0 0)"));
  const viaHex = contrastRatio(parseColor("#0a0a0a"), parseColor("#ffffff"));
  assert.ok(Math.abs(viaOklch - viaHex) < 0.05, `oklch ${viaOklch} vs hex ${viaHex}`);
});

test("a chromatic oklch color converts to its sRGB value", () => {
  // oklch(0.628 0.2577 29.23) is sRGB red, #ff0000, per CSS Color 4 conversion.
  assert.deepEqual(parseColor("oklch(0.628 0.2577 29.23)").map((c) => Math.round(c)), [255, 0, 0]);
});

test("#777777 on #ffffff is 4.48", () => {
  const ratio = contrastRatio(parseColor("#777777"), parseColor("#ffffff"));
  assert.equal(ratio.toFixed(2), "4.48");
});

test("hsl triplet parses", () => {
  assert.deepEqual(parseColor("222 47% 11%").map((c) => Math.round(c)), [15, 23, 41]);
  assert.deepEqual(parseColor("hsl(0 0% 100%)").map((c) => Math.round(c)), [255, 255, 255]);
});

test("alpha colors are refused rather than guessed", () => {
  assert.throws(() => parseColor("#ffffff80"), /opaque/);
  assert.throws(() => parseColor("oklch(0.5 0.1 200 / 50%)"), /opaque/);
});

test("dark theme inherits root values and var() chains resolve", () => {
  const themes = parseThemes(readFileSync(join(fixtures, "tokens.css"), "utf8"));
  assert.deepEqual(Object.keys(themes), ["root", "dark"]);
  assert.equal(themes.dark.get("muted"), "#777777");
  const results = checkPairs(themes, [{ fg: "--link", bg: "--background", min: 4.5 }]);
  assert.ok(results.every((r) => r.pass));
});

test("failing pair fails with both colors and the ratio in the message", () => {
  const themes = parseThemes(readFileSync(join(fixtures, "tokens.css"), "utf8"));
  const pairs = JSON.parse(readFileSync(join(fixtures, "pairs.json"), "utf8"));
  const failed = checkPairs(themes, pairs).filter((r) => !r.pass);
  assert.equal(failed.length, 2, "muted on card fails in root and dark");
  assert.match(failed[0].message, /--muted \(#777777\) on --card \(#ffffff\) is 4\.47, needs 4\.5/);
});

test("the runner fails the suite on the fixture pairs", () => {
  const runner = join(here, "..", "design-tokens-contrast.test.mjs");
  const result = spawnSync(process.execPath, ["--test", runner], {
    encoding: "utf8",
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "NODE_TEST_CONTEXT")),
      DESIGN_TOKENS_FILE: join(fixtures, "tokens.css"),
      CONTRAST_PAIRS_FILE: join(fixtures, "pairs.json"),
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /root --muted on --card >= 4\.5/);
});

test("a :root inside a dark color-scheme media query counts as dark", () => {
  const css = ":root { --bg: #ffffff; } @media (prefers-color-scheme: dark) { :root { --bg: #000000; } }";
  const themes = parseThemes(css);
  assert.equal(themes.root.get("bg"), "#ffffff");
  assert.equal(themes.dark.get("bg"), "#000000");
});

test("a ratio just under the minimum is not rounded up to it", () => {
  // #647d67 on #ffffff is 4.4957, which toFixed(2) would print as 4.50.
  const themes = parseThemes(":root { --fg: #647d67; --bg: #ffffff; }");
  const [result] = checkPairs(themes, [{ fg: "--fg", bg: "--bg", min: 4.5 }]);
  assert.equal(result.pass, false);
  assert.match(result.message, /is 4\.49, needs 4\.5/);
});

test(":root values win over @theme inline references to the same name", () => {
  const css = ":root { --background: #ffffff; --foreground: #111111; } @theme inline { --background: var(--background); --color-background: var(--background); }";
  const themes = parseThemes(css);
  const [result] = checkPairs(themes, [{ fg: "--foreground", bg: "--color-background", min: 4.5 }]);
  assert.ok(result.pass, result.message);
});
