/**
 * Which releases a run covers.
 *
 * A run can start three ways:
 *   release   CI after a release tag. This is the default.
 *   schedule  a cron job.
 *   manual    a one-off command, which always works.
 *
 * Every run covers each release since that output's last recorded run, up to
 * the release that started it (release) or the newest release (schedule and
 * manual). So a release missed by a failed run, or by a weekly schedule, is
 * picked up next time. An output with no recorded run covers the newest release
 * only: the first run for a repo is the onboarding baseline, not a replay of
 * its tag history.
 */

import { UserError } from "./errors.mjs";

export const TRIGGERS = Object.freeze(["release", "schedule", "manual"]);

/**
 * Whether the config lets this trigger start a run. A manual run always may.
 * @param {{ trigger: { mode: string } }} config
 */
export function triggerEnabled(config, trigger) {
  return trigger === "manual" || config.trigger.mode === trigger;
}

/**
 * @param {object} args
 * @param {string[]} args.releases      Every release tag, oldest first.
 * @param {string} args.trigger
 * @param {string} [args.release]       The tag that started a release run.
 * @param {string} [args.lastRelease]   The newest release this output has covered.
 * @returns {{ covered: string[], notes: string[] }}
 */
export function releasesToCover({ releases, trigger, release, lastRelease }) {
  const notes = [];
  let end;
  if (trigger === "release") {
    end = releases.indexOf(release);
    if (end < 0) throw new UserError(`Release ${release} is not among the release tags.`);
  } else {
    end = releases.length - 1;
  }

  const start = lastRelease === undefined ? -1 : releases.indexOf(lastRelease);
  if (start < 0) {
    const covered = end >= 0 ? [releases[end]] : [];
    if (lastRelease !== undefined) {
      // A deleted or renamed tag leaves no way to tell which releases came after it. Stopping would
      // wedge every later run until someone edits the state file, so recover from one release
      // and leave the note in the run report.
      const now = covered.length > 0 ? `only ${covered[0]} is covered` : "no release is covered";
      notes.push(`The last recorded release ${lastRelease} is no longer a tag, so ${now}.`);
    }
    return { covered, notes };
  }
  return { covered: releases.slice(start + 1, end + 1), notes };
}
