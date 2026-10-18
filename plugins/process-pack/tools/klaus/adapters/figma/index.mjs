/**
 * The Figma adapter: turns a release's planned writes into Plugin API code.
 *
 * It uses no model and makes no Figma call. `write` leaves code files and an
 * upload list in a folder, and the relay (issue #28) sends them through a
 * signed-in agent, because Figma's MCP server refuses a plain script.
 *
 *   plan      components whose current version is not written yet, and the screens to write
 *   estimate  calls and relay tokens: about 1,200 tokens a component version
 *   write     read computed styles from a static Storybook build, build the code, pack it into
 *             files of at most 50,000 characters, and list the screenshots to upload
 *   report    where the files are, and a link to the Figma file
 *
 * Settings are under outputs.figma.options. See settings.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import { selectComponents } from "../../frame/components.mjs";
import { writeJsonFile } from "../../frame/json-file.mjs";
import { packUnits } from "./batch.mjs";
import { captureComponent, captureScreen, openStorybook, readStoryIndex, storyCandidates } from "./capture.mjs";
import { hasComponent, hasScreen, readLedger, recordComponent, recordScreen } from "./ledger.mjs";
import { screenRoutes, uploadFor } from "./screens.mjs";
import {
  CHARS_PER_TOKEN,
  MAX_CODE_CHARS,
  MODE_NAME,
  SCREENS_PAGE,
  TOKENS_PER_COMPONENT,
  TOKENS_PER_EDITABLE_SCREEN,
  TOKENS_PER_SCREEN_IMAGE,
  pageFor,
  readOptions,
} from "./settings.mjs";
import { buildComponentUnit, buildScreenUnit, describe } from "./spec.mjs";

/** A component the versioning step has not numbered yet is written as this. */
export const DEFAULT_VERSION = "1.0.0";

/** Figma allows a few hundred variants in a set. Past this, the set is not worth drawing. */
const MAX_VARIANTS = 256;

/** The run's output folder, handed from write to report. */
const runs = new WeakMap();

const rootOf = (ctx) => ctx.root ?? process.cwd();
const releaseOf = (ctx) => ctx.release ?? new Date().toISOString().slice(0, 10);
const titleCase = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const safeName = (text) => String(text).replace(/[^A-Za-z0-9._-]+/g, "_");
const ledgerFile = (root, options) => path.join(root, options.outputDir, "ledger.json");

/** The inventory props that become Figma variant properties. */
export function axesOf(entry, options) {
  return options.axes
    .filter((prop) => Array.isArray(entry.variants?.[prop]) && entry.variants[prop].length > 0)
    .map((prop) => ({ prop, name: titleCase(prop), values: entry.variants[prop] }));
}

/** The stories in the Storybook build, or null when there is no build to look in. */
function readStories(root, options) {
  const directory = path.resolve(root, options.storybookDir);
  try {
    return readStoryIndex(directory);
  } catch {
    return null;
  }
}

/**
 * The adapter. The browser steps are passed in so a test can replace them.
 * @param {{ openStorybook?: Function, captureComponent?: Function, captureScreen?: Function }} [browser]
 */
export function createAdapter(browser = {}) {
  const open = browser.openStorybook ?? openStorybook;
  const readComponent = browser.captureComponent ?? captureComponent;
  const readScreen = browser.captureScreen ?? captureScreen;

  return {
    name: "figma",
    usesModel: false,

    async plan(ctx) {
      const options = readOptions(ctx.settings);
      const root = rootOf(ctx);
      const release = releaseOf(ctx);
      const ledger = readLedger(ledgerFile(root, options));
      const stories = readStories(root, options);
      const retry = new Set(ctx.unwrittenFromLastRun);
      const items = [];

      const picked = selectComponents(ctx.inventory, ctx.selection, { isNew: (c) => !ledger.components[c.name] });
      for (const entry of picked) {
        if (entry.kind === "icon-set") continue;
        const version = entry.version || DEFAULT_VERSION;
        if (hasComponent(ledger, entry.name, version) && !retry.has(entry.name)) continue;
        // A component with no story cannot be drawn. Leave it out of the plan instead of failing every run.
        if (stories && storyCandidates(stories, entry.name, options.stories[entry.name]).length === 0) continue;
        items.push({
          id: entry.name,
          kind: "component",
          name: entry.name,
          version,
          file: entry.file,
          page: pageFor(entry.name, options),
          description: describe(entry.purpose),
          axes: axesOf(entry, options),
        });
      }

      for (const route of screenRoutes(ctx.selection.screens, ctx.inventory)) {
        const id = `screen:${route}`;
        if (hasScreen(ledger, route, release) && !retry.has(id)) continue;
        items.push({ id, kind: "screen", route, release, page: SCREENS_PAGE, editable: options.editableScreens });
      }
      return { items };
    },

    estimate(plan, ctx) {
      const options = readOptions(ctx.settings);
      const perCall = Math.round((1 / options.componentsPerCall) * 10000) / 10000;
      return {
        items: plan.items.map((item) => {
          if (item.kind === "component") return { id: item.id, calls: perCall, tokens: TOKENS_PER_COMPONENT, usd: 0 };
          const tokens = item.editable ? TOKENS_PER_EDITABLE_SCREEN : TOKENS_PER_SCREEN_IMAGE;
          return { id: item.id, calls: 1, tokens, usd: 0 };
        }),
      };
    },

    async write(plan, ctx) {
      const options = readOptions(ctx.settings);
      const root = rootOf(ctx);
      const release = releaseOf(ctx);
      const failed = [];
      const units = [];
      const uploads = [];
      const warnings = [];

      const components = plan.items.filter((item) => item.kind === "component");
      const screens = plan.items.filter((item) => item.kind === "screen");

      if (components.length > 0) {
        let storybook;
        try {
          storybook = await open({ root, directory: options.storybookDir, globals: options.globals });
        } catch (error) {
          for (const item of components) failed.push({ id: item.id, error: error.message });
        }
        if (storybook) {
          try {
            for (const item of components) {
              try {
                const unit = await buildComponent(storybook, item, options, readComponent);
                units.push(unit);
                warnings.push(...unit.warnings);
              } catch (error) {
                failed.push({ id: item.id, error: error.message });
              }
            }
          } finally {
            await storybook.close();
          }
        }
      }

      const imageRoutes = [];
      for (const item of screens) {
        try {
          if (item.editable) {
            const url = new URL(item.route, options.screensBaseUrl).href;
            const capture = await readScreen({ root, url, storageState: options.screensStorageState || undefined });
            const unit = buildScreenUnit({ item, capture, options });
            units.push(unit);
            warnings.push(...unit.warnings);
          } else {
            const found = uploadFor({ root, directory: options.screenshotsDir, route: item.route, release: item.release, page: item.page });
            if (found.error) {
              failed.push({ id: item.id, error: found.error });
              continue;
            }
            uploads.push(found.upload);
            imageRoutes.push(item.route);
          }
        } catch (error) {
          failed.push({ id: item.id, error: error.message });
        }
      }

      const config = { collection: options.collectionName, mode: MODE_NAME };
      const { files, tooLarge } = packUnits(units, { config, perFile: options.componentsPerCall });
      for (const { unit, chars } of tooLarge) {
        const advice = unit.kind === "screen" ? "Use a screenshot for this screen instead of editableScreens." : "Narrow outputs.figma.options.axes or states.";
        failed.push({ id: unit.id, error: `Its code is ${chars} characters, more than the ${MAX_CODE_CHARS} one call takes. ${advice}` });
      }
      const packed = new Set(files.flatMap((file) => file.units.map((unit) => unit.id)));

      // Image screens: the relay uploads the images, then runs this to keep the last N versions of each.
      let afterUploads = null;
      if (imageRoutes.length > 0) {
        const retention = { kind: "retain", id: "retain-screens", page: SCREENS_PAGE, keep: options.screenVersionsKept, routes: imageRoutes, tokens: [] };
        const { files: kept } = packUnits([retention], { config });
        afterUploads = { ...kept[0], name: "figma-retention.js" };
      }

      const directory = path.join(root, options.outputDir, safeName(release));
      fs.mkdirSync(directory, { recursive: true });
      for (const name of fs.readdirSync(directory)) {
        // Only the names this adapter writes. A file someone else left in the folder stays.
      if (/^figma-(\d+|retention)\.js$/.test(name) || name === "manifest.json") fs.rmSync(path.join(directory, name));
      }
      const everyFile = afterUploads ? [...files, afterUploads] : files;
      for (const file of everyFile) fs.writeFileSync(path.join(directory, file.name), file.code);

      const chars = everyFile.reduce((sum, file) => sum + file.code.length, 0);
      const actual = {
        calls: everyFile.length + (uploads.length > 0 ? Math.ceil(uploads.length / 60) : 0),
        tokens: Math.ceil(chars / CHARS_PER_TOKEN) + uploads.length * TOKENS_PER_SCREEN_IMAGE,
        usd: 0,
      };
      const manifest = {
        schemaVersion: 1,
        output: "figma",
        fileKey: fileKeyOf(ctx.settings.target),
        release,
        generatedAt: new Date().toISOString(),
        files: files.map((file) => ({ name: file.name, chars: file.code.length, units: file.units.map((unit) => unit.id) })),
        uploads,
        afterUploads: afterUploads ? { name: afterUploads.name, chars: afterUploads.code.length } : null,
        warnings: [...new Set(warnings)],
      };
      writeJsonFile(path.join(directory, "manifest.json"), manifest);

      const ledger = readLedger(ledgerFile(root, options));
      for (const unit of units.filter((u) => packed.has(u.id))) {
        if (unit.kind === "component") recordComponent(ledger, unit.name, unit.version);
        else if (unit.kind === "screen") recordScreen(ledger, unit.route, unit.release);
      }
      for (const upload of uploads) recordScreen(ledger, upload.screen, upload.release);
      writeJsonFile(ledgerFile(root, options), ledger);

      runs.set(ctx, { directory: path.relative(root, directory).split(path.sep).join("/"), manifest });
      const written = [...packed, ...uploads.map((upload) => upload.id)];
      return { written, failed, actual };
    },

    report(outcome, ctx) {
      const run = runs.get(ctx);
      const key = fileKeyOf(ctx.settings.target);
      const links = key ? [{ label: "Figma file", url: `https://www.figma.com/design/${key}` }] : [];
      if (outcome.dryRun || !run) {
        return { summary: `Figma: ${outcome.dryRun ? "a dry run, so no code was generated" : "nothing was written"}.`, links };
      }
      const { manifest, directory } = run;
      const parts = [`${manifest.files.reduce((n, f) => n + f.units.length, 0)} in ${manifest.files.length} code file${manifest.files.length === 1 ? "" : "s"}`];
      if (manifest.uploads.length > 0) parts.push(`${manifest.uploads.length} screenshot${manifest.uploads.length === 1 ? "" : "s"} to upload`);
      return {
        summary: `Figma code is ready for the relay in ${directory}: ${parts.join(" and ")}.`,
        links,
        details: { directory, manifest: `${directory}/manifest.json`, files: manifest.files, uploads: manifest.uploads.length, warnings: manifest.warnings },
      };
    },
  };
}

async function buildComponent(storybook, item, options, readComponent) {
  const states = options.states;
  const variants = item.axes.reduce((n, axis) => n * axis.values.length, 1) * (1 + states.length);
  if (variants > MAX_VARIANTS) {
    throw new Error(`${item.name} would have ${variants} variants, more than ${MAX_VARIANTS}. Narrow outputs.figma.options.axes or states.`);
  }
  const capture = await readComponent(storybook, {
    name: item.name,
    axes: item.axes,
    states,
    label: options.label ? item.name : false,
    icons: options.icons,
    story: options.stories[item.name],
  });
  return buildComponentUnit({ item, capture, options });
}

/** The file key from a key or a Figma URL, or null when the target is neither. */
export function fileKeyOf(target) {
  if (typeof target !== "string") return null;
  const url = /figma\.com\/(?:design|file|board)\/([0-9A-Za-z]{22,128})/.exec(target);
  if (url) return url[1];
  return /^[0-9A-Za-z]{22,128}$/.test(target) ? target : null;
}

export default createAdapter();
