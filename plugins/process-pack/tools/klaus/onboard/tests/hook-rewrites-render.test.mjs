import assert from 'node:assert/strict'
import { test } from 'node:test'
import { exactLine } from '../bodies.mjs'

test('a line is a code span with its text as it is, and a missing line is null', () => {
  assert.equal(exactLine('const a = 1'), '`const a = 1`')
  assert.equal(exactLine('      disabled={disabled}'), '`      disabled={disabled}`')
  assert.equal(exactLine(null), null)
})

test('an empty line and a line of only spaces or tabs are named as such', () => {
  assert.equal(exactLine(''), '(an empty line)')
  assert.equal(exactLine('  \t '), '(a line of only spaces or tabs)')
})

test('a line with backticks gets a longer fence and a space inside each end', () => {
  assert.equal(exactLine('x // `y`'), '`` x // `y` ``')
  assert.equal(exactLine('a ``b`` c'), '``` a ``b`` c ```')
})

test('a line that starts and ends with a space is padded, since Markdown drops one space from each end of such a span', () => {
  assert.equal(exactLine('  return;  '), '`   return;   `')
  assert.equal(exactLine(' x'), '` x`')
})

test('a line past 200 characters is cut, and the notice is outside the span', () => {
  assert.equal(exactLine(`${'a'.repeat(200)}bcd`), `\`${'a'.repeat(200)}\` (cut here, 3 more characters)`)
})
