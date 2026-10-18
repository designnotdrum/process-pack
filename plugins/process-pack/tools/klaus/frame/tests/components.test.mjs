/** Reading the inventory and applying the config's selection. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { listComponents, selectComponents, usageCount } from "../components.mjs";

test("usage is usageCount when present, else the length of usedBy, else 0", () => {
  assert.equal(usageCount({ name: "A", usageCount: 7, usedBy: ["x"] }), 7);
  assert.equal(usageCount({ name: "A", usedBy: ["x", "y"] }), 2);
  assert.equal(usageCount({ name: "A" }), 0);
});

test("the inventory may be an array or an object with components, and every component needs a name", () => {
  assert.equal(listComponents([{ name: "A" }]).length, 1);
  assert.equal(listComponents({ components: [{ name: "A" }] }).length, 1);
  assert.throws(() => listComponents({ components: [{ file: "x" }] }), /without a name/);
  assert.throws(() => listComponents({}), /must be an array/);
});

const inventory = [
  { name: "Button", file: "packages/ui/Button.tsx", usageCount: 30 },
  { name: "Banner", file: "packages/ui-extra/Banner.tsx", usageCount: 1 },
  { name: "Nav", file: "apps/web/app/components/Nav.tsx", usageCount: 4 },
  { name: "Orphan", usageCount: 9 },
];

test("component groups match whole folders, not folders that share a prefix", () => {
  const picked = selectComponents(inventory, { componentGroups: ["packages/ui"] });
  assert.deepEqual(picked.map((c) => c.name), ["Button"]);
});

test("no component groups means every component", () => {
  assert.equal(selectComponents(inventory, { componentGroups: [] }).length, 4);
});

test("the new-component rule applies only to components the output has never received", () => {
  const isNew = (c) => c.name !== "Button";
  const names = (rule) => selectComponents(inventory, { newComponents: rule }, { isNew }).map((c) => c.name);

  assert.deepEqual(names({ rule: "all" }), ["Button", "Banner", "Nav", "Orphan"]);
  assert.deepEqual(names({ rule: "none" }), ["Button"]);
  assert.deepEqual(names({ rule: "min-usage", minUsage: 4 }), ["Button", "Nav", "Orphan"]);
});
