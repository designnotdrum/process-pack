/**
 * Reads computed styles from a browser.
 *
 * Components come from a static Storybook build: the build is served from a
 * local port and each story is opened with the Storybook URL `args` setting
 * one variant. Screens come from a running app. Playwright is not a
 * dependency of Klaus. It is resolved from the repo the build is for, the same
 * way the inventory resolves TypeScript.
 */
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { findIcons, listCustomProperties, markComponent, readStory, storyFacts, waitForStill } from "./capture-browser.mjs";
import { STORY } from "./settings.mjs";

/** Root children that draw nothing. A story's root can start with one, so they are skipped. */
const NOT_DRAWN = ["STYLE", "SCRIPT", "LINK", "META", "TEMPLATE", "NOSCRIPT"];

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

/** Finds Playwright in the repo the design files are for. */
export function loadPlaywright(root) {
  const require = createRequire(path.join(root, "package.json"));
  for (const name of ["@playwright/test", "playwright", "playwright-core"]) {
    try {
      const loaded = require(name);
      if (loaded?.chromium) return loaded;
    } catch {
      // Try the next name.
    }
  }
  throw new Error(`Playwright is not installed in ${root}. Klaus reads computed styles with it, so add @playwright/test to the repo and install a browser.`);
}

/**
 * Serves a folder on a free local port, on 127.0.0.1 only.
 *
 * A file is served only when its real path, with every symlink followed, is inside the folder's real
 * path. A symlink in the build that points outside it, such as one to /proc/self/environ, is a 404.
 * So is a path that cannot be resolved. The story code in the page can fetch from this server, and the
 * process environment holds tokens in CI.
 */
export async function serve(directory) {
  const base = fs.realpathSync(path.resolve(directory));
  const inside = (real) => real === base || real.startsWith(`${base}${path.sep}`);

  /** The real path of the file to send for a URL path, or null. */
  async function resolveFile(pathname) {
    let real = await fs.promises.realpath(path.resolve(base, `.${pathname}`));
    if (!inside(real)) return null;
    if ((await fs.promises.stat(real)).isDirectory()) {
      real = await fs.promises.realpath(path.join(real, "index.html"));
      if (!inside(real)) return null;
    }
    return (await fs.promises.stat(real)).isFile() ? real : null;
  }

  const server = http.createServer(async (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405).end();
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(request.url.split("?")[0]);
    } catch {
      // A malformed percent sequence is a bad request, not a reason to stop the run.
      response.writeHead(400).end();
      return;
    }
    let file = null;
    try {
      file = await resolveFile(pathname);
    } catch {
      // A path that does not exist, or cannot be resolved, is not served.
    }
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    fs.readFile(file, (error, bytes) => {
      if (error) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" }).end(request.method === "HEAD" ? undefined : bytes);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, port: server.address().port };
}

/** The stories in a static build's index. */
export function readStoryIndex(directory) {
  for (const name of ["index.json", "stories.json"]) {
    const file = path.join(directory, name);
    if (!fs.existsSync(file)) continue;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const entries = Object.values(parsed.entries ?? parsed.stories ?? {});
    return entries.filter((entry) => !entry.type || entry.type === "story");
  }
  throw new Error(`${directory} has no index.json, so it is not a Storybook build.`);
}

const simple = (text) => String(text).toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The stories that belong to a component, in the index's order. A story belongs to it when the last
 * part of its title or the name of its stories file is the component's name.
 */
export function componentStories(entries, component) {
  const wanted = simple(component);
  return entries.filter((entry) => {
    const title = simple(String(entry.title ?? "").split("/").at(-1));
    const file = simple(path.basename(String(entry.importPath ?? "")).replace(/\.stories\.[a-z]+$/i, ""));
    return title === wanted || file === wanted;
  });
}

/** The story ids that belong to a component, best guess first for the story the axes are read from. */
export function storyCandidates(entries, component, override) {
  if (override) return [override];
  const mine = componentStories(entries, component);
  const first = /^(primary|default|playground|base)$/i;
  return [...mine.filter((e) => first.test(e.name)), ...mine.filter((e) => !first.test(e.name))].map((e) => e.id);
}

/**
 * A story's name as a value of the Story property. Figma reads a comma or an equals sign in a
 * variant's name as the end of a value and marks the variant broken (a probe in a scratch file,
 * 2026-10-21), so a comma becomes a semicolon and an equals sign a colon. Figma trims the value.
 */
export function storyValue(name) {
  const value = String(name).replace(/,/g, ";").replace(/=/g, ":").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return value === "" ? "Story" : value.slice(0, 100);
}

/**
 * The Story values of a component's stories, in their order, each one different. Two stories of one
 * component can have the same name when they come from two stories files, as Meridian's two
 * DropdownMenu files both have Default. Those are told apart by their titles.
 */
export function storyValues(entries) {
  const plain = entries.map((entry) => storyValue(entry.name));
  const titled = entries.map((entry, i) => (plain.filter((v) => v === plain[i]).length > 1 ? storyValue(`${entry.name} (${entry.title})`) : plain[i]));
  return titled.map((value, i) => (titled.indexOf(value) === i ? value : storyValue(`${value} ${entries[i].id}`)));
}

/**
 * Where a story's one variant sits among the axes, from the story's own args. An axis takes the
 * story's arg when it is one of the axis's values, and the axis's first value otherwise. The State
 * axis takes the first of its states whose arg the story sets to true.
 */
export function storyKey(axes, args) {
  return Object.fromEntries(
    axes.map((axis) => {
      if (axis.prop) {
        const value = args[axis.prop];
        const found = value === undefined || value === null ? undefined : axis.values.find((v) => String(v) === String(value));
        return [axis.name, found ?? axis.values[0]];
      }
      return [axis.name, axis.values.find((state) => state !== "default" && args[state] === true) ?? axis.values[0]];
    }),
  );
}

/** Where and how big a node is. Two reads of one story can differ in these by a fraction of a pixel. */
const GEOMETRY = ["x", "y", "w", "h"];

/**
 * True when two read trees draw the same, wherever each sits on its page. Every value must be equal,
 * except a node's place and size, which may differ by up to a pixel once both trees start at 0, 0:
 * React Flow's canvas zoom moves the boxes the reader measures between two loads of one story (two
 * reads of Meridian's AlignmentToolbar were 83.62 and 83.38 wide, 2026-10-21).
 */
export function sameDrawing(a, b) {
  const near = (p, q) => Math.abs(p - q) <= 1;
  const same = (p, q, origin) => {
    if (Array.isArray(p) || Array.isArray(q)) return Array.isArray(p) && Array.isArray(q) && p.length === q.length && p.every((v, i) => same(v, q[i], origin));
    if (p === null || q === null || typeof p !== "object" || typeof q !== "object") return p === q;
    const keys = Object.keys(p);
    if (keys.length !== Object.keys(q).length || keys.some((key) => !(key in q))) return false;
    // Only a drawn node, which has a kind, is placed on the page. A shadow's x and y are offsets.
    const placed = typeof p.kind === "string";
    return keys.every((key) => {
      if (placed && GEOMETRY.includes(key) && typeof p[key] === "number" && typeof q[key] === "number") {
        const shift = key === "x" ? origin[0] : key === "y" ? origin[1] : [0, 0];
        return near(p[key] - shift[0], q[key] - shift[1]);
      }
      return same(p[key], q[key], origin);
    });
  };
  return same(a, b, [[a.x ?? 0, b.x ?? 0], [a.y ?? 0, b.y ?? 0]]);
}

/** A story's args as the Storybook URL setting. Only simple values are allowed in a URL. */
export function argsParam(args) {
  return Object.entries(args)
    .map(([key, value]) => {
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) throw new Error(`"${key}" cannot be set from a story URL.`);
      if (typeof value === "boolean") return `${key}:!${value}`;
      // Storybook reads only these from a URL: letters, numbers, spaces, underscores and dashes, and decimal numbers.
      if (!/^([A-Za-z0-9 _-]*|-?\d+\.\d+)$/.test(String(value))) throw new Error(`The value "${value}" of ${key} cannot be set from a story URL.`);
      return `${key}:${String(value).replace(/ /g, "+")}`;
    })
    .join(";");
}

/** Every combination of the axes' values, first axis slowest. */
export function combinations(axes) {
  return axes.reduce((rows, axis) => rows.flatMap((row) => axis.values.map((value) => [...row, value])), [[]]);
}

/**
 * Opens a static Storybook build in a headless browser.
 * @param {{ root: string, directory: string, globals: string }} options
 */
export async function openStorybook({ root, directory, globals }) {
  const dir = path.resolve(root, directory);
  if (!fs.existsSync(path.join(dir, "iframe.html"))) {
    throw new Error(`${dir} is not a static Storybook build. Run "storybook build" first, or point outputs.figma.options.storybookDir at the build.`);
  }
  const entries = readStoryIndex(dir);
  const playwright = loadPlaywright(root);
  const { server, port } = await serve(dir);
  let browser;
  try {
    browser = await playwright.chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 });
    return {
      entries,
      page,
      async show(id, args = {}) {
        const query = [`id=${encodeURIComponent(id)}`, "viewMode=story"];
        if (globals) query.push(`globals=${encodeURIComponent(globals)}`);
        const parameter = argsParam(args);
        if (parameter) query.push(`args=${parameter}`);
        await page.goto(`http://127.0.0.1:${port}/iframe.html?${query.join("&")}`);
        // A story can put a <style> or <script> first in the root. waitForSelector would wait for
        // that first match to become visible, which never happens, so wait for any drawn child. A
        // dialog open from the start draws only in a portal on the body and leaves the root empty, so
        // a drawn element there that is not Storybook's own counts too (Meridian's
        // TaskFormDialogPresentation Open By Default timed out without it, 2026-10-21).
        await page.waitForFunction(
          (skip) => {
            if (document.body.classList.contains("sb-show-errordisplay")) return true;
            const drawn = (el) => !skip.includes(el.tagName) && el.getClientRects().length > 0;
            const root = document.querySelector("#storybook-root");
            if ([...(root?.children ?? [])].some(drawn)) return true;
            const storybooks = (el) => el === root || el.id.startsWith("storybook-") || [...el.classList].some((name) => name.startsWith("sb-"));
            return [...document.body.children].some((el) => !storybooks(el) && drawn(el));
          },
          NOT_DRAWN,
          { timeout: 30000 },
        );
        if (await page.evaluate(() => document.body.classList.contains("sb-show-errordisplay"))) {
          const message = await page.evaluate(() => document.querySelector(".sb-errordisplay")?.textContent?.slice(0, 300) ?? "");
          throw new Error(`The story ${id} failed to render: ${message.trim()}`);
        }
        await page.evaluate(() => document.fonts.ready);
        await settle(page);
      },
      async close() {
        try {
          await browser.close();
        } finally {
          server.close();
        }
      },
    };
  } catch (error) {
    try {
      await browser?.close();
    } finally {
      server.close();
    }
    throw error;
  }
}

/**
 * How much of a story the reader reads: every level and every element, up to a bound. A calendar
 * month draws about 120 elements eight levels down, and two months about 240. Past 600 the data
 * no longer fits one relay call next to the runtime, so a story that draws more is cut there with a
 * warning.
 */
export const READ = Object.freeze({ maxDepth: 40, maxNodes: 600 });

/** Turns transitions and animations off until the next page load, so an overlay opens at once. */
const FREEZE = "*,*::before,*::after{transition:none!important;animation:none!important}";

/** How long a story may take to stop changing after it draws: three still frames, within 1.5 seconds. */
const STILL = Object.freeze({ frames: 3, timeout: 1500 });

/**
 * Stops style sheet transitions and animations, as readStory does, and waits until nothing drawn
 * still moves or fades (waitForStill), so two loads of one story read the same.
 */
export async function settle(page) {
  await page.addStyleTag({ content: FREEZE });
  return page.evaluate(waitForStill, STILL);
}

/**
 * Opens a closed overlay the component drew, such as a popover, a select or a dialog, and marks the
 * component's parts for readStory (markComponent). A popup trigger is clicked and a tooltip's is
 * hovered. Returns a warning when a trigger did not open.
 */
export async function openComponent(page, name) {
  const { trigger: how } = await page.evaluate(markComponent);
  if (!how) return null;
  let warning = null;
  try {
    await page.addStyleTag({ content: FREEZE });
    const trigger = page.locator("[data-klaus-trigger]").first();
    if (how === "hover") await trigger.hover({ timeout: 5000 });
    else await trigger.click({ timeout: 5000 });
    // Open when the trigger says so. A trigger React drew again has lost its mark, so then any
    // element that says it is open will do.
    await page.waitForFunction(
      () => {
        const isOpen = (element) => element.getAttribute("aria-expanded") === "true" || /open/.test(element.dataset.state ?? "");
        const trigger = document.querySelector("[data-klaus-trigger]");
        return trigger ? isOpen(trigger) : [...document.querySelectorAll("[aria-expanded], [data-state]")].some(isOpen);
      },
      null,
      { timeout: 2000 },
    );
    // A pointer left on the trigger would draw its hover colours. A tooltip needs it there.
    if (how === "click") await page.mouse.move(0, 0);
    // An overlay moves focus into its content, which would draw a field focused and its text
    // selected. The component is drawn at rest.
    await page.evaluate(() => document.activeElement?.blur?.());
    // An overlay is placed in the frames after it opens, and can fade in from script.
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(waitForStill, STILL);
  } catch (error) {
    warning = `${name}: its trigger did not open (${String(error.message).split("\n")[0]}), so it is drawn closed.`;
  }
  // The open content is drawn now, so the parts are found again.
  await page.evaluate(markComponent);
  return warning;
}

/**
 * Reads one component: every combination of its variant props, drawn by one story, and one variant
 * for each of the component's other stories.
 *
 * The other stories are read at their own args, with no URL args, in the index's order. A story
 * that draws the same as a variant already read adds nothing, and one that fails to render is left
 * out. Both are listed in leftOut and named in a warning. The capture's stories are empty for a
 * component with one story, and then it is drawn with no Story property.
 *
 * @param {Awaited<ReturnType<typeof openStorybook>>} storybook
 * @param {object} request
 * @param {string} request.name        The component's name.
 * @param {Array<{ prop: string, name: string, values: Array<string | number> }>} request.axes
 * @param {string[]} request.states    "loading" and "disabled".
 * @param {string | false} request.label  Text for the label, or false to keep the story's own.
 * @param {boolean} request.icons
 * @param {string} [request.story]     A story id, when the automatic pick is wrong.
 */
export async function captureComponent(storybook, request) {
  const { page } = storybook;
  const { name, axes, states, label, icons } = request;
  const warnings = [];
  const base = label === false ? {} : { children: label };
  const allAxes = states.length > 0 ? [...axes, { prop: null, name: "State", values: ["default", ...states] }] : axes;
  const argsFor = (combination) => {
    const args = { ...base };
    allAxes.forEach((axis, i) => {
      const value = combination[i];
      if (axis.prop) args[axis.prop] = value;
      else if (value !== "default") args[value] = true;
    });
    return args;
  };

  const candidates = storyCandidates(storybook.entries, name, request.story);
  if (candidates.length === 0) throw new Error(`No story found for ${name}. Write a story, or name its id in outputs.figma.options.stories.`);

  const combos = combinations(allAxes);
  // Pick the first story whose args change what is drawn. A story with a fixed render ignores them.
  // The args tried are the first axis with two values, which may be the State axis for a component with no variant props.
  const checked = allAxes.findIndex((axis) => axis.values.length > 1);
  let story = null;
  let failures = 0;
  let lastError = "";
  for (const id of candidates) {
    if (checked < 0) {
      story = id;
      break;
    }
    const probe = async (value) => {
      const combination = combos[0].slice();
      combination[checked] = value;
      await storybook.show(id, argsFor(combination));
      // The whole drawn markup, not only the outer element: a story decorator often wraps the
      // component in a box that looks the same whatever the args. Ids are left out, because a
      // generated id may differ between two loads of the same story.
      return page.evaluate((skip) => {
        const drawn = [...(document.querySelector("#storybook-root")?.children ?? [])].filter((el) => !skip.includes(el.tagName));
        return drawn.map((el) => el.outerHTML.replace(/\s(?:id|for|aria-[a-z]+)="[^"]*"/g, "")).join("");
      }, NOT_DRAWN);
    };
    try {
      const [a, b] = [await probe(allAxes[checked].values[0]), await probe(allAxes[checked].values[1])];
      if (a !== "" && a !== b) {
        story = id;
        break;
      }
    } catch (error) {
      failures += 1;
      lastError = error.message;
      warnings.push(`Story ${id} was skipped: ${error.message}`);
    }
  }
  if (!story) {
    if (failures === candidates.length) {
      throw new Error(`None of the stories for ${name} (${candidates.join(", ")}) could not be rendered. The last error: ${lastError}`);
    }
    const prop = allAxes[checked].prop ?? allAxes[checked].values[1];
    throw new Error(`None of the stories for ${name} (${candidates.join(", ")}) change when ${prop} is set from the URL. Add a story that renders from its args, or name one in outputs.figma.options.stories.`);
  }

  await storybook.show(story, argsFor(combos[0]));
  const propertyNames = await page.evaluate(listCustomProperties);
  // The story's own args. The label replaces text children only: children given as markup, such as
  // a sidebar's menu, stay. An overlay opens from its open arg when the component takes one.
  const facts = await page.evaluate(storyFacts);
  if (facts.childrenIsMarkup) delete base.children;
  const openArg = ["defaultOpen", "open"].find((arg) => facts.args.some((a) => a.name === arg && (a.type === null || a.type === "boolean")));
  if (openArg) base[openArg] = true;

  const cells = [];
  let tokens = [];
  const classLists = [];
  const openWarnings = new Set();
  let truncated = false;
  for (const combination of combos) {
    await storybook.show(story, argsFor(combination));
    const opened = await openComponent(page, name);
    if (opened) openWarnings.add(opened);
    const read = await page.evaluate(readStory, { candidates: propertyNames, withTokens: cells.length === 0, ...READ });
    if (read.error) throw new Error(`${name}: ${read.error}`);
    if (read.tokens) tokens = read.tokens;
    truncated ||= read.truncated;
    classLists.push(read.classes);
    cells.push({ key: Object.fromEntries(allAxes.map((axis, i) => [axis.name, combination[i]])), tree: read.tree });
  }
  if (truncated) {
    warnings.push(`${name} draws more than ${READ.maxNodes} elements or ${READ.maxDepth} levels, so the reader stopped there and the drawing is cut short.`);
  }

  let icon = null;
  let spinner = null;
  if (icons) {
    const signature = classLists[0].filter((c) => classLists.every((list) => list.includes(c)));
    for (const entry of storybook.entries.filter((e) => candidates.includes(e.id) && e.id !== story)) {
      try {
        await storybook.show(entry.id);
        for (const found of await page.evaluate(findIcons, { signature })) {
          if (found.loading) spinner ??= found;
          else icon ??= found;
        }
      } catch (error) {
        warnings.push(`Story ${entry.id} was not searched for icons: ${error.message}`);
      }
    }
    if (!icon) warnings.push(`${name}: no story draws an icon inside it, so no icon layer was made.`);
  }

  // The component's other stories, one variant each.
  const own = componentStories(storybook.entries, name);
  const first = storybook.entries.find((entry) => entry.id === story) ?? { id: story, name: story, title: "" };
  const others = own.filter((entry) => entry.id !== story);
  const stories = [];
  const leftOut = [];
  if (others.length > 0 && allAxes.some((axis) => axis.name === STORY)) {
    warnings.push(`${name}: a variant prop is already named ${STORY}, so its other stories are not drawn.`);
  } else if (others.length > 0) {
    const values = storyValues([first, ...others]);
    for (const [i, entry] of others.entries()) {
      try {
        await storybook.show(entry.id);
        const opened = await openComponent(page, `${name}, story ${entry.name}`);
        if (opened) openWarnings.add(opened);
        const { initialArgs } = await page.evaluate(storyFacts);
        const read = await page.evaluate(readStory, { candidates: propertyNames, withTokens: false, ...READ });
        if (read.error) throw new Error(read.error);
        if (read.truncated) {
          warnings.push(`${name} draws more than ${READ.maxNodes} elements or ${READ.maxDepth} levels in its story ${entry.name}, so the reader stopped there and that variant is cut short.`);
        }
        if ([...cells, ...stories].some((cell) => sameDrawing(cell.tree, read.tree))) {
          leftOut.push({ id: entry.id, name: entry.name, reason: "same" });
          warnings.push(`${name}: the story ${entry.name} draws the same as a variant already in the set, so it adds none.`);
          continue;
        }
        stories.push({ id: entry.id, name: entry.name, value: values[i + 1], key: storyKey(allAxes, initialArgs), tree: read.tree });
      } catch (error) {
        leftOut.push({ id: entry.id, name: entry.name, reason: "failed" });
        warnings.push(`Story ${entry.id} was skipped: ${error.message}`);
      }
    }
  }
  warnings.push(...openWarnings);
  return { component: name, story, storyValue: storyValues([first, ...others])[0], axes: allAxes, tokens, cells, stories, leftOut, icon, spinner, warnings };
}

/**
 * Reads one screen of a running app as a tree of boxes, text and icons.
 *
 * @param {{ root: string, url: string, storageState?: string }} options
 */
export async function captureScreen({ root, url, storageState }) {
  const playwright = loadPlaywright(root);
  const browser = await playwright.chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      ...(storageState ? { storageState: path.resolve(root, storageState) } : {}),
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    const read = await page.evaluate(readStory, { candidates: [], withTokens: false, maxDepth: 12, maxNodes: 1500, rootSelector: "body", useHost: true, bind: false });
    if (read.error) throw new Error(read.error);
    const size = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
    return { tree: read.tree, size };
  } finally {
    await browser.close();
  }
}
