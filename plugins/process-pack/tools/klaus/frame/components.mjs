/**
 * Reads components out of inventory.json and applies the config's selection.
 *
 * The inventory is either an array of components or an object with a
 * "components" array. A component needs a "name". It may have "file" and a
 * usage count, given as "usageCount" or as a "usedBy" array.
 */
import path from "node:path";

/** @returns {Array<object>} */
export function listComponents(inventory) {
  const list = Array.isArray(inventory) ? inventory : inventory?.components;
  if (!Array.isArray(list)) throw new Error("inventory.json must be an array of components or an object with a components array.");
  for (const component of list) {
    if (!component || typeof component.name !== "string" || component.name === "") {
      throw new Error("inventory.json has a component without a name.");
    }
  }
  return list;
}

/** How many places use a component. This is the order the spending cap writes in. */
export function usageCount(component) {
  if (Number.isFinite(component.usageCount)) return component.usageCount;
  if (Array.isArray(component.usedBy)) return component.usedBy.length;
  return 0;
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
