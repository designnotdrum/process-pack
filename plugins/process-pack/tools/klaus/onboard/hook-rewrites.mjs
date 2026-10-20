/**
 * The lines a repo's commit hook rewrote.
 *
 * The run writes whole files and commits them. A pre-commit hook that fixes what it finds (a
 * linter with an autofix, a formatter) changes the staged files and stages them again, so the
 * commit holds text Klaus did not write. This compares each committed file with the text the run
 * wrote. Every line that is different was added, changed or removed by the hook, because Klaus
 * wrote the whole file. The run does not undo the change and does not skip the hook.
 *
 * Only text the run wrote is compared. A picture, or a file the hook added to the commit that the
 * run never wrote, is not.
 */
import { git } from './git.mjs'

/**
 * The most edits the line comparison searches for. Past it the lines between the first and last
 * ones that agree count as one rewritten block, which is a larger answer than the smallest one but
 * always a correct one, and the search stays fast on a file the hook rewrote throughout.
 */
const MAX_EDITS = 400

/**
 * The lines of `before` removed and the lines of `after` added, as the smallest set of edits
 * (Myers' algorithm) found within MAX_EDITS, or null when there are more.
 * Returns { removed: Set of indexes into before, added: Set of indexes into after }.
 */
function smallestEdits(before, after) {
  const n = before.length
  const m = after.length
  const max = Math.min(n + m, MAX_EDITS)
  const offset = max + 1
  const frontier = new Int32Array(2 * max + 3)
  const trace = []
  for (let d = 0; d <= max; d++) {
    trace.push(frontier.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && frontier[offset + k - 1] < frontier[offset + k + 1]) ? frontier[offset + k + 1] : frontier[offset + k - 1] + 1
      let y = x - k
      while (x < n && y < m && before[x] === after[y]) {
        x += 1
        y += 1
      }
      frontier[offset + k] = x
      if (x >= n && y >= m) return collectEdits(trace, offset, n, m)
    }
  }
  return null
}

/** Walks the saved frontiers back from the end to say which lines each edit removed or added. */
function collectEdits(trace, offset, n, m) {
  const removed = new Set()
  const added = new Set()
  let x = n
  let y = m
  for (let d = trace.length - 1; d > 0; d--) {
    const before = trace[d]
    const k = x - y
    const previousK = k === -d || (k !== d && before[offset + k - 1] < before[offset + k + 1]) ? k + 1 : k - 1
    const previousX = before[offset + previousK]
    const previousY = previousX - previousK
    while (x > previousX && y > previousY) {
      x -= 1
      y -= 1
    }
    if (x === previousX) added.add(previousY)
    else removed.add(previousX)
    x = previousX
    y = previousY
  }
  return { removed, added }
}

/**
 * The places two lists of lines differ: [{ at, removed, added }]. `at` is the line number, counting
 * from 1 in `after`, where the changed lines begin, `removed` the lines of `before` that are gone
 * and `added` the lines of `after` that take their place (either may be empty).
 */
export function changedHunks(before, after) {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1
  let endBefore = before.length
  let endAfter = after.length
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1
    endAfter -= 1
  }
  const middleBefore = before.slice(start, endBefore)
  const middleAfter = after.slice(start, endAfter)
  if (middleBefore.length === 0 && middleAfter.length === 0) return []
  const edits = smallestEdits(middleBefore, middleAfter) ?? { removed: new Set(middleBefore.keys()), added: new Set(middleAfter.keys()) }
  const hunks = []
  let i = 0
  let j = 0
  while (i < middleBefore.length || j < middleAfter.length) {
    if (!edits.removed.has(i) && !edits.added.has(j)) {
      // A line neither removed nor added is the same line in both.
      i += 1
      j += 1
      continue
    }
    const hunk = { at: start + j + 1, removed: [], added: [] }
    while (i < middleBefore.length && edits.removed.has(i)) hunk.removed.push(middleBefore[i++])
    while (j < middleAfter.length && edits.added.has(j)) hunk.added.push(middleAfter[j++])
    hunks.push(hunk)
  }
  return hunks
}

/**
 * One entry for each line the hook rewrote in a file: { rel, line, before, after }.
 * `line` counts from 1 in the committed file. A changed line has both texts. A line the hook added
 * has no `before` (null). A line it removed has no `after` (null), and its `line` is the one that
 * follows the place it was removed from, which is past the last line when it was the last. In a place where the hook replaced some lines with a different
 * number of lines, the old and new lines are paired in order and the rest are additions or removals.
 */
export function lineRewrites(rel, written, committed) {
  if (written === committed) return []
  const rewrites = []
  for (const hunk of changedHunks(written.split('\n'), committed.split('\n'))) {
    const count = Math.max(hunk.removed.length, hunk.added.length)
    // Lines removed from one place all get the same `line`: they were one run of lines, and the
    // committed file has no line numbers of its own for them. The body shows "removed after line N" for each.
    for (let i = 0; i < count; i++) rewrites.push({ rel, line: hunk.at + Math.min(i, hunk.added.length), before: hunk.removed[i] ?? null, after: hunk.added[i] ?? null })
  }
  return rewrites
}

/**
 * Compares what a commit holds with what the run wrote, for each file the run wrote.
 *
 * @param {object} options
 * @param {string} options.repo
 * @param {string} options.commit The commit just made.
 * @param {Map<string, string>} options.written The text the run wrote, by path from the repo root. A file the commit lacks counts as emptied.
 * @returns {{ rel: string, line: number, before: string | null, after: string | null }[]} In the order of `written`, then of the lines.
 */
export function findHookRewrites({ repo, commit, written }) {
  const rewrites = []
  for (const [rel, text] of written) {
    const committed = git(repo, ['cat-file', 'blob', `${commit}:${rel}`], { allowFail: true }) ?? ''
    rewrites.push(...lineRewrites(rel, text, committed))
  }
  return rewrites
}

/** The rewrites counted for each file: [{ rel, count }], in the order the files first appear. */
export function countByFile(rewrites) {
  const counts = new Map()
  for (const { rel } of rewrites) counts.set(rel, (counts.get(rel) ?? 0) + 1)
  return [...counts].map(([rel, count]) => ({ rel, count }))
}
