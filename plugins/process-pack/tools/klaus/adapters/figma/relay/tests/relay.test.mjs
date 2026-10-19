/** The relay, run as a command against a stub codex that replays recorded event output. */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { CALL_BASE_TOKENS } from "../../settings.mjs";
import { DEFAULT_MODEL, predictTokens } from "../relay.mjs";
import { generatedRepo, KEY, ledgerOf, outputOf, relay } from "./helpers.mjs";

// The recorded success call's usage: 86,388 input and 6,274 output tokens.
const SUCCESS_TOKENS = 92662;

test("a successful call marks its units sent, and the generator stops planning them", async () => {
  const { root, folder, plan } = await generatedRepo();
  assert.deepEqual(ledgerOf(root).components, { Button: { "1.0.0": "generated" }, Card: { "1.0.0": "generated" } });

  const run = await relay(root, [folder]);

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.calls.length, 2, "one call per code file");
  assert.deepEqual(ledgerOf(root).components, { Button: { "1.0.0": "sent" }, Card: { "1.0.0": "sent" } });
  assert.deepEqual((await plan()).items, [], "a sent unit is not planned again");

  const output = outputOf(run.report);
  assert.equal(run.report.status, "ok");
  assert.equal(output.output, "figma-relay");
  assert.deepEqual(output.written, ["Button", "Card"]);
  assert.deepEqual(output.actual, { calls: 2, tokens: 2 * SUCCESS_TOKENS, usd: 0 });
  const [first] = output.adapter.details.files;
  assert.equal(first.status, "sent");
  assert.equal(first.calls, 1);
  assert.equal(first.tokens, first.usage.input_tokens + first.usage.output_tokens, "relay tokens are input plus output");
  assert.equal(first.tokens, SUCCESS_TOKENS);
  assert.deepEqual(
    output.adapter.details.units.map((u) => [u.id, u.status, u.figma, u.calls, u.tokens]),
    [["Button", "sent", "written", 1, SUCCESS_TOKENS], ["Card", "sent", "written", 1, SUCCESS_TOKENS]],
  );
  // The run report is the frame's, kept where the frame keeps reports.
  const reports = readdirSync(path.join(root, ".klaus/reports"));
  assert.equal(reports.length, 1);
  assert.match(reports[0], /^report-.*\.json$/);
});

test("a sent mark another run writes during a call is kept", async () => {
  const { root, folder } = await generatedRepo({ perFile: 10 });
  const run = await relay(root, [folder], { otherRunLedger: path.join(root, ".klaus/figma/ledger.json") });
  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(ledgerOf(root).components, { Button: { "1.0.0": "sent" }, Card: { "1.0.0": "sent" }, Other: { "1.0.0": "sent" } });
});

test("the code reaches Codex unchanged on stdin, and the prompt carries no code", async () => {
  const { root, folder, manifest } = await generatedRepo({ perFile: 10 });
  const run = await relay(root, [folder]);

  assert.equal(run.calls.length, 1);
  const file = readFileSync(path.join(folder, manifest.files[0].name));
  assert.ok(run.calls[0].stdin.equals(file), "stdin is the code file, byte for byte");

  const { args } = run.calls[0];
  const prompt = args.at(-1);
  assert.match(prompt, /use_figma tool of the figma MCP server exactly once/);
  assert.match(prompt, new RegExp(`fileKey: ${KEY}`));
  assert.ok(!prompt.includes("const UNITS"), "the code is not pasted into the prompt");
  for (const flag of ["--json", "--ephemeral", "--ignore-user-config", "--skip-git-repo-check"]) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
  assert.equal(args[args.indexOf("-m") + 1], DEFAULT_MODEL);
  assert.ok(args.includes('mcp_servers.figma.enabled_tools=["use_figma"]'), "Codex sees use_figma and no other tool");
  assert.ok(args.includes('mcp_servers.figma.url="https://mcp.figma.com/mcp"'));
});

test("--keep-codex-config leaves the user's Codex config in place", async () => {
  const { root, folder } = await generatedRepo({ perFile: 10 });
  const run = await relay(root, [folder, "--keep-codex-config", "--model", "gpt-6-terra", "--effort", "medium"]);
  const { args } = run.calls[0];
  assert.ok(!args.includes("--ignore-user-config"));
  assert.equal(args[args.indexOf("-m") + 1], "gpt-6-terra");
  assert.ok(args.includes('model_reasoning_effort="medium"'));
});

test("a tool error leaves the units unsent and reports them, and the next run retries only those", async () => {
  const { root, folder } = await generatedRepo();
  const first = await relay(root, [folder], { scenarios: "success,tool-error" });

  assert.equal(first.code, 1, "a unit that did not land fails the run");
  assert.equal(first.report.status, "failed");
  const output = outputOf(first.report);
  assert.deepEqual(output.written, ["Button"]);
  assert.deepEqual(output.failed, [{ id: "Card", error: "use_figma failed: Error: You do not have edit access to this file." }]);
  assert.deepEqual(ledgerOf(root).components, { Button: { "1.0.0": "sent" }, Card: { "1.0.0": "generated" } });
  assert.equal(output.adapter.details.files[1].tokens, 68817, "a failed call still counts its tokens");

  const second = await relay(root, [folder]);
  assert.equal(second.code, 0);
  assert.equal(second.calls.length, 1, "the file already sent is not sent again");
  assert.match(second.calls[0].stdin.toString(), /"id":"Card"/);
  assert.deepEqual(outputOf(second.report).written, ["Card"]);
  assert.equal(outputOf(second.report).adapter.details.files[0].status, "already sent");
  assert.deepEqual(ledgerOf(root).components, { Button: { "1.0.0": "sent" }, Card: { "1.0.0": "sent" } });
});

test("a Codex crash leaves the units unsent, says why, and counts no tokens it cannot see", async () => {
  const { root, folder } = await generatedRepo({ perFile: 10 });
  const run = await relay(root, [folder], { scenarios: "crash" });

  assert.equal(run.code, 1);
  const output = outputOf(run.report);
  assert.deepEqual(output.written, []);
  assert.equal(output.failed.length, 2);
  assert.match(output.failed[0].error, /Codex exited with 1: Error: stream disconnected before completion/);
  assert.deepEqual(output.actual, { calls: 1, tokens: 0, usd: 0 });
  assert.equal(output.adapter.details.files[0].tokens, null);
  assert.ok(output.warnings.some((w) => /ended without a token count/.test(w)));
  assert.deepEqual(ledgerOf(root).components, { Button: { "1.0.0": "generated" }, Card: { "1.0.0": "generated" } });
});

test("a unit the code reports failed stays unsent while the rest of its file is sent", async () => {
  const { root, folder } = await generatedRepo({ perFile: 10 });
  const run = await relay(root, [folder], { scenarios: "unit-failed" });

  assert.equal(run.code, 1);
  const output = outputOf(run.report);
  assert.deepEqual(output.written, ["Button"]);
  assert.deepEqual(output.failed, [{ id: "Card", error: "Figma: The font DM Sans Medium could not be loaded." }]);
  assert.equal(output.adapter.details.files[0].status, "partly sent");
  assert.deepEqual(output.adapter.details.units.map((u) => [u.id, u.calls, u.tokens]), [["Button", 0.5, SUCCESS_TOKENS / 2], ["Card", 0.5, SUCCESS_TOKENS / 2]]);
  assert.deepEqual(ledgerOf(root).components, { Button: { "1.0.0": "sent" }, Card: { "1.0.0": "generated" } });
});

test("a set Figma drew from changed code is recorded as changed, and a later exists does not count", async () => {
  const { root, folder } = await generatedRepo({ perFile: 10 });
  const first = await relay(root, [folder], { scenarios: "changed-code" });
  assert.equal(first.code, 1);
  assert.match(outputOf(first.report).failed[0].error, /^Figma drew Button 1\.0\.0 from code Codex changed on the way, so the set may be wrong\. Delete it in Figma/);
  assert.deepEqual(ledgerOf(root).components, { Button: { "1.0.0": "changed" }, Card: { "1.0.0": "changed" } });

  // The next call copies the code exactly, and the code finds the wrong set already there.
  const second = await relay(root, [folder], { scenarios: "exists" });
  assert.equal(second.code, 1);
  assert.match(outputOf(second.report).failed[0].error, /Button 1\.0\.0 in Figma was drawn from code Codex changed in an earlier run/);
  assert.deepEqual(ledgerOf(root).components, { Button: { "1.0.0": "changed" }, Card: { "1.0.0": "changed" } });

  // Once a person has deleted the sets, the next call writes them again from the right code.
  const third = await relay(root, [folder], { scenarios: "success" });
  assert.equal(third.code, 0);
  assert.deepEqual(ledgerOf(root).components, { Button: { "1.0.0": "sent" }, Card: { "1.0.0": "sent" } });
});

test("code Codex changed on the way is not trusted when the call failed", async () => {
  const { root, folder } = await generatedRepo({ perFile: 10 });
  const run = await relay(root, [folder], { scenarios: "changed-code-failed" });
  assert.match(outputOf(run.report).failed[0].error, /Codex changed the code before it reached use_figma/);
  assert.deepEqual(ledgerOf(root).components, { Button: { "1.0.0": "generated" }, Card: { "1.0.0": "generated" } }, "nothing was drawn, so nothing is changed");
});

test("an exists from an exact copy marks a unit sent", async () => {
  const { root, folder } = await generatedRepo({ perFile: 10 });
  const run = await relay(root, [folder], { scenarios: "exists" });
  assert.equal(run.code, 0);
  assert.deepEqual(outputOf(run.report).adapter.details.units.map((u) => [u.id, u.status, u.figma]), [["Button", "sent", "exists"], ["Card", "sent", "exists"]]);
});

test("code sent to another Figma file is not trusted", async () => {
  const { root, folder } = await generatedRepo({ perFile: 10 });
  const run = await relay(root, [folder], { scenarios: "wrong-file-key" });
  assert.equal(run.code, 1);
  assert.match(outputOf(run.report).failed[0].error, new RegExp(`Codex sent the code to file "SomeOtherFigmaFileKey000", not ${KEY}`));
  assert.deepEqual(ledgerOf(root).components, { Button: { "1.0.0": "generated" }, Card: { "1.0.0": "generated" } });
});

test("a reply without a use_figma call is a failure, with what Codex said", async () => {
  const { root, folder } = await generatedRepo({ perFile: 10 });
  const run = await relay(root, [folder], { scenarios: "no-call" });
  assert.equal(run.code, 1);
  assert.match(outputOf(run.report).failed[0].error, /Codex did not call use_figma\. It replied: I cannot find a use_figma tool\./);
  assert.equal(run.calls.length, 1);
  assert.deepEqual(ledgerOf(root).components, { Button: { "1.0.0": "generated" }, Card: { "1.0.0": "generated" } }, "nothing is marked sent");
});

test("the token cap stops before the call that would pass it, and defers the rest", async () => {
  const predicted = predictTokens(0);
  assert.ok(predicted >= CALL_BASE_TOKENS);
  // Room for the first call and not for the second.
  const probe = await generatedRepo();
  const cap = Math.max(predictTokens(probe.manifest.files[0].chars), SUCCESS_TOKENS) + 1000;
  const { root, folder } = await generatedRepo({ components: ["Button", "Card", "Badge"], config: { outputs: { figma: { enabled: true, target: KEY } }, spendingCap: { maxRelayTokens: cap } } });

  const run = await relay(root, [folder]);

  assert.equal(run.code, 0, "going over the cap is not a failure");
  assert.equal(run.calls.length, 1);
  const output = outputOf(run.report);
  assert.deepEqual(output.written, ["Button"]);
  assert.deepEqual(output.deferred, [{ id: "Card", kind: "component", reason: "token-cap" }, { id: "Badge", kind: "component", reason: "token-cap" }]);
  assert.deepEqual(output.adapter.details.files.map((f) => [f.name, f.status]), [["figma-001.js", "sent"], ["figma-002.js", "deferred"], ["figma-003.js", "deferred"]]);
  assert.ok(output.warnings.some((w) => /stopped before a call that would pass the token-cap/.test(w)));
  assert.equal(ledgerOf(root).components.Card["1.0.0"], "generated", "a deferred unit stays unsent for the next run");
});

test("a file that alone needs more than the token cap is deferred with a reason that says it never fits", async () => {
  const { root, folder } = await generatedRepo({ config: { outputs: { figma: { enabled: true, target: KEY } }, spendingCap: { maxRelayTokens: 50000 } } });
  const run = await relay(root, [folder]);
  assert.equal(run.calls.length, 0);
  const output = outputOf(run.report);
  assert.deepEqual(output.deferred.map((d) => d.reason), ["larger-than-token-cap", "larger-than-token-cap"]);
  assert.ok(output.warnings.some((w) => /will never be sent at this cap\. Raise the cap, or lower outputs\.figma\.options\.componentsPerCall/.test(w)));
});

test("the component write cap and --max-calls defer the same way", async () => {
  const writes = await generatedRepo({ config: { outputs: { figma: { enabled: true, target: KEY } }, spendingCap: { maxComponentWrites: 1 } } });
  const capped = await relay(writes.root, [writes.folder]);
  assert.equal(capped.calls.length, 1);
  assert.deepEqual(outputOf(capped.report).deferred.map((d) => [d.id, d.reason]), [["Card", "write-cap"]]);

  const calls = await generatedRepo();
  const limited = await relay(calls.root, [calls.folder, "--max-calls", "0"]);
  assert.equal(limited.calls.length, 0);
  assert.deepEqual(outputOf(limited.report).deferred.map((d) => [d.id, d.reason]), [["Button", "call-cap"], ["Card", "call-cap"]]);
});

test("a dry run makes no call and shows what would be sent", async () => {
  const { root, folder } = await generatedRepo();
  const run = await relay(root, [folder, "--dry-run"]);
  assert.equal(run.code, 0);
  assert.equal(run.calls.length, 0);
  const output = outputOf(run.report);
  assert.equal(output.status, "dry-run");
  assert.equal(output.estimated.calls, 2);
  assert.deepEqual(output.adapter.details.files.map((f) => f.status), ["would send", "would send"]);
  assert.equal(existsSync(path.join(root, ".klaus/reports")), false, "a dry run writes no report");
});

test("Codex not signed in to Figma stops the run before any call", async () => {
  const { root, folder } = await generatedRepo();
  const run = await relay(root, [folder], { mcp: [{ name: "figma", enabled: true, transport: { url: "https://mcp.figma.com/mcp" }, auth_status: "not_logged_in" }] });
  assert.equal(run.code, 2);
  assert.equal(run.calls.length, 0);
  assert.match(run.stderr, /not signed in to Figma\. Run: codex mcp login figma/);
  assert.deepEqual(ledgerOf(root).components, { Button: { "1.0.0": "generated" }, Card: { "1.0.0": "generated" } });

  const missing = await relay(root, [folder], { mcp: [] });
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /codex mcp add figma --url https:\/\/mcp\.figma\.com\/mcp/);
});

test("--run downloads the CI artifact with gh and relays the release in it", async () => {
  const { root, folder } = await generatedRepo({ perFile: 10 });
  const run = await relay(root, ["--run", "123456", "--repo", "acme/app"], { ghSource: path.dirname(folder) });

  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(run.gh.slice(0, 7), ["run", "download", "123456", "--name", "klaus-figma", "--dir", run.gh[6]]);
  assert.deepEqual(run.gh.slice(7), ["--repo", "acme/app"]);
  assert.deepEqual(outputOf(run.report).written, ["Button", "Card"]);
  // The ledger is the repo's, not the downloaded copy's.
  assert.deepEqual(ledgerOf(root).components, { Button: { "1.0.0": "sent" }, Card: { "1.0.0": "sent" } });
  assert.equal(existsSync(run.gh[6]), false, "the downloaded artifact is removed after the run");
  assert.equal(outputOf(run.report).adapter.details.folder, "the klaus-figma artifact of run 123456");
});

test("a code file that changed after it was generated is not sent", async () => {
  const { root, folder, manifest } = await generatedRepo({ perFile: 10 });
  writeFileSync(path.join(folder, manifest.files[0].name), "figma.closePlugin();\n");
  const run = await relay(root, [folder]);
  assert.equal(run.calls.length, 0);
  assert.match(outputOf(run.report).failed[0].error, /changed after it was generated/);
});

test("a manifest from before the relay is refused with what to do", async () => {
  const { root, folder, manifest } = await generatedRepo();
  writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({ ...manifest, schemaVersion: 1, ledgerEntries: undefined }));
  const run = await relay(root, [folder]);
  assert.equal(run.code, 2);
  assert.match(run.stderr, /needs version 2.*Run the generator again/);
});

test("screenshot uploads are listed as not sent, and stay generated", async () => {
  const { root, folder, manifest } = await generatedRepo({ perFile: 10 });
  const upload = { id: "screen:/settings", screen: "/settings", release: "v1.0.0", image: ".klaus/screens/settings.png", bytes: 64, page: "Screens", frame: "/settings v1.0.0" };
  writeFileSync(
    path.join(folder, "manifest.json"),
    JSON.stringify({ ...manifest, uploads: [upload], ledgerEntries: { ...manifest.ledgerEntries, [upload.id]: { kind: "screen", route: "/settings", release: "v1.0.0" } } }),
  );
  const run = await relay(root, [folder]);
  assert.equal(run.code, 0);
  const output = outputOf(run.report);
  assert.deepEqual(output.deferred, [{ id: "screen:/settings", kind: "screen", reason: "upload-not-supported" }]);
  assert.ok(output.warnings.some((w) => /does not upload screenshots yet/.test(w)));
  assert.equal(ledgerOf(root).screens["/settings"]?.["v1.0.0"], undefined, "the relay records no upload as sent");
});
