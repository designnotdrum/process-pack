/**
 * What the adapter has already written: which versions of each component and
 * which releases of each screen. Klaus never reads a design file back, so this
 * is how a run knows a version is done and does not send it twice.
 *
 * The file sits in the adapter's output folder. If it is lost, the next run
 * plans everything again. That costs relay tokens and nothing else: the
 * generated code leaves a set that already exists alone.
 */
import { existsSync } from "node:fs";
import { readJsonFile } from "../../frame/json-file.mjs";

export const LEDGER_VERSION = 1;

export function emptyLedger() {
  return { version: LEDGER_VERSION, components: {}, screens: {} };
}

export function readLedger(file) {
  if (!existsSync(file)) return emptyLedger();
  const ledger = readJsonFile(file, "The Figma ledger");
  if (ledger?.version !== LEDGER_VERSION || typeof ledger.components !== "object" || typeof ledger.screens !== "object") {
    return emptyLedger();
  }
  return ledger;
}

function add(table, key, value) {
  const list = table[key] ?? [];
  if (!list.includes(value)) list.push(value);
  table[key] = list;
}

export const recordComponent = (ledger, name, version) => add(ledger.components, name, version);
export const recordScreen = (ledger, route, release) => add(ledger.screens, route, release);
export const hasComponent = (ledger, name, version) => ledger.components[name]?.includes(version) ?? false;
export const hasScreen = (ledger, route, release) => ledger.screens[route]?.includes(release) ?? false;
