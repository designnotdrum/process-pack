/** Which releases a run covers: since the last recorded run, up to the one that started it. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { releasesToCover, triggerEnabled } from "../triggers.mjs";

const releases = ["v0.9.0", "v1.0.0", "v1.1.0", "v1.2.0"];

test("a release run covers every release since the last run, through the new tag", () => {
  const { covered } = releasesToCover({ releases, trigger: "release", release: "v1.2.0", lastRelease: "v0.9.0" });
  assert.deepEqual(covered, ["v1.0.0", "v1.1.0", "v1.2.0"]);
});

test("a release run right after the previous release covers just the new one", () => {
  assert.deepEqual(releasesToCover({ releases, trigger: "release", release: "v1.1.0", lastRelease: "v1.0.0" }).covered, ["v1.1.0"]);
});

test("a release run stops at its own tag even when newer tags exist", () => {
  assert.deepEqual(releasesToCover({ releases, trigger: "release", release: "v1.0.0", lastRelease: "v0.9.0" }).covered, ["v1.0.0"]);
});

test("a release run with no recorded run covers only that tag, not the tag history", () => {
  assert.deepEqual(releasesToCover({ releases, trigger: "release", release: "v1.1.0" }).covered, ["v1.1.0"]);
});

test("a release run for a tag already covered covers nothing", () => {
  assert.deepEqual(releasesToCover({ releases, trigger: "release", release: "v1.0.0", lastRelease: "v1.1.0" }).covered, []);
  assert.deepEqual(releasesToCover({ releases, trigger: "release", release: "v1.1.0", lastRelease: "v1.1.0" }).covered, []);
});

test("a release run for a tag that is not a release is an error", () => {
  assert.throws(() => releasesToCover({ releases, trigger: "release", release: "nightly" }), /Release nightly is not among the release tags/);
});

for (const trigger of ["schedule", "manual"]) {
  test(`a ${trigger} run covers every release since the last run, through the newest`, () => {
    assert.deepEqual(releasesToCover({ releases, trigger, lastRelease: "v1.0.0" }).covered, ["v1.1.0", "v1.2.0"]);
  });

  test(`a ${trigger} run with nothing new covers nothing`, () => {
    assert.deepEqual(releasesToCover({ releases, trigger, lastRelease: "v1.2.0" }).covered, []);
  });

  test(`a ${trigger} run with no recorded run covers only the newest release`, () => {
    assert.deepEqual(releasesToCover({ releases, trigger }).covered, ["v1.2.0"]);
    assert.deepEqual(releasesToCover({ releases: [], trigger }).covered, []);
  });
}

test("a last release that is no longer a tag falls back to the newest and says so", () => {
  const { covered, notes } = releasesToCover({ releases, trigger: "schedule", lastRelease: "v0.1.0" });
  assert.deepEqual(covered, ["v1.2.0"]);
  assert.match(notes[0], /v0\.1\.0 is no longer a tag/);
});

test("a last release that is no longer a tag, with no releases at all, says no release is covered", () => {
  const { covered, notes } = releasesToCover({ releases: [], trigger: "manual", lastRelease: "v0.1.0" });
  assert.deepEqual(covered, []);
  assert.deepEqual(notes, ["The last recorded release v0.1.0 is no longer a tag, so no release is covered."]);
});

test("only the configured trigger starts a run, and a manual run always may", () => {
  const config = { trigger: { mode: "release" } };
  assert.equal(triggerEnabled(config, "release"), true);
  assert.equal(triggerEnabled(config, "schedule"), false);
  assert.equal(triggerEnabled(config, "manual"), true);
  assert.equal(triggerEnabled({ trigger: { mode: "schedule" } }, "release"), false);
});
