/**
 * Checks what the writer changed against the plan, and writes the comments itself.
 *
 * The plan says which components may get a doc comment. A writer's file passes only if, once the
 * doc comments of those components are cut out, the file is the same as before (line breaks and
 * indentation aside). Then the two sentences are read out of each comment and the comment is
 * written from them in one fixed form. No other byte the model produced reaches a source file.
 */
import { docCommentOf, findComponent, parseSource } from './source.mjs'
import { readWrittenPurpose, renderComment } from './purpose-text.mjs'

/** Line breaks and indentation are not code, so a writer that re-indents a line is not a failure. */
const normalize = (text) => text.replace(/[ \t]*\r?\n\s*/g, '\n').trim()

function without(text, ranges) {
  let out = text
  for (const { start, end } of [...ranges].sort((a, b) => b.start - a.start)) out = out.slice(0, start) + out.slice(end)
  return out
}

/**
 * Judges one file the writer touched.
 *
 * @param {object} options
 * @param {object} options.ts
 * @param {string} options.file
 * @param {string} options.before The file as it was.
 * @param {string} options.after The file as the writer left it.
 * @param {{ id: string, name: string }[]} options.components The components the plan lists for this file.
 * @returns {{ results: { id: string, ok: boolean, reason?: string, useWhen?: string, notFor?: string }[], changedMore: boolean }}
 */
export function judgeWrittenFile({ ts, file, before, after, components }) {
  const fail = (reason) => ({ changedMore: true, results: components.map((c) => ({ id: c.id, ok: false, reason })) })
  let beforeFile
  let afterFile
  try {
    beforeFile = parseSource(ts, file, before)
    afterFile = parseSource(ts, file, after)
  } catch {
    return fail('the file could not be read after the change')
  }
  const beforeDocs = []
  const afterDocs = []
  const afterComments = new Map()
  for (const component of components) {
    const was = findComponent(ts, beforeFile, component.name)
    const now = findComponent(ts, afterFile, component.name)
    if (!was || !now) return fail('the component can no longer be found where it was')
    const docBefore = docCommentOf(ts, beforeFile, was.statement)
    const docAfter = docCommentOf(ts, afterFile, now.statement)
    if (docBefore) beforeDocs.push(docBefore)
    if (docAfter) {
      afterDocs.push(docAfter)
      afterComments.set(component.id, docAfter.text)
    }
  }
  if (normalize(without(before, beforeDocs)) !== normalize(without(after, afterDocs))) return fail('the writer changed more than the doc comments of the listed components')
  const results = components.map((component) => {
    const raw = afterComments.get(component.id)
    if (!raw) return { id: component.id, ok: false, reason: 'the writer left no comment' }
    const read = readWrittenPurpose(raw)
    return read.ok ? { id: component.id, ok: true, useWhen: read.useWhen, notFor: read.notFor } : { id: component.id, ok: false, reason: read.reason }
  })
  // Two listed components cannot share one comment.
  return { changedMore: false, results }
}

/** Where a new comment goes: above the `//` comments that sit directly on the declaration, so a lint directive keeps its target. */
function insertionPoint(ts, text, statement, sourceFile) {
  const ranges = ts.getLeadingCommentRanges(text, statement.getFullStart()) ?? []
  let point = statement.getStart(sourceFile)
  for (const range of [...ranges].reverse()) {
    const between = text.slice(range.end, point)
    if (/^[ \t]*\r?\n?[ \t]*$/.test(between) && (between.match(/\n/g) ?? []).length <= 1 && range.kind === ts.SyntaxKind.SingleLineCommentTrivia) point = range.pos
    else break
  }
  return point
}

/**
 * Writes accepted purposes into the original text and returns the new text. A component with a
 * doc comment gets it replaced. One without gets a new comment above its declaration.
 *
 * @param {object} ts
 * @param {string} file
 * @param {string} before
 * @param {{ name: string, useWhen: string, notFor: string }[]} accepted
 */
export function applyPurposes(ts, file, before, accepted) {
  const sourceFile = parseSource(ts, file, before)
  const edits = []
  for (const purpose of accepted) {
    const found = findComponent(ts, sourceFile, purpose.name)
    if (!found) throw new Error(`${purpose.name} is not in ${file}.`)
    const doc = docCommentOf(ts, sourceFile, found.statement)
    const at = doc ? doc.start : insertionPoint(ts, before, found.statement, sourceFile)
    const lineStart = before.lastIndexOf('\n', at - 1) + 1
    const lead = before.slice(lineStart, at)
    const indent = /^[ \t]*$/.test(lead) ? lead : ''
    const comment = renderComment(purpose, indent).slice(indent.length)
    edits.push(doc ? { start: doc.start, end: doc.end, text: comment } : { start: at, end: at, text: `${comment}\n${indent}` })
  }
  let out = before
  for (const edit of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end)
  // The result must read back as what was meant, or it is not written.
  const check = parseSource(ts, file, out)
  for (const purpose of accepted) {
    const found = findComponent(ts, check, purpose.name)
    const doc = found && docCommentOf(ts, check, found.statement)
    const read = doc && readWrittenPurpose(doc.text)
    if (!read?.ok || read.useWhen !== purpose.useWhen || read.notFor !== purpose.notFor) throw new Error(`The comment for ${purpose.name} in ${file} did not read back as written.`)
  }
  return out
}
