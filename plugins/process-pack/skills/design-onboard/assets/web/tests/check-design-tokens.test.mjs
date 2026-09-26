import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "check-design-tokens.mjs");
const fixtures = join(here, "fixtures");

function run(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

test("clean exits 0", () => {
  const result = run(["--root", join(fixtures, "clean"), "--tokens", join(fixtures, "tokens.css")]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("dirty reports exactly 3 hits with line numbers", () => {
  const result = run(["--root", join(fixtures, "dirty"), "--tokens", join(fixtures, "tokens.css")]);
  assert.equal(result.status, 1);
  const hits = result.stdout.trim().split("\n");
  assert.equal(hits.length, 3, result.stdout);
  assert.match(hits[0], /Card\.tsx:3: text-orange-600/);
  assert.match(hits[1], /Card\.tsx:4: bg-\[#ff0000\]/);
  assert.match(hits[2], /Card\.tsx:5: #333/);
});

test("allow comment is exempt", () => {
  const result = run(["--root", join(fixtures, "dirty"), "--tokens", join(fixtures, "tokens.css")]);
  assert.doesNotMatch(result.stdout, /#1da1f2/);
});

test("tokens file is exempt", () => {
  const root = mkdtempSync(join(tmpdir(), "tokens-"));
  cpSync(join(fixtures, "tokens.css"), join(root, "globals.css"));
  assert.equal(run(["--root", root]).status, 1, "without --tokens the literals are hits");
  assert.equal(run(["--root", root, "--tokens", join(root, "globals.css")]).status, 0);
});

test("black and white utility classes are hits", () => {
  const root = mkdtempSync(join(tmpdir(), "bw-"));
  writeFileSync(join(root, "Button.tsx"), '<button className="bg-black text-white hover:bg-white/90">Go</button>\n');
  const result = run(["--root", root]);
  assert.equal(result.status, 1);
  const hits = result.stdout.trim().split("\n");
  assert.equal(hits.length, 3, result.stdout);
});

test("a total line goes to stderr", () => {
  const result = run(["--root", join(fixtures, "dirty"), "--tokens", join(fixtures, "tokens.css")]);
  assert.match(result.stderr, /3 hardcoded colors in 1 file/);
});
