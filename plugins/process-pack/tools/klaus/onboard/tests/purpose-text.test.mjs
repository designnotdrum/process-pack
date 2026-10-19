import assert from 'node:assert/strict'
import { test } from 'node:test'
import { commentBody, readWrittenPurpose, renderComment, sentenceProblem } from '../purpose-text.mjs'

const good = '/**\n * Use when: the person starts an action.\n * Not for: moving to another page, use LinkButton.\n */'

test('a comment in the two-part form is read, and written back in one fixed form', () => {
  const read = readWrittenPurpose(good)
  assert.equal(read.ok, true)
  assert.equal(read.useWhen, 'the person starts an action.')
  assert.equal(renderComment(read), good)
})

test('a one-line comment is read too, and a missing full stop is added', () => {
  const read = readWrittenPurpose('/** Use when: a label that can be removed. Not for: long text */')
  assert.equal(read.ok, true)
  assert.equal(read.notFor, 'long text.')
})

test('a comment missing either half is refused', () => {
  assert.equal(readWrittenPurpose('/** Use when: a label that can be removed. */').ok, false)
  assert.equal(readWrittenPurpose('/** A chip. */').ok, false)
})

test('text that could change a file or a markdown view is refused', () => {
  const cases = {
    link: 'see https://evil.example now please',
    'markdown link': 'click [here](x) to continue now',
    mention: 'ask @someone about it please',
    pipe: 'one | two in a table cell',
    'non-ascii': 'a label with an em \u2014 dash in it',
    'comment marker': 'ends the comment */ early on purpose',
    markup: 'an <img src=x> tag in the text',
    long: 'x'.repeat(201),
    short: 'too',
  }
  for (const [name, text] of Object.entries(cases)) assert.notEqual(sentenceProblem(text, 'the sentence'), null, name)
  assert.equal(sentenceProblem('the person starts an action', 'the sentence'), null)
})

test('commentBody strips the markers and the leading stars', () => {
  assert.equal(commentBody(good).trim(), 'Use when: the person starts an action.\nNot for: moving to another page, use LinkButton.')
})
