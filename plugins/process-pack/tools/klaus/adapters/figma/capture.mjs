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
import { findIcons, listCustomProperties, markComponent, readStory, storyFacts } from "./capture-browser.mjs";

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
 * The story ids that belong to a component, best guess first. A story belongs to it when the last
 * part of its title or the name of its stories file is the component's name.
 */
export function storyCandidates(entries, component, override) {
  if (override) return [override];
  const wanted = simple(component);
  const mine = entries.filter((entry) => {
    const title = simple(String(entry.title ?? "").split("/").at(-1));
    const file = simple(path.basename(String(entry.importPath ?? "")).replace(/\.stories\.[a-z]+$/i, ""));
    return title === wanted || file === wanted;
  });
  const first = /^(primary|default|playground|base)$/i;
  return [...mine.filter((e) => first.test(e.name)), ...mine.filter((e) => !first.test(e.name))].map((e) => e.id);
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
        // that first match to become visible, which never happens, so wait for any drawn child.
        await page.waitForFunction(
          (skip) => {
            if (document.body.classList.contains("sb-show-errordisplay")) return true;
            const root = document.querySelector("#storybook-root");
            return [...(root?.children ?? [])].some((el) => !skip.includes(el.tagName) && el.getClientRects().length > 0);
          },
          NOT_DRAWN,
          { timeout: 30000 },
        );
        if (await page.evaluate(() => document.body.classList.contains("sb-show-errordisplay"))) {
          const message = await page.evaluate(() => document.querySelector(".sb-errordisplay")?.textContent?.slice(0, 300) ?? "");
          throw new Error(`The story ${id} failed to render: ${message.trim()}`);
        }
        await page.evaluate(() => document.fonts.ready);
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
    // An overlay is placed in the frames after it opens.
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    await page.evaluate(() => document.fonts.ready);
  } catch (error) {
    warning = `${name}: its trigger did not open (${String(error.message).split("\n")[0]}), so it is drawn closed.`;
  }
  // The open content is drawn now, so the parts are found again.
  await page.evaluate(markComponent);
  return warning;
}

/**
 * Reads one component: every combination of its variant props, drawn by one story.
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
  warnings.push(...openWarnings);
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
  return { component: name, story, axes: allAxes, tokens, cells, icon, spinner, warnings };
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
