/** Screens: how many versions stay, the upload list, and which routes are written. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { screenFrameName, screenRoutes, screenSlug, uploadFor } from "../screens.mjs";
import { runCode } from "./fake-figma.mjs";
import { codeFor, newFigma, run, screenUnit } from "./helpers.mjs";

const frames = (page, route) => page.children.filter((n) => n.name.startsWith(`${route} `)).map((n) => n.name);

test("an editable screen keeps its last 20 versions and drops the oldest", async () => {
  const figma = newFigma();
  for (let release = 1; release <= 23; release++) await run(figma, [screenUnit("/settings", `v${release}`)]);

  const kept = frames(figma.page("Screens"), "/settings");
  assert.equal(kept.length, 20);
  assert.equal(kept[0], "/settings v4");
  assert.equal(kept.at(-1), "/settings v23");
});

test("the number of versions kept is a setting", async () => {
  const figma = newFigma();
  for (let release = 1; release <= 6; release++) await run(figma, [screenUnit("/settings", `v${release}`, { keep: 3 })]);
  assert.deepEqual(frames(figma.page("Screens"), "/settings"), ["/settings v4", "/settings v5", "/settings v6"]);
});

test("retention is counted for each screen on its own", async () => {
  const figma = newFigma();
  for (let release = 1; release <= 5; release++) await run(figma, [screenUnit("/home", `v${release}`, { keep: 2 })]);
  for (let release = 1; release <= 2; release++) await run(figma, [screenUnit("/billing", `v${release}`, { keep: 2 })]);
  await run(figma, [screenUnit("/billing", "v3", { keep: 2 })]);

  assert.deepEqual(frames(figma.page("Screens"), "/home"), ["/home v4", "/home v5"]);
  assert.deepEqual(frames(figma.page("Screens"), "/billing"), ["/billing v2", "/billing v3"]);
});

test("a screen whose name starts like another is not trimmed with it", async () => {
  const figma = newFigma();
  for (let release = 1; release <= 4; release++) await run(figma, [screenUnit("/a", `v${release}`, { keep: 2 })]);
  for (let release = 1; release <= 3; release++) await run(figma, [screenUnit("/a/b", `v${release}`, { keep: 2 })]);
  assert.deepEqual(frames(figma.page("Screens"), "/a"), ["/a v3", "/a v4"]);
  assert.deepEqual(frames(figma.page("Screens"), "/a/b"), ["/a/b v2", "/a/b v3"]);
});

test("the same release is not written twice", async () => {
  const figma = newFigma();
  await run(figma, [screenUnit("/home", "v1")]);
  const again = await run(figma, [screenUnit("/home", "v1")]);
  assert.equal(again.units[0].status, "exists");
  assert.deepEqual(frames(figma.page("Screens"), "/home"), ["/home v1"]);
});

test("the retention step trims image screens after the relay has uploaded them", async () => {
  const figma = newFigma(["Screens"]);
  const page = figma.page("Screens");
  // The relay has uploaded 25 versions of /a and 3 of /b as frames named like Klaus asks.
  for (let release = 1; release <= 25; release++) {
    const frame = figma.createFrame();
    frame.name = screenFrameName("/a", `v${release}`);
    page.appendChild(frame);
  }
  for (let release = 1; release <= 3; release++) {
    const frame = figma.createFrame();
    frame.name = screenFrameName("/b", `v${release}`);
    page.appendChild(frame);
  }
  const retention = { kind: "retain", id: "retain-screens", page: "Screens", keep: 20, routes: ["/a", "/b"], tokens: [] };

  const result = await runCode(codeFor([retention]), figma);

  assert.deepEqual(result.units[0].removed, ["/a v1", "/a v2", "/a v3", "/a v4", "/a v5"]);
  assert.equal(frames(page, "/a").length, 20);
  assert.equal(frames(page, "/a")[0], "/a v6");
  assert.equal(frames(page, "/b").length, 3);
});

test("routes come from the selection: none, listed or all", () => {
  const inventory = {
    entries: [
      { name: "Nav", kind: "app", usedIn: ["/", "/projects", "/projects (layout)"] },
      { name: "Header", kind: "local", route: "/projects", usedIn: ["/projects"] },
      { name: "Row", kind: "local", route: "/projects/[id]", usedIn: ["/projects/[id]"] },
      { name: "Button", kind: "shared", usedIn: ["apps/web/app/page.tsx"] },
    ],
  };
  assert.deepEqual(screenRoutes({ mode: "none", routes: ["/x"] }, inventory), []);
  assert.deepEqual(screenRoutes({ mode: "listed", routes: ["/settings", "/"] }, inventory), ["/", "/settings"]);
  assert.deepEqual(screenRoutes({ mode: "all", routes: ["/settings"] }, inventory), ["/", "/projects", "/settings"]);
  assert.deepEqual(screenRoutes(undefined, inventory), []);
});

test("a screen's image is named after the route", () => {
  assert.equal(screenSlug("/"), "home");
  assert.equal(screenSlug("/settings"), "settings");
  assert.equal(screenSlug("/settings/billing/"), "settings-billing");
});

test("the upload list names the image, the page and the frame the relay creates", () => {
  const root = mkdtempSync(path.join(tmpdir(), "klaus-screens-"));
  mkdirSync(path.join(root, ".klaus/screens"), { recursive: true });
  writeFileSync(path.join(root, ".klaus/screens/settings.png"), Buffer.alloc(120));

  const found = uploadFor({ root, directory: ".klaus/screens", route: "/settings", release: "v1.4.0", page: "Screens" });
  assert.deepEqual(found.upload, {
    id: "screen:/settings",
    screen: "/settings",
    release: "v1.4.0",
    image: ".klaus/screens/settings.png",
    bytes: 120,
    page: "Screens",
    frame: "/settings v1.4.0",
  });

  const missing = uploadFor({ root, directory: ".klaus/screens", route: "/billing", release: "v1.4.0", page: "Screens" });
  assert.match(missing.error, /No screenshot of \/billing at \.klaus\/screens\/billing\.png/);
});
