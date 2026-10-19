/** Reading the inventory and applying the config's selection. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { listComponents, selectComponents, usageCount } from "../components.mjs";

test("usage is the number of files in usedIn, and 0 when there are none", () => {
  assert.equal(usageCount({ name: "A", usedIn: ["a.tsx", "b.tsx"] }), 2);
  assert.equal(usageCount({ name: "A", usedIn: [] }), 0);
  assert.equal(usageCount({ name: "A" }), 0);
});

test("components are the inventory's entries, and every entry needs a name", () => {
  const entries = [{ name: "A" }, { name: "B", file: "b.tsx" }];
  assert.deepEqual(listComponents({ schemaVersion: 1, folders: [], entries }), entries);
  assert.throws(() => listComponents({ entries: [{ file: "x" }] }), /without a name/);
  assert.throws(() => listComponents({}), /with an entries array/);
  assert.throws(() => listComponents([{ name: "A" }]), /with an entries array/);
});

const used = (count) => Array.from({ length: count }, (_, i) => `apps/web/app/screens/screen-${i}.tsx`);
const inventory = {
  schemaVersion: 1,
  folders: [],
  entries: [
    { name: "Button", file: "packages/ui/Button.tsx", usedIn: used(30) },
    { name: "Banner", file: "packages/ui-extra/Banner.tsx", usedIn: used(1) },
    { name: "Nav", file: "apps/web/app/components/Nav.tsx", usedIn: used(4) },
    { name: "Orphan", usedIn: used(9) },
  ],
};

test("component groups match whole folders, not folders that share a prefix", () => {
  const picked = selectComponents(inventory, { componentGroups: ["packages/ui"] });
  assert.deepEqual(picked.map((c) => c.name), ["Button"]);
});

test("no component groups means every component", () => {
  assert.deepEqual(
    selectComponents(inventory, { componentGroups: [] }).map((c) => c.name),
    ["Button", "Banner", "Nav", "Orphan"],
  );
});

test("the new-component rule applies only to components the output has never received", () => {
  const isNew = (c) => c.name !== "Button";
  const names = (rule) => selectComponents(inventory, { newComponents: rule }, { isNew }).map((c) => c.name);

  assert.deepEqual(names({ rule: "all" }), ["Button", "Banner", "Nav", "Orphan"]);
  // With no rule configured, a component the output never received is still selected.
  assert.deepEqual(selectComponents(inventory, {}, { isNew }).map((c) => c.name), ["Button", "Banner", "Nav", "Orphan"]);
  assert.deepEqual(names({ rule: "none" }), ["Button"]);
  assert.deepEqual(names({ rule: "min-usage", minUsage: 4 }), ["Button", "Nav", "Orphan"]);
});
