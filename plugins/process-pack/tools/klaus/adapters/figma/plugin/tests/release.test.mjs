/** A release is the manifest and its data files, read with the generator's own reader. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { DataError, readData } from "../../data-file.mjs";
import { buttonCapture } from "../../tests/helpers.mjs";
import { loadRelease, ReleaseError } from "../src/release.mjs";
import { buttonCapture30, generate, sourcesOf } from "./helpers.mjs";

const copy = (value) => JSON.parse(JSON.stringify(value));
const refused = (sources, pattern, type = ReleaseError) => assert.throws(() => loadRelease(sources), (error) => error instanceof type && pattern.test(error.message));

/** Two components in one data file each, which share most of their tokens. */
async function twoFiles() {
  return generate({
    components: [
      { name: "Button", version: "1.0.0", capture: buttonCapture() },
      { name: "Card", version: "2.1.0", capture: buttonCapture() },
    ],
    options: { icons: true },
  });
}

test("a release from the real generator is read, with a summary for the window", async () => {
  const files = await generate({ components: [{ name: "Button", version: "1.1.0", capture: buttonCapture30() }], release: "v1.1.0", options: { icons: true } });
  const release = loadRelease(sourcesOf(files));

  assert.equal(release.summary.release, "v1.1.0");
  assert.equal(release.summary.fileKey, "zSRhsvwtutOIPvHyWF9Wf2");
  assert.equal(release.summary.collection, "Tokens");
  assert.deepEqual(release.summary.pages, ["Button", "Older versions"]);
  assert.deepEqual(release.summary.units, [{ id: "Button", kind: "component", label: "Button 1.1.0", variants: 30 }]);
  assert.deepEqual(release.summary.notApplied, { screenshots: 0, retention: false });
  assert.deepEqual(release.config, { collection: "Tokens", mode: "Light" });
});

test("files inside a folder are found by the manifest that sits with them", async () => {
  const files = await generate();
  const release = loadRelease(sourcesOf(files, ".klaus/figma/v1.0.0/"));
  assert.equal(release.units.length, 1);
});

test("the data goes through the same reader the relay uses, so a refusal reads the same", async () => {
  const files = await generate();
  const bad = copy(JSON.parse(files["figma-001.json"]));
  bad.units[0].kind = "plugin";
  const text = JSON.stringify(bad);
  let relay;
  assert.throws(() => readData(text, "figma-001.json"), (error) => ((relay = error.message), error instanceof DataError));
  refused(sourcesOf({ ...files, "figma-001.json": text }), new RegExp(relay.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), DataError);
});

test("a data file that is code, not JSON, is refused and nothing in it runs", async () => {
  const files = await generate();
  refused(sourcesOf({ ...files, "figma-001.json": "figma.currentPage.remove();" }), /figma-001\.json is not JSON/, DataError);
  refused(sourcesOf({ ...files, "figma-001.json": JSON.stringify({ version: 1, header: "x", config: {}, tokens: [], units: [], onload: "figma.closePlugin()" }) }), /does not write: "onload"/, DataError);
});

test("a data file with a key, a kind or a value the generator does not write is refused", async () => {
  const files = await generate();
  const base = JSON.parse(files["figma-001.json"]);
  const changes = [
    [(d) => { d.script = "x"; }, /has a key the generator does not write: "script"/],
    [(d) => { d.header = "a\nfigma.closePlugin();"; }, /header must be one line of printable ASCII/],
    [(d) => { d.units[0].version = "1.0.0; figma.closePlugin()"; }, /version must be a version/],
    [(d) => { d.units[0].nodes[0].k = "script"; }, /nodes\[0\]\.k must be one of/],
    [(d) => { d.units[0].svgs = ["<script>alert(1)</script>"]; }, /must be SVG markup/],
    [(d) => { d.version = 2; }, /is version 2, not 1/],
  ];
  for (const [change, pattern] of changes) {
    const data = copy(base);
    change(data);
    refused(sourcesOf({ ...files, "figma-001.json": JSON.stringify(data) }), pattern, DataError);
  }
});

test("no manifest, two releases, or a manifest that is not the generator's are refused", async () => {
  const files = await generate();
  const { "manifest.json": manifest, ...onlyData } = files;
  refused(sourcesOf(onlyData), /There is no manifest\.json/);
  refused([...sourcesOf(files, "a/"), ...sourcesOf(files, "b/")], /hold 2 releases \(v1\.0\.0, v1\.0\.0\)\. Add one release at a time/);
  refused(sourcesOf({ ...files, "manifest.json": "not json" }), /manifest\.json is not JSON/);
  refused(sourcesOf({ ...files, "manifest.json": JSON.stringify({ output: "storybook" }) }), /not one the Figma generator wrote/);
  refused(sourcesOf({ ...files, "manifest.json": JSON.stringify({ output: "figma", files: [] }) }), /lists no data files/);
  refused(sourcesOf({ ...files, "manifest.json": JSON.stringify({ output: "figma", files: [{ name: "evil.js", units: ["Button"] }] }) }), /lists a data file the generator does not write/);
  refused(sourcesOf({ ...files, "manifest.json": JSON.stringify({ output: "figma", files: [{ name: "../figma-001.json", units: ["Button"] }] }) }), /lists a data file the generator does not write/);
  refused("nonsense", /There is no manifest\.json/);
  refused([{ path: "manifest.json", text: 5 }], /files the plugin cannot read/);
});

test("a data file the manifest lists but is missing, and one that holds other units, are refused", async () => {
  const files = await generate();
  const manifest = JSON.parse(files["manifest.json"]);
  const { "figma-001.json": _gone, ...without } = files;
  refused(sourcesOf(without), /manifest\.json lists figma-001\.json, but it is not here/);

  manifest.files[0].units = ["Card"];
  refused(sourcesOf({ ...files, "manifest.json": JSON.stringify(manifest) }), /figma-001\.json holds Button, but manifest\.json lists Card/);
});

test("files are applied in the manifest's order, and their tokens are joined into one list", async () => {
  const files = await twoFiles();
  assert.deepEqual(Object.keys(files).toSorted(), ["figma-001.json", "figma-002.json", "manifest.json"]);
  const first = JSON.parse(files["figma-001.json"]);
  const second = JSON.parse(files["figma-002.json"]);
  const release = loadRelease(sourcesOf(files));

  assert.deepEqual(release.units.map((u) => u.id), ["Button", "Card"]);
  const names = release.tokens.map((t) => t.name);
  assert.equal(new Set(names).size, names.length, "a token shared by both files is listed once");
  assert.equal(names.length, new Set([...first.tokens, ...second.tokens].map((t) => t.name)).size);
  // Every unit's tk points at the same token it pointed at in its own file.
  [first, second].forEach((file, f) => {
    release.units.filter((u) => u.id === file.units[0].id).forEach((unit) => {
      assert.deepEqual(unit.tk.map((i) => release.tokens[i].name), file.units[0].tk.map((i) => file.tokens[i].name), `file ${f + 1}`);
    });
  });
});

test("joining takes a token's scopes from every file that uses it", async () => {
  const files = await twoFiles();
  const first = JSON.parse(files["figma-001.json"]);
  const second = JSON.parse(files["figma-002.json"]);
  const shared = first.tokens[0].name;
  first.tokens[0].scopes = ["FRAME_FILL"];
  second.tokens.find((t) => t.name === shared).scopes = ["TEXT_FILL"];
  const release = loadRelease(sourcesOf({ ...files, "figma-001.json": JSON.stringify(first), "figma-002.json": JSON.stringify(second) }));
  assert.deepEqual(release.tokens.find((t) => t.name === shared).scopes.toSorted(), ["FRAME_FILL", "TEXT_FILL"]);
});

test("files that disagree about the collection, a token's colour, or a unit's id are refused", async () => {
  const files = await twoFiles();
  const edit = (change) => {
    const out = copy(files);
    const parsed = { "figma-001.json": JSON.parse(out["figma-001.json"]), "figma-002.json": JSON.parse(out["figma-002.json"]) };
    change(parsed);
    return sourcesOf({ ...files, "figma-001.json": JSON.stringify(parsed["figma-001.json"]), "figma-002.json": JSON.stringify(parsed["figma-002.json"]) });
  };
  refused(edit((d) => { d["figma-002.json"].config.collection = "Other"; }), /figma-002\.json writes to the variable collection "Other", but figma-001\.json writes to "Tokens"/);
  refused(edit((d) => { d["figma-002.json"].tokens[0].rgba = [1, 2, 3, 1]; }), /gives the token .* another colour or code syntax/);
  refused(
    edit((d) => {
      d["figma-002.json"].units[0].id = "Button";
    }),
    /manifest\.json lists Card/,
  );
});

test("a repeated unit id across files is refused even when the manifest agrees", async () => {
  const files = await twoFiles();
  const second = JSON.parse(files["figma-002.json"]);
  second.units[0].id = "Button";
  const manifest = JSON.parse(files["manifest.json"]);
  manifest.files[1].units = ["Button"];
  refused(sourcesOf({ ...files, "figma-002.json": JSON.stringify(second), "manifest.json": JSON.stringify(manifest) }), /figma-002\.json repeats the unit Button/);
});

test("the rules that do not need settings still hold: reserved pages, and where earlier versions go", async () => {
  const files = await generate();
  const edit = (change) => {
    const data = JSON.parse(files["figma-001.json"]);
    change(data);
    return sourcesOf({ ...files, "figma-001.json": JSON.stringify(data) });
  };
  refused(edit((d) => { d.units[0].page = "Screens"; }), /cannot be drawn on the "Screens" page/, DataError);
  refused(edit((d) => { d.units[0].older = "Archive"; }), /moves earlier versions to "Archive", not "Older versions"/, DataError);
  refused(edit((d) => { d.config.mode = "Dark"; }), /\(Dark\), but the settings name "Tokens" \(Light\)/, DataError);
});

test("one page for every component is accepted when they all share it", async () => {
  const files = await generate({ components: [{ name: "Button", version: "1.0.0", capture: buttonCapture() }, { name: "Card", version: "1.0.0", capture: buttonCapture() }], options: { page: "Components" } });
  const release = loadRelease(sourcesOf(files));
  assert.deepEqual(release.summary.pages, ["Components", "Older versions"]);
});

test("a release that mixes page settings is refused", async () => {
  const files = await twoFiles();
  const second = JSON.parse(files["figma-002.json"]);
  second.units[0].page = "Somewhere else";
  refused(sourcesOf({ ...files, "figma-002.json": JSON.stringify(second) }), /writes to the page "Somewhere else", but the settings put it on "Button"/, DataError);
});

test("screenshots and the retention file are counted as not applied", async () => {
  const files = await generate();
  const manifest = JSON.parse(files["manifest.json"]);
  manifest.uploads = [{ id: "screen:/a" }, { id: "screen:/b" }];
  manifest.afterUploads = { name: "figma-retention.json", chars: 100 };
  const release = loadRelease(sourcesOf({ ...files, "manifest.json": JSON.stringify(manifest) }));
  assert.deepEqual(release.summary.notApplied, { screenshots: 2, retention: true });
});
