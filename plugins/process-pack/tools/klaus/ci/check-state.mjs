#!/usr/bin/env node
/**
 * Checks a downloaded klaus-state artifact before the workflow uses it.
 *
 *   node ci/check-state.mjs <folder>
 *
 * The artifact comes from an earlier run, and the run that made it is checked
 * separately. Even so, its files are read by Klaus as if they were its own, so
 * their shape is checked here first. A folder passes only if it holds nothing but
 * the four things Klaus keeps, each in the shape Klaus writes it:
 *
 *   state.json                 the frame's state file
 *   inventory.versioned.json   an inventory the version picker wrote
 *   screenshots/**.png         PNG files
 *   figma/ledger.json          the Figma ledger
 *
 * No symbolic link, no other file and no unexpected name passes. Exit 0 when the
 * folder passes, 1 when it does not (every problem is printed), 2 on a usage error.
 * No dependencies.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonFile } from "../frame/json-file.mjs";
import { readState } from "../frame/state.mjs";

const MAX_JSON_BYTES = 20 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SAFE_NAME = /^[A-Za-z0-9._@+%~=-]{1,200}$/;
const LEDGER_STATUSES = new Set(["generated", "sent", "changed"]);
const isTable = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** Every file and link below dir, as relative paths with "/" separators. */
function walk(dir) {
  const found = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      const relative = path.relative(dir, full).split(path.sep).join("/");
      if (entry.isSymbolicLink()) found.push({ relative, kind: "link" });
      else if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) found.push({ relative, kind: "file" });
      else found.push({ relative, kind: "other" });
    }
  };
  visit(dir);
  return found;
}

function checkInventory(file, errors) {
  let inventory;
  try {
    inventory = readJsonFile(file, "inventory.versioned.json");
  } catch (error) {
    errors.push(error.message);
    return;
  }
  if (!isTable(inventory)) return void errors.push("inventory.versioned.json is not an object.");
  if (!Array.isArray(inventory.entries)) errors.push("inventory.versioned.json has no entries list.");
  else {
    for (const entry of inventory.entries) {
      if (!isTable(entry) || typeof entry.name !== "string" || entry.name === "") errors.push("inventory.versioned.json has an entry without a name.");
      else if (typeof entry.version !== "string" || !/^(\d+\.\d+\.\d+)?$/.test(entry.version)) errors.push(`inventory.versioned.json: the version of ${JSON.stringify(entry.name).slice(0, 60)} is not x.y.z.`);
    }
  }
  const versioned = inventory.versioned;
  if (!isTable(versioned) || typeof versioned.release !== "string" || !/^[^\s\u0000-\u001f]{1,200}$/.test(versioned.release)) {
    errors.push("inventory.versioned.json does not say which release it was versioned for.");
  }
  if (inventory.screens !== undefined && !Array.isArray(inventory.screens)) errors.push("inventory.versioned.json: screens is not a list.");
}

function checkLedger(file, errors) {
  let ledger;
  try {
    ledger = readJsonFile(file, "figma/ledger.json");
  } catch (error) {
    errors.push(error.message);
    return;
  }
  if (!isTable(ledger) || !isTable(ledger.components) || !isTable(ledger.screens)) return void errors.push("figma/ledger.json is not a Figma ledger.");
  for (const table of [ledger.components, ledger.screens]) {
    for (const [key, entry] of Object.entries(table)) {
      if (key === "__proto__" || !isTable(entry) || Object.values(entry).some((status) => !LEDGER_STATUSES.has(status))) {
        errors.push("figma/ledger.json holds a unit with a status Klaus does not write.");
        return;
      }
    }
  }
}

/**
 * @param {string} dir
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function checkState(dir) {
  const errors = [];
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { ok: false, errors: [`${dir} is not a folder.`] };
  const entries = walk(dir);
  for (const { relative, kind } of entries) {
    if (kind !== "file") {
      errors.push(`${relative} is a ${kind === "link" ? "symbolic link" : "special file"}.`);
      continue;
    }
    const parts = relative.split("/");
    const known = relative === "state.json" || relative === "inventory.versioned.json" || relative === "figma/ledger.json" || (parts[0] === "screenshots" && parts.length >= 2 && /\.png$/.test(relative));
    if (!known || !parts.every((part) => SAFE_NAME.test(part))) errors.push(`${relative} is not something Klaus keeps.`);
  }
  if (errors.length > 0) return { ok: false, errors };

  const has = (relative) => entries.some((entry) => entry.relative === relative);
  for (const name of ["state.json", "inventory.versioned.json", "figma/ledger.json"]) {
    if (has(name) && fs.statSync(path.join(dir, name)).size > MAX_JSON_BYTES) errors.push(`${name} is larger than ${MAX_JSON_BYTES / 1024 / 1024} MB.`);
  }
  if (errors.length > 0) return { ok: false, errors };

  if (has("state.json")) {
    try {
      readState(path.join(dir, "state.json"));
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (has("inventory.versioned.json")) checkInventory(path.join(dir, "inventory.versioned.json"), errors);
  if (has("figma/ledger.json")) checkLedger(path.join(dir, "figma/ledger.json"), errors);
  for (const { relative } of entries.filter((entry) => entry.relative.startsWith("screenshots/"))) {
    const head = Buffer.alloc(PNG_SIGNATURE.length);
    const fd = fs.openSync(path.join(dir, relative), "r");
    try {
      fs.readSync(fd, head, 0, head.length, 0);
    } finally {
      fs.closeSync(fd);
    }
    if (!head.equals(PNG_SIGNATURE)) errors.push(`${relative} is not a PNG file.`);
  }
  return { ok: errors.length === 0, errors };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir || process.argv.length > 3) {
    console.error("Usage: check-state.mjs <folder>");
    process.exit(2);
  }
  const { ok, errors } = checkState(dir);
  for (const error of errors) console.error(error);
  process.exit(ok ? 0 : 1);
}
