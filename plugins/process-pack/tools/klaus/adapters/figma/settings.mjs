/**
 * The Figma adapter's own settings.
 *
 * They sit under `outputs.figma.options` in klaus.config.json. Every one has a
 * default, so an empty block works. `readOptions` checks the types and throws
 * an error that names the setting, so a typo is found before any step runs.
 */

/** Characters the relay can carry in one call, from Figma's use_figma limit. */
export const MAX_CODE_CHARS = 50000;

/**
 * What one relay call costs, from four real calls on 2026-10-18 (issue #28): 68,817 to 99,687
 * relay tokens for 18,750 to 20,582 characters of code. A call is two model requests, and each
 * reads Codex's instructions, the tool's definition and the code. The fixed part comes from the
 * dearest call, so an estimate is not lower than what that call cost.
 */
export const CALL_BASE_TOKENS = 71000;
export const TOKENS_PER_CODE_CHAR = 1.4;

/** The relay tokens of one call that carries chars characters of code. */
export const relayCallTokens = (chars) => Math.ceil(CALL_BASE_TOKENS + chars * TOKENS_PER_CODE_CHAR);

/**
 * Characters of a component's own data in a code file, next to the shared runtime. From the two
 * Button files of 2026-10-18: 3,929 characters for 18 variants and 5,761 for 30.
 */
export const DATA_CHARS_PER_COMPONENT = 1200;
export const DATA_CHARS_PER_VARIANT = 155;

/** Unverified: no measurement exists. It covers the text of one upload call. */
export const TOKENS_PER_SCREEN_IMAGE = 300;

/**
 * Unverified: no editable screen has been relayed. This is the cost of a call that carries a full
 * file of 50,000 characters, so an estimate does not let the cap be passed.
 */
export const TOKENS_PER_EDITABLE_SCREEN = relayCallTokens(MAX_CODE_CHARS);

export const STATES = Object.freeze(["loading", "disabled"]);

/** The one mode the variable collection has. */
export const MODE_NAME = "Light";

/** Where earlier versions of a component go when a new version is written. */
export const OLDER_VERSIONS_PAGE = "Older versions";

/** Where screens go. */
export const SCREENS_PAGE = "Screens";

export const DEFAULT_OPTIONS = Object.freeze({
  /** Folder of a static Storybook build, relative to the repo root. */
  storybookDir: "storybook-static",
  /** Name of the variable collection that holds the colour tokens. */
  collectionName: "Tokens",
  /** One page for every component. Empty means one page per component, named after it. */
  page: "",
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
  /**
   * Components in one code file. The relay sends each file in one call and carries the small
   * updates after a release, so the default is one component version a call. A bulk load can set
   * up to 50. A file is still cut at 50,000 characters.
   */
  componentsPerCall: 1,
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
  name(options, "collectionName");
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
