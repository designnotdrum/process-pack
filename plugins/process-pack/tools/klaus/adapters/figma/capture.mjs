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
import { findIcons, listCustomProperties, readStory } from "./capture-browser.mjs";

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

/** Serves a folder on a free local port. Only paths inside the folder are served. */
export async function serve(directory) {
  const base = path.resolve(directory);
  const server = http.createServer((request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405).end();
      return;
    }
    let requested;
    try {
      requested = path.resolve(base, `.${decodeURIComponent(request.url.split("?")[0])}`);
    } catch {
      // A malformed percent sequence is a bad request, not a reason to stop the run.
      response.writeHead(400).end();
      return;
    }
    if (requested !== base && !requested.startsWith(`${base}${path.sep}`)) {
      response.writeHead(403).end();
      return;
    }
    const file = fs.existsSync(requested) && fs.statSync(requested).isDirectory() ? path.join(requested, "index.html") : requested;
    fs.readFile(file, (error, bytes) => {
      if (error) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" }).end(bytes);
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
        await page.waitForSelector("#storybook-root > *, .sb-show-errordisplay", { timeout: 30000 });
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

const READ = { maxDepth: 3, maxNodes: 60 };

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
  for (const id of candidates) {
    if (checked < 0) {
      story = id;
      break;
    }
    const probe = async (value) => {
      const combination = combos[0].slice();
      combination[checked] = value;
      await storybook.show(id, argsFor(combination));
      return page.evaluate(() => {
        const element = document.querySelector("#storybook-root")?.firstElementChild;
        return element ? `${element.className}|${getComputedStyle(element).backgroundColor}|${element.getBoundingClientRect().width}` : "";
      });
    };
    try {
      const [a, b] = [await probe(allAxes[checked].values[0]), await probe(allAxes[checked].values[1])];
      if (a !== "" && a !== b) {
        story = id;
        break;
      }
    } catch (error) {
      warnings.push(`Story ${id} was skipped: ${error.message}`);
    }
  }
  if (!story) {
    const prop = allAxes[checked].prop ?? allAxes[checked].values[1];
    throw new Error(`None of the stories for ${name} (${candidates.join(", ")}) change when ${prop} is set from the URL. Add a story that renders from its args, or name one in outputs.figma.options.stories.`);
  }

  await storybook.show(story, argsFor(combos[0]));
  const propertyNames = await page.evaluate(listCustomProperties);

  const cells = [];
  let tokens = [];
  const classLists = [];
  for (const combination of combos) {
    await storybook.show(story, argsFor(combination));
    const read = await page.evaluate(readStory, { candidates: propertyNames, withTokens: cells.length === 0, ...READ });
    if (read.error) throw new Error(`${name}: ${read.error}`);
    if (read.tokens) tokens = read.tokens;
    classLists.push(read.classes);
    cells.push({ key: Object.fromEntries(allAxes.map((axis, i) => [axis.name, combination[i]])), tree: read.tree });
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
