/**
 * What a purpose may say, and how it is written into a file.
 *
 * A model chooses two sentences. This file decides whether they are acceptable and renders the
 * two lines itself, so no other byte a model wrote ever reaches a source file or a markdown view.
 * A comment that was there before is kept: the two lines are added to it.
 */
import { parsePurpose } from '../inventory/components.mjs'

export const MAX_SENTENCE = 200

const FORBIDDEN = [
  [/[^\x20-\x7e]/, 'uses a character that is not plain ASCII'],
  [/\*\/|\/\*/, 'contains a comment marker'],
  [/https?:|www\./i, 'contains a link'],
  [/\]\(/, 'contains markdown link syntax'],
  [/@/, 'contains an @ tag or mention'],
  [/[|\\]/, 'contains a pipe or a backslash'],
  [/<!--|<\/?(?:script|img|a|iframe|style)\b/i, 'contains markup'],
  [/```/, 'contains a code fence'],
]

/** Why a sentence is not acceptable, or null. */
export function sentenceProblem(text, label) {
  if (typeof text !== 'string' || text.trim() === '') return `${label} is empty`
  const sentence = text.trim()
  if (sentence.length < 8) return `${label} is too short`
  if (sentence.length > MAX_SENTENCE) return `${label} is longer than ${MAX_SENTENCE} characters`
  for (const [pattern, why] of FORBIDDEN) if (pattern.test(sentence)) return `${label} ${why}`
  return null
}

/** The text of a doc comment without its markers: `/** Use when: a. Not for: b. *\/` becomes `Use when: a. Not for: b.` */
export function commentBody(raw) {
  return raw.replace(/^\s*\/\*\*?/, '').replace(/\*\/\s*$/, '').split('\n').map((line) => line.replace(/^\s*\*\s?/, '')).join('\n')
}

const finish = (sentence) => {
  const text = sentence.trim().replace(/\s+/g, ' ')
  return /[.!?]$/.test(text) ? text : `${text}.`
}

const collapse = (text) => text.replace(/\s+/g, ' ').trim()

/**
 * The two sentences added to a comment that was there before, and what is left of the comment
 * without them. The sentences run from the "Use when:" label to the first tag after the "Not for:"
 * label, or to the end: a sentence cannot hold an @, so a tag after them is the old comment's.
 */
function splitAddition(text) {
  const use = /\buse when\s*:\s*/i.exec(text)
  if (!use) return null
  const rest = text.slice(use.index + use[0].length)
  const not = /\bnot for\s*:\s*/i.exec(rest)
  if (!not) return null
  const afterNot = rest.slice(not.index + not[0].length)
  const tag = afterNot.search(/(?:^|\s)@\w/)
  return {
    useWhen: rest.slice(0, not.index).trim(),
    notFor: (tag < 0 ? afterNot : afterNot.slice(0, tag)).trim(),
    left: collapse(`${text.slice(0, use.index)} ${tag < 0 ? '' : afterNot.slice(tag)}`),
  }
}

/**
 * Reads the two sentences out of a comment a writer produced. Returns the sentences, or the
 * reason the comment is not acceptable.
 *
 * When the component had a doc comment before (`existingComment`), the writer may only add to it:
 * once the two sentences are taken out, every word of the old comment must still be there, in its
 * order, and nothing else. Line breaks and the comment's stars do not count.
 *
 * @param {string} rawComment
 * @param {string | null} [existingComment]
 * @returns {{ ok: true, useWhen: string, notFor: string } | { ok: false, reason: string }}
 */
export function readWrittenPurpose(rawComment, existingComment = null) {
  let purpose
  if (existingComment) {
    const split = splitAddition(collapse(commentBody(rawComment)))
    if (!split) return { ok: false, reason: 'the writer did not add both a Use when and a Not for line to the existing comment' }
    if (split.left !== collapse(commentBody(existingComment))) return { ok: false, reason: 'the writer did not keep the existing comment whole, with the two lines added after its text' }
    purpose = split
  } else {
    purpose = parsePurpose(commentBody(rawComment))
    if (!purpose) return { ok: false, reason: 'no comment above the component' }
  }
  const problem = sentenceProblem(purpose.useWhen, 'the Use when sentence') ?? sentenceProblem(purpose.notFor, 'the Not for sentence')
  if (problem) return { ok: false, reason: problem }
  return { ok: true, useWhen: finish(purpose.useWhen), notFor: finish(purpose.notFor) }
}

/** The comment as it is written into a file, with the indentation of the line it sits above. */
export function renderComment({ useWhen, notFor }, indent = '') {
  return [`${indent}/**`, `${indent} * Use when: ${useWhen}`, `${indent} * Not for: ${notFor}`, `${indent} */`].join('\n')
}
