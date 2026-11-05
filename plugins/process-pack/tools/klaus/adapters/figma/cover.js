/**
 * The cover update: the part of the code that writes the release onto the file's cover page.
 *
 * codegen.mjs adds this text to the runtime only for the call that sends the release's last
 * component unit, and only when the coverPage setting names a page. It is kept out of runtime.js
 * because every call carries the runtime and a large component's call has little room left: code
 * over the limit stops the whole release, while a last call that cannot fit this text just goes
 * without it.
 *
 * It runs after the units, so it sees `complete` (runtime.js) and leaves the cover alone unless
 * every component unit of the call was written or was already there. The cover then never names a
 * release that did not finish.
 *
 * COVER is { page, version, updated }. With a KEY its strings are encoded like the rest of the data.
 * The two text layers are found by name on that page. The cover is drawn by a person, so a missing
 * page or layer is a warning and never fails the release. result.cover.status is one of the fixed
 * words written, held and failed.
 *
 * Like runtime.js, it holds no backslash and it never switches the current page.
 */
async function writeCover() {
  const page = await findPage(COVER.page);
  if (!page) {
    note("The cover was not updated: the file has no page named " + COVER.page + ".");
    return "failed";
  }
  const fields = [["Version", COVER.version], ["Updated", COVER.updated]];
  let status = "written";
  for (const field of fields) {
    const layer = page.findOne(function (n) { return n.type === "TEXT" && n.name === field[0]; });
    if (!layer) {
      note("The cover was not fully updated: " + COVER.page + " has no text layer named " + field[0] + ".");
      status = "failed";
      continue;
    }
    await figma.loadFontAsync(layer.fontName);
    layer.characters = field[1];
  }
  return status;
}

if (KEY) decodeData(COVER, "");
try {
  result.cover = { status: complete ? await writeCover() : "held" };
} catch (e) {
  // Nothing escapes as a raw error, because the error text of an escaped exception is not encoded.
  note("The cover was not updated: " + message(e));
  result.cover = { status: "failed" };
}
