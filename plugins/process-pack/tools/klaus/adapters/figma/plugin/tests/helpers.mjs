/** Shared fixtures for the plugin's tests: real generator output, zips, and the built plugin loaded into the fake Plugin API. */
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { createAdapter } from "../../index.mjs";
import { buttonCapture } from "../../tests/helpers.mjs";

export const FILE_KEY = "zSRhsvwtutOIPvHyWF9Wf2";

const entry = (name, extra = {}) => ({
  name,
  kind: "shared",
  folder: "packages/ui",
  file: `packages/ui/${name}.tsx`,
  props: [],
  parts: [],
  variants: { variant: ["primary", "secondary", "destructive", "outline", "ghost", "link"], size: ["sm", "md", "lg"] },
  purpose: { useWhen: "any action a person clicks", notFor: "navigation that should be a link", text: "" },
  version: "1.0.0",
  screenshot: "",
  usedIn: ["a.tsx"],
  ...extra,
});

/** Button as Meridian's 1.1.0 had it: two more sizes, so 6 variants by 5 sizes, 30 variants. */
export function buttonCapture30() {
  const capture = buttonCapture();
  const small = capture.cells.filter((cell) => cell.key.Size === "sm");
  const more = ["xs", "icon"].flatMap((size) => small.map((cell) => ({ ...cell, key: { ...cell.key, Size: size } })));
  return {
    ...capture,
    axes: capture.axes.map((axis) => (axis.name === "Size" ? { ...axis, values: [...axis.values, "xs", "icon"] } : axis)),
    cells: [...capture.cells, ...more],
  };
}

/**
 * Runs the real generator over a recorded Button capture and returns the files it leaves in a
 * release folder: manifest.json and figma-001.json, as text.
 */
export async function generate({ components = [{ name: "Button", version: "1.0.0", capture: buttonCapture() }], release = "v1.0.0", options = {} } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "klaus-plugin-test-"));
  const captures = new Map(components.map((c) => [c.name, c.capture]));
  const browser = {
    async openStorybook() {
      return { entries: [], async close() {} };
    },
    async captureComponent(_storybook, request) {
      return captures.get(request.name);
    },
  };
  const adapter = createAdapter(browser);
  const ctx = {
    output: "figma",
    root,
    settings: { enabled: true, target: FILE_KEY, options },
    selection: { componentGroups: [], screens: { mode: "none", routes: [] }, newComponents: { rule: "all", minUsage: 2 } },
    inventory: { schemaVersion: 1, folders: ["packages/ui"], entries: components.map((c) => entry(c.name, { version: c.version })) },
    trigger: "release",
    release,
    releases: [release],
    unwrittenFromLastRun: [],
    dryRun: false,
    secret() {},
  };
  await adapter.write(await adapter.plan(ctx), ctx);
  const directory = path.join(root, ".klaus/figma", release);
  return Object.fromEntries(readdirSync(directory).map((name) => [name, readFileSync(path.join(directory, name), "utf8")]));
}

/** Loose files as the window reads them. */
export const sourcesOf = (files, prefix = "") => Object.entries(files).map(([name, text]) => ({ path: prefix + name, text }));

/** Loose files as the browser gives them to readSources. */
export const looseFiles = (files) => Object.entries(files).map(([name, text]) => ({ name, bytes: new TextEncoder().encode(text) }));

const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * A zip file, written by hand so the tests need no library.
 * @param {Array<{ name: string, data?: string | Uint8Array, method?: 0 | 8, flags?: number }>} entries
 *   A name ending in "/" is a folder. method 8 (default) is deflate and 0 is stored.
 * @param {{ descriptor?: boolean }} [options]  descriptor writes sizes after the data, as GitHub's artifact zips do.
 */
export function makeZip(entries, { descriptor = true } = {}) {
  const parts = [];
  const central = [];
  let offset = 0;
  const push = (buffer) => {
    parts.push(buffer);
    offset += buffer.length;
  };
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const raw = Buffer.from(e.data ?? "");
    const method = e.name.endsWith("/") ? 0 : (e.method ?? 8);
    const packed = method === 8 ? deflateRawSync(raw) : raw;
    const crc = crc32(raw);
    const flags = (e.flags ?? 0) | (descriptor ? 8 : 0) | 0x800;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    if (!descriptor) {
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(packed.length, 18);
      local.writeUInt32LE(raw.length, 22);
    }
    local.writeUInt16LE(name.length, 26);
    const at = offset;
    push(local);
    push(name);
    push(packed);
    if (descriptor) {
      const tail = Buffer.alloc(16);
      tail.writeUInt32LE(0x08074b50, 0);
      tail.writeUInt32LE(crc, 4);
      tail.writeUInt32LE(packed.length, 8);
      tail.writeUInt32LE(raw.length, 12);
      push(tail);
    }
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(flags, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(packed.length, 20);
    header.writeUInt32LE(raw.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(at, 42);
    central.push(header, name);
  }
  const directoryAt = offset;
  for (const buffer of central) push(buffer);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(offset - directoryAt, 12);
  end.writeUInt32LE(directoryAt, 16);
  push(end);
  return new Uint8Array(Buffer.concat(parts));
}

/** A zip of a release folder, as `actions/upload-artifact` makes it: the folder's files, with a folder entry. */
export const zipOf = (files, folder = "", options) =>
  makeZip(
    [...(folder ? [{ name: folder }] : []), ...Object.entries(files).map(([name, data]) => ({ name: folder + name, data })), { name: `${folder}screens/home.png`, data: Buffer.alloc(4096, 7) }],
    options,
  );

/**
 * The built code.js, loaded as Figma loads it, with `figma` in scope.
 *
 * Trust boundary: code.js is the plugin this repository builds and commits, the same kind of code
 * tests/fake-figma.mjs runs, never a release file. The Function constructor runs it with this
 * process's privileges, so pass it nothing else.
 */
export function loadPlugin(figma, { html, code = readFileSync(new URL("../code.js", import.meta.url), "utf8") } = {}) {
  const load = new Function("figma", "__html__", `${code}\nreturn { applyRelease, startPlugin, reader };`);
  return load(figma, html);
}

/** The plugin's window, as the main thread sees it: what it posts, and a way to send it a message. */
export function fakeWindow(figma) {
  const posted = [];
  const window = {
    posted,
    onmessage: null,
    postMessage(message) {
      posted.push(JSON.parse(JSON.stringify(message)));
    },
  };
  figma.ui = window;
  figma.showUI = (html, options) => {
    figma.calls.showUI = [html, options];
  };
  figma.closePlugin = () => {
    figma.calls.closePlugin = true;
  };
  figma.calls ??= {};
  return window;
}
