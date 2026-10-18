/**
 * A fake adapter and fixtures for the frame's tests. The adapter records every
 * step it is called with into a shared log, so a test can check the order.
 */
import { resolveConfig } from "../config.mjs";

/** An inventory, in the shape the inventory script writes, where each entry is used in the given number of files. */
export function inventoryOf(usage) {
  return {
    schemaVersion: 1,
    folders: ["packages/ui"],
    entries: Object.entries(usage).map(([name, count]) => ({
      name,
      file: `packages/ui/${name}.tsx`,
      folder: "packages/ui",
      kind: "shared",
      parts: [],
      props: [],
      variants: [],
      purpose: { useWhen: "", notFor: "" },
      version: "1.0.0",
      screenshot: null,
      usedIn: Array.from({ length: count }, (_, i) => `apps/web/app/screens/screen-${i}.tsx`),
    })),
  };
}

export function configOf(overrides = {}) {
  return resolveConfig({ outputs: { storybook: { enabled: true } }, ...overrides });
}

/**
 * @param {object} options
 * @param {Array<{ output: string, step: string }>} options.log  Shared across adapters.
 * @param {string} [options.output]
 * @param {string[]} [options.ids]            Component ids the plan lists.
 * @param {string[]} [options.screens]        Screen ids the plan lists.
 * @param {(id: string) => object} [options.cost]  Estimate for one item.
 * @param {object} [options.overhead]
 * @param {string[]} [options.failIds]        Ids whose write fails.
 * @param {string} [options.throwAt]          A step that throws.
 * @param {boolean} [options.usesModel]
 * @param {boolean} [options.omitActual]
 */
export function fakeAdapter({
  log,
  output = "storybook",
  ids = [],
  screens = [],
  cost = () => ({ calls: 1, tokens: 100, usd: 0.01 }),
  overhead,
  failIds = [],
  throwAt,
  usesModel = false,
  omitActual = false,
}) {
  const seen = { plan: [], estimate: [], write: [], report: [] };
  const step = (name, args) => {
    log.push({ output, step: name });
    seen[name].push(args);
    if (throwAt === name) throw new Error(`${name} blew up with token-value-12345678`);
  };
  return {
    seen,
    usesModel,
    plan(ctx) {
      step("plan", ctx);
      const wanted = new Set([...ids, ...ctx.unwrittenFromLastRun]);
      return {
        items: [
          ...[...wanted].map((id) => ({ id, kind: "component" })),
          ...screens.map((id) => ({ id, kind: "screen" })),
        ],
      };
    },
    estimate(plan) {
      step("estimate", plan);
      return { items: plan.items.map((item) => ({ id: item.id, ...cost(item.id) })), overhead };
    },
    write(plan) {
      step("write", plan);
      const failed = plan.items.filter((i) => failIds.includes(i.id)).map((i) => ({ id: i.id, error: "relay refused it" }));
      const written = plan.items.filter((i) => !failIds.includes(i.id)).map((i) => i.id);
      const actual = omitActual ? undefined : { calls: written.length, tokens: written.length * 80, usd: written.length * 0.008 };
      return { written, failed, actual };
    },
    report(outcome, ctx) {
      step("report", outcome);
      return { summary: `${output}: ${outcome.written.length} written`, links: [{ label: "Result", url: `https://example.test/${ctx.release}` }] };
    },
  };
}
