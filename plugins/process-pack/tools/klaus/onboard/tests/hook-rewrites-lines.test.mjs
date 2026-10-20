import assert from 'node:assert/strict'
import { test } from 'node:test'
import { changedHunks, countByFile, lineRewrites } from '../hook-rewrites.mjs'

const text = (...lines) => `${lines.join('\n')}\n`

test('text that is the same has no rewrite', () => {
  assert.deepEqual(lineRewrites('a.ts', text('one', 'two'), text('one', 'two')), [])
})

test('a changed line is one rewrite with both texts and its line in the committed file', () => {
  const written = text('const a = 1', 'str.match(re)', 'const b = 2')
  const committed = text('const a = 1', 're.exec(str)', 'const b = 2')
  assert.deepEqual(lineRewrites('a.ts', written, committed), [{ rel: 'a.ts', line: 2, before: 'str.match(re)', after: 're.exec(str)' }])
})

test('an added line has no before, and a removed line has no after', () => {
  assert.deepEqual(lineRewrites('a.ts', text('one', 'three'), text('one', 'two', 'three')), [{ rel: 'a.ts', line: 2, before: null, after: 'two' }])
  assert.deepEqual(lineRewrites('a.ts', text('one', 'two', 'three'), text('one', 'three')), [{ rel: 'a.ts', line: 2, before: 'two', after: null }])
})

test('separate places are separate rewrites, in file order, and a block that changes size is paired line by line', () => {
  const written = text('a', 'b', 'c', 'd', 'e', 'f')
  const committed = text('a', 'B', 'c', 'd', 'e1', 'e2', 'e3')
  assert.deepEqual(lineRewrites('x.ts', written, committed), [
    { rel: 'x.ts', line: 2, before: 'b', after: 'B' },
    { rel: 'x.ts', line: 5, before: 'e', after: 'e1' },
    { rel: 'x.ts', line: 6, before: 'f', after: 'e2' },
    { rel: 'x.ts', line: 7, before: null, after: 'e3' },
  ])
})

test('a final newline the hook adds counts as one added empty line', () => {
  assert.deepEqual(lineRewrites('a.md', 'one', 'one\n'), [{ rel: 'a.md', line: 2, before: null, after: '' }])
})

test('lines that repeat are matched in order, so only the real edit is found', () => {
  const written = text('x', 'x', 'x', 'y', 'x', 'x')
  const committed = text('x', 'x', 'y', 'x', 'x')
  const found = lineRewrites('a.ts', written, committed)
  assert.equal(found.length, 1)
  assert.deepEqual([found[0].before, found[0].after], ['x', null])
})

test('a file rewritten throughout is answered as one block, without searching for the smallest edit', () => {
  const written = Array.from({ length: 1000 }, (_, i) => `line ${i}`)
  const committed = Array.from({ length: 1000 }, (_, i) => `  line ${i};`)
  const hunks = changedHunks(written, committed)
  assert.equal(hunks.length, 1)
  assert.deepEqual([hunks[0].at, hunks[0].removed.length, hunks[0].added.length], [1, 1000, 1000])
})

test('a few changes in a long file are found exactly', () => {
  const written = Array.from({ length: 5000 }, (_, i) => `line ${i}`)
  const committed = [...written]
  committed[10] = 'changed ten'
  committed.splice(2500, 1)
  committed.push('last')
  assert.deepEqual(lineRewrites('big.ts', `${written.join('\n')}\n`, `${committed.join('\n')}\n`), [
    { rel: 'big.ts', line: 11, before: 'line 10', after: 'changed ten' },
    { rel: 'big.ts', line: 2501, before: 'line 2500', after: null },
    { rel: 'big.ts', line: 5000, before: null, after: 'last' },
  ])
})

test('rewrites are counted for each file in the order the files first appear', () => {
  const rewrites = [{ rel: 'b.ts' }, { rel: 'a.ts' }, { rel: 'b.ts' }]
  assert.deepEqual(countByFile(rewrites), [{ rel: 'b.ts', count: 2 }, { rel: 'a.ts', count: 1 }])
  assert.deepEqual(countByFile([]), [])
})
