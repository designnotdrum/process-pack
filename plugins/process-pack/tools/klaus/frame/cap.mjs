/**
 * The spending cap. It sits between an adapter's estimate and its write.
 *
 * Items are ranked by usage, highest first, and ties go to the lower id so the
 * order never changes between runs. Each item in that order is written if it
 * fits under both limits and deferred if it does not. Nothing here throws
 * because a limit was hit: a run over the cap writes what fits and defers the
 * rest to the next run.
 *
 * Limits:
 *   maxComponentWrites  counts items of kind "component". Screens do not count.
 *   maxRelayTokens      counts the tokens of every item, plus the estimate's overhead.
 */
import { sumCosts, zeroCost, normalizeCost } from "./cost.mjs";

/**
 * Checks an estimate against its plan and returns a map from id to cost.
 * @returns {{ byId: Map<string, import("./cost.mjs").Cost>, overhead: import("./cost.mjs").Cost }}
 */
export function indexEstimate(plan, estimate, output) {
  if (!estimate || !Array.isArray(estimate.items)) throw new Error(`${output} estimate must be an object with an items array.`);
  const byId = new Map();
  for (const entry of estimate.items) {
    byId.set(entry.id, normalizeCost(entry, `${output} estimate for ${entry.id}`));
  }
  for (const item of plan.items) {
    if (!byId.has(item.id)) throw new Error(`${output} estimate has no entry for "${item.id}".`);
  }
  return { byId, overhead: normalizeCost(estimate.overhead, `${output} estimate overhead`) };
}

/** Plain code-unit order, so the tie-break never depends on the machine's locale. */
function compareIds(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/**
 * @param {object} args
 * @param {Array<{ id: string, kind: string }>} args.items
 * @param {{ byId: Map<string, import("./cost.mjs").Cost>, overhead: import("./cost.mjs").Cost }} args.estimate
 * @param {Map<string, number>} args.usageById
 * @param {{ maxComponentWrites: number, maxRelayTokens: number }} args.cap
 * @returns {{
 *   allowed: Array<object>,
 *   deferred: Array<{ id: string, kind: string, usage: number, reason: "write-cap" | "token-cap" | "larger-than-token-cap" }>,
 *   estimated: import("./cost.mjs").Cost,
 *   estimatedUncapped: import("./cost.mjs").Cost,
 * }}
 *   allowed is in write order. Reasons: write-cap means the component limit was reached,
 *   token-cap means the item did not fit in the tokens left, larger-than-token-cap means
 *   the item, with the estimate's overhead, needs more than the whole token limit and will
 *   never be written.
 */
export function applyCap({ items, estimate, usageById, cap }) {
  const ranked = items
    .map((item) => ({ ...item, usage: usageById.get(item.id) ?? 0 }))
    .sort((a, b) => b.usage - a.usage || compareIds(a.id, b.id));

  const room = cap.maxRelayTokens - estimate.overhead.tokens;
  let tokens = 0;
  let componentWrites = 0;
  const allowed = [];
  const deferred = [];

  for (const item of ranked) {
    const itemTokens = estimate.byId.get(item.id).tokens;
    const isComponent = item.kind === "component";
    let reason = null;
    if (isComponent && componentWrites >= cap.maxComponentWrites) reason = "write-cap";
    else if (room < 0 || itemTokens > room) reason = "larger-than-token-cap";
    else if (tokens + itemTokens > room) reason = "token-cap";

    if (reason) {
      deferred.push({ id: item.id, kind: item.kind, usage: item.usage, reason });
      continue;
    }
    allowed.push(item);
    tokens += itemTokens;
    if (isComponent) componentWrites += 1;
  }

  const costOf = (list) => sumCosts([...list.map((item) => estimate.byId.get(item.id)), estimate.overhead]);
  return {
    allowed,
    deferred,
    estimated: allowed.length > 0 ? costOf(allowed) : zeroCost(),
    estimatedUncapped: costOf(ranked),
  };
}
