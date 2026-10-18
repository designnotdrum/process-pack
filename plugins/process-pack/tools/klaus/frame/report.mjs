/**
 * The run report: one JSON file per run, written for a weekly scorecard to read.
 *
 * Top level: schemaVersion, status, reason, startedAt, finishedAt, trigger,
 * release, dryRun, cap, totals, outputs.
 *
 * status is "ok", "failed" (an output failed, or a write did not land) or
 * "skipped" (the trigger is not enabled in the config). A run that deferred
 * work because of the cap is "ok".
 *
 * Each entry in outputs has: output, status ("ok", "dry-run", "skipped",
 * "failed"), reason, releases, planned, written (ids), deferred (id, kind,
 * usage, reason), failed (id, error), estimated, estimatedUncapped, actual,
 * adapter, warnings, and error and failedStep when the output failed.
 * estimated is what the allowed writes were expected to cost, estimatedUncapped
 * what the whole plan would have cost. actual is null only when the adapter
 * wrote and did not say what it cost. Costs are { calls, tokens, usd }.
 */
import path from "node:path";
import { sumCosts } from "./cost.mjs";
import { writeJsonFile } from "./json-file.mjs";

export const REPORT_SCHEMA_VERSION = 1;

export function buildReport({ status, reason = null, startedAt, finishedAt, trigger, release, dryRun, cap, outputs }) {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    status,
    reason,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    trigger,
    release: release ?? null,
    dryRun,
    cap: { maxComponentWrites: cap.maxComponentWrites, maxRelayTokens: cap.maxRelayTokens },
    totals: {
      written: outputs.reduce((n, o) => n + o.written.length, 0),
      deferred: outputs.reduce((n, o) => n + o.deferred.length, 0),
      failed: outputs.reduce((n, o) => n + o.failed.length, 0),
      estimated: sumCosts(outputs.map((o) => o.estimated)),
      actual: sumCosts(outputs.map((o) => o.actual)),
    },
    outputs,
  };
}

/** A name that sorts by time and has no characters a filesystem dislikes. */
export function reportFileName(startedAt) {
  return `report-${startedAt.toISOString().replace(/[:.]/g, "-")}.json`;
}

export function writeReport(dir, report) {
  const file = path.join(dir, reportFileName(new Date(report.startedAt)));
  writeJsonFile(file, report);
  return file;
}
