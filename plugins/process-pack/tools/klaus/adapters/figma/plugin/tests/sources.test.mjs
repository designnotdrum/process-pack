/** The window reads a CI artifact .zip or loose files, and nothing else. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";
import { MAX_ENTRY_BYTES, readSources, SourceError } from "../src/sources.mjs";
import { generate, looseFiles, makeZip, zipOf } from "./helpers.mjs";

const refused = (promise, pattern) => assert.rejects(promise, (error) => error instanceof SourceError && pattern.test(error.message));
const sorted = (sources) => sources.toSorted((a, b) => a.path.localeCompare(b.path));

test("loose files are read as text", async () => {
  const files = await generate();
  const sources = await readSources(looseFiles(files));
  assert.deepEqual(sorted(sources), sorted(Object.entries(files).map(([path, text]) => ({ path, text }))));
});

test("a zip with deflated entries and data descriptors, as GitHub writes artifacts, gives the same text", async () => {
  const files = await generate();
  const zip = zipOf(files, "v1.0.0/");
  const sources = await readSources([{ name: "klaus-figma.zip", bytes: zip }]);
  assert.deepEqual(
    sorted(sources),
    sorted(Object.entries(files).map(([name, text]) => ({ path: `v1.0.0/${name}`, text }))),
    "only the manifest and the data file are unpacked; the screenshot and the folder entry are left alone",
  );
});

test("a zip with stored entries and sizes in the local headers reads the same", async () => {
  const files = await generate();
  const zip = makeZip(Object.entries(files).map(([name, data]) => ({ name, data, method: 0 })), { descriptor: false });
  const sources = await readSources([{ name: "a.zip", bytes: zip }]);
  assert.deepEqual(sorted(sources), sorted(Object.entries(files).map(([path, text]) => ({ path, text }))));
});

test("a zip is recognised by its first bytes, not by its name", async () => {
  const files = await generate();
  const sources = await readSources([{ name: "download", bytes: zipOf(files) }]);
  assert.equal(sources.length, 2);
});

test("a byte order mark at the start of a file is dropped", async () => {
  const sources = await readSources([{ name: "manifest.json", bytes: new TextEncoder().encode("﻿{}") }]);
  assert.equal(sources[0].text, "{}");
});

test("the generator's other loose files are skipped, so a whole folder can be added", async () => {
  const files = await generate();
  const sources = await readSources([
    ...looseFiles(files),
    { name: "figma-retention.json", bytes: new TextEncoder().encode("{}") },
    { name: "home.png", bytes: new Uint8Array([1, 2, 3]) },
  ]);
  assert.deepEqual(sorted(sources).map((s) => s.path), ["figma-001.json", "manifest.json"]);
});

test("a loose file the generator does not write is refused by name", async () => {
  await refused(readSources([{ name: "package.json", bytes: new TextEncoder().encode("{}") }]), /package\.json is not a file the generator writes/);
  await refused(readSources([{ name: "run.js", bytes: new TextEncoder().encode("figma.closePlugin()") }]), /run\.js is not a file the generator writes/);
  await refused(readSources([]), /Add the artifact \.zip/);
});

test("the same file twice is refused", async () => {
  const files = await generate();
  await refused(readSources([...looseFiles(files), ...looseFiles(files)]), /was added twice/);
});

test("a file that is not text is refused", async () => {
  await refused(readSources([{ name: "figma-001.json", bytes: new Uint8Array([0xff, 0xfe, 0xfd]) }]), /is not text/);
});

test("a zip that is cut short, or only starts like a zip, is refused", async () => {
  const zip = zipOf(await generate());
  await refused(readSources([{ name: "a.zip", bytes: zip.slice(0, zip.length - 30) }]), /is not a zip the plugin can read/);
  await refused(readSources([{ name: "a.zip", bytes: new Uint8Array([0x50, 0x4b, 1, 2, 3, 4, 5]) }]), /is not a zip the plugin can read/);
});

test("an entry that cannot be inflated is refused", async () => {
  const zip = makeZip([{ name: "figma-001.json", data: "x".repeat(100) }]);
  // Overwrite the deflate data with bytes that are not a valid stream.
  const at = Buffer.from(zip).indexOf("figma-001.json") + "figma-001.json".length;
  zip.fill(0xff, at, at + 6);
  await refused(readSources([{ name: "a.zip", bytes: zip }]), /figma-001\.json is damaged inside the zip/);
});

test("an entry larger than the limit is refused, whether the zip admits it or hides it", async () => {
  const big = "x".repeat(MAX_ENTRY_BYTES + 10);
  await refused(readSources([{ name: "a.zip", bytes: makeZip([{ name: "figma-001.json", data: big }]) }]), /is larger than 1 MB/);
  await refused(readSources([{ name: "figma-001.json", bytes: new TextEncoder().encode(big) }]), /is larger than 1 MB/);

  // A zip that says the entry is small but inflates to more than the limit stops at the limit.
  const zip = makeZip([{ name: "figma-001.json", data: "x".repeat(MAX_ENTRY_BYTES * 3), method: 8 }]);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const central = zip.length - 22 - (46 + "figma-001.json".length);
  assert.equal(view.getUint32(central, true), 0x02014b50);
  view.setUint32(central + 24, 100, true);
  await refused(readSources([{ name: "a.zip", bytes: zip }]), /unpacks to more than 1 MB/);
});

test("an entry whose size disagrees with the zip's directory is refused", async () => {
  const zip = makeZip([{ name: "figma-001.json", data: "{}" }]);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const central = zip.length - 22 - (46 + "figma-001.json".length);
  view.setUint32(central + 24, 5, true);
  await refused(readSources([{ name: "a.zip", bytes: zip }]), /is damaged: it is 2 bytes, not the 5 the zip says/);
});

test("encrypted, Zip64 and unusual compression are refused with a reason", async () => {
  await refused(readSources([{ name: "a.zip", bytes: makeZip([{ name: "manifest.json", data: "{}", flags: 1 }]) }]), /is encrypted/);

  const odd = makeZip([{ name: "manifest.json", data: "{}" }]);
  const view = new DataView(odd.buffer, odd.byteOffset, odd.byteLength);
  const central = odd.length - 22 - (46 + "manifest.json".length);
  view.setUint16(central + 10, 12, true);
  await refused(readSources([{ name: "a.zip", bytes: odd }]), /uses a compression the plugin does not read \(method 12\)/);

  const big = makeZip([{ name: "manifest.json", data: "{}" }]);
  const end = new DataView(big.buffer, big.byteOffset, big.byteLength);
  end.setUint16(big.length - 22 + 10, 0xffff, true);
  await refused(readSources([{ name: "a.zip", bytes: big }]), /uses Zip64/);
});

test("entries the plugin does not read are never unpacked, even when their data is not a valid stream", async () => {
  // Data that would not inflate, under names the plugin does not read: it is never touched.
  const zip = makeZip([
    { name: "screens/home.png", data: deflateRawSync("x").subarray(0, 1), method: 0 },
    { name: "notes/readme.md", data: "hello" },
  ]);
  assert.deepEqual(await readSources([{ name: "a.zip", bytes: zip }]), []);
});
