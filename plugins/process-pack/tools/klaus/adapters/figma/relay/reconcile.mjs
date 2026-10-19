/**
 * The pure parts of the relay's reconcile mode: which pages to look at, the one read-only call's
 * code, and how its reply is read. relay.mjs runs the call.
 *
 * Reconcile exists because the Klaus plugin in Figma writes the first, large load and cannot
 * write the repo's ledger. After it runs, the ledger still lists every unit as generated. One
 * read-only use_figma call is told the `<Name> <version>` of every generated unit and returns one
 * true or false for each, in the same order: true when a component set or component of that name
 * sits on a page Klaus writes. It returns no name, because the reply stays in the context of the
 * model that relays the call, and a name from the Figma file could be written to steer it.
 */
import { readFileSync } from "node:fs";
import { encodeText } from "../codegen.mjs";
import { OLDER_VERSIONS_PAGE, pageFor } from "../settings.mjs";
import { readFoundResult } from "./events.mjs";

/** A page name the relay will put in code: the same rule as the page setting. */
const PAGE_NAME = /^[^\u0000-\u001f]{1,100}$/;

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

const RUNTIME = readFileSync(new URL("../runtime.js", import.meta.url), "utf8");

/**
 * The runtime's own decoder, as text: its BASE64 line and its decodeText function, so the call
 * decodes what encodeText wrote with the same code the generated units use.
 */
function decoderCode() {
  const base64 = /^const BASE64 = .*;$/m.exec(RUNTIME);
  const decode = /^function decodeText\(encoded\) \{\n[\s\S]*?\n\}$/m.exec(RUNTIME);
  if (!base64 || !decode) throw new Error("reconcile.mjs cannot find the decoder in runtime.js.");
  return [base64[0], ...decode[0].split("\n").map((line) => line.trim()).filter(Boolean)];
}

export const DECODER_CODE = decoderCode();

/**
 * The code of the one call. It is read-only: it writes nothing, makes no page and switches no
 * page. It decodes the page names and the labels it was given, loads each page with `loadAsync`
 * as the generated code does, collects the names of the component sets and components that sit
 * directly on those pages, and returns { found }, one true or false for each label in order. A
 * page the file does not have is skipped. No name from the file leaves the code.
 *
 * Every page name and label is encoded with the call's key (encodeText), so the relaying model
 * reads no name from the ledger or the settings either. The code holds no backslash, because a
 * model drops them (see the README).
 * @param {string[]} pages
 * @param {string[]} labels  `<Name> <version>`, in the order the answer is wanted.
 * @param {number[]} key
 */
export function reconcileCode(pages, labels, key) {
  return [
    "// Klaus reconcile. Read only: it returns one true or false for each label, and no name.",
    `const KEY = [${key.join(",")}];`,
    `const PAGES = ${JSON.stringify(pages.map((page) => encodeText(page, key)))};`,
    `const LABELS = ${JSON.stringify(labels.map((label) => encodeText(label, key)))};`,
    ...DECODER_CODE,
    "const names = [];",
    "for (const encodedPage of PAGES) {",
    "  const pageName = decodeText(encodedPage);",
    "  const page = figma.root.children.find(function (p) { return p.name === pageName; });",
    "  if (!page) continue;",
    "  await page.loadAsync();",
    "  for (const node of page.children) {",
    '    if (node.type === "COMPONENT_SET" || node.type === "COMPONENT") names.push(node.name);',
    "  }",
    "}",
    "return { found: LABELS.map(function (label) { return names.indexOf(decodeText(label)) >= 0; }) };",
    "",
  ].join("\n");
}

/**
 * Reads the booleans out of a use_figma result, and nothing else: the model's own reply is never
 * looked at. The result must hold { found }, a list of booleans as long as the labels sent.
 * Anything else is refused, and then nothing changes.
 * @returns {{ found: boolean[] } | { error: string }}
 */
export function readFound(result, expected) {
  const reply = readFoundResult(result);
  if (!reply) return { error: "its result holds no list of true and false." };
  const { found } = reply;
  if (found.length !== expected) return { error: `its list has ${found.length} entries, and ${expected} were asked for.` };
  if (found.some((entry) => typeof entry !== "boolean")) return { error: "its list holds something that is not true or false." };
  return { found };
}
