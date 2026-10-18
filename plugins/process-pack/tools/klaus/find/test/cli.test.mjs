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

  test('an inventory that cannot be read is not called invalid JSON', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'klaus-find-unreadable-'))
    try {
      fs.mkdirSync(path.join(repo, 'inventory.json'))
      const { code, err } = run(['tooltip'], { cwd: repo })
      assert.equal(code, 2)
      assert.match(err, /Could not read the inventory .*inventory\.json/)
      assert.doesNotMatch(err, /not valid JSON/)
      fs.rmSync(path.join(repo, 'inventory.json'), { recursive: true })
      fs.writeFileSync(path.join(repo, 'inventory.json'), JSON.stringify(inventory))
      fs.mkdirSync(path.join(repo, 'vocabulary.json'))
      const vocab = run(['--vocabulary', 'vocabulary.json', 'tooltip'], { cwd: repo })
      assert.equal(vocab.code, 2)
      assert.match(vocab.err, /Could not read the vocabulary file/)
      assert.doesNotMatch(vocab.err, /not valid JSON/)
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
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
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'klaus-find-vocab-errors-'))
    try {
      fs.writeFileSync(path.join(repo, 'inventory.json'), JSON.stringify(inventory))
      const file = path.join(repo, 'vocab.json')
      assert.match(run(['--vocabulary', file, 'tooltip'], { cwd: repo }).err, /does not exist/)
      fs.writeFileSync(file, 'nope')
      assert.match(run(['--vocabulary', file, 'tooltip'], { cwd: repo }).err, /not valid JSON/)
      for (const [bad, message] of [
        [{ productNouns: 'loop' }, /"productNouns" .* must be a list of words/],
        [{ synonyms: [['alone']] }, /"synonyms" .* two or more words/],
        [{ synonym: [] }, /unknown setting "synonym"/],
        [[], /must hold an object/],
      ]) {
        fs.writeFileSync(file, JSON.stringify(bad))
        const { code, err } = run(['--vocabulary', file, 'tooltip'], { cwd: repo })
        assert.equal(code, 2)
        assert.match(err, message)
      }
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })
})

describe('readInventory', () => {
  test('fills in what a partial entry leaves out, and counts the entries it cannot use', () => {
    const file = path.join(root, 'partial.json')
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, entries: [{ name: 'Bare' }, { nope: true }, null] }))
    const read = readInventory(file)
    assert.deepEqual(read.folders, [])
    assert.equal(read.skipped, 2)
    assert.equal(read.entries.length, 1)
    assert.deepEqual(read.entries[0], { kind: 'app', file: '', purpose: null, name: 'Bare', props: [], variants: {}, parts: [], usedIn: [] })
  })

  test('copes with fields of the wrong type instead of crashing', () => {
    const file = path.join(root, 'wrong-types.json')
    fs.writeFileSync(
      file,
      JSON.stringify({
        schemaVersion: 1,
        folders: 'nope',
        entries: [
          { name: 'Odd', kind: 7, file: 3, purpose: 'text', props: 'a, b', parts: [{ name: 'Part' }, 'Bad', null], variants: { size: 'big', tone: ['a'] }, usedIn: 'x', icons: ['A', 4] },
          { name: 'Plain', purpose: { useWhen: 5, notFor: null, text: 9 } },
        ],
      }),
    )
    const read = readInventory(file)
    assert.deepEqual(read.folders, [])
    assert.deepEqual(read.entries[0], { name: 'Odd', kind: 'app', file: '', purpose: null, props: [], parts: [{ name: 'Part' }], variants: { size: [], tone: ['a'] }, usedIn: [], icons: ['A'] })
    assert.deepEqual(read.entries[1].purpose, { useWhen: null, notFor: null, text: '' })
    const { code, err } = run(['--inventory', file, 'odd plain part'])
    assert.equal(code, 0)
    assert.equal(err, '')
  })

  test('the command warns on stderr about entries it skipped and still answers', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'klaus-find-skip-'))
    try {
      fs.writeFileSync(path.join(repo, 'inventory.json'), JSON.stringify({ schemaVersion: 1, entries: [entry('Tooltip'), { nope: true }] }))
      const { code, out, err } = run(['tooltip'], { cwd: repo })
      assert.equal(code, 0)
      assert.match(out, /1\. Tooltip/)
      assert.equal(err, 'Skipped 1 inventory entry with no name. Write the inventory again if that is not expected.\n')
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
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

  test('runs through a link to the script', { skip: process.platform === 'win32' && 'links need privileges on Windows' }, () => {
    const link = path.join(root, 'link.mjs')
    fs.symlinkSync(script, link)
    const result = spawnSync(process.execPath, [link, '--root', root, 'tooltip'], { encoding: 'utf8' })
    assert.equal(result.status, 0)
    assert.match(result.stdout, /1\. Tooltip/)
  })

  test('runs from a copy of the folder, as design-onboard installs it', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'klaus-find-copy-'))
    try {
      const installed = path.join(repo, 'scripts', 'klaus', 'find')
      fs.cpSync(path.dirname(script), installed, { recursive: true, filter: (source) => !source.includes(`${path.sep}test`) })
      const copy = path.join(installed, 'find.mjs')
      const missing = spawnSync(process.execPath, [copy, 'tooltip'], { cwd: repo, encoding: 'utf8' })
      assert.equal(missing.status, 2)
      assert.match(missing.stderr, /Write one with: node scripts\/klaus\/inventory\/inventory\.mjs/)
      fs.writeFileSync(path.join(repo, 'inventory.json'), JSON.stringify(inventory))
      const found = spawnSync(process.execPath, [copy, 'tooltip'], { cwd: repo, encoding: 'utf8' })
      assert.equal(found.status, 0)
      assert.match(found.stdout, /1\. Tooltip/)
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })
})
