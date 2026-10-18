/** The version index page and versions.json. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { latestPerRelease, renderIndex } from "./index-page.mjs";

const at = (day) => Date.UTC(2026, 9, day);

test("keeps the newest deployment of each release, newest release first", () => {
  const releases = latestPerRelease([
    { release: "v1.0.0", alias: "a-v1-0-0.vercel.app", commit: "old", createdAt: at(1) },
    { release: "v1.1.0", alias: "a-v1-1-0.vercel.app", commit: "c11", createdAt: at(8) },
    { release: "v1.0.0", alias: "a-v1-0-0.vercel.app", commit: "redeployed", createdAt: at(10) },
  ]);
  assert.deepEqual(releases.map((r) => [r.release, r.commit]), [["v1.0.0", "redeployed"], ["v1.1.0", "c11"]]);
});

test("links every release by its address and lists the latest first", () => {
  const files = renderIndex({
    project: "acme-storybook",
    releases: [
      { release: "v1.1.0", alias: "acme-storybook-v1-1-0.vercel.app", commit: "1234567890", createdAt: at(8) },
      { release: "v1.0.0", alias: "acme-storybook-v1-0-0.vercel.app", commit: null, createdAt: at(1) },
    ],
  });
  const html = files["index.html"];
  assert.ok(html.includes('<a href="https://acme-storybook-v1-1-0.vercel.app/">v1.1.0</a>'));
  assert.ok(html.includes('<a href="https://acme-storybook-v1-0-0.vercel.app/">v1.0.0</a>'));
  assert.ok(html.indexOf("v1.1.0") < html.indexOf("v1.0.0"));
  assert.ok(html.includes("<code>1234567</code>"));
  assert.ok(html.includes("2026-10-08"));

  const versions = JSON.parse(files["versions.json"]);
  assert.equal(versions.schemaVersion, 1);
  assert.deepEqual(versions.releases.map((r) => r.url), ["https://acme-storybook-v1-1-0.vercel.app/", "https://acme-storybook-v1-0-0.vercel.app/"]);
});

test("falls back to the computed address when a deployment has none recorded, and escapes the text it prints", () => {
  const files = renderIndex({ project: "a<b>", releases: [{ release: 'v"1"', alias: null, commit: null, createdAt: at(1) }] });
  assert.ok(files["index.html"].includes("https://a-b-v-1.vercel.app/"));
  assert.ok(files["index.html"].includes("a&lt;b&gt; Storybook releases"));
  assert.ok(files["index.html"].includes("v&quot;1&quot;"));
  assert.ok(!files["index.html"].includes('v"1"'));
});

test("an index with no releases says so", () => {
  const files = renderIndex({ project: "acme-storybook", releases: [] });
  assert.ok(files["index.html"].includes("No releases yet."));
  assert.deepEqual(JSON.parse(files["versions.json"]).releases, []);
});
