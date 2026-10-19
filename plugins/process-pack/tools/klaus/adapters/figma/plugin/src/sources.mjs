/**
 * Reads what a person gives the plugin window: a CI artifact as a .zip, or the loose files.
 *
 * This runs in the plugin's window, a browser page, so it uses no Node module. build.mjs copies it
 * into ui.html as it is, minus the word `export`. A zip is read from its central directory, and only
 * the entries the plugin needs are unpacked: manifest.json and the generator's data files. Deflate
 * is unpacked with the browser's DecompressionStream, so the plugin carries no unzip library.
 *
 * The result is text, nothing else. Nothing here parses or runs it. The plugin's main thread reads
 * it with the generator's own reader (data-file.mjs), which is what refuses a file that is not
 * generator data.
 */

export class SourceError extends Error {}

/** The most a zip may be, and the most one unpacked entry may be. A data file is under 100,000 characters. */
export const MAX_ZIP_BYTES = 200 * 1024 * 1024;
export const MAX_ENTRY_BYTES = 1024 * 1024;
const MAX_ENTRIES = 20000;

/** The names the plugin reads. Everything else in an artifact (screenshots, other files) is left alone. */
const WANTED = /(^|\/)(manifest\.json|figma-\d{3,}\.json)$/;
/** Loose files the generator writes that the plugin does not apply, so a whole folder can be added at once. */
const SKIPPED_LOOSE = /^(figma-retention\.json|.*\.png)$/i;

const decoder = new TextDecoder("utf-8", { fatal: true });

/** True when the bytes start like a zip: "PK". */
const looksLikeZip = (bytes) => bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;

function textOf(bytes, path) {
  let text;
  try {
    text = decoder.decode(bytes);
  } catch {
    throw new SourceError(`${path} is not text, so it is not generator data.`);
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** The unpacked bytes of a deflate stream, stopping as soon as they pass the limit. */
async function inflate(bytes, limit, path) {
  if (typeof DecompressionStream === "undefined") {
    throw new SourceError("This version of Figma cannot unzip files here. Unzip the artifact and add manifest.json with the figma-001.json files.");
  }
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel();
        throw new SourceError(`${path} unpacks to more than ${limit / 1024 / 1024} MB, so it is not generator data.`);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError(`${path} is damaged inside the zip and could not be unpacked.`);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * The wanted entries of a zip, as { path, text }. Reads the central directory, so a zip written with
 * data descriptors (as GitHub writes artifacts) works the same as any other.
 */
async function readZip(bytes, label) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const broken = () => new SourceError(`${label} is not a zip the plugin can read.`);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65535); at--) {
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw broken();
  const count = view.getUint16(end + 10, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (count === 0xffff || directoryOffset === 0xffffffff) {
    throw new SourceError(`${label} uses Zip64, which the plugin does not read. Unzip it and add manifest.json with the figma-001.json files.`);
  }
  if (count > MAX_ENTRIES) throw new SourceError(`${label} holds more than ${MAX_ENTRIES} files.`);

  const found = [];
  let at = directoryOffset;
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) throw broken();
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const packed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    if (at + 46 + nameLength > bytes.length) throw broken();
    const path = new TextDecoder("utf-8").decode(bytes.subarray(at + 46, at + 46 + nameLength)).replaceAll("\\", "/");
    at += 46 + nameLength + extraLength + commentLength;
    if (path.endsWith("/") || !WANTED.test(path)) continue;

    if (flags & 1) throw new SourceError(`${path} in ${label} is encrypted.`);
    if (method !== 0 && method !== 8) throw new SourceError(`${path} in ${label} uses a compression the plugin does not read (method ${method}).`);
    if (packed === 0xffffffff || size === 0xffffffff) throw new SourceError(`${label} uses Zip64, which the plugin does not read.`);
    if (size > MAX_ENTRY_BYTES) throw new SourceError(`${path} is larger than ${MAX_ENTRY_BYTES / 1024 / 1024} MB, so it is not generator data.`);
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) throw broken();
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + packed > bytes.length) throw broken();
    const stored = bytes.subarray(start, start + packed);
    const data = method === 0 ? stored : await inflate(stored, MAX_ENTRY_BYTES, path);
    if (data.length !== size) throw new SourceError(`${path} in ${label} is damaged: it is ${data.length} bytes, not the ${size} the zip says.`);
    found.push({ path, text: textOf(data, path) });
  }
  return found;
}

/**
 * The text of every file the plugin reads, from the files a person added.
 *
 * @param {Array<{ name: string, bytes: Uint8Array }>} files  Each file the person chose or dropped.
 * @returns {Promise<Array<{ path: string, text: string }>>}
 * @throws {SourceError} for a zip that cannot be read, and for a loose file the generator does not write.
 */
export async function readSources(files) {
  if (!Array.isArray(files) || files.length === 0) throw new SourceError("Add the artifact .zip, or manifest.json with the figma-001.json files.");
  const sources = [];
  for (const file of files) {
    if (file.bytes.length > MAX_ZIP_BYTES) throw new SourceError(`${file.name} is larger than ${MAX_ZIP_BYTES / 1024 / 1024} MB.`);
    if (looksLikeZip(file.bytes)) {
      sources.push(...(await readZip(file.bytes, file.name)));
    } else if (WANTED.test(file.name)) {
      if (file.bytes.length > MAX_ENTRY_BYTES) throw new SourceError(`${file.name} is larger than ${MAX_ENTRY_BYTES / 1024 / 1024} MB, so it is not generator data.`);
      sources.push({ path: file.name, text: textOf(file.bytes, file.name) });
    } else if (!SKIPPED_LOOSE.test(file.name)) {
      throw new SourceError(`${file.name} is not a file the generator writes. Add the artifact .zip, or manifest.json with the figma-001.json files.`);
    }
  }
  const seen = new Set();
  for (const { path } of sources) {
    if (seen.has(path)) throw new SourceError(`${path} was added twice.`);
    seen.add(path);
  }
  return sources;
}
