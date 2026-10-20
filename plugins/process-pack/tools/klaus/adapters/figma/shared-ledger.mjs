/**
 * The shared record of what the relay sent: the sent and changed marks of the ledger, kept in the
 * repository Actions variable KLAUS_FIGMA_LEDGER so CI and every relay machine read the same marks.
 *
 *   {"version":2,"fileKey":"<Figma file key>","components":{"Button":{"1.0.0":"sent"}},"screens":{}}
 *
 * The relay writes it with `gh variable set` after a run that changed its ledger (a send or
 * --reconcile), and reads it with `gh variable get` before it plans (relay/variable.mjs). The
 * workflow passes it to the generator as an environment variable, and the generator reads it before
 * it plans. Neither copies CI's generated marks into it: CI cannot write a variable.
 *
 * A record names its Figma file, so a run against another file neither uses nor overwrites it.
 *
 * Anyone who can write a repository variable can write this record, so it is never trusted
 * silently. It only confirms versions the reading side already lists: CI's own ledger, which lists
 * every version CI generated, or the relay's own ledger and the release it is relaying or
 * reconciling. A mark for any other version is ignored and named in the run's report, so a forged
 * mark for a made-up older version cannot make a new component look established. A version the
 * record marks sent that the run's own ledger does not is also named, with a warning, by the
 * generator and by the relay. Neither copies the record's marks into its own ledger, so such a
 * version is named again on every run that looks at it.
 * A missing or malformed record means nothing is known to be sent, with a warning. It never stops a run.
 *
 * Merging: a version sent or changed in either ledger counts as that. When one says sent and the
 * other changed, sent wins. A version goes from changed to sent only when the relay writes it again
 * from its own code, after a person deleted the set; nothing takes a sent version back to changed,
 * because the relay never sends a sent version again.
 */
import { CHANGED, entryLabel, entryStatus, LEDGER_VERSION, SENT } from "./ledger.mjs";

export const SHARED_LEDGER_VARIABLE = "KLAUS_FIGMA_LEDGER";

/**
 * GitHub limits one configuration variable to 48 KB (GitHub's variables reference, "Limits for
 * configuration variables", read 2026-10-20). Counted as 48,000 bytes, the stricter reading.
 */
export const MAX_SHARED_LEDGER_BYTES = 48000;

const MARKS = new Set([SENT, CHANGED]);
const isTable = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** Sets an own property, so a component named "__proto__" stays data. */
function setOwn(object, key, value) {
  Object.defineProperty(object, key, { value, writable: true, enumerable: true, configurable: true });
}

/** Keeps the sent and changed marks of a table, and drops everything else. */
function marksOf(table) {
  const out = {};
  for (const [key, entry] of Object.entries(table)) {
    if (!isTable(entry)) continue;
    const kept = {};
    for (const [version, status] of Object.entries(entry)) if (MARKS.has(status)) setOwn(kept, version, status);
    if (Object.keys(kept).length > 0) setOwn(out, key, kept);
  }
  return out;
}

const unset = () => ({
  status: "absent",
  ledger: null,
  warning: `${SHARED_LEDGER_VARIABLE} is not set, so this run counts only the units its own ledger marks sent. The relay sets it after each run that sends or reconciles.`,
});

const malformed = (why) => ({
  status: "malformed",
  ledger: null,
  warning: `${SHARED_LEDGER_VARIABLE} is not a record the relay writes (${why}), so this run counts only the units its own ledger marks sent. The next relay run that sends or reconciles writes it again.`,
});

/**
 * Reads the variable's text.
 * @param {string | null | undefined} text  The variable's value. Empty is how the workflow passes an unset variable.
 * @param {string | null} fileKey  The Figma file the settings name.
 * @returns {{ status: "read" | "absent" | "malformed" | "other-file", ledger: object | null, warning: string | null }}
 *   ledger holds the sent and changed marks, in the ledger's shape, when status is "read".
 */
export function parseSharedLedger(text, fileKey) {
  if (typeof text !== "string" || text.trim() === "") return unset();
  let record;
  try {
    record = JSON.parse(text);
  } catch {
    return malformed("it is not JSON");
  }
  if (!isTable(record)) return malformed("it is not an object");
  if (record.version !== LEDGER_VERSION) return malformed(`its version is ${JSON.stringify(record.version)}, not ${LEDGER_VERSION}`);
  if (typeof record.fileKey !== "string" || record.fileKey === "") return malformed("it names no Figma file");
  if (!isTable(record.components) || !isTable(record.screens)) return malformed("it has no components and screens tables");
  if (record.fileKey !== fileKey) {
    return {
      status: "other-file",
      ledger: null,
      warning: `${SHARED_LEDGER_VARIABLE} is the record for Figma file ${record.fileKey.slice(0, 128)}, but klaus.config.json names ${fileKey ?? "no file"}, so this run does not use it. Delete the variable to start a record for ${fileKey ?? "the new file"}.`,
    };
  }
  return { status: "read", ledger: { version: LEDGER_VERSION, components: marksOf(record.components), screens: marksOf(record.screens) }, warning: null };
}

function mergeTable(into, from) {
  for (const [key, entry] of Object.entries(from)) {
    if (!isTable(entry)) continue;
    const target = Object.hasOwn(into, key) && isTable(into[key]) ? into[key] : {};
    for (const [version, status] of Object.entries(entry)) {
      if (!MARKS.has(status)) continue;
      const now = Object.hasOwn(target, version) ? target[version] : undefined;
      // Sent wins over changed, and either wins over generated or nothing.
      if (now === SENT) continue;
      if (now === CHANGED && status !== SENT) continue;
      setOwn(target, version, status);
    }
    if (Object.keys(target).length > 0) setOwn(into, key, target);
  }
}

/**
 * Merges the sent and changed marks of `from` into `into`, a ledger. Generated marks in `from` are
 * ignored: only the generator of a checkout records what it generated.
 * @returns {object} into
 */
export function mergeMarks(into, from) {
  mergeTable(into.components, from.components ?? {});
  mergeTable(into.screens, from.screens ?? {});
  return into;
}

/** The variable's text for a ledger: its sent and changed marks, with the Figma file they are in. */
export function sharedLedgerText(ledger, fileKey) {
  return JSON.stringify({ version: LEDGER_VERSION, fileKey, components: marksOf(ledger.components), screens: marksOf(ledger.screens) });
}

/**
 * The labels of the units the shared record alone marks sent: sent in shared, not sent in own.
 * @param {object} own  The run's own ledger, before the record was merged into it.
 * @param {object | null} shared  The record's ledger, or null when there is none to use.
 * @param {Array<object>} entries  The units the run looked at, as ledger entries.
 * @returns {string[]}  Sorted, each once.
 */
export function sentOnlyInShared(own, shared, entries) {
  if (!shared) return [];
  const labels = entries.filter((entry) => entryStatus(shared, entry) === SENT && entryStatus(own, entry) !== SENT).map(entryLabel);
  return [...new Set(labels)].sort();
}

/**
 * The warning that names them.
 * @param {string[]} labels
 * @param {string} skipped  What the run did not do, missing its object: "the relay did not send".
 */
export function sentOnlyWarning(labels, skipped) {
  const one = labels.length === 1;
  const them = one ? "it" : "them";
  return `${SHARED_LEDGER_VARIABLE} alone marks ${labels.length} version${one ? "" : "s"} sent, so ${skipped} ${them}: ${labels.join(", ")}. This checkout's ledger does not say ${one ? "it was" : "they were"} sent. If the relay did not send ${them}, correct or delete ${SHARED_LEDGER_VARIABLE}.`;
}

/**
 * The sentence a report's summary carries, or "" when there is nothing to say.
 * @param {number} count
 * @param {[string, string]} [after]  Text after "sent", for one version and for several.
 */
export function sentOnlySentence(count, [ifOne, ifMany] = ["", ""]) {
  if (count === 0) return "";
  return ` ${SHARED_LEDGER_VARIABLE} alone marks ${count} version${count === 1 ? "" : "s"} sent${count === 1 ? ifOne : ifMany}.`;
}

/** A key for a unit that tells a component from a screen with the same text. */
const entryKey = (entry) => (entry.kind === "component" ? `c\u0000${entry.name}\u0000${entry.version}` : `s\u0000${entry.route}\u0000${entry.release}`);

/**
 * Whether the reading side lists a unit: its own ledger has it with any status, or it is one of
 * the extra entries (the release the relay is relaying or reconciling). entryStatus reads own
 * properties only, so a version named "toString" or "__proto__" is listed only when the ledger
 * holds that version itself.
 * @returns {(entry: object) => boolean}
 */
export function listedIn(own, extra = []) {
  const keys = new Set(extra.map(entryKey));
  return (entry) => entryStatus(own, entry) !== undefined || keys.has(entryKey(entry));
}

/**
 * The record's marks for the units the reading side lists, and the labels of the marks it ignores.
 * @param {object} shared  The record's ledger.
 * @param {(entry: object) => boolean} listed  From listedIn.
 * @returns {{ ledger: object, ignored: string[] }}  ignored is sorted.
 */
export function listedMarks(shared, listed) {
  const ledger = { version: LEDGER_VERSION, components: {}, screens: {} };
  const ignored = [];
  const keep = (table, key, version, status) => {
    const entry = Object.hasOwn(table, key) ? table[key] : {};
    setOwn(entry, version, status);
    setOwn(table, key, entry);
  };
  for (const [name, versions] of Object.entries(shared.components)) {
    for (const [version, status] of Object.entries(versions)) {
      const entry = { kind: "component", name, version };
      if (listed(entry)) keep(ledger.components, name, version, status);
      else ignored.push(entryLabel(entry));
    }
  }
  for (const [route, releases] of Object.entries(shared.screens)) {
    for (const [release, status] of Object.entries(releases)) {
      const entry = { kind: "screen", route, release };
      if (listed(entry)) keep(ledger.screens, route, release, status);
      else ignored.push(entryLabel(entry));
    }
  }
  return { ledger, ignored: ignored.sort() };
}

/** The warning that names the marks the reading side ignored. */
export function ignoredWarning(labels) {
  const one = labels.length === 1;
  return `${SHARED_LEDGER_VARIABLE} lists ${labels.length} version${one ? "" : "s"} this ledger never planned; ignored: ${labels.join(", ")}. A mark counts only for a version this checkout's ledger lists, or one in the release being relayed or reconciled.`;
}

/**
 * Reads the record against the reading side's own ledger: the marks it may use, the ones it
 * ignores, and the versions only it marks sent among the units the run looked at.
 * @param {{ ledger: object | null }} shared  From parseSharedLedger or readVariable.
 * @param {object} own  The reading side's own ledger.
 * @param {Array<object>} extra  Units the reading side also lists: the release being relayed or reconciled.
 * @returns {{ usable: object | null, ignored: string[] }}
 */
export function usableMarks(shared, own, extra = []) {
  if (!shared.ledger) return { usable: null, ignored: [] };
  const { ledger, ignored } = listedMarks(shared.ledger, listedIn(own, extra));
  return { usable: ledger, ignored };
}
