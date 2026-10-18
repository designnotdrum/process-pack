import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { BASELINE, bumpVersion, higher, isVersion } from '../bump.mjs'

describe('bumping a version', () => {
  test('a major bump zeroes the minor and patch numbers', () => assert.equal(bumpVersion('1.4.2', 'major'), '2.0.0'))
  test('a minor bump zeroes the patch number', () => assert.equal(bumpVersion('1.4.2', 'minor'), '1.5.0'))
  test('a patch bump adds one to the patch number', () => assert.equal(bumpVersion('1.4.2', 'patch'), '1.4.3'))
  test('no change keeps the version', () => assert.equal(bumpVersion('1.4.2', 'none'), '1.4.2'))

  test('a version that is empty or not x.y.z counts as the baseline', () => {
    assert.equal(bumpVersion('', 'minor'), '1.1.0')
    assert.equal(bumpVersion(undefined, 'none'), BASELINE)
    assert.equal(bumpVersion('v1.2', 'patch'), '1.0.1')
  })

  test('refuses a level that is not one', () => assert.throws(() => bumpVersion('1.0.0', 'huge'), /Unknown level/))
  test('only x.y.z is a version', () => {
    assert.equal(isVersion('10.20.30'), true)
    assert.equal(isVersion('1.0'), false)
    assert.equal(isVersion('v1.0.0'), false)
    assert.equal(isVersion(''), false)
  })
})

describe('the highest kind of change wins', () => {
  test('major over minor over patch over none', () => {
    assert.equal(higher('none', 'patch'), 'patch')
    assert.equal(higher('patch', 'minor'), 'minor')
    assert.equal(higher('minor', 'major'), 'major')
    assert.equal(higher('major', 'patch'), 'major')
    assert.equal(higher('minor', 'minor'), 'minor')
  })

  test('refuses a level that is not one, so a bad report cannot under-state a bump', () => {
    assert.throws(() => higher('none', 'graver'), /Unknown level/)
    assert.throws(() => higher('graver', 'none'), /Unknown level/)
  })
})
