/**
 * What a purpose may say, and how it is written into a file.
 *
 * A model chooses two sentences. This file decides whether they are acceptable and renders the
 * comment itself, so no other byte a model wrote ever reaches a source file or a markdown view.
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

/**
 * Reads the two sentences out of a comment a writer produced. Returns the sentences, or the
 * reason the comment is not acceptable.
 *
 * @returns {{ ok: true, useWhen: string, notFor: string } | { ok: false, reason: string }}
 */
export function readWrittenPurpose(rawComment) {
  const purpose = parsePurpose(commentBody(rawComment))
  if (!purpose) return { ok: false, reason: 'no comment above the component' }
  const problem = sentenceProblem(purpose.useWhen, 'the Use when sentence') ?? sentenceProblem(purpose.notFor, 'the Not for sentence')
  if (problem) return { ok: false, reason: problem }
  return { ok: true, useWhen: finish(purpose.useWhen), notFor: finish(purpose.notFor) }
}

/** The comment as it is written into a file, with the indentation of the line it sits above. */
export function renderComment({ useWhen, notFor }, indent = '') {
  return [`${indent}/**`, `${indent} * Use when: ${useWhen}`, `${indent} * Not for: ${notFor}`, `${indent} */`].join('\n')
}
