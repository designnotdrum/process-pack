/**
 * Screens: which routes to write, and the image upload list.
 *
 * By default a screen is a screenshot that Dieter has already taken, uploaded
 * as an image. This file only lists the uploads. The relay sends them and then
 * runs the retention code, which keeps the last N versions of each screen.
 * Editable screens are the opt-in alternative and are built from the page's
 * computed styles, in spec.mjs.
 */
import fs from "node:fs";
import path from "node:path";

/** "/settings/billing" becomes "settings-billing" and "/" becomes "home". */
export function screenSlug(route) {
  const slug = route.replace(/^\/+|\/+$/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug === "" ? "home" : slug;
}

/** The name of a screen's frame in the file. The last word is the release, which retention relies on. */
export function screenFrameName(route, release) {
  return `${route} ${release}`;
}

/**
 * The routes to write. Routes with a dynamic part cannot be opened without data, so they are left out.
 *
 * @param {{ mode?: string, routes?: string[] }} screens  The config's selection.screens.
 * @param {{ entries?: Array<{ kind?: string, route?: string, usedIn?: string[] }> }} inventory
 */
export function screenRoutes(screens, inventory) {
  const mode = screens?.mode ?? "none";
  if (mode === "none") return [];
  let routes = screens.routes ?? [];
  if (mode === "all") {
    const found = new Set(routes);
    for (const entry of inventory?.entries ?? []) {
      if (entry.route) found.add(entry.route);
      if (entry.kind === "app" || entry.kind === "local") {
        for (const label of entry.usedIn ?? []) if (/^\/\S*$/.test(label)) found.add(label);
      }
    }
    routes = [...found];
  }
  return [...new Set(routes)].filter((route) => !route.includes("[")).sort();
}

/**
 * The upload list entry for a screen, or an error when Dieter has not left its screenshot.
 *
 * @returns {{ upload: object } | { error: string }}
 */
export function uploadFor({ root, directory, route, release, page }) {
  const file = path.join(directory, `${screenSlug(route)}.png`);
  const absolute = path.resolve(root, file);
  if (!fs.existsSync(absolute)) {
    return { error: `No screenshot of ${route} at ${file}. Dieter leaves one per screen before the run.` };
  }
  return {
    upload: {
      id: `screen:${route}`,
      screen: route,
      release,
      image: file.split(path.sep).join("/"),
      bytes: fs.statSync(absolute).size,
      page,
      frame: screenFrameName(route, release),
    },
  };
}
