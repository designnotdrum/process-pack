/**
 * Which of the onboarding run's three pull requests are already on the default branch, so that a
 * run of the same plan continues from the first one that is not.
 *
 * The first pull request is the list and the duplicates. None of its files is a component file,
 * so the plan can write them again exactly, and it counts as merged when the default branch holds
 * each of them with the same content, apart from the formatting a commit hook may have done:
 * a JSON file is compared as parsed JSON, and a Markdown file with its whitespace collapsed. The
 * list also records the commit it was made at. A list made at an earlier commit of this branch is
 * the same list when everything else in it matches.
 *
 * The second and third change the files the plan is made from (the components, and their
 * stories), so once either has merged a later plan cannot write it again. Each counts as merged
 * when its own record, which no other pull request writes, is on the default branch:
 * `purposes.md` for the second and `stories.json` for the third.
 *
 * When the default branch holds some of the first pull request's files, or holds them with other
 * content, the run refuses and says which files differ and where.
 */
import fs from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { git } from './git.mjs'

const collapse = (text) => text.replace(/\s+/g, ' ').trim()
const MAX_SHOWN = 160
const show = (value) => {
  const text = JSON.stringify(value) ?? 'nothing'
  return text.length > MAX_SHOWN ? `${text.slice(0, MAX_SHOWN)}...` : text
}

/** The first place two parsed JSON values differ, as a path such as `entries[3].props[1].type`. */
export function firstDifference(expected, actual, at = '') {
  if (isDeepStrictEqual(expected, actual)) return null
  const bothObjects = expected && actual && typeof expected === 'object' && typeof actual === 'object' && Array.isArray(expected) === Array.isArray(actual)
  if (!bothObjects) return { path: at || '(the whole file)', expected, actual }
  if (Array.isArray(expected) && expected.length !== actual.length) return { path: `${at || '(the whole file)'} (a list of ${expected.length}, and it has ${actual.length})`, expected: null, actual: null, lengths: true }
  const keys = Array.isArray(expected) ? expected.map((_, i) => i) : [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
  for (const key of keys) {
    const inner = firstDifference(expected[key], actual[key], Array.isArray(expected) ? `${at}[${key}]` : at ? `${at}.${key}` : key)
    if (inner) return inner
  }
  return null
}

const isAncestor = (repo, commit) => typeof commit === 'string' && /^[0-9a-f]{7,64}$/.test(commit) && git(repo, ['merge-base', '--is-ancestor', commit, 'HEAD'], { allowFail: true }) !== null

/**
 * Why the text on the default branch is not what the plan writes, or null when it is the same.
 *
 * @param {object} options
 * @param {string} options.repo
 * @param {string} options.rel The file, from the repo root.
 * @param {string} options.expected What the plan writes.
 * @param {string} options.actual What the default branch holds.
 */
export function contentDifference({ repo, rel, expected, actual }) {
  if (actual === expected) return null
  if (rel.endsWith('.json')) {
    let found
    try {
      found = JSON.parse(actual)
    } catch {
      return 'it is not valid JSON'
    }
    const wanted = JSON.parse(expected)
    // The list says which commit it was made at. One made at an earlier commit of this branch is the same list.
    if (rel === 'inventory.json' && found?.versioned && wanted?.versioned && found.versioned.release === wanted.versioned.release && found.versioned.commit !== wanted.versioned.commit && isAncestor(repo, found.versioned.commit)) {
      found = { ...found, versioned: wanted.versioned }
    }
    const where = firstDifference(wanted, found)
    if (!where) return null
    const entry = /^entries\[(\d+)\]/.exec(where.path)
    const named = entry && wanted.entries?.[Number(entry[1])] ? ` (${wanted.entries[Number(entry[1])].name} in ${wanted.entries[Number(entry[1])].file})` : ''
    return where.lengths ? `at ${where.path}${named}` : `at ${where.path}${named} the plan writes ${show(where.expected)}, and it holds ${show(where.actual)}`
  }
  if (rel.endsWith('.md')) {
    if (collapse(actual) === collapse(expected)) return null
    const a = actual.split('\n').map(collapse).filter(Boolean)
    const e = expected.split('\n').map(collapse).filter(Boolean)
    const line = e.findIndex((text, i) => text !== a[i])
    return line < 0 ? 'it has more text at the end' : `the plan writes ${show(e[line])}, and it holds ${show(a[line] ?? '')}`
  }
  return 'its text is different'
}

/**
 * @param {object} options
 * @param {string} options.repo The repo, on the default branch, with a clean tree.
 * @param {string} options.base The default branch's name, for the messages.
 * @param {string} options.docs The docs folder of the run's records.
 * @param {{ rel: string, text: string, volatile?: boolean }[]} options.listFiles The first pull request's files, as the plan writes them.
 *   A `volatile` file depends on a browser and a Storybook build, not on the plan, so it has only to be there.
 * @returns {{ start: number, merged: number[], refusal: string | null, note: string | null }}
 *   `start` is the first pull request to make: 1, 2 or 3, or 4 when all three are merged.
 */
export function findMerged({ repo, base, docs, listFiles }) {
  const has = (rel) => fs.existsSync(path.join(repo, rel))
  const purposes = `${docs}/purposes.md`
  const stories = `${docs}/stories.json`
  const refuse = (refusal) => ({ start: 0, merged: [], refusal, note: null })
  if (has(stories) && !has(purposes)) return refuse(`${stories} is on ${base} and ${purposes} is not, so the stories were merged before the purposes. The run cannot continue from that: it makes the three pull requests in order.`)
  if (has(stories)) return { start: 4, merged: [1, 2, 3], refusal: null, note: `${purposes} and ${stories} are on ${base}: all three pull requests are merged.` }
  if (has(purposes)) return { start: 3, merged: [1, 2], refusal: null, note: `${purposes} is on ${base}: the first two pull requests are merged, and the run continues at the third.` }

  const present = listFiles.filter((f) => has(f.rel))
  if (present.length === 0) return { start: 1, merged: [], refusal: null, note: null }
  const records = listFiles.filter((f) => f.rel.startsWith(`${docs}/`))
  if (!records.some((f) => has(f.rel))) return refuse('inventory.json already exists, so this repo has a baseline. Run the version picker for a release instead.')
  const problems = []
  for (const file of listFiles) {
    if (!has(file.rel)) problems.push(`${file.rel} is not there`)
    else if (!file.volatile) {
      const why = contentDifference({ repo, rel: file.rel, expected: file.text, actual: fs.readFileSync(path.join(repo, file.rel), 'utf8') })
      if (why) problems.push(`${file.rel}: ${why}`)
    }
  }
  if (problems.length === 0) return { start: 2, merged: [1], refusal: null, note: `The first pull request's files are on ${base}, as this plan writes them (formatting aside), so the run continues at the second.` }
  const shown = problems.slice(0, 5)
  return refuse([
    `The first pull request's files are on ${base}, but not as this plan writes them, so the run cannot continue from them and does not overwrite them.`,
    ...shown.map((p) => `- ${p}`),
    ...(problems.length > shown.length ? [`- and ${problems.length - shown.length} more`] : []),
    `Find out why they differ: a change made on ${base} after the merge, or a repo that no longer gives the list that was merged. When ${base} holds what the plan writes, run again.`,
  ].join('\n'))
}
