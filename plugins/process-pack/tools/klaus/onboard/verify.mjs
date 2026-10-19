/**
 * Checks what the writer changed against the plan, and writes the comments itself.
 *
 * The plan says which components may get a doc comment. A writer's file passes only if, once the
 * doc comments of those components are cut out, the file is the same as before (line breaks and
 * indentation aside). Then the two sentences are read out of each comment. A component that had a
 * doc comment must still have all of its text, with only the two lines added. The run writes the
 * two lines itself, in one fixed form: no other byte the model produced reaches a source file, and
 * no byte of a comment that was there before is removed.
 */
import { parsePurpose } from '../inventory/components.mjs'
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
  const beforeComments = new Map()
  for (const component of components) {
    const was = findComponent(ts, beforeFile, component.name)
    const now = findComponent(ts, afterFile, component.name)
    if (!was || !now) return fail('the component can no longer be found where it was')
    const docBefore = docCommentOf(ts, beforeFile, was.statement)
    const docAfter = docCommentOf(ts, afterFile, now.statement)
    if (docBefore) {
      beforeDocs.push(docBefore)
      beforeComments.set(component.id, docBefore.text)
    }
    if (docAfter) {
      afterDocs.push(docAfter)
      afterComments.set(component.id, docAfter.text)
    }
  }
  if (normalize(without(before, beforeDocs)) !== normalize(without(after, afterDocs))) return fail('the writer changed more than the doc comments of the listed components')
  const results = components.map((component) => {
    const raw = afterComments.get(component.id)
    if (!raw) return { id: component.id, ok: false, reason: 'the writer left no comment' }
    const read = readWrittenPurpose(raw, beforeComments.get(component.id) ?? null)
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

/** A line of a doc comment that holds no text: blank, a lone star, or the opening marker. */
const EMPTY_LINE = /^[ \t]*(?:\/\*\*|\*)?[ \t]*\r?$/

/**
 * The edit that adds the two lines to a doc comment that is already there, keeping every byte of
 * it. The lines go after its text, before its first tag (the inventory reads only the text before
 * the tags), as a paragraph of their own. A comment whose text and closing marker or first tag
 * share a line, such as a one-line comment, is laid out again over several lines, with its words
 * unchanged.
 */
function addToDoc(text, doc, purpose, indent) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const close = doc.end - 2
  const tag = doc.node.tags?.[0]?.pos ?? -1
  const at = tag >= 0 ? tag : close
  const lineStart = text.lastIndexOf('\n', at - 1) + 1
  const lead = text.slice(lineStart, at)
  if (lineStart > doc.start && /^[ \t]*\*?[ \t]*$/.test(lead)) {
    const star = `${/^[ \t]*/.exec(lead)[0]}*`
    const previous = text.slice(Math.max(text.lastIndexOf('\n', lineStart - 2) + 1, 0), lineStart - 1)
    const lines = [...(EMPTY_LINE.test(previous) ? [] : [star]), `${star} Use when: ${purpose.useWhen}`, `${star} Not for: ${purpose.notFor}`, ...(tag >= 0 ? [star] : [])]
    return { start: lineStart, end: lineStart, text: lines.map((line) => `${line}${eol}`).join('') }
  }
  const lines = (raw) => {
    const all = raw.split(/\r?\n/).map((line) => line.replace(/^[ \t]*\*?[ \t]?/, '').replace(/[ \t]+$/, ''))
    while (all.length && all[0] === '') all.shift()
    while (all.length && all.at(-1) === '') all.pop()
    return all
  }
  const description = lines(text.slice(doc.start + 3, at))
  const tags = tag >= 0 ? lines(text.slice(tag, close)) : []
  const body = [...description, ...(description.length ? [''] : []), `Use when: ${purpose.useWhen}`, `Not for: ${purpose.notFor}`, ...(tags.length ? ['', ...tags] : [])]
  return { start: doc.start, end: doc.end, text: ['/**', ...body.map((line) => (line ? ` * ${line}` : ' *')), ' */'].join(`${eol}${indent}`) }
}

/**
 * Writes accepted purposes into the original text and returns the new text. A component with a
 * doc comment keeps it and gets the two lines added to it. One without gets a new comment above
 * its declaration.
 *
 * @param {object} ts
 * @param {string} file
 * @param {string} before
 * @param {{ name: string, useWhen: string, notFor: string }[]} accepted
 */
export function applyPurposes(ts, file, before, accepted) {
  const sourceFile = parseSource(ts, file, before)
  const edits = []
  const existing = new Map()
  for (const purpose of accepted) {
    const found = findComponent(ts, sourceFile, purpose.name)
    if (!found) throw new Error(`${purpose.name} is not in ${file}.`)
    const doc = docCommentOf(ts, sourceFile, found.statement)
    const at = doc ? doc.start : insertionPoint(ts, before, found.statement, sourceFile)
    const lineStart = before.lastIndexOf('\n', at - 1) + 1
    const lead = before.slice(lineStart, at)
    const indent = /^[ \t]*$/.test(lead) ? lead : ''
    if (doc) {
      existing.set(purpose.name, doc.text)
      edits.push(addToDoc(before, doc, purpose, indent))
    } else {
      const comment = renderComment(purpose, indent).slice(indent.length)
      edits.push({ start: at, end: at, text: `${comment}\n${indent}` })
    }
  }
  let out = before
  for (const edit of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end)
  // The result must read back as what was meant, or it is not written: the old comment whole, the
  // two sentences added, and the sentences where the inventory reads a purpose.
  const check = parseSource(ts, file, out)
  for (const purpose of accepted) {
    const found = findComponent(ts, check, purpose.name)
    const doc = found && docCommentOf(ts, check, found.statement)
    const read = doc && readWrittenPurpose(doc.text, existing.get(purpose.name) ?? null)
    const listed = doc && parsePurpose(ts.getTextOfJSDocComment(doc.node.comment) ?? '')
    const same = (p) => p?.useWhen === purpose.useWhen && p?.notFor === purpose.notFor
    if (!read?.ok || !same(read) || !same(listed)) throw new Error(`The comment for ${purpose.name} in ${file} did not read back as written.`)
  }
  return out
}
