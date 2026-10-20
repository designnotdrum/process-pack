/**
 * The relay and the KLAUS_FIGMA_LEDGER variable: what every relay machine and CI read to agree on
 * what reached Figma. The stub gh keeps the variable in a file, so no test reads or writes a real one.
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { generatedRepo, KEY, ledgerOf, outputOf, reconcileRepo, relay, ROOMY } from "./helpers.mjs";

const NAME = "KLAUS_FIGMA_LEDGER";
/** A shared record as the relay writes it. */
const record = (components, { fileKey = KEY, screens = {} } = {}) => JSON.stringify({ version: 2, fileKey, components, screens });
const getCalls = (run) => run.gh.filter((call) => call[0] === "variable" && call[1] === "get");
const setCalls = (run) => run.gh.filter((call) => call[0] === "variable" && call[1] === "set");
const warningsOf = (run) => outputOf(run.report).warnings;
const sharedOf = (run) => outputOf(run.report).adapter.details.sharedLedger;

test("after a send the relay publishes its sent marks to the variable, with gh variable set", async () => {
  const { root, folder } = await generatedRepo();
  const run = await relay(root, [folder]);

  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(getCalls(run), [["variable", "get", NAME]], "the variable is read on start");
  assert.equal(setCalls(run).length, 1, "and written once at the end");
  assert.deepEqual(setCalls(run)[0].slice(0, 4), ["variable", "set", NAME, "--body"]);
  assert.deepEqual(JSON.parse(run.variable), { version: 2, fileKey: KEY, components: { Button: { "1.0.0": "sent" }, Card: { "1.0.0": "sent" } }, screens: {} });
  assert.ok(warningsOf(run).some((w) => /KLAUS_FIGMA_LEDGER is not set/.test(w)), "a missing variable is a warning");
  assert.equal(sharedOf(run).read, "absent");
  assert.equal(sharedOf(run).published, true);
  assert.equal(sharedOf(run).bytes, Buffer.byteLength(run.variable));
});

test("a unit the variable marks sent is not sent again, and the variable's marks are kept when it is written back", async () => {
  const { root, folder } = await generatedRepo();
  const other = { Button: { "1.0.0": "sent" }, Dialog: { "2.0.0": "sent" } };
  const run = await relay(root, [folder], { variable: record(other) });

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.calls.length, 1, "only Card is sent: another machine sent Button");
  const units = outputOf(run.report).adapter.details.units.map((u) => [u.id, u.status]);
  assert.deepEqual(units, [["Button", "already sent"], ["Card", "sent"]]);
  assert.deepEqual(JSON.parse(run.variable).components, { Button: { "1.0.0": "sent" }, Card: { "1.0.0": "sent" }, Dialog: { "2.0.0": "sent" } });
  assert.deepEqual(ledgerOf(root).components, { Button: { "1.0.0": "generated" }, Card: { "1.0.0": "sent" } }, "the local ledger keeps its own marks only");
  assert.equal(sharedOf(run).read, "read");
});

test("a version the variable marks changed is not taken as sent from a later exists", async () => {
  const { root, folder } = await generatedRepo({ components: ["Button"] });
  const before = record({ Button: { "1.0.0": "changed" } });
  const run = await relay(root, [folder], { scenarios: "exists", variable: before });

  assert.equal(run.code, 1);
  assert.match(outputOf(run.report).failed[0].error, /drawn from code Codex changed in an earlier run/);
  assert.equal(run.variable, before, "nothing was marked, so the variable is left as it was");
});

test("with --run the variable is read and written on the run's repository", async () => {
  const { root, folder } = await generatedRepo({ perFile: 10 });
  const run = await relay(root, ["--run", "123456", "--repo", "acme/app"], { ghSource: path.dirname(folder) });

  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(getCalls(run), [["variable", "get", NAME, "--repo", "acme/app"]]);
  assert.deepEqual(setCalls(run)[0].slice(-2), ["--repo", "acme/app"]);
  const download = run.gh.findIndex((call) => call[0] === "run");
  const read = run.gh.findIndex((call) => call[0] === "variable");
  assert.ok(download < read, "the run is checked and downloaded before the variable is read");
});

test("the relay warns and carries on when publishing fails, and keeps its own ledger", async () => {
  const { root, folder } = await generatedRepo();
  const run = await relay(root, [folder], { variableSetError: "HTTP 403: Resource not accessible by personal access token" });

  assert.equal(run.code, 0, "the units reached Figma, so the run did not fail");
  assert.deepEqual(outputOf(run.report).written, ["Button", "Card"]);
  assert.deepEqual(ledgerOf(root).components, { Button: { "1.0.0": "sent" }, Card: { "1.0.0": "sent" } });
  const warning = warningsOf(run).find((w) => /could not be published/.test(w));
  assert.ok(warning, "the report says it was not published");
  assert.match(warning, /HTTP 403: Resource not accessible/, "and repeats what gh said");
  assert.equal(sharedOf(run).published, false);
  assert.equal(run.variable, null);
});

test("a machine without gh still relays: it warns and keeps the local ledger", async () => {
  const { root, folder } = await generatedRepo();
  const run = await relay(root, [folder, "--gh", path.join(root, "no-such-gh")]);

  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(ledgerOf(root).components, { Button: { "1.0.0": "sent" }, Card: { "1.0.0": "sent" } });
  assert.ok(warningsOf(run).some((w) => /KLAUS_FIGMA_LEDGER could not be read/.test(w)));
  assert.equal(sharedOf(run).read, "unreadable");
  assert.equal(sharedOf(run).published, false);
});

test("a variable that could not be read is not written, so marks another machine published are not lost", async () => {
  const { root, folder } = await generatedRepo();
  const run = await relay(root, [folder], { variable: record({ Dialog: { "2.0.0": "sent" } }), variableGetError: "HTTP 502: Bad Gateway" });

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.calls.length, 2);
  assert.deepEqual(setCalls(run), [], "nothing is published over marks the relay could not read");
  assert.deepEqual(JSON.parse(run.variable).components, { Dialog: { "2.0.0": "sent" } });
  assert.ok(warningsOf(run).some((w) => /KLAUS_FIGMA_LEDGER could not be read.*HTTP 502/s.test(w)));
});

test("a malformed variable is a warning: nothing counts as sent from it, and the relay writes a good one", async () => {
  const { root, folder } = await generatedRepo();
  const run = await relay(root, [folder], { variable: "Button sent, honest" });

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.calls.length, 2, "both units are sent");
  assert.ok(warningsOf(run).some((w) => /KLAUS_FIGMA_LEDGER is not a record the relay writes/.test(w)));
  assert.equal(sharedOf(run).read, "malformed");
  assert.deepEqual(JSON.parse(run.variable).components, { Button: { "1.0.0": "sent" }, Card: { "1.0.0": "sent" } });
});

test("a variable for another Figma file is not used and not overwritten", async () => {
  const { root, folder } = await generatedRepo();
  const otherFile = "AnotherFigmaFileKey0000";
  const before = record({ Button: { "1.0.0": "sent" } }, { fileKey: otherFile });
  const run = await relay(root, [folder], { variable: before });

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.calls.length, 2, "Button is sent: the other file's mark does not count here");
  assert.deepEqual(setCalls(run), []);
  assert.equal(run.variable, before);
  assert.ok(warningsOf(run).some((w) => w.includes(otherFile) && w.includes(KEY)));
  assert.equal(sharedOf(run).read, "other-file");
});

test("a record over GitHub's 48 KB limit is refused plainly and never sent to gh", async () => {
  const { root, folder } = await generatedRepo();
  // A local ledger that already holds a long history of sent versions.
  const ledger = ledgerOf(root);
  for (let i = 0; i < 1500; i += 1) ledger.components[`HistoricalComponent${String(i).padStart(4, "0")}`] = { "1.0.0": "sent" };
  writeFileSync(path.join(root, ".klaus/figma/ledger.json"), JSON.stringify(ledger));

  const run = await relay(root, [folder]);
  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(setCalls(run), [], "nothing over the limit reaches gh");
  const warning = warningsOf(run).find((w) => /48,000 bytes/.test(w));
  assert.ok(warning, "the report names the limit");
  assert.match(warning, /was not published/);
  assert.equal(sharedOf(run).published, false);
  assert.ok(sharedOf(run).bytes > 48000);
});

test("a dry run reads the variable and never writes it", async () => {
  const { root, folder } = await generatedRepo();
  const run = await relay(root, [folder, "--dry-run"], { variable: record({ Button: { "1.0.0": "sent" } }) });

  assert.equal(run.code, 0, run.stderr);
  assert.equal(getCalls(run).length, 1);
  assert.deepEqual(setCalls(run), []);
  const units = outputOf(run.report).adapter.details.units.map((u) => [u.id, u.status]);
  assert.deepEqual(units, [["Button", "already sent"], ["Card", "would send"]]);
});

test("a run that sends nothing does not write the variable", async () => {
  const { root, folder } = await generatedRepo();
  const run = await relay(root, [folder], { variable: record({ Button: { "1.0.0": "sent" }, Card: { "1.0.0": "sent" } }) });

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.calls.length, 0);
  assert.deepEqual(setCalls(run), []);
  assert.equal(sharedOf(run).published, null);
});

test("after reconcile the relay publishes the versions it marked sent", async () => {
  const root = reconcileRepo({ components: { Button: { "1.0.0": "generated", "1.1.0": "generated" } } });
  const run = await relay(root, ["--reconcile"], { names: ["Button 1.0.0"], variable: record({ Card: { "1.0.0": "sent" } }) });

  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(ledgerOf(root).components, { Button: { "1.0.0": "sent", "1.1.0": "generated" } }, "the variable's Card mark is not copied into the local ledger");
  assert.deepEqual(JSON.parse(run.variable).components, { Button: { "1.0.0": "sent" }, Card: { "1.0.0": "sent" } }, "generated versions are not published");
  assert.equal(sharedOf(run).published, true);
});

test("reconcile does not look for a version the variable already marks sent or changed", async () => {
  const root = reconcileRepo({ components: { Button: { "1.0.0": "generated", "1.1.0": "generated", "1.2.0": "generated" } } });
  const run = await relay(root, ["--reconcile"], { names: [], variable: record({ Button: { "1.0.0": "sent", "1.1.0": "changed" } }) });

  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(outputOf(run.report).adapter.details.missing, ["Button 1.2.0"], "only the version no ledger has settled is looked for");
  assert.deepEqual(outputOf(run.report).adapter.details.changed, ["Button 1.1.0"]);
  assert.deepEqual(setCalls(run), [], "nothing was marked, so nothing is published");
});

test("reconcile publishing that fails is a warning, and the local marks stay", async () => {
  const root = reconcileRepo({ components: { Button: { "1.0.0": "generated" } } });
  const run = await relay(root, ["--reconcile"], { names: ["Button 1.0.0"], variableSetError: "HTTP 404: Not Found" });

  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(ledgerOf(root).components, { Button: { "1.0.0": "sent" } });
  assert.ok(warningsOf(run).some((w) => /could not be published.*HTTP 404/s.test(w)));
});

// ---------------------------------------------------------------------------------------------
// A forged record is visible: every version only the variable marks sent is named in the report.
// ---------------------------------------------------------------------------------------------

test("a unit the record alone marks sent is named in the relay's warning, details and summary, on every run", async () => {
  const { root, folder } = await generatedRepo();
  const variable = record({ Button: { "1.0.0": "sent" } });
  const run = await relay(root, [folder], { variable });

  assert.equal(run.code, 0, run.stderr);
  const warning = warningsOf(run).find((w) => w.startsWith("KLAUS_FIGMA_LEDGER alone marks"));
  assert.equal(warning, "KLAUS_FIGMA_LEDGER alone marks 1 version sent, so the relay did not send it: Button 1.0.0. This checkout's ledger does not say it was sent. If the relay did not send it, correct or delete KLAUS_FIGMA_LEDGER.");
  assert.deepEqual(sharedOf(run).sentOnlyInVariable, { count: 1, versions: ["Button 1.0.0"] });
  assert.match(outputOf(run.report).adapter.summary, /KLAUS_FIGMA_LEDGER alone marks 1 version sent\./);
  assert.match(run.stdout, /KLAUS_FIGMA_LEDGER alone marks 1 version sent/);

  // The mark is not copied into the local ledger, so the next run names it again.
  const again = await relay(root, [folder, "--dry-run"], { variable: run.variable });
  assert.deepEqual(sharedOf(again).sentOnlyInVariable, { count: 1, versions: ["Button 1.0.0"] });
});

test("a record that agrees with the relay's own ledger adds no warning and no count", async () => {
  const { root, folder } = await generatedRepo();
  writeFileSync(path.join(root, ".klaus/figma/ledger.json"), JSON.stringify({ version: 2, components: { Button: { "1.0.0": "sent" }, Card: { "1.0.0": "generated" } }, screens: {} }));
  const run = await relay(root, [folder], { variable: record({ Button: { "1.0.0": "sent" } }) });

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.calls.length, 1);
  assert.equal(warningsOf(run).some((w) => w.includes("KLAUS_FIGMA_LEDGER")), false);
  assert.deepEqual(sharedOf(run).sentOnlyInVariable, { count: 0, versions: [] });
  assert.doesNotMatch(outputOf(run.report).adapter.summary, /KLAUS_FIGMA_LEDGER/);
});

test("reconcile names the versions it did not look for because the record alone marks them sent", async () => {
  const root = reconcileRepo({ components: { Button: { "1.0.0": "generated", "1.1.0": "generated" } } });
  const run = await relay(root, ["--reconcile"], { names: [], variable: record({ Button: { "1.0.0": "sent" } }) });

  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(outputOf(run.report).adapter.details.missing, ["Button 1.1.0"]);
  const warning = warningsOf(run).find((w) => w.startsWith("KLAUS_FIGMA_LEDGER alone marks"));
  assert.match(warning, /^KLAUS_FIGMA_LEDGER alone marks 1 version sent, so reconcile did not look for it: Button 1\.0\.0\./);
  assert.deepEqual(sharedOf(run).sentOnlyInVariable, { count: 1, versions: ["Button 1.0.0"] });
  assert.match(outputOf(run.report).adapter.summary, /KLAUS_FIGMA_LEDGER alone marks 1 version sent\./);

  const agreeing = reconcileRepo({ components: { Button: { "1.0.0": "sent", "1.1.0": "generated" } } });
  const quiet = await relay(agreeing, ["--reconcile"], { names: [], variable: record({ Button: { "1.0.0": "sent" } }) });
  assert.deepEqual(sharedOf(quiet).sentOnlyInVariable, { count: 0, versions: [] });
  assert.equal(warningsOf(quiet).some((w) => w.includes("KLAUS_FIGMA_LEDGER")), false);
});

// ---------------------------------------------------------------------------------------------
// The record only confirms versions the relay's ledger or the release lists. Others are ignored.
// ---------------------------------------------------------------------------------------------

test("the relay ignores and names a mark for a version neither its ledger nor the release lists, and still applies a known one", async () => {
  const { root, folder } = await generatedRepo();
  // A fresh relay machine: no ledger of its own. The release lists Button and Card.
  writeFileSync(path.join(root, ".klaus/figma/ledger.json"), JSON.stringify({ version: 2, components: {}, screens: {} }));
  const run = await relay(root, [folder], { variable: record({ Button: { "1.0.0": "sent" }, Ghost: { "3.0.0": "sent" } }) });

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.calls.length, 1, "Button is in the release, so its mark applies and only Card is sent");
  assert.deepEqual(sharedOf(run).ignoredInVariable, { count: 1, versions: ["Ghost 3.0.0"] });
  assert.ok(warningsOf(run).some((w) => w.startsWith("KLAUS_FIGMA_LEDGER lists 1 version this ledger never planned; ignored: Ghost 3.0.0.")));
  assert.deepEqual(JSON.parse(run.variable).components.Ghost, { "3.0.0": "sent" }, "it is carried forward: another machine may have sent it");
});

test("reconcile ignores and names a mark for a version neither its ledger nor the release lists", async () => {
  const root = reconcileRepo({ components: { Button: { "1.0.0": "generated" } } });
  const run = await relay(root, ["--reconcile"], { names: [], variable: record({ Ghost: { "3.0.0": "sent" } }) });

  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(sharedOf(run).ignoredInVariable, { count: 1, versions: ["Ghost 3.0.0"] });
  assert.ok(warningsOf(run).some((w) => w.startsWith("KLAUS_FIGMA_LEDGER lists 1 version this ledger never planned; ignored: Ghost 3.0.0.")));
});

test("the relay ignores and names marks whose version or component is a name of Object.prototype", async () => {
  const { root, folder } = await generatedRepo();
  const forged = `{"version":2,"fileKey":"${KEY}","components":{"Button":{"toString":"sent","constructor":"sent","__proto__":"sent"},"constructor":{"1.0.0":"sent"}},"screens":{}}`;
  const run = await relay(root, [folder], { variable: forged });

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.calls.length, 2, "Button 1.0.0 is not marked, so both units are sent");
  assert.deepEqual(sharedOf(run).ignoredInVariable, { count: 4, versions: ["Button __proto__", "Button constructor", "Button toString", "constructor 1.0.0"] });
  assert.deepEqual(ledgerOf(root).components, { Button: { "1.0.0": "sent" }, Card: { "1.0.0": "sent" } }, "no forged key reaches the local ledger");
});

// ---------------------------------------------------------------------------------------------
// A first load: CI writes data for every planned unit, the plugin applies it, reconcile records it.
// ---------------------------------------------------------------------------------------------

test("the relay refuses to send a first load, which is the plugin's to apply", async () => {
  const { root, folder } = await generatedRepo({ firstLoad: true });
  const run = await relay(root, [folder]);

  assert.equal(run.code, 2);
  assert.match(run.stderr, /first load for the Klaus plugin/);
  assert.match(run.stderr, /--reconcile/);
  assert.equal(run.calls.length, 0);
});

test("reconcile --run looks for the first load's versions on a machine whose ledger has never seen them", async () => {
  const { folder } = await generatedRepo({ firstLoad: true });
  // The relay machine: the repo's settings and an empty ledger. CI generated the data, not this checkout.
  const box = reconcileRepo({ components: {} });
  const run = await relay(box, ["--reconcile", "--run", "123456", "--repo", "acme/app"], { ghSource: path.dirname(folder), names: ["Button 1.0.0"] });

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.calls.length, 1, "one read-only call");
  const details = outputOf(run.report).adapter.details;
  assert.deepEqual(details.reconciled, ["Button 1.0.0"]);
  assert.deepEqual(details.missing, ["Card 1.0.0"]);
  assert.equal(details.folder, "the klaus-figma artifact of run 123456");
  assert.deepEqual(ledgerOf(box).components, { Button: { "1.0.0": "sent" }, Card: { "1.0.0": "generated" } }, "a missing version stays generated, so a later reconcile looks again");
  assert.deepEqual(JSON.parse(run.variable).components, { Button: { "1.0.0": "sent" } });
  assert.deepEqual(run.gh.slice(0, 2), [["api", "repos/acme/app/actions/runs/123456"], ["api", "repos/acme/app"]], "the run is checked before anything is downloaded");
});

test("reconcile reads a local release folder too, and refuses one for another Figma file", async () => {
  const { folder } = await generatedRepo({ firstLoad: true });
  const box = reconcileRepo({ components: {} });
  const run = await relay(box, ["--reconcile", folder], { names: ["Button 1.0.0", "Card 1.0.0"] });
  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(outputOf(run.report).adapter.details.reconciled, ["Button 1.0.0", "Card 1.0.0"]);

  const elsewhere = reconcileRepo({ components: {}, config: { ...ROOMY, outputs: { figma: { enabled: true, target: "AnotherFigmaFileKey0000" } } } });
  const refused = await relay(elsewhere, ["--reconcile", folder], { names: [] });
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /klaus\.config\.json names AnotherFigmaFileKey0000/);
  assert.equal(refused.calls.length, 0);
});

test("reconcile takes one source of versions at most, and --artifact or --release only with --run", async () => {
  const root = reconcileRepo({ components: { Button: { "1.0.0": "generated" } } });
  const empty = mkdtempSync(path.join(tmpdir(), "klaus-empty-"));
  for (const extra of [[empty, "--run", "123"], ["--artifact", "x"], ["--release", "v1"]]) {
    const run = await relay(root, ["--reconcile", ...extra]);
    assert.equal(run.code, 2, extra.join(" "));
    assert.equal(run.calls.length, 0);
  }
});
