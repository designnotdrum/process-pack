/**
 * The Figma adapter's own settings.
 *
 * They sit under `outputs.figma.options` in klaus.config.json. Every one has a
 * default, so an empty block works. `readOptions` checks the types and throws
 * an error that names the setting, so a typo is found before any step runs.
 */

/** Characters the relay can carry in one call, from Figma's use_figma limit. */
export const MAX_CODE_CHARS = 50000;

/** Relay tokens for one component version, measured on the prototype (about 4.5 KB of code). */
export const TOKENS_PER_COMPONENT = 1200;

/** Characters per relay token on the prototype's code: 4.5 KB is about 1,200 tokens. */
export const CHARS_PER_TOKEN = 3.75;

/** Unverified: no measurement exists. It covers the text of one upload call. */
export const TOKENS_PER_SCREEN_IMAGE = 300;

/** Unverified: no measurement exists. An editable screen is code, and a screen has more layers than a component. */
export const TOKENS_PER_EDITABLE_SCREEN = 3000;

export const STATES = Object.freeze(["loading", "disabled"]);

export const DEFAULT_OPTIONS = Object.freeze({
  /** Folder of a static Storybook build, relative to the repo root. */
  storybookDir: "storybook-static",
  /** Name of the variable collection that holds the colour tokens. */
  collectionName: "Tokens",
  /** Name of the one mode the collection has. */
  modeName: "Light",
  /** One page for every component. Empty means one page per component, named after it. */
  page: "",
  /** Where earlier versions of a component go when a new version is written. */
  olderVersionsPage: "Older versions",
  /** Where screens go. */
  screensPage: "Screens",
  /** Inventory variant props that become Figma variant properties, in order. */
  axes: ["variant", "size"],
  /** Extra states to draw, as a State property: any of "loading" and "disabled". Empty keeps Variant and Size only. */
  states: [],
  /** Draw the icon a story shows, as a hidden layer with a Show icon property. */
  icons: false,
  /** Put the component's name in the text layer. False leaves the story's own text. */
  label: true,
  /** The Storybook globals the stories are read under. */
  globals: "theme:light",
  /** Story ids by component name, when the automatic pick is wrong. */
  stories: {},
  /** Components in one code file. A file is also cut at 50,000 characters. */
  componentsPerCall: 10,
  /** Write each screen as editable layers instead of a screenshot image. Needs screensBaseUrl. */
  editableScreens: false,
  /** Where Dieter leaves the screenshot of each screen, relative to the repo root. */
  screenshotsDir: ".klaus/screens",
  /** The running app, for editable screens. */
  screensBaseUrl: "",
  /** A Playwright storage state file for a signed-in app, relative to the repo root. */
  screensStorageState: "",
  /** How many versions of each screen stay in the file. */
  screenVersionsKept: 20,
  /** Where write leaves the code files and the upload list, relative to the repo root. */
  outputDir: ".klaus/figma",
});

const NAME = /^[^\u0000-\u001f]{1,100}$/;

function fail(key, message) {
  throw new Error(`outputs.figma.options.${key}: ${message}`);
}

function text(options, key) {
  if (typeof options[key] !== "string") fail(key, "must be text.");
}

function name(options, key, { empty = false } = {}) {
  text(options, key);
  if (options[key] === "" && empty) return;
  if (!NAME.test(options[key])) fail(key, "must be a name of 1 to 100 characters.");
}

function bool(options, key) {
  if (typeof options[key] !== "boolean") fail(key, "must be true or false.");
}

function whole(options, key, min, max) {
  const value = options[key];
  if (!Number.isInteger(value) || value < min || value > max) fail(key, `must be a whole number from ${min} to ${max}.`);
}

/**
 * The options with defaults filled in. Throws when one is the wrong type.
 * @param {object} [settings]  The output's block of klaus.config.json.
 */
export function readOptions(settings) {
  const given = settings?.options ?? {};
  if (typeof given !== "object" || Array.isArray(given)) fail("(block)", "must be an object.");
  for (const key of Object.keys(given)) {
    if (!(key in DEFAULT_OPTIONS)) fail(key, `is not a setting the Figma adapter knows. Known: ${Object.keys(DEFAULT_OPTIONS).join(", ")}.`);
  }
  const options = { ...DEFAULT_OPTIONS, ...given };

  for (const key of ["storybookDir", "screenshotsDir", "outputDir", "globals"]) text(options, key);
  for (const key of ["collectionName", "modeName", "olderVersionsPage", "screensPage"]) name(options, key);
  name(options, "page", { empty: true });
  for (const key of ["icons", "label", "editableScreens"]) bool(options, key);
  whole(options, "componentsPerCall", 1, 50);
  whole(options, "screenVersionsKept", 1, 1000);

  for (const key of ["axes", "states"]) {
    if (!Array.isArray(options[key]) || options[key].some((v) => typeof v !== "string" || v === "")) fail(key, "must be a list of names.");
  }
  const badState = options.states.find((s) => !STATES.includes(s));
  if (badState) fail("states", `"${badState}" is not a state. Use ${STATES.join(" or ")}.`);
  if (new Set(options.axes).size !== options.axes.length) fail("axes", "lists a name twice.");

  if (!options.stories || typeof options.stories !== "object" || Array.isArray(options.stories)) fail("stories", "must map component names to story ids.");
  for (const [component, id] of Object.entries(options.stories)) {
    if (typeof id !== "string" || id === "") fail("stories", `the story id for ${component} must be text.`);
  }
  for (const key of ["screensBaseUrl", "screensStorageState"]) text(options, key);
  if (options.editableScreens && options.screensBaseUrl === "") fail("screensBaseUrl", "is needed when editableScreens is true.");
  return options;
}

/** The page a component's sets live on. */
export function pageFor(component, options) {
  return options.page === "" ? component : options.page;
}
