/**
 * What the adapter has generated and what the relay has sent: the versions of
 * each component and the releases of each screen. Klaus never reads a design
 * file back, so this is how a run knows a version is in Figma and does not
 * send it twice.
 *
 *   {
 *     "version": 2,
 *     "components": { "Button": { "1.0.0": "sent", "1.1.0": "generated" } },
 *     "screens": { "/settings": { "v3.0.0": "generated" } }
 *   }
 *
 * write records a unit as "generated" when its code file exists. Only the relay
 * records "sent", after use_figma reports the unit written or already there.
 * plan leaves out sent units only, so a unit whose relay call failed is planned,
 * generated and sent again.
 *
 * The relay records "changed" when Figma drew a unit from code that Codex
 * changed on the way. The set in Figma may then differ from the generated code,
 * and the code leaves an existing set alone, so a later "exists" proves nothing.
 * A changed unit becomes sent only when a call writes it again, after a person
 * has deleted the set in Figma. Generating its code again does not clear it.
 *
 * The relay's reconcile mode also records "sent", for a generated component
 * version whose set it found in Figma, because the Klaus plugin wrote it and
 * cannot write this file. It never touches a changed unit. The ledger does not
 * say which way a unit became sent: the run report does.
 *
 * The file sits in the adapter's output folder. If it is lost, the next run
 * plans everything again. That costs relay tokens and nothing else: the
 * generated code leaves a set that already exists alone.
 */
import { existsSync } from "node:fs";
import { readJsonFile } from "../../frame/json-file.mjs";

export const LEDGER_VERSION = 2;
export const GENERATED = "generated";
export const SENT = "sent";
export const CHANGED = "changed";

const STATUSES = new Set([GENERATED, SENT, CHANGED]);

export function emptyLedger() {
  return { version: LEDGER_VERSION, components: {}, screens: {} };
}

const isTable = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Sets an own property. A plain assignment to "__proto__" would set the object's
 * prototype instead, and the entry would be lost.
 */
function setOwn(object, key, value) {
  Object.defineProperty(object, key, { value, writable: true, enumerable: true, configurable: true });
}

/** Keeps the entries that have a known status and drops the rest. */
function cleanTable(table) {
  const out = {};
  for (const [key, entry] of Object.entries(table)) {
    if (!isTable(entry)) continue;
    const kept = Object.entries(entry).filter(([, status]) => STATUSES.has(status));
    if (kept.length > 0) setOwn(out, key, Object.fromEntries(kept));
  }
  return out;
}

/**
 * Version 1 counted a unit as written as soon as its code file existed, so
 * nothing in it is known to be in Figma. Its entries become generated.
 */
function fromVersion1(table) {
  const out = {};
  for (const [key, list] of Object.entries(table)) {
    if (!Array.isArray(list)) continue;
    const versions = list.filter((value) => typeof value === "string");
    if (versions.length > 0) setOwn(out, key, Object.fromEntries(versions.map((value) => [value, GENERATED])));
  }
  return out;
}

export function readLedger(file) {
  if (!existsSync(file)) return emptyLedger();
  const ledger = readJsonFile(file, "The Figma ledger");
  if (!isTable(ledger) || !isTable(ledger.components) || !isTable(ledger.screens)) return emptyLedger();
  if (ledger.version === 1) {
    return { version: LEDGER_VERSION, components: fromVersion1(ledger.components), screens: fromVersion1(ledger.screens) };
  }
  if (ledger.version !== LEDGER_VERSION) return emptyLedger();
  return { version: LEDGER_VERSION, components: cleanTable(ledger.components), screens: cleanTable(ledger.screens) };
}

const ownEntry = (table, key) => (Object.hasOwn(table, key) ? table[key] : undefined);

function mark(table, key, value, status) {
  const entry = ownEntry(table, key) ?? {};
  const now = ownEntry(entry, value);
  // Generating the code again does not take a sent set out of Figma, or fix a changed one.
  if (!(status === GENERATED && (now === SENT || now === CHANGED))) setOwn(entry, value, status);
  setOwn(table, key, entry);
}

/** Records a component version. write records it generated; the relay records it sent. */
export const recordComponent = (ledger, name, version, status = GENERATED) => mark(ledger.components, name, version, status);
/** Records a screen release. write records it generated; the relay records it sent. */
export const recordScreen = (ledger, route, release, status = GENERATED) => mark(ledger.screens, route, release, status);

/** True when the relay has sent this version. A generated version is not in Figma yet. */
export const componentSent = (ledger, name, version) => ownEntry(ledger.components, name)?.[version] === SENT;
export const screenSent = (ledger, route, release) => ownEntry(ledger.screens, route)?.[release] === SENT;

/** True when any version of the component has reached Figma. */
export const anyVersionSent = (ledger, name) => Object.values(ownEntry(ledger.components, name) ?? {}).includes(SENT);

/**
 * Every component version the ledger holds as generated, as ledger entries. Sent and changed
 * versions are left out: reconcile looks only for what has not been confirmed in Figma.
 */
export function generatedComponents(ledger) {
  const out = [];
  for (const [name, versions] of Object.entries(ledger.components)) {
    for (const [version, status] of Object.entries(versions)) {
      if (status === GENERATED) out.push({ kind: "component", name, version });
    }
  }
  return out;
}

/** Counts the screen releases the ledger holds with this status. */
export function screenCount(ledger, status) {
  return Object.values(ledger.screens).reduce((n, releases) => n + Object.values(releases).filter((held) => held === status).length, 0);
}

/**
 * Records a unit as sent only if the ledger still holds it as generated. A changed unit stays
 * changed, and a unit already sent is left as it is.
 * @returns {boolean}  True when the entry was generated and is now sent.
 */
export function markGeneratedAsSent(ledger, entry) {
  if (entryStatus(ledger, entry) !== GENERATED) return false;
  recordEntry(ledger, entry, SENT);
  return true;
}

/** The ledger entry of a generated unit, as the manifest lists it for the relay. */
export function entryOf(unit) {
  if (unit.kind === "component") return { kind: "component", name: unit.name, version: unit.version };
  if (unit.kind === "screen") return { kind: "screen", route: unit.route, release: unit.release };
  throw unknownKind(unit.kind);
}

function unknownKind(kind) {
  return new Error(`A ledger entry needs a kind of "component" or "screen", not ${JSON.stringify(kind)}.`);
}

/**
 * Records the unit a manifest names, as written by the generator in `ledgerEntries`.
 * @param {object} ledger
 * @param {{ kind: "component", name: string, version: string } | { kind: "screen", route: string, release: string }} entry
 * @param {string} status
 */
export function recordEntry(ledger, entry, status) {
  if (entry.kind === "component") recordComponent(ledger, entry.name, entry.version, status);
  else if (entry.kind === "screen") recordScreen(ledger, entry.route, entry.release, status);
  else throw unknownKind(entry.kind);
}

/** The status the ledger holds for the unit a manifest names, or undefined. */
export function entryStatus(ledger, entry) {
  if (entry.kind === "component") return ownEntry(ledger.components, entry.name)?.[entry.version];
  if (entry.kind === "screen") return ownEntry(ledger.screens, entry.route)?.[entry.release];
  throw unknownKind(entry.kind);
}

/** True when the relay has sent the unit a manifest names. */
export const entrySent = (ledger, entry) => entryStatus(ledger, entry) === SENT;
