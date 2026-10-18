/**
 * Cost arithmetic shared by the cap, the runner and the report.
 *
 * @typedef {{ calls: number, tokens: number, usd: number }} Cost
 *   calls: requests to the output or to a relay.
 *   tokens: relay tokens, the unit the spending cap counts.
 *   usd: money, in US dollars.
 */

/** @returns {Cost} */
export function zeroCost() {
  return { calls: 0, tokens: 0, usd: 0 };
}

/** Sums costs. Money is rounded to a millionth of a dollar so float noise stays out of reports. */
export function sumCosts(costs) {
  const total = zeroCost();
  for (const cost of costs) {
    if (!cost) continue;
    total.calls += cost.calls;
    total.tokens += cost.tokens;
    total.usd += cost.usd;
  }
  total.usd = Math.round(total.usd * 1e6) / 1e6;
  return total;
}

/**
 * Checks a cost an adapter returned. A field left out counts as 0. A field that
 * is present must be a finite number that is not negative.
 * @param {unknown} value
 * @param {string} where  Used in the error message, for example "storybook estimate for Button".
 * @returns {Cost}
 */
export function normalizeCost(value, where) {
  if (value === undefined || value === null) return zeroCost();
  if (typeof value !== "object") throw new Error(`${where}: a cost must be an object with calls, tokens and usd.`);
  const cost = zeroCost();
  for (const field of Object.keys(cost)) {
    const given = value[field];
    if (given === undefined) continue;
    if (typeof given !== "number" || !Number.isFinite(given) || given < 0) {
      throw new Error(`${where}: ${field} must be a number that is not negative.`);
    }
    cost[field] = given;
  }
  return cost;
}
