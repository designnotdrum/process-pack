/**
 * Packs units into data files, one per use_figma call.
 *
 * Figma takes at most 50,000 characters of code in one call, so a file is
 * sized by the code that will be built from it. A file is closed when the next
 * unit would take that code past 50,000 characters or past the unit count. A
 * unit that is too big for a file of its own cannot be sent at all and is
 * returned apart, so the caller can say which.
 */
import { codeFor, dataFor, SIZING_KEY } from "./codegen.mjs";
import { MAX_CODE_CHARS } from "./settings.mjs";

/** The most characters a file header can take. The header names the file and its units, and is written after the packing. */
const HEADER_ROOM = 120;

/**
 * The most characters of code the relay can send for these units in one file: its encoded code,
 * which is longer than the plain code, with a header of the greatest length, so a file never comes
 * out over the limit once its real header is in.
 * @param {object[]} units
 * @param {{ collection: string, mode: string }} config
 */
export function codeChars(units, config) {
  return codeFor(dataFor({ units, config, header: "x".repeat(HEADER_ROOM) }), { key: [...SIZING_KEY] }).length;
}

/**
 * @param {object[]} units
 * @param {object} options
 * @param {{ collection: string, mode: string }} options.config
 * @param {number} [options.perFile]    Most units in one file. Default 10.
 * @param {number} [options.maxChars]   Most characters in one file. Default 50,000.
 * @returns {{ files: Array<{ name: string, data: object, code: string, chars: number, units: object[] }>, tooLarge: Array<{ unit: object, chars: number }> }}
 *   name is the data file's name and data is what it holds. code is the plain code built from it.
 *   chars is the length of the relay's encoded code, the most use_figma will be sent.
 */
export function packUnits(units, { config, perFile = 10, maxChars = MAX_CODE_CHARS }) {
  // Each size call renders only the file being filled, which holds at most perFile units.
  const size = (group) => codeChars(group, config);
  const groups = [];
  const tooLarge = [];
  let current = [];
  for (const unit of units) {
    const alone = size([unit]);
    if (alone > maxChars) {
      tooLarge.push({ unit, chars: alone });
      continue;
    }
    if (current.length > 0 && (current.length >= perFile || size([...current, unit]) > maxChars)) {
      groups.push(current);
      current = [];
    }
    current.push(unit);
  }
  if (current.length > 0) groups.push(current);

  const files = groups.map((group, i) => {
    const name = `figma-${String(i + 1).padStart(3, "0")}.json`;
    const names = group.map((unit) => unit.id).join(", ");
    const header = `Klaus Figma code, file ${i + 1} of ${groups.length}: ${names}`.replace(/[^\x20-\x7e]+/g, " ").slice(0, HEADER_ROOM);
    const data = dataFor({ units: group, config, header });
    const code = codeFor(data);
    const chars = codeFor(data, { key: [...SIZING_KEY] }).length;
    // The sizes above were measured with a header of the greatest length, so this cannot happen.
    if (chars > maxChars) throw new Error(`${name} came to ${chars} characters, over the ${maxChars} limit.`);
    return { name, data, code, chars, units: group };
  });
  return { files, tooLarge };
}
