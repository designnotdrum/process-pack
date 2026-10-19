/**
 * Turns the files a person gave the plugin into one release to apply.
 *
 * It finds the release's manifest.json, reads each data file the manifest lists with the generator's
 * own reader (data-file.mjs readData, the same one the relay uses), and joins them into one set of
 * tokens and units. build.mjs bundles this module and data-file.mjs into the plugin's main thread.
 *
 * Nothing in the files is code. Their text is parsed as JSON and checked field by field, and the
 * values go to the runtime as arguments. No file's text is ever put into code, `eval` or `Function`.
 *
 * The plugin has no settings file, so it cannot check which variable collection or page the repo's
 * settings name, as the relay does. It takes the collection from the data, takes the page setting
 * from the components (their own names, or the one page they all share), and still runs
 * checkTargets, which holds a release to the rules that do not depend on settings: earlier versions
 * go to "Older versions", a component is not drawn on "Older versions" or "Screens", and screens go
 * to "Screens". The window shows the collection and pages before anything is applied.
 */
import { checkTargets, readData } from "../../data-file.mjs";

export class ReleaseError extends Error {}

const FILE_NAME = /^figma-\d{3,}\.json$/;
const MAX_FILES = 500;

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const directoryOf = (path) => path.slice(0, path.lastIndexOf("/") + 1);
const baseOf = (path) => path.slice(path.lastIndexOf("/") + 1);

/** What the plugin reads from manifest.json: the order of the data files and the units each holds. */
function readManifest(text) {
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    throw new ReleaseError("manifest.json is not JSON.");
  }
  if (!isRecord(manifest) || manifest.output !== "figma") throw new ReleaseError("manifest.json is not one the Figma generator wrote.");
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new ReleaseError("manifest.json lists no data files.");
  if (manifest.files.length > MAX_FILES) throw new ReleaseError(`manifest.json lists more than ${MAX_FILES} data files.`);
  const names = new Set();
  for (const entry of manifest.files) {
    const named = isRecord(entry) && typeof entry.name === "string" && FILE_NAME.test(entry.name);
    if (!named) throw new ReleaseError("manifest.json lists a data file the generator does not write.");
    if (!Array.isArray(entry.units) || entry.units.some((id) => typeof id !== "string")) throw new ReleaseError(`manifest.json lists ${entry.name} without its units.`);
    if (names.has(entry.name)) throw new ReleaseError(`manifest.json lists ${entry.name} twice.`);
    names.add(entry.name);
  }
  return {
    files: manifest.files,
    release: typeof manifest.release === "string" ? manifest.release.slice(0, 200) : "",
    fileKey: typeof manifest.fileKey === "string" ? manifest.fileKey.slice(0, 200) : "",
    uploads: Array.isArray(manifest.uploads) ? manifest.uploads.length : 0,
    retention: isRecord(manifest.afterUploads),
  };
}

/** The page every component is meant to go on: its own name, or the one page all of them share. */
function sharedPage(datas) {
  const components = datas.flatMap((data) => data.units.filter((unit) => unit.kind === "component"));
  if (components.every((unit) => unit.page === unit.name)) return "";
  return components[0].page;
}

/**
 * The data files joined into one set of tokens and units, so one run of the runtime writes the whole
 * release. A token colour that changed is then written after every older version has been frozen.
 * Each unit's "tk" list pointed into its own file's tokens; it is moved to point into the joined list.
 */
function join(files) {
  const first = files[0];
  const tokens = [];
  const index = new Map();
  const units = [];
  const ids = new Set();
  for (const { name, data } of files) {
    if (data.config.collection !== first.data.config.collection || data.config.mode !== first.data.config.mode) {
      throw new ReleaseError(`${name} writes to the variable collection "${data.config.collection}", but ${first.name} writes to "${first.data.config.collection}".`);
    }
    const moved = data.tokens.map((token) => {
      const at = index.get(token.name);
      if (at === undefined) {
        index.set(token.name, tokens.length);
        tokens.push({ ...token, scopes: [...token.scopes] });
        return tokens.length - 1;
      }
      const have = tokens[at];
      if (have.syntax !== token.syntax || have.rgba.some((part, i) => part !== token.rgba[i])) {
        throw new ReleaseError(`${name} gives the token ${token.name} another colour or code syntax than an earlier file.`);
      }
      for (const scope of token.scopes) if (!have.scopes.includes(scope)) have.scopes.push(scope);
      return at;
    });
    for (const unit of data.units) {
      if (ids.has(unit.id)) throw new ReleaseError(`${name} repeats the unit ${unit.id}.`);
      ids.add(unit.id);
      units.push({ ...unit, tk: unit.tk.map((i) => moved[i]) });
    }
  }
  return { config: { ...first.data.config }, tokens, units };
}

const labelOf = (unit) => {
  if (unit.kind === "component") return `${unit.name} ${unit.version}`;
  if (unit.kind === "screen") return `${unit.route} ${unit.release}`;
  return `Keep the last ${unit.keep} versions of each screen`;
};

/**
 * Reads a release from the files the window found.
 *
 * @param {Array<{ path: string, text: string }>} sources  From the window: manifest.json and the figma-001.json files.
 * @returns {{ config: object, tokens: object[], units: object[], summary: object }}
 *   config, tokens and units are what the runtime takes. summary is what the window shows before applying.
 * @throws {ReleaseError | DataError} with a message a person can act on.
 */
export function loadRelease(sources) {
  const given = Array.isArray(sources) ? sources : [];
  if (given.length > 0 && given.some((s) => !isRecord(s) || typeof s.path !== "string" || typeof s.text !== "string")) {
    throw new ReleaseError("The window sent files the plugin cannot read.");
  }
  const manifests = given.filter((s) => baseOf(s.path) === "manifest.json");
  if (manifests.length === 0) {
    throw new ReleaseError("There is no manifest.json. Add the artifact .zip, or manifest.json together with the figma-001.json files.");
  }
  if (manifests.length > 1) {
    const releases = manifests.map((s) => {
      try {
        return JSON.parse(s.text).release || directoryOf(s.path) || "unnamed";
      } catch {
        return directoryOf(s.path) || "unnamed";
      }
    });
    throw new ReleaseError(`These files hold ${manifests.length} releases (${releases.join(", ")}). Add one release at a time.`);
  }
  const manifest = readManifest(manifests[0].text);
  const directory = directoryOf(manifests[0].path);
  const beside = new Map(given.filter((s) => directoryOf(s.path) === directory).map((s) => [baseOf(s.path), s]));

  const files = manifest.files.map((entry) => {
    const found = beside.get(entry.name);
    if (!found) throw new ReleaseError(`manifest.json lists ${entry.name}, but it is not here.`);
    const data = readData(found.text, entry.name);
    const ids = data.units.map((unit) => unit.id);
    if (ids.length !== entry.units.length || ids.some((id, i) => id !== entry.units[i])) {
      throw new ReleaseError(`${entry.name} holds ${ids.join(", ")}, but manifest.json lists ${entry.units.join(", ")}.`);
    }
    return { name: entry.name, data };
  });

  const page = sharedPage(files.map((file) => file.data));
  for (const { name, data } of files) checkTargets(data, { collectionName: data.config.collection, page }, name);

  const release = join(files);
  const pages = [];
  for (const unit of release.units) if (!pages.includes(unit.page)) pages.push(unit.page);
  for (const unit of release.units) if (unit.kind === "component" && !pages.includes(unit.older)) pages.push(unit.older);
  return {
    ...release,
    summary: {
      release: manifest.release,
      fileKey: manifest.fileKey,
      files: files.length,
      collection: release.config.collection,
      pages,
      units: release.units.map((unit) => ({
        id: unit.id,
        kind: unit.kind,
        label: labelOf(unit),
        variants: unit.kind === "component" ? unit.cells.length : 0,
      })),
      notApplied: { screenshots: manifest.uploads, retention: manifest.retention },
    },
  };
}
