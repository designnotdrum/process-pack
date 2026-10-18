/** The kinds of change, from the smallest to the largest. `none` is no change at all. */
export const LEVELS = ['none', 'patch', 'minor', 'major']

/** What every entry starts at when a repo is onboarded. */
export const BASELINE = '1.0.0'

const rank = (level) => LEVELS.indexOf(level)

/** The larger of two levels. One bump per component per release, and the highest kind wins. */
export const higher = (a, b) => (rank(b) > rank(a) ? b : a)

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/

export const isVersion = (value) => typeof value === 'string' && VERSION.test(value)

/**
 * `1.2.3` plus a level. A major bump zeroes the minor and patch numbers, a minor bump zeroes the
 * patch number. A version that is empty or not x.y.z counts as the baseline, which is what an
 * entry carries before any run has versioned it.
 */
export function bumpVersion(version, level) {
  if (!LEVELS.includes(level)) throw new Error(`Unknown level ${JSON.stringify(level)}.`)
  const match = VERSION.exec(isVersion(version) ? version : BASELINE)
  const [major, minor, patch] = match.slice(1).map(Number)
  if (level === 'major') return `${major + 1}.0.0`
  if (level === 'minor') return `${major}.${minor + 1}.0`
  if (level === 'patch') return `${major}.${minor}.${patch + 1}`
  return `${major}.${minor}.${patch}`
}
