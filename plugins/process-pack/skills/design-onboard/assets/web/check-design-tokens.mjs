#!/usr/bin/env node
/**
 * Blocks hardcoded colors in app code: Tailwind palette-shade classes
 * (text-orange-600), arbitrary color classes (bg-[#ff0000]), hex literals,
 * and rgb(), hsl(), oklch(), lab() and lch() values. Every color should come
 * from a design token instead.
 *
 * Usage:
 *   node scripts/check-design-tokens.mjs --tokens app/globals.css [--root .] [--glob "app/**"]...
 *
 * --tokens (repeatable) names the token files, which are exempt.
 * --glob (repeatable) limits the scan to matching paths, relative to --root.
 * A line containing "design-tokens-allow: <reason>" is exempt.
 *
 * Exit 0 when clean. Exit 1 and one "path:line: match (reason)" line per hit
 * otherwise. No dependencies. Copied into a consuming repo by the
 * design-onboard skill and wired into its lint script.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";

const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".css"]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "out", "coverage", ".agents", ".claude", ".turbo"]);
const SELF = new Set(["check-design-tokens.mjs", "design-tokens-contrast.mjs", "design-tokens-contrast.test.mjs"]);
const TEST_FILE = /(?:\.test\.|\.spec\.|(?:^|\/)__tests__\/)/;
const ALLOW = /design-tokens-allow:\s*\S/;

const UTILITIES = "bg|text|border|ring|fill|stroke|from|via|to|outline|decoration|divide|placeholder|shadow|accent|caret";
const PALETTE = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const COLOR_FN = "rgba?|hsla?|oklch|oklab|lab|lch";

const RULES = [
  {
    reason: "palette class, use a token class",
    pattern: new RegExp(`(?<![\\w-])(?:[\\w-]+:)*(?:${UTILITIES})-(?:${PALETTE})-(?:50|[1-9]00|950)(?:/\\d+)?(?![\\w-])`, "g"),
    languages: "script",
  },
  {
    reason: "arbitrary color class, use a token class",
    pattern: new RegExp(`(?<![\\w-])[\\w-]+-\\[(?:#[\\da-fA-F]{3,8}|(?:${COLOR_FN})\\([^\\]]*\\))\\]`, "g"),
    languages: "script",
  },
  {
    reason: "hex color, use a token",
    // A whole string literal that is a hex color. Anchors such as href="#add" are not colors.
    pattern: /(?<!(?:href|to|id|htmlFor)=)(["'`])(#(?:[\da-fA-F]{3,4}|[\da-fA-F]{6}|[\da-fA-F]{8}))\1/g,
    group: 2,
    languages: "script",
  },
  {
    reason: "color function, use a token",
    pattern: new RegExp(`\\b(?:${COLOR_FN})\\([^)]*\\)`, "g"),
    languages: "all",
  },
  {
    reason: "hex color, use a token",
    pattern: /(?<=:[^;{}]*)#(?:[\da-fA-F]{3,4}|[\da-fA-F]{6}|[\da-fA-F]{8})\b/g,
    languages: "style",
  },
];

function parseArgs(argv) {
  const args = { root: process.cwd(), tokens: [], globs: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--root") args.root = value;
    else if (flag === "--tokens") args.tokens.push(value);
    else if (flag === "--glob") args.globs.push(value);
    else {
      console.error(`check-design-tokens: unknown argument ${flag}`);
      process.exit(2);
    }
    i += 1;
  }
  return args;
}

/** "**" matches any number of directories, "*" matches within one path segment. */
function globToRegExp(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === "*" && glob[i + 1] === "*") {
      out += glob[i + 2] === "/" ? "(?:.*/)?" : ".*";
      i += glob[i + 2] === "/" ? 2 : 1;
    } else if (ch === "*") out += "[^/]*";
    else if (ch === "?") out += "[^/]";
    else out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(join(dir, entry.name));
    } else if (entry.isFile()) {
      yield join(dir, entry.name);
    }
  }
}

function scanLine(line, isStyle) {
  const found = [];
  for (const rule of RULES) {
    if (rule.languages === "script" && isStyle) continue;
    if (rule.languages === "style" && !isStyle) continue;
    for (const m of line.matchAll(rule.pattern)) {
      const text = rule.group ? m[rule.group] : m[0];
      const start = m.index + m[0].indexOf(text);
      found.push({ start, end: start + text.length, text, reason: rule.reason });
    }
  }
  // One hit per location: drop any match that sits inside another one.
  return found
    .filter((a) => !found.some((b) => b !== a && b.start <= a.start && b.end >= a.end && b.end - b.start > a.end - a.start))
    .sort((a, b) => a.start - b.start);
}

export function scan({ root, tokens = [], globs = [] }) {
  const rootPath = resolve(root);
  const exempt = new Set(tokens.map((t) => resolve(t)));
  const matchers = globs.map(globToRegExp);
  const hits = [];
  for (const file of walk(rootPath)) {
    const rel = relative(rootPath, file).split(sep).join("/");
    if (!EXTENSIONS.has(extname(file)) || SELF.has(basename(file)) || TEST_FILE.test(rel)) continue;
    if (exempt.has(resolve(file))) continue;
    if (matchers.length && !matchers.some((m) => m.test(rel))) continue;
    if (statSync(file).size > 1_000_000) continue;
    const isStyle = extname(file) === ".css";
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (ALLOW.test(line)) return;
        for (const hit of scanLine(line, isStyle)) {
          hits.push(`${rel}:${index + 1}: ${hit.text} (${hit.reason})`);
        }
      });
  }
  return hits;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("check-design-tokens.mjs")) {
  const hits = scan(parseArgs(process.argv.slice(2)));
  if (hits.length) {
    console.log(hits.join("\n"));
    process.exit(1);
  }
}
