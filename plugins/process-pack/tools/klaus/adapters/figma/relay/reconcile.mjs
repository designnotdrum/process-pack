/**
 * The pure parts of the relay's reconcile mode: which pages to look at, the one read-only call's
 * code, and how its reply is read. relay.mjs runs the call.
 *
 * Reconcile exists because the Klaus plugin in Figma writes the first, large load and cannot
 * write the repo's ledger. After it runs, the ledger still lists every unit as generated. One
 * read-only use_figma call returns the names of the component sets and components on the pages
 * Klaus writes, and each generated unit whose `<Name> <version>` is among them becomes sent.
 */
import { OLDER_VERSIONS_PAGE, pageFor } from "../settings.mjs";
import { readNamesResult } from "./events.mjs";

/** A page name the relay will put in code: the same rule as the page setting. */
const PAGE_NAME = /^[^\u0000-\u001f]{1,100}$/;

/** A version, as data-file.mjs and the runtime read one. */
const VERSION = /^\d+(\.\d+)*([-+][0-9A-Za-z.-]+)?$/;

/** The most names a reply may list, and the most characters one may have. */
export const MAX_NAMES = 20000;
export const MAX_NAME_CHARS = 300;

/** True for a string shaped like `<Name> <version>`. */
export function isVersionedName(text) {
  if (typeof text !== "string" || text.length > MAX_NAME_CHARS) return false;
  const space = text.lastIndexOf(" ");
  return space > 0 && VERSION.test(text.slice(space + 1));
}

/**
 * The pages to look at for some generated component versions. Each version's page is the one the
 * generator writes it to (`pageFor` with the repo's settings), and the Older versions page is
 * always added, because a set moves there when a newer version is written.
 * @param {Array<{ kind: "component", name: string, version: string }>} entries
 * @param {{ page: string }} options  The Figma adapter's settings.
 * @returns {{ pages: string[], looked: object[], skipped: Array<{ entry: object, reason: string }> }}
 *   looked are the entries whose page can be looked at. skipped are the rest, with the reason.
 */
export function lookupPlan(entries, options) {
  const pages = [];
  const looked = [];
  const skipped = [];
  for (const entry of entries) {
    const page = pageFor(entry.name, options);
    if (!PAGE_NAME.test(page)) {
      skipped.push({ entry, reason: `its page name is not 1 to 100 characters without control characters (${JSON.stringify(page.slice(0, 40))})` });
      continue;
    }
    looked.push(entry);
    if (!pages.includes(page)) pages.push(page);
  }
  if (looked.length > 0 && !pages.includes(OLDER_VERSIONS_PAGE)) pages.push(OLDER_VERSIONS_PAGE);
  return { pages, looked, skipped };
}

/**
 * The code of the one call. It is read-only: it writes nothing, makes no page and switches no
 * page. It loads each page named below with `loadAsync`, as the generated code does, and returns
 * the names of the component sets and components that sit directly on those pages. A page the
 * file does not have is skipped.
 *
 * The text is fixed apart from the page names. Those come from the repo's settings and ledger,
 * never from an artifact, and each is written as a list of character codes, so the relaying
 * model reads no name. It holds no backslash, because a model drops them (see the README).
 * @param {string[]} pages
 */
export function reconcileCode(pages) {
  const codes = pages.map((page) => `[${Array.from({ length: page.length }, (_, i) => page.charCodeAt(i)).join(",")}]`);
  return [
    "// Klaus reconcile. Read only: it returns the names of the sets and components on the pages below.",
    `const PAGES = [${codes.join(",")}];`,
    "const names = [];",
    "for (const codes of PAGES) {",
    "  const pageName = String.fromCharCode.apply(null, codes);",
    "  const page = figma.root.children.find(function (p) { return p.name === pageName; });",
    "  if (!page) continue;",
    "  await page.loadAsync();",
    "  for (const node of page.children) {",
    '    if (node.type === "COMPONENT_SET" || node.type === "COMPONENT") names.push(node.name);',
    "  }",
    "}",
    "return { names: names };",
    "",
  ].join("\n");
}

/**
 * Reads the names out of a use_figma result, and nothing else: the model's own reply is never
 * looked at. The result must hold a list of strings. A string that is not shaped like
 * `<Name> <version>` is dropped, because another person's components can sit on a Klaus page and
 * they match no unit. Anything else is refused, and then nothing changes.
 * @returns {{ names: string[], ignored: number } | { error: string }}
 */
export function readNames(result) {
  const found = readNamesResult(result);
  if (!found) return { error: "its result holds no list of names." };
  const { names } = found;
  if (!Array.isArray(names)) return { error: "its names are not a list." };
  if (names.length > MAX_NAMES) return { error: `its list has ${names.length} names, more than the ${MAX_NAMES} the relay reads.` };
  if (names.some((name) => typeof name !== "string")) return { error: "its list holds something that is not text." };
  const kept = names.filter(isVersionedName);
  return { names: kept, ignored: names.length - kept.length };
}
