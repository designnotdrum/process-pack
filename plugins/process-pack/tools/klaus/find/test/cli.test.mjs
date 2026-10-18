import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { main, readInventory } from '../find.mjs'
import { entry, inventory, purpose } from './fixture.mjs'

const script = fileURLToPath(new URL('../find.mjs', import.meta.url))

let root
before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'klaus-find-'))
  fs.writeFileSync(path.join(root, 'inventory.json'), JSON.stringify(inventory))
})
after(() => fs.rmSync(root, { recursive: true, force: true }))

/** Runs main() against the temp repo and returns what it printed. */
function run(args, { cwd = root } = {}) {
  let out = ''
  let err = ''
  const code = main(args, { out: (t) => (out += t), err: (t) => (err += t), cwd })
  return { code, out, err }
}

describe('klaus find', () => {
  test('prints the closest components for a purpose, from inventory.json in the repo root', () => {
    const { code, out, err } = run(['a switch between two views in a page header'])
    assert.equal(code, 0)
    assert.equal(err, '')
    assert.match(out, /1\. SegmentedControl/)
  })

  test('takes a purpose given as several words without quotes', () => {
    const { out } = run(['a', 'switch', 'between', 'two', 'views'])
    assert.match(out, /^Purpose: a switch between two views\n/)
  })

  test('says nothing fits and still exits 0', () => {
    const { code, out } = run(['a dial showing how confident the team is in a hypothesis, from 0 to 100'])
    assert.equal(code, 0)
    assert.match(out, /Nothing fits/)
  })

  test('prints the case section with --case', () => {
    const { code, out } = run(['--case', 'a dial showing how confident the team is in a hypothesis, from 0 to 100'])
    assert.equal(code, 0)
    assert.match(out, /^Klaus: new component, see case\n\n## New component case\n/)
    assert.match(out, /Where it lives: \[fill in: shared \(packages\/ui\/src\) or app-level \(apps\/web\/app\)\]/)
  })

  test('reads --root and --inventory', () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'klaus-find-cwd-'))
    try {
      assert.match(run(['--root', root, 'tooltip'], { cwd: elsewhere }).out, /1\. Tooltip/)
      const custom = path.join(elsewhere, 'custom.json')
      fs.writeFileSync(custom, JSON.stringify({ schemaVersion: 1, folders: [], entries: [entry('Gizmo', { purpose: purpose('turning gizmos.', 'nothing.') })] }))
      assert.match(run(['--inventory', custom, 'gizmo'], { cwd: elsewhere }).out, /1\. Gizmo/)
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true })
    }
  })

  test('reads klaus.find.json in the repo root when it is there', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'klaus-find-vocab-'))
    try {
      fs.writeFileSync(
        path.join(repo, 'inventory.json'),
        JSON.stringify({ schemaVersion: 1, folders: [], entries: [entry('OrdersBanner'), entry('Card', { purpose: purpose('grouping content on one surface.', 'a page.') })] }),
      )
      const plain = run(['orders card'], { cwd: repo }).out
      assert.match(plain, /score 0\.45/)
      fs.writeFileSync(path.join(repo, 'klaus.find.json'), JSON.stringify({ productNouns: ['orders'] }))
      const withNoun = run(['orders card'], { cwd: repo }).out
      assert.match(withNoun, /1\. Card, score 0\.9/)
      const explicit = path.join(repo, 'elsewhere.json')
      fs.writeFileSync(explicit, JSON.stringify({}))
      assert.match(run(['--vocabulary', explicit, 'orders card'], { cwd: repo }).out, /score 0\.45/)
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })

  test('prints usage with --help', () => {
    const { code, out } = run(['--help'])
    assert.equal(code, 0)
    assert.match(out, /^Usage: find\.mjs /)
  })
})

describe('errors the person can fix', () => {
  test('no purpose', () => {
    const { code, err, out } = run([])
    assert.equal(code, 2)
    assert.equal(out, '')
    assert.match(err, /Say what the new component is for/)
  })

  test('a purpose of only filler words', () => {
    const { code, err } = run(['a the of'])
    assert.equal(code, 2)
    assert.match(err, /can be matched/)
  })

  test('an option that does not exist', () => {
    const { code, err } = run(['--bogus', 'x'])
    assert.equal(code, 2)
    assert.match(err, /Usage: find\.mjs/)
  })

  test('no inventory, with the command that writes one', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'klaus-find-empty-'))
    try {
      const { code, err } = run(['tooltip'], { cwd: empty })
      assert.equal(code, 2)
      assert.match(err, /There is no inventory at .*inventory\.json\. Write one with: node .*inventory\.mjs/)
    } finally {
      fs.rmSync(empty, { recursive: true, force: true })
    }
  })

  test('an inventory that is not JSON, or not this version', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'klaus-find-bad-'))
    try {
      fs.writeFileSync(path.join(repo, 'inventory.json'), '{ nope')
      assert.match(run(['tooltip'], { cwd: repo }).err, /is not valid JSON/)
      fs.writeFileSync(path.join(repo, 'inventory.json'), JSON.stringify({ schemaVersion: 2, entries: [] }))
      const { code, err } = run(['tooltip'], { cwd: repo })
      assert.equal(code, 2)
      assert.match(err, /schemaVersion 1/)
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })

  test('a vocabulary file that is missing, not JSON or not the right shape', () => {
    assert.match(run(['--vocabulary', path.join(root, 'none.json'), 'tooltip']).err, /does not exist/)
    const file = path.join(root, 'vocab.json')
    fs.writeFileSync(file, 'nope')
    assert.match(run(['--vocabulary', file, 'tooltip']).err, /not valid JSON/)
    for (const [bad, message] of [
      [{ productNouns: 'loop' }, /"productNouns" .* must be a list of words/],
      [{ synonyms: [['alone']] }, /"synonyms" .* two or more words/],
      [{ synonym: [] }, /unknown setting "synonym"/],
      [[], /must hold an object/],
    ]) {
      fs.writeFileSync(file, JSON.stringify(bad))
      const { code, err } = run(['--vocabulary', file, 'tooltip'])
      assert.equal(code, 2)
      assert.match(err, message)
    }
  })
})

describe('readInventory', () => {
  test('fills in what a partial entry leaves out', () => {
    const file = path.join(root, 'partial.json')
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, entries: [{ name: 'Bare' }, { nope: true }] }))
    const read = readInventory(file)
    assert.deepEqual(read.folders, [])
    assert.equal(read.entries.length, 1)
    assert.deepEqual(read.entries[0], { kind: 'app', file: '', purpose: null, name: 'Bare', props: [], variants: {}, parts: [], usedIn: [] })
  })
})

describe('as a process', () => {
  test('prints the answer and exits 0, and exits 2 on an error', () => {
    const ok = spawnSync(process.execPath, [script, '--root', root, 'a switch between two views'], { encoding: 'utf8' })
    assert.equal(ok.status, 0)
    assert.match(ok.stdout, /1\. SegmentedControl/)
    const bad = spawnSync(process.execPath, [script, '--root', root], { encoding: 'utf8' })
    assert.equal(bad.status, 2)
    assert.match(bad.stderr, /Say what the new component is for/)
  })

  test('runs through a link to the script, as a copied folder might be called', () => {
    const link = path.join(root, 'link.mjs')
    fs.symlinkSync(script, link)
    const result = spawnSync(process.execPath, [link, '--root', root, 'tooltip'], { encoding: 'utf8' })
    assert.equal(result.status, 0)
    assert.match(result.stdout, /1\. Tooltip/)
  })
})
