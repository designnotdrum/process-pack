/**
 * The Figma adapter: turns a release's planned writes into data for Plugin API code.
 *
 * It uses no model and makes no Figma call. `write` leaves data files and an
 * upload list in a folder. The relay (relay/) builds each call's code from a
 * data file and the runtime in its own checkout, and sends it through a
 * signed-in agent, because Figma's MCP server refuses a plain script.
 *
 *   plan      components whose current version is not written yet, and the screens to write
 *   estimate  calls and relay tokens, at the measured relay rate: 71,000 tokens a call plus
 *             1.4 a character of code, about 108,000 for a Button-sized component version
 *   write     read computed styles from a static Storybook build, build the data, pack it into
 *             files of one component each by default whose code is at most 50,000 characters,
 *             and list the screenshots to upload
 *   report    where the files are, and a link to the Figma file
 *
 * The relay runs on another machine and keeps its own ledger. It publishes its sent and changed
 * marks to the KLAUS_FIGMA_LEDGER variable, which the workflow passes to this adapter in the
 * environment. plan merges them into the ledger it reads, so a unit the relay sent is not planned
 * again (shared-ledger.mjs). They are not written into this checkout's ledger, and every version the
 * plan leaves out only because the variable marks it sent is named in the report, with a warning.
 *
 * A first load (ctx.firstLoad, from the workflow's figma_first_load input) is the whole release for
 * the Klaus plugin: the frame lifts the spending cap, and the manifest says firstLoad, so the relay
 * does not send it.
 *
 * Settings are under outputs.figma.options. See settings.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import { selectComponents } from "../../frame/components.mjs";
import { writeJsonFile } from "../../frame/json-file.mjs";
import { packUnits } from "./batch.mjs";
import { captureComponent, captureScreen, openStorybook, readStoryIndex, storyCandidates } from "./capture.mjs";
import { anyVersionSent, componentSent, entryOf, GENERATED, readLedger, recordEntry, screenSent } from "./ledger.mjs";
import { screenRoutes, uploadFor } from "./screens.mjs";
import { ignoredWarning, mergeMarks, parseSharedLedger, SHARED_LEDGER_VARIABLE, sentOnlyInShared, sentOnlySentence, sentOnlyWarning, usableMarks } from "./shared-ledger.mjs";
import { RUNTIME_CODE } from "./codegen.mjs";
import {
  CALL_BASE_TOKENS,
  DATA_CHARS_PER_COMPONENT,
  DATA_CHARS_PER_VARIANT,
  MAX_CODE_CHARS,
  MODE_NAME,
  SCREENS_PAGE,
  TOKENS_PER_CODE_CHAR,
  TOKENS_PER_EDITABLE_SCREEN,
  TOKENS_PER_SCREEN_IMAGE,
  pageFor,
  readOptions,
  relayCallTokens,
} from "./settings.mjs";
import { buildComponentUnit, buildScreenUnit, describe } from "./spec.mjs";

/** A component the versioning step has not numbered yet is written as this. */
export const DEFAULT_VERSION = "1.0.0";

/** Version 2 adds ledgerEntries, which the relay needs to record what it sent. */
export const MANIFEST_VERSION = 2;

/** Figma allows a few hundred variants in a set. Past this, the set is not worth drawing. */
const MAX_VARIANTS = 256;

/** The run's output folder, handed from write to report. */
const runs = new WeakMap();

/** How the plan read KLAUS_FIGMA_LEDGER, handed from plan to report. */
const plans = new WeakMap();

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
 * @param {{ env?: Record<string, string | undefined> }} [options]  Where KLAUS_FIGMA_LEDGER is read. Default process.env.
 */
export function createAdapter(browser = {}, { env } = {}) {
  const open = browser.openStorybook ?? openStorybook;
  const readComponent = browser.captureComponent ?? captureComponent;
  const readScreen = browser.captureScreen ?? captureScreen;
  const sharedText = () => (env ?? process.env)[SHARED_LEDGER_VARIABLE];

  return {
    name: "figma",
    usesModel: false,

    async plan(ctx) {
      const options = readOptions(ctx.settings);
      const root = rootOf(ctx);
      const release = releaseOf(ctx);
      const own = readLedger(ledgerFile(root, options));
      // What the relay sent, from wherever it ran, for the versions this ledger lists. Merged for planning only.
      const shared = parseSharedLedger(sharedText(), fileKeyOf(ctx.settings.target));
      const { usable, ignored } = usableMarks(shared, own);
      const ledger = usable ? mergeMarks(readLedger(ledgerFile(root, options)), usable) : own;
      const stories = readStories(root, options);
      const retry = new Set(ctx.unwrittenFromLastRun);
      const items = [];
      // The units the plan leaves out as sent. Those only the variable marks sent are named in the report.
      const skipped = [];

      // A component is new to Figma until the relay has sent one of its versions.
      const picked = selectComponents(ctx.inventory, ctx.selection, { isNew: (c) => !anyVersionSent(ledger, c.name) });
      for (const entry of picked) {
        if (entry.kind === "icon-set") continue;
        const version = entry.version || DEFAULT_VERSION;
        if (componentSent(ledger, entry.name, version) && !retry.has(entry.name)) {
          skipped.push({ kind: "component", name: entry.name, version });
          continue;
        }
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
        if (screenSent(ledger, route, release) && !retry.has(id)) {
          skipped.push({ kind: "screen", route, release });
          continue;
        }
        items.push({ id, kind: "screen", route, release, page: SCREENS_PAGE, editable: options.editableScreens });
      }
      const sentOnlyInVariable = sentOnlyInShared(own, usable, skipped);
      plans.set(ctx, {
        variable: SHARED_LEDGER_VARIABLE,
        read: shared.status,
        sentOnlyInVariable: { count: sentOnlyInVariable.length, versions: sentOnlyInVariable },
        ignoredInVariable: { count: ignored.length, versions: ignored },
      });
      const warnings = shared.warning ? [shared.warning] : [];
      if (ignored.length > 0) warnings.push(ignoredWarning(ignored));
      if (sentOnlyInVariable.length > 0) warnings.push(sentOnlyWarning(sentOnlyInVariable, "this run did not plan"));
      return { items, warnings };
    },

    estimate(plan, ctx) {
      // The plugin applies a first load with no model and no relay call, so it costs no relay tokens.
      if (ctx.firstLoad) return { items: plan.items.map((item) => ({ id: item.id, calls: 0, tokens: 0, usd: 0 })) };
      const options = readOptions(ctx.settings);
      const per = options.componentsPerCall;
      const perCall = Math.round((1 / per) * 10000) / 10000;
      // A call's fixed cost and the runtime it carries are shared by the components in its file.
      const shared = (CALL_BASE_TOKENS + RUNTIME_CODE.length * TOKENS_PER_CODE_CHAR) / per;
      return {
        items: plan.items.map((item) => {
          if (item.kind === "component") {
            const variants = item.axes.reduce((n, axis) => n * axis.values.length, 1) * (1 + options.states.length);
            const data = DATA_CHARS_PER_COMPONENT + DATA_CHARS_PER_VARIANT * variants;
            return { id: item.id, calls: perCall, tokens: Math.ceil(shared + data * TOKENS_PER_CODE_CHAR), usd: 0 };
          }
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
        afterUploads = { ...kept[0], name: "figma-retention.json" };
      }

      const directory = path.join(root, options.outputDir, safeName(release));
      fs.mkdirSync(directory, { recursive: true });
      for (const name of fs.readdirSync(directory)) {
        // Only the names this adapter writes. A file someone else left in the folder stays.
      // An older generator wrote code files (.js); they go too, so no code is left in the folder.
      if (/^figma-(\d+|retention)\.(js|json)$/.test(name) || name === "manifest.json") fs.rmSync(path.join(directory, name));
      }
      const everyFile = afterUploads ? [...files, afterUploads] : files;
      // Data only. Whatever sends a file to Figma builds its code from the runtime in its own checkout.
      for (const file of everyFile) writeJsonFile(path.join(directory, file.name), file.data);

      // What relaying these files will cost. No relay has run yet, so this is the measured rate.
      // A first load is the plugin's, which spends nothing.
      const actual = ctx.firstLoad ? { calls: 0, tokens: 0, usd: 0 } : {
        calls: everyFile.length + (uploads.length > 0 ? Math.ceil(uploads.length / 60) : 0),
        tokens: everyFile.reduce((sum, file) => sum + relayCallTokens(file.chars), 0) + uploads.length * TOKENS_PER_SCREEN_IMAGE,
        usd: 0,
      };
      const sendable = units.filter((u) => packed.has(u.id));
      const manifest = {
        schemaVersion: MANIFEST_VERSION,
        output: "figma",
        fileKey: fileKeyOf(ctx.settings.target),
        release,
        generatedAt: new Date().toISOString(),
        // chars: the length of the code the relay sends, which is what a call costs.
        files: files.map((file) => ({ name: file.name, chars: file.chars, units: file.units.map((unit) => unit.id) })),
        // What the relay records in the ledger for each unit once use_figma confirms it.
        ledgerEntries: Object.fromEntries([
          ...sendable.map((unit) => [unit.id, entryOf(unit)]),
          ...uploads.map((upload) => [upload.id, { kind: "screen", route: upload.screen, release: upload.release }]),
        ]),
        uploads,
        afterUploads: afterUploads ? { name: afterUploads.name, chars: afterUploads.chars } : null,
        warnings: [...new Set(warnings)],
      };
      // The Klaus plugin applies a first load. The relay refuses to send one (relay/README.md).
      if (ctx.firstLoad) manifest.firstLoad = true;
      writeJsonFile(path.join(directory, "manifest.json"), manifest);

      // Generated, not sent: only the relay records a unit as sent, after use_figma confirms it.
      // The same entries the manifest gives the relay, so the two cannot drift apart.
      const ledger = readLedger(ledgerFile(root, options));
      for (const entry of Object.values(manifest.ledgerEntries)) recordEntry(ledger, entry, GENERATED);
      writeJsonFile(ledgerFile(root, options), ledger);

      runs.set(ctx, { directory: path.relative(root, directory).split(path.sep).join("/"), manifest });
      const written = [...packed, ...uploads.map((upload) => upload.id)];
      return { written, failed, actual };
    },

    report(outcome, ctx) {
      const run = runs.get(ctx);
      const key = fileKeyOf(ctx.settings.target);
      const links = key ? [{ label: "Figma file", url: `https://www.figma.com/design/${key}` }] : [];
      // KLAUS_FIGMA_LEDGER: how it read, and the versions only it marks sent, so a forged record shows.
      const sharedLedger = plans.get(ctx) ?? null;
      const variableNote = sentOnlySentence(sharedLedger?.sentOnlyInVariable.count ?? 0, [", so it was not planned", ", so they were not planned"]);
      if (outcome.dryRun || !run) {
        const summary = `Figma: ${outcome.dryRun ? "a dry run, so no code was generated" : "nothing was written"}.${variableNote}`;
        // No manifest, so the only details are how the plan read the variable, when it ran.
        return sharedLedger ? { summary, links, details: { sharedLedger } } : { summary, links };
      }
      const { manifest, directory } = run;
      const parts = [`${manifest.files.reduce((n, f) => n + f.units.length, 0)} in ${manifest.files.length} data file${manifest.files.length === 1 ? "" : "s"}`];
      if (manifest.uploads.length > 0) parts.push(`${manifest.uploads.length} screenshot${manifest.uploads.length === 1 ? "" : "s"} to upload`);
      const details = { directory, manifest: `${directory}/manifest.json`, files: manifest.files, uploads: manifest.uploads.length, warnings: manifest.warnings, sharedLedger };
      if (manifest.firstLoad) {
        return {
          summary: `Figma first load for the Klaus plugin in ${directory}: ${parts.join(" and ")}, with no spending cap. Apply the klaus-figma artifact with the plugin, then run the relay with --reconcile --run <this run's id>. The relay does not send a first load.${variableNote}`,
          links,
          details: { ...details, firstLoad: true },
        };
      }
      return {
        summary: `Figma data is ready for the relay in ${directory}: ${parts.join(" and ")}.${variableNote}`,
        links,
        details,
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
