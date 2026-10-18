/**
 * The adapter interface. Every design output (Storybook, Figma, Penpot, Pencil)
 * is one adapter object. The runner calls its four steps in this order, and
 * never any other way:
 *
 *   plan      what to write for the releases being covered
 *   estimate  what those writes would cost
 *   write     do the writes the spending cap allows
 *   report    say what was written, so a person can find it
 *
 * Any step may be async. The cap sits between estimate and write, so an adapter
 * never decides what to defer: it only reports costs honestly and writes what
 * it is given, in the order it is given.
 *
 * @typedef {import("./cost.mjs").Cost} Cost
 *
 * @typedef {object} PlanItem
 * @property {string} id    Unique within the plan. For a component it is the inventory name.
 * @property {"component" | "screen"} kind
 *   Further properties are allowed. The adapter reads them back in write.
 *
 * @typedef {{ items: PlanItem[] }} Plan
 *
 * @typedef {object} Estimate
 * @property {Array<{ id: string } & Partial<Cost>>} items  One entry per plan item.
 * @property {Partial<Cost>} [overhead]  Cost of the run that does not depend on the items,
 *   for example one deployment. It counts against the cap before any item does.
 *
 * @typedef {object} WriteResult
 * @property {string[]} written   Ids of the items written.
 * @property {Array<{ id: string, error: string }>} [failed]  Items that were tried and did not land.
 *   They are retried on the next run, and the cap orders them with everything else.
 * @property {Partial<Cost>} [actual]  What the writes really cost.
 *
 * @typedef {object} AdapterReport
 * @property {string} [summary]  One plain sentence.
 * @property {Array<{ label: string, url: string }>} [links]  Where a person can see the result.
 * @property {object} [details]  Anything else the adapter wants kept in the run report.
 *
 * @typedef {object} StepContext
 * @property {string} output      The output name, such as "storybook".
 * @property {object} settings    This output's block of klaus.config.json.
 * @property {object} selection   The config's selection block, defaults filled in.
 * @property {object} inventory   The parsed inventory.json.
 * @property {string} trigger     "release", "schedule" or "manual".
 * @property {string} release     The newest release covered.
 * @property {string[]} releases  Every release covered, oldest first.
 * @property {string[]} unwrittenFromLastRun
 *   Ids that an earlier run planned and did not write. The plan must include each one that still exists.
 * @property {boolean} dryRun     True when write will not be called.
 * @property {(name: string) => string} secret
 *   Reads a secret from the environment. Only names listed in settings.secrets are readable.
 *
 * @typedef {object} Adapter
 * @property {string} [name]
 * @property {boolean} [usesModel]  True when the output needs a model or a signed-in tool. The
 *   workflow template passes --model-free, which skips these adapters.
 * @property {(ctx: StepContext) => Plan | Promise<Plan>} plan
 * @property {(plan: Plan, ctx: StepContext) => Estimate | Promise<Estimate>} estimate
 * @property {(plan: Plan, ctx: StepContext) => WriteResult | Promise<WriteResult>} write
 *   Receives only the items the cap allows, most-used first, with a usage number on each.
 * @property {(outcome: object, ctx: StepContext) => AdapterReport | Promise<AdapterReport>} report
 *   Receives written, failed, deferred, estimated, actual and dryRun.
 */

export const STEPS = Object.freeze(["plan", "estimate", "write", "report"]);

/** Throws unless the object has all four steps. */
export function assertAdapter(output, adapter) {
  if (!adapter || typeof adapter !== "object") throw new Error(`Adapter for "${output}" must be an object.`);
  for (const step of STEPS) {
    if (typeof adapter[step] !== "function") throw new Error(`Adapter for "${output}" is missing the ${step} step.`);
  }
}

/** Checks the plan an adapter returned and returns it unchanged. */
export function normalizePlan(plan, output) {
  if (!plan || !Array.isArray(plan.items)) throw new Error(`${output} plan must be an object with an items array.`);
  const seen = new Set();
  for (const item of plan.items) {
    if (!item || typeof item.id !== "string" || item.id === "") throw new Error(`${output} plan has an item without an id.`);
    if (item.kind !== "component" && item.kind !== "screen") {
      throw new Error(`${output} plan item "${item.id}" needs a kind of "component" or "screen".`);
    }
    if (seen.has(item.id)) throw new Error(`${output} plan lists "${item.id}" twice.`);
    seen.add(item.id);
  }
  return plan;
}
