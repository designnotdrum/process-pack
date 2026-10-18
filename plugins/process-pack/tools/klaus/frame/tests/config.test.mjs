/**
 * klaus.config.json: the schema accepts a real config, rejects a secret value
 * wherever it is put, and never repeats the value in an error message.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DEFAULT_SPENDING_CAP, loadConfig, resolveConfig, validateConfig } from "../config.mjs";
import { validateAgainstSchema } from "../json-schema.mjs";

/**
 * Secret-shaped strings are assembled here, not written out, so this file holds
 * nothing a secret scanner would flag.
 */
const SECRETS = {
  "a GitHub token": ["gh", "p_", "a1B2c3D4".repeat(5)].join(""),
  "a Figma token": ["fi", "gd_", "x9Y8z7W6".repeat(5)].join(""),
  "an API key": ["s", "k-", "q1W2e3R4".repeat(5)].join(""),
  "an AWS key id": ["AK", "IA", "ABCDEFGH12345678"].join(""),
  "a private key header": ["-----BEGIN ", "RSA PRIVATE KEY", "-----"].join(""),
  "a URL with a password": ["https://deploy:", "hunter2hunter2", "@example.test/project"].join(""),
  "a JWT": ["ey", "Jhbgcioijiuzi1nij9", ".", "eyJzdWIiOiIxMjM0NTY3ODkwIn0"].join(""),
  "a bearer header": ["Bearer ", "abcDEF0123456789abcDEF"].join(""),
  "a long unbroken token": "f3a9".repeat(12),
};

const base = (patch = {}) => ({
  outputs: { storybook: { enabled: true, target: "acme-storybook" } },
  ...patch,
});

test("accepts a full, realistic config", () => {
  const config = {
    $schema: "./scripts/klaus/klaus.config.schema.json",
    outputs: {
      storybook: { enabled: true, target: "acme-storybook", secrets: ["VERCEL_TOKEN"] },
      figma: {
        enabled: true,
        target: "https://www.figma.com/design/AbCdEfGhIjKlMnOpQrStUv/Acme-components?node-id=1-2",
        route: "codex-relay",
        logins: ["codex"],
      },
      penpot: { enabled: false },
      pencil: { enabled: false, target: "design/acme.pen" },
    },
    inventory: { folders: ["packages/ui", "apps/web/app/components"] },
    selection: {
      componentGroups: ["packages/ui"],
      screens: { mode: "listed", routes: ["/", "/projects/[id]"] },
      newComponents: { rule: "min-usage", minUsage: 3 },
    },
    spendingCap: { maxComponentWrites: 25, maxRelayTokens: 60000 },
    trigger: { mode: "schedule", cron: "0 6 * * 1", tagPattern: "v*" },
  };
  assert.deepEqual(validateConfig(config), { ok: true, errors: [] });
});

test("accepts identifiers that look unusual but are not secrets", () => {
  const targets = [
    "prj_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4",
    "AbCdEfGhIjKlMnOpQrStUv",
    "design/acme.pen",
    "https://acme-storybook.vercel.app/versions/v1.4.0/index.html",
    "apps/web/app/components/dashboard-v2-widgets/index.tsx",
  ];
  for (const target of targets) {
    assert.deepEqual(validateConfig(base({ outputs: { storybook: { enabled: true, target } } })).errors, [], target);
  }
});

for (const [what, secret] of Object.entries(SECRETS)) {
  test(`rejects ${what} as a target, and the error does not repeat it`, () => {
    const { ok, errors } = validateConfig(base({ outputs: { storybook: { enabled: true, target: secret } } }));
    assert.equal(ok, false);
    assert.match(errors.join("\n"), /outputs\.storybook\.target: looks like a secret value/);
    assert.ok(!errors.join("\n").includes(secret));
  });
}

test("rejects a secret value in every field that takes text", () => {
  const secret = SECRETS["a GitHub token"];
  const where = [
    ["outputs.storybook.route", base({ outputs: { storybook: { enabled: true, route: secret } } })],
    ["outputs.storybook.secrets[0]", base({ outputs: { storybook: { enabled: true, secrets: [secret] } } })],
    ["outputs.storybook.logins[0]", base({ outputs: { storybook: { enabled: true, logins: [secret] } } })],
    ["inventory.folders[0]", base({ inventory: { folders: [secret] } })],
    ["selection.componentGroups[0]", base({ selection: { componentGroups: [secret] } })],
    ["selection.screens.routes[0]", base({ selection: { screens: { mode: "listed", routes: [`/${secret}`] } } })],
  ];
  for (const [path_, config] of where) {
    const { ok, errors } = validateConfig(config);
    assert.equal(ok, false, path_);
    assert.ok(errors.some((e) => e.startsWith(`${path_}:`)), `${path_} in ${errors.join(" | ")}`);
    assert.ok(!errors.join("\n").includes(secret), path_);
  }
});

test("rejects an AWS-style key id in secrets, where it has the shape of a name", () => {
  const { errors } = validateConfig(base({ outputs: { storybook: { enabled: true, secrets: [SECRETS["an AWS key id"]] } } }));
  assert.match(errors.join("\n"), /secrets\[0\]: looks like a secret value/);
});

test("rejects a setting Klaus does not know, such as a token field", () => {
  const { ok, errors } = validateConfig(base({ outputs: { storybook: { enabled: true, token: SECRETS["an API key"] } } }));
  assert.equal(ok, false);
  assert.deepEqual(errors, ["outputs.storybook.token: is not a setting Klaus knows."]);
});

test("secrets and logins must be names", () => {
  const { errors } = validateConfig(base({ outputs: { storybook: { enabled: true, secrets: ["vercel token"], logins: ["Codex Login"] } } }));
  assert.match(errors.join("\n"), /secrets\[0\]: must be the name of an environment variable/);
  assert.match(errors.join("\n"), /logins\[0\]: must be the name of a login/);
});

test("rejects an unknown output name, a missing enabled flag and wrong types", () => {
  assert.match(validateConfig({ outputs: { figmaa: { enabled: true } } }).errors[0], /outputs\.figmaa: is not a setting Klaus knows/);
  assert.match(validateConfig({ outputs: { figma: { target: "x" } } }).errors[0], /outputs\.figma: "enabled" is required/);
  assert.match(validateConfig({ outputs: { figma: { enabled: "yes" } } }).errors[0], /outputs\.figma\.enabled: must be a boolean/);
  assert.match(validateConfig({}).errors[0], /"outputs" is required/);
  assert.match(validateConfig([]).errors[0], /must be an object/);
});

test("rejects a tag pattern that git would read as an option", () => {
  const { errors } = validateConfig(base({ trigger: { tagPattern: "--output=x" } }));
  assert.match(errors[0], /trigger\.tagPattern: must be a git tag glob that does not start with a dash/);
  assert.deepEqual(validateConfig(base({ trigger: { tagPattern: "release-*" } })).errors, []);
});

test("rejects a spending cap that is negative or not a whole number", () => {
  assert.match(validateConfig(base({ spendingCap: { maxComponentWrites: -1 } })).errors[0], /at least 0/);
  assert.match(validateConfig(base({ spendingCap: { maxRelayTokens: 1.5 } })).errors[0], /must be an integer/);
});

test("rejects rules that need a second field", () => {
  assert.match(validateConfig(base({ trigger: { mode: "schedule" } })).errors[0], /trigger\.cron: is required/);
  assert.match(validateConfig(base({ selection: { screens: { mode: "listed" } } })).errors[0], /selection\.screens\.routes: must list at least one route/);
});

test("resolveConfig fills in the default cap of 50 writes and 100000 relay tokens", () => {
  const config = resolveConfig(base());
  assert.deepEqual(DEFAULT_SPENDING_CAP, { maxComponentWrites: 50, maxRelayTokens: 100000 });
  assert.deepEqual(config.spendingCap, DEFAULT_SPENDING_CAP);
  assert.deepEqual(config.trigger, { mode: "release", tagPattern: "v*" });
  assert.deepEqual(config.selection.screens, { mode: "none", routes: [] });
  assert.deepEqual(config.selection.newComponents, { rule: "all", minUsage: 2 });
  assert.deepEqual(config.outputs.storybook.secrets, []);
});

test("resolveConfig keeps a partial cap and fills the other half", () => {
  assert.deepEqual(resolveConfig(base({ spendingCap: { maxComponentWrites: 10 } })).spendingCap, { maxComponentWrites: 10, maxRelayTokens: 100000 });
});

test("resolveConfig throws with every problem listed and none of the values", () => {
  const secret = SECRETS["a GitHub token"];
  assert.throws(
    () => resolveConfig(base({ outputs: { storybook: { enabled: true, target: secret } } })),
    (error) => /klaus\.config\.json is not valid/.test(error.message) && !error.message.includes(secret),
  );
});

test("loadConfig reports a syntax error without quoting the file", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "klaus-config-"));
  const file = path.join(dir, "klaus.config.json");
  writeFileSync(file, `${SECRETS["a GitHub token"]} {`);
  assert.throws(() => loadConfig(file), (error) => /is not valid JSON/.test(error.message) && !error.message.includes("a1B2c3D4"));
  assert.throws(() => loadConfig(path.join(dir, "missing.json")), /does not exist/);
});

test("the schema checker refuses a keyword it does not implement", () => {
  assert.throws(() => validateAgainstSchema({ type: "object", patternProperties: {} }, {}), /Unsupported schema keyword "patternProperties"/);
});
