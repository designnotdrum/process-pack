import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import { UserError } from '../../frame/errors.mjs'
import { headCommit, resolveCommit, snapshotCommit } from '../snapshot.mjs'
import { cleanup, commitAll, initRepo, klausModules, tmpDir, writeFiles } from './helpers.mjs'

after(cleanup)

describe('unpacking a commit', () => {
  function repoWithTwoCommits() {
    const repo = tmpDir('klaus-repo')
    initRepo(repo)
    fs.symlinkSync(klausModules, path.join(repo, 'node_modules'))
    writeFiles(repo, {
      'package.json': '{ "name": "root" }\n',
      // Over the size limit, so it is not unpacked. The folder still gets its node_modules.
      'packages/ui/package.json': `{ "name": "ui", "padding": "${'x'.repeat(1_100_000)}" }\n`,
      'packages/ui/src/old.tsx': 'export const Old = 1\n',
      'packages/ui/logo.png': 'not really a png',
      'packages/ui/README.md': 'docs\n',
      'package-lock.json': '{ "lockfileVersion": 3 }\n',
    })
    fs.mkdirSync(path.join(repo, 'packages/ui/node_modules'))
    const first = commitAll(repo, 'one', 'v1')
    writeFiles(repo, { 'packages/ui/src/old.tsx': 'export const Old = 2\n', 'packages/ui/src/new.tsx': 'export const New = 1\n' })
    const second = commitAll(repo, 'two', 'v2')
    return { repo, first, second }
  }

  test('holds the files as they were at that commit, source and config only', () => {
    const { repo, first } = repoWithTwoCommits()
    const snapshot = snapshotCommit(repo, first)
    try {
      assert.equal(fs.readFileSync(path.join(snapshot.dir, 'packages/ui/src/old.tsx'), 'utf8'), 'export const Old = 1\n')
      assert.equal(fs.existsSync(path.join(snapshot.dir, 'packages/ui/src/new.tsx')), false)
      assert.equal(fs.existsSync(path.join(snapshot.dir, 'package.json')), true)
      assert.equal(fs.existsSync(path.join(snapshot.dir, 'packages/ui/logo.png')), false)
      assert.equal(fs.existsSync(path.join(snapshot.dir, 'packages/ui/README.md')), false)
      assert.equal(fs.existsSync(path.join(snapshot.dir, 'package-lock.json')), false)
      assert.equal(fs.existsSync(path.join(snapshot.dir, 'packages/ui/package.json')), false)
      assert.equal(fs.realpathSync(path.join(snapshot.dir, 'packages/ui/node_modules')), fs.realpathSync(path.join(repo, 'packages/ui/node_modules')))
    } finally {
      snapshot.remove()
    }
  })

  test('links the repo\'s node_modules in, and removing the snapshot leaves them alone', () => {
    const { repo, first } = repoWithTwoCommits()
    const modules = fs.realpathSync(klausModules)
    const listing = fs.readdirSync(modules)
    const snapshot = snapshotCommit(repo, first)
    assert.equal(fs.realpathSync(path.join(snapshot.dir, 'node_modules')), modules)
    snapshot.remove()
    assert.equal(fs.existsSync(snapshot.dir), false)
    assert.deepEqual(fs.readdirSync(modules), listing, 'removing the snapshot must not touch the linked node_modules')
    assert.equal(fs.existsSync(path.join(modules, 'typescript', 'package.json')), true)
  })

  test('finds the commit a tag names, and says when a ref is not one', () => {
    const { repo, first, second } = repoWithTwoCommits()
    assert.equal(resolveCommit(repo, 'v1'), first)
    assert.equal(resolveCommit(repo, 'v2'), second)
    assert.equal(headCommit(repo), second)
    assert.throws(() => resolveCommit(repo, 'v9'), (e) => e instanceof UserError && /"v9" is not a commit/.test(e.message))
  })

  test('reports no head commit outside a git repo', () => {
    assert.equal(headCommit(tmpDir('klaus-plain')), null)
  })
})
