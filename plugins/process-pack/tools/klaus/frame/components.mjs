/**
 * Reads components out of inventory.json and applies the config's selection.
 *
 * The inventory is the file the inventory script writes:
 *
 *   { schemaVersion, folders, entries: [ { name, file, folder, kind, parts, props,
 *     variants, purpose, version, screenshot, usedIn } ] }
 *
 * The frame reads "entries". Each needs a "name". It uses "file" for component
 * groups and "usedIn", the repo-relative files that use the entry, for usage.
 */
import path from "node:path";

/** @returns {Array<object>} */
export function listComponents(inventory) {
  const list = inventory?.entries;
  if (!Array.isArray(list)) throw new Error("inventory.json must be an object with an entries array.");
  for (const component of list) {
    if (!component || typeof component.name !== "string" || component.name === "") {
      throw new Error("inventory.json has a component without a name.");
    }
  }
  return list;
}

/** How many files use an entry. This is the order the spending cap writes in. */
export function usageCount(component) {
  return Array.isArray(component.usedIn) ? component.usedIn.length : 0;
}

function inFolder(file, folder) {
  const clean = path.posix.normalize(folder).replace(/^\.\//, "").replace(/\/+$/, "");
  const target = path.posix.normalize(file).replace(/^\.\//, "");
  return target === clean || target.startsWith(`${clean}/`);
}

/**
 * Components the selection lets an output write.
 * @param {object} inventory
 * @param {{ componentGroups?: string[], newComponents?: { rule: string, minUsage?: number } }} selection
 * @param {{ isNew?: (component: object) => boolean }} [options]
 *   isNew says whether the output has never received a component. The adapter knows this,
 *   the frame does not. Without it no component counts as new.
 */
export function selectComponents(inventory, selection, { isNew = () => false } = {}) {
  const groups = selection.componentGroups ?? [];
  const rule = selection.newComponents?.rule ?? "all";
  const minUsage = selection.newComponents?.minUsage ?? 2;
  return listComponents(inventory).filter((component) => {
    if (groups.length > 0) {
      if (typeof component.file !== "string" || !groups.some((g) => inFolder(component.file, g))) return false;
    }
    if (!isNew(component)) return true;
    if (rule === "none") return false;
    if (rule === "min-usage") return usageCount(component) >= minUsage;
    return true;
  });
}
