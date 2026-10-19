import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { UserError } from '../../frame/errors.mjs'
import { assertPlainPath, readPlainFile, removePlainFile, writePlainFile } from '../plain-path.mjs'

function repo() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'klaus-plain-'))
  fs.mkdirSync(path.join(base, 'repo'))
  return { base, repo: path.join(base, 'repo'), cleanup: () => fs.rmSync(base, { recursive: true, force: true }) }
}

test('a file is written, replaced and removed inside the repo', () => {
  const r = repo()
  try {
    writePlainFile(r.repo, path.join(r.repo, 'docs', 'a.md'), 'one')
    writePlainFile(r.repo, path.join(r.repo, 'docs', 'a.md'), 'two')
    assert.equal(readPlainFile(r.repo, path.join(r.repo, 'docs', 'a.md')), 'two')
    removePlainFile(r.repo, path.join(r.repo, 'docs', 'a.md'))
    assert.equal(fs.existsSync(path.join(r.repo, 'docs', 'a.md')), false)
    assert.deepEqual(fs.readdirSync(path.join(r.repo, 'docs')), [])
  } finally {
    r.cleanup()
  }
})

test('a link where a folder or a file should be is not written through', () => {
  const r = repo()
  try {
    const outside = path.join(r.base, 'outside')
    fs.mkdirSync(outside)
    fs.symlinkSync(outside, path.join(r.repo, 'docs'))
    assert.throws(() => writePlainFile(r.repo, path.join(r.repo, 'docs', 'a.md'), 'x'), (e) => e instanceof UserError && /symbolic link/.test(e.message))
    assert.deepEqual(fs.readdirSync(outside), [])

    fs.writeFileSync(path.join(outside, 'target.txt'), 'original')
    fs.symlinkSync(path.join(outside, 'target.txt'), path.join(r.repo, 'inventory.json'))
    assert.throws(() => writePlainFile(r.repo, path.join(r.repo, 'inventory.json'), 'x'), /symbolic link/)
    assert.equal(fs.readFileSync(path.join(outside, 'target.txt'), 'utf8'), 'original')
  } finally {
    r.cleanup()
  }
})

test('a path outside the repo is refused', () => {
  const r = repo()
  try {
    assert.throws(() => assertPlainPath(r.repo, path.join(r.repo, '..', 'x.txt')), /not inside the repo/)
    assert.throws(() => assertPlainPath(r.repo, r.repo), /not inside the repo/)
  } finally {
    r.cleanup()
  }
})
