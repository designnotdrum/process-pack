/**
 * The runner. For every enabled output it works out the releases to cover,
 * then calls the adapter's four steps in order: plan, estimate, write, report.
 * The spending cap runs between estimate and write.
 *
 * The runner touches no files and runs no commands, so tests drive it with a
 * fake adapter. The command line (cli.mjs) reads the config, inventory, state
 * and git tags, calls runKlaus, then saves the report and the new state.
 *
 * One output failing does not stop the others. A failed output keeps its old
 * state, so its next run covers the same releases again.
 */
import { assertAdapter, normalizePlan } from "./adapter.mjs";
import { applyCap, indexEstimate } from "./cap.mjs";
import { listComponents, usageCount } from "./components.mjs";
import { normalizeCost, zeroCost } from "./cost.mjs";
import { UserError } from "./errors.mjs";
import { buildReport } from "./report.mjs";
import { emptyState } from "./state.mjs";
import { releasesToCover, TRIGGERS, triggerEnabled } from "./triggers.mjs";

function outputRecord(output, fields) {
  return {
    output,
    status: "ok",
    reason: null,
    releases: [],
    planned: 0,
    written: [],
    deferred: [],
    failed: [],
    estimated: zeroCost(),
    estimatedUncapped: zeroCost(),
    actual: zeroCost(),
    adapter: null,
    warnings: [],
    ...fields,
  };
}

/**
 * Removes the values of an output's declared secrets from text headed for a report.
 * Values under 8 characters are left alone: they would also match ordinary words
 * and garble the message.
 */
function redactor(settings, env) {
  const values = settings.secrets.map((name) => env[name]).filter((v) => typeof v === "string" && v.length >= 8);
  return (text) => values.reduce((out, value) => out.split(value).join("[redacted]"), String(text));
}

/** Applies the redactor to every string inside a value. */
function redactDeep(value, redact) {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, redact));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDeep(item, redact)]));
  }
  return value;
}

async function runOutput({ name, settings, adapter, run }) {
  const { config, inventory, trigger, release, releases, previous, usageById, modelFree, dryRun, env, now, log } = run;
  const redact = redactor(settings, env);

  if (!adapter) {
    return { record: outputRecord(name, { status: "failed", error: `No adapter is installed for the ${name} output.` }) };
  }
  try {
    assertAdapter(name, adapter);
  } catch (error) {
    return { record: outputRecord(name, { status: "failed", error: error.message }) };
  }
  if (modelFree && adapter.usesModel) {
    return { record: outputRecord(name, { status: "skipped", reason: "needs-model" }) };
  }

  const entry = previous.outputs[name];
  const unwritten = entry?.unwritten ?? [];
  const { covered, notes } = releasesToCover({ releases, trigger, release, lastRelease: entry?.lastRelease });
  if (covered.length === 0 && unwritten.length === 0) {
    return { record: outputRecord(name, { status: "skipped", reason: "up-to-date", warnings: notes }) };
  }

  const missing = dryRun ? [] : settings.secrets.filter((secret) => !env[secret]);
  if (missing.length > 0) {
    return {
      record: outputRecord(name, {
        status: "failed",
        releases: covered,
        error: `Secrets named in klaus.config.json are not set in the environment: ${missing.join(", ")}.`,
      }),
    };
  }

  const ctx = {
    output: name,
    settings,
    selection: config.selection,
    inventory,
    trigger,
    release: covered.at(-1) ?? entry?.lastRelease ?? null,
    releases: covered,
    unwrittenFromLastRun: unwritten,
    dryRun,
    secret(secretName) {
      if (!settings.secrets.includes(secretName)) {
        throw new Error(`"${secretName}" is not listed under secrets for the ${name} output.`);
      }
      return env[secretName];
    },
  };

  let step = "plan";
  let plan;
  let capped;
  let result = { written: [], failed: [], actual: zeroCost() };
  try {
    plan = normalizePlan(await adapter.plan(ctx), name);
    step = "estimate";
    const estimate = indexEstimate(plan, await adapter.estimate(plan, ctx), name);
    step = "cap";
    capped = applyCap({ items: plan.items, estimate, usageById, cap: config.spendingCap });
    if (!dryRun && capped.allowed.length > 0) {
      step = "write";
      const raw = await adapter.write({ items: capped.allowed }, ctx);
      result = readWriteResult(raw, capped.allowed, name);
    }
  } catch (error) {
    return {
      record: outputRecord(name, { status: "failed", failedStep: step, error: redact(error.message), releases: covered, warnings: notes }),
    };
  }

  const failedIds = new Set(result.failed.map((f) => f.id));
  const written = result.written;
  const notWritten = capped.allowed
    .filter((item) => !written.includes(item.id) && !failedIds.has(item.id))
    .map((item) => ({ id: item.id, kind: item.kind, usage: item.usage, reason: "not-written" }));
  const deferred = dryRun ? capped.deferred : [...capped.deferred, ...notWritten];
  const failed = result.failed.map((f) => ({ id: f.id, error: redact(f.error) }));

  const warnings = [...notes];
  const wrote = !dryRun && capped.allowed.length > 0;
  if (wrote && result.actual === null) warnings.push("The adapter did not report what the writes cost.");

  let adapterReport = null;
  try {
    const reported = await adapter.report(
      { written, failed, deferred, estimated: capped.estimated, estimatedUncapped: capped.estimatedUncapped, actual: result.actual, dryRun },
      ctx,
    );
    adapterReport = reported && typeof reported === "object" ? redactDeep(reported, redact) : null;
  } catch (error) {
    warnings.push(`The report step failed: ${redact(error.message)}`);
  }

  const count = dryRun ? capped.allowed.length : written.length;
  log(`${name}: ${dryRun ? "would write" : "wrote"} ${count}, deferred ${deferred.length}, failed ${failed.length}`);

  const record = outputRecord(name, {
    status: dryRun ? "dry-run" : "ok",
    releases: covered,
    planned: plan.items.length,
    written,
    deferred,
    failed,
    estimated: capped.estimated,
    estimatedUncapped: capped.estimatedUncapped,
    actual: result.actual,
    adapter: adapterReport,
    warnings,
  });
  const stateEntry = dryRun
    ? null
    : {
        lastRelease: covered.at(-1) ?? entry?.lastRelease,
        lastRunAt: now().toISOString(),
        unwritten: [...new Set([...deferred.map((d) => d.id), ...failed.map((f) => f.id)])],
      };
  return { record, stateEntry };
}

/** Checks what write returned against the items it was given. */
function readWriteResult(raw, allowed, output) {
  if (!raw || !Array.isArray(raw.written)) throw new Error(`${output} write must return an object with a written array.`);
  const given = new Set(allowed.map((item) => item.id));
  const failed = raw.failed ?? [];
  const reported = [...raw.written, ...failed.map((f) => f?.id)];
  for (const id of reported) {
    if (!given.has(id)) throw new Error(`${output} write reported "${id}", which was not in the items it was given.`);
  }
  if (new Set(reported).size !== reported.length) {
    throw new Error(`${output} write reported the same id more than once.`);
  }
  return {
    written: raw.written,
    failed: failed.map((f) => ({ id: f.id, error: String(f.error ?? "failed") })),
    actual: raw.actual === undefined ? null : normalizeCost(raw.actual, `${output} actual cost`),
  };
}

/**
 * @param {object} options
 * @param {object} options.config       From resolveConfig.
 * @param {object} options.inventory    Parsed inventory.json.
 * @param {Record<string, import("./adapter.mjs").Adapter>} options.adapters  By output name.
 * @param {string[]} options.releases   Every release tag, oldest first.
 * @param {"release" | "schedule" | "manual"} options.trigger
 * @param {string} [options.release]    Required when trigger is "release".
 * @param {object} [options.state]      From readState. Defaults to a first run.
 * @param {boolean} [options.modelFree] Skip adapters that need a model.
 * @param {boolean} [options.dryRun]    Plan and estimate only. Nothing is written or recorded.
 * @param {Record<string, string | undefined>} [options.env]
 * @param {() => Date} [options.now]
 * @param {(line: string) => void} [options.log]
 * @returns {Promise<{ report: object, state: object }>}
 *   state is the state to save. For a dry run or a skipped trigger it is the state that came in.
 */
export async function runKlaus(options) {
  const {
    config, inventory, adapters, releases = [], trigger, release, state = emptyState(),
    modelFree = false, dryRun = false, env = process.env, now = () => new Date(), log = () => {},
  } = options;
  if (!TRIGGERS.includes(trigger)) throw new UserError(`Unknown trigger "${trigger}".`);
  if (trigger === "release" && !releases.includes(release)) {
    throw new UserError(`Release ${release} is not among the release tags.`);
  }

  const startedAt = now();
  const common = {
    startedAt, trigger, dryRun, cap: config.spendingCap,
    release: trigger === "release" ? release : (releases.at(-1) ?? null),
  };

  if (!triggerEnabled(config, trigger)) {
    const reason = `The ${trigger} trigger is not enabled in klaus.config.json (trigger.mode is ${config.trigger.mode}).`;
    return { report: buildReport({ ...common, status: "skipped", reason, outputs: [], finishedAt: now() }), state };
  }

  const usageById = new Map(listComponents(inventory).map((c) => [c.name, usageCount(c)]));
  const run = { config, inventory, trigger, release, releases, previous: state, usageById, modelFree, dryRun, env, now, log };
  const nextState = structuredClone(state);
  const outputs = [];

  for (const [name, settings] of Object.entries(config.outputs)) {
    if (!settings.enabled) continue;
    const { record, stateEntry } = await runOutput({ name, settings, adapter: adapters[name], run });
    outputs.push(record);
    if (stateEntry) nextState.outputs[name] = stateEntry;
  }

  // A write that did not land is a failure even when the output itself ran.
  const status = outputs.some((o) => o.status === "failed" || o.failed.length > 0) ? "failed" : "ok";
  return { report: buildReport({ ...common, status, outputs, finishedAt: now() }), state: dryRun ? state : nextState };
}
