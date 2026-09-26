/**
 * Contrast check over this repo's design tokens, one test per pair per theme.
 * Run with: node --test scripts/design-tokens-contrast.test.mjs
 *
 * DESIGN_TOKENS_FILE: the token file (default app/globals.css).
 * CONTRAST_PAIRS_FILE: the pairs to check (default .process/contrast-pairs.json),
 * shaped [{ "fg": "--foreground", "bg": "--background", "min": 4.5 }].
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { checkPairs, parseThemes } from "./design-tokens-contrast.mjs";

const tokensFile = process.env.DESIGN_TOKENS_FILE ?? "app/globals.css";
const pairsFile = process.env.CONTRAST_PAIRS_FILE ?? ".process/contrast-pairs.json";

if (!existsSync(tokensFile) || !existsSync(pairsFile)) {
  test("contrast inputs exist", () => {
    assert.fail(`Missing ${existsSync(tokensFile) ? pairsFile : tokensFile}. Set DESIGN_TOKENS_FILE and CONTRAST_PAIRS_FILE.`);
  });
} else {
  const themes = parseThemes(readFileSync(tokensFile, "utf8"));
  const pairs = JSON.parse(readFileSync(pairsFile, "utf8"));
  for (const result of checkPairs(themes, pairs)) {
    test(result.name, () => {
      assert.ok(result.pass, result.message);
    });
  }
}
