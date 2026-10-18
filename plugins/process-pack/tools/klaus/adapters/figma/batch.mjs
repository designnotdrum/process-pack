/**
 * Packs units into code files.
 *
 * Figma takes at most 50,000 characters of code in one call, and the
 * prototype measured about 4.5 KB per component, so a call holds about ten
 * components. A file is closed when the next unit would take it past 50,000
 * characters or past the unit count. A unit that is too big for a file of its
 * own cannot be sent at all and is returned apart, so the caller can say which.
 */
import { renderFile } from "./codegen.mjs";
import { MAX_CODE_CHARS } from "./settings.mjs";

/** Room for the file header, which says "file 12 of 40" and is written after the packing. */
const HEADER_ROOM = 120;

/**
 * @param {object[]} units
 * @param {object} options
 * @param {{ collection: string, mode: string }} options.config
 * @param {number} [options.perFile]    Most units in one file. Default 10.
 * @param {number} [options.maxChars]   Most characters in one file. Default 50,000.
 * @returns {{ files: Array<{ name: string, code: string, units: object[] }>, tooLarge: Array<{ unit: object, chars: number }> }}
 */
export function packUnits(units, { config, perFile = 10, maxChars = MAX_CODE_CHARS }) {
  const room = maxChars - HEADER_ROOM;
  const size = (group) => renderFile({ units: group, config, header: "" }).length;
  const groups = [];
  const tooLarge = [];
  let current = [];
  for (const unit of units) {
    const alone = size([unit]);
    if (alone > room) {
      tooLarge.push({ unit, chars: alone });
      continue;
    }
    if (current.length > 0 && (current.length >= perFile || size([...current, unit]) > room)) {
      groups.push(current);
      current = [];
    }
    current.push(unit);
  }
  if (current.length > 0) groups.push(current);

  const files = groups.map((group, i) => {
    const name = `figma-${String(i + 1).padStart(3, "0")}.js`;
    const names = group.map((unit) => unit.id).join(", ");
    const header = `Klaus Figma code, file ${i + 1} of ${groups.length}: ${names}`.replace(/[^\x20-\x7e]+/g, " ").slice(0, HEADER_ROOM - 10);
    const code = renderFile({ units: group, config, header });
    if (code.length > maxChars) throw new Error(`${name} came to ${code.length} characters, over the ${maxChars} limit.`);
    return { name, code, units: group };
  });
  return { files, tooLarge };
}
