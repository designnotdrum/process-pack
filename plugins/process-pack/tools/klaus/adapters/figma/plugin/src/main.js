// The plugin's main thread: it reads a release and applies it to the open file.
//
// build.mjs puts two things in the marked places below, so this file is not run as it stands:
//   reader   data-file.mjs (the generator's data reader, as the relay uses it) and release.mjs
//   runtime  adapters/figma/runtime.js, the code that draws the sets, as the relay sends it
//
// No text from a release file is ever run. The window sends file text here, the reader parses it as
// JSON and checks every field, and the values reach the runtime as the arguments of applyData. There
// is no eval, no Function and no network request, and the manifest allows none.

/* @bundle:reader */

/**
 * The runtime, wrapped in a function. runtime.js was written as the body of a function with
 * CONFIG, TOKENS, UNITS, SVGS and KEY in scope (it uses top-level await and return, as use_figma
 * allows). Here those five are the function's own arguments and constants, so the data arrives as
 * values. SVGS stays empty: the data keeps each icon's markup in the unit, and the runtime reads it
 * from there when the SVGS index is not a number.
 */
async function applyData(CONFIG, TOKENS, UNITS, SVGS) {
  const KEY = null;
/* @bundle:runtime */
}

/** What the window's Apply button runs: every unit of the release, in the order the generator wrote them, in one run. */
function applyLoaded(release) {
  return applyData(release.config, release.tokens, release.units, []);
}

/** Reads a release from the window's files, then applies it. */
async function applyRelease(sources) {
  return applyLoaded(reader.loadRelease(sources));
}

const isRefusal = (error) => error instanceof reader.ReleaseError || error instanceof reader.DataError;

function startPlugin() {
  figma.showUI(__html__, { width: 460, height: 640, themeColors: true });
  let loaded = null;
  const say = (message) => figma.ui.postMessage(message);

  figma.ui.onmessage = async function (message) {
    try {
      if (message.type === "load") {
        loaded = null;
        loaded = reader.loadRelease(message.sources);
        say({ type: "loaded", summary: loaded.summary });
      } else if (message.type === "apply") {
        if (!loaded) {
          say({ type: "refused", message: "Add the release files first." });
          return;
        }
        say({ type: "applying" });
        say({ type: "applied", result: await applyLoaded(loaded) });
      } else if (message.type === "close") {
        figma.closePlugin();
      }
    } catch (error) {
      if (message.type === "load") loaded = null;
      const text = String(error && error.message ? error.message : error);
      say(isRefusal(error) ? { type: "refused", message: text } : { type: "failed", message: text });
    }
  };
}

// In Figma's plugin sandbox __html__ holds ui.html. Anywhere else (a test, use_figma) there is no window to open.
if (typeof __html__ !== "undefined") startPlugin();
