import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { UserError } from '../../frame/errors.mjs'
import { buildInventory } from '../../inventory/inventory.mjs'
import { pickVersions, readCaptures } from '../version.mjs'
import { cleanup, commitAll, fixtures, initRepo, klausModules, rectPng, squarePng, tmpDir, writeFiles } from './helpers.mjs'

after(cleanup)

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'version.mjs')
const FOLDERS = [{ path: 'packages/ui/src', role: 'shared' }]

/** A component file: a props interface and a function that renders. */
const component = (name, props, params = `_props: ${name}Props`) => `export interface ${name}Props { ${props} }\nexport function ${name}(${params}): JSX.Element {\n  return <div />\n}\n`

/** Starts a git repo with the React and cva type stubs, a tsconfig and a link to this package's TypeScript. */
function newRepo() {
  const repo = tmpDir('klaus-repo')
  initRepo(repo)
  fs.symlinkSync(klausModules, path.join(repo, 'node_modules'))
  writeFiles(repo, {
    'package.json': '{ "name": "fixture-repo", "private": true }\n',
    'tsconfig.json': JSON.stringify({ compilerOptions: { jsx: 'preserve', module: 'esnext', moduleResolution: 'bundler', target: 'es2020', strict: true, noEmit: true, skipLibCheck: true, types: [] }, include: ['**/*.ts', '**/*.tsx'], exclude: ['node_modules'] }),
  })
  for (const stub of ['react.d.ts', 'cva.d.ts']) {
    fs.mkdirSync(path.join(repo, 'stubs'), { recursive: true })
    fs.copyFileSync(path.join(fixtures, 'common', 'stubs', stub), path.join(repo, 'stubs', stub))
  }
  return repo
}

/** Writes the PNGs and the captures file for one release. Returns the captures file. */
function writeCaptures(dir, { components = {}, screens = {} }) {
  fs.mkdirSync(dir, { recursive: true })
  const manifest = { components: {}, screens: {} }
  for (const [section, items] of [['components', components], ['screens', screens]]) {
    for (const [index, [key, png]] of Object.entries(items).entries()) {
      const file = `${section}-${index}-${key.replace(/\W+/g, '_')}.png`
      fs.writeFileSync(path.join(dir, file), png)
      manifest[section][key] = file
    }
  }
  fs.writeFileSync(path.join(dir, 'captures.json'), JSON.stringify(manifest))
  return path.join(dir, 'captures.json')
}

const white = squarePng(40, 40)
const block6 = squarePng(40, 40, { x: 10, y: 10, size: 6 }) // 36 pixels against white
const speck3 = squarePng(40, 40, { x: 10, y: 10, size: 3 }) // 9 pixels: under the ten-pixel noise threshold
const block12 = rectPng(40, 40, { x: 10, y: 10, w: 4, h: 3 }) // 12 pixels

const entryOf = (inventory, name) => inventory.entries.find((e) => e.name === name)
const reportOf = (report, name) => report.entries.find((e) => e.name === name)
const read = (repo, file) => fs.readFileSync(path.join(repo, file))

describe('three releases of a small component library', () => {
  let repo
  let baseline
  let second
  let third

  before(async () => {
    repo = newRepo()
    const run = async ({ files, remove = [], captures, release, previous, from, baseline: isBaseline }) => {
      writeFiles(repo, files)
      for (const file of remove) fs.rmSync(path.join(repo, file))
      commitAll(repo, release, release)
      return pickVersions({ root: repo, inventory: buildInventory({ root: repo, folders: FOLDERS }), previous, from, release, baseline: isBaseline, captures: readCaptures(writeCaptures(tmpDir('klaus-caps'), captures)) })
    }

    baseline = await run({
      release: 'v1.0.0',
      baseline: true,
      files: {
        'packages/ui/src/alpha.tsx': component('Alpha', 'size?: "sm" | "md";'),
        'packages/ui/src/beta.tsx': component('Beta', 'label?: string;', '{ label }: BetaProps'),
        'packages/ui/src/gamma.tsx': component('Gamma', 'tone?: "info";'),
        'packages/ui/src/delta.tsx': component('Delta', 'title?: string;'),
        'packages/ui/src/epsilon.tsx': component('Epsilon', 'title?: string;'),
        'packages/ui/src/zeta.tsx': component('Zeta', 'mode?: "a";'),
      },
      captures: { components: { Alpha: white, Beta: white, Gamma: white, Delta: white, Epsilon: white }, screens: { '/': white, '/settings': white } },
    })

    second = await run({
      release: 'v1.1.0',
      previous: baseline.inventory,
      from: 'v1.0.0',
      files: {
        // A new required prop.
        'packages/ui/src/alpha.tsx': component('Alpha', 'size?: "sm" | "md"; required: string;'),
        // A new prop with a default.
        'packages/ui/src/beta.tsx': component('Beta', 'label?: string; tone?: "info" | "warn";', '{ label, tone = "info" }: BetaProps'),
        // A new optional prop and a changed capture in the same release.
        'packages/ui/src/gamma.tsx': component('Gamma', 'tone?: "info"; hint?: string;'),
        // Same props. Delta's capture changes by a visible amount, Epsilon's by noise.
        // Zeta gets a new prop and has no capture.
        'packages/ui/src/zeta.tsx': component('Zeta', 'mode?: "a"; extra?: boolean;'),
        'packages/ui/src/eta.tsx': component('Eta', 'size?: "sm";'),
      },
      captures: {
        components: { Alpha: white, Beta: white, Gamma: block6, Delta: block6, Epsilon: speck3, Eta: white },
        screens: { '/': block6, '/settings': white, '/new': white },
      },
    })

    // No `from`: the previous inventory records the commit of the last release.
    third = await run({
      release: 'v1.2.0',
      previous: second.inventory,
      files: {
        'packages/ui/src/alpha.tsx': component('Alpha', 'size?: "sm"; required: string;'),
        // Zeta moves to another folder and nothing else changes.
        'packages/ui/src/moved/zeta.tsx': component('Zeta', 'mode?: "a"; extra?: boolean;'),
      },
      remove: ['packages/ui/src/zeta.tsx'],
      captures: { components: { Epsilon: block12 } },
    })
  })

  test('the baseline starts every entry and screen at 1.0.0', () => {
    assert.deepEqual(baseline.inventory.entries.map((e) => [e.name, e.version]), [
      ['Alpha', '1.0.0'],
      ['Beta', '1.0.0'],
      ['Delta', '1.0.0'],
      ['Epsilon', '1.0.0'],
      ['Gamma', '1.0.0'],
      ['Zeta', '1.0.0'],
    ])
    assert.deepEqual(baseline.inventory.screens.map((s) => [s.route, s.version]), [['/', '1.0.0'], ['/settings', '1.0.0']])
    assert.equal(baseline.report.baseline, true)
    assert.equal(baseline.report.pixelDiff, null)
  })

  test('the baseline keeps each capture as the screenshot of version 1.0.0', () => {
    assert.equal(entryOf(baseline.inventory, 'Alpha').screenshot, '.klaus/screenshots/components/Alpha/1.0.0.png')
    assert.deepEqual(read(repo, entryOf(baseline.inventory, 'Alpha').screenshot), white)
    // A component with no capture has no screenshot.
    assert.equal(entryOf(baseline.inventory, 'Zeta').screenshot, '')
    assert.equal(baseline.inventory.screens[0].screenshot, '.klaus/screenshots/screens/%2F/1.0.0.png')
  })

  test('a new required prop is major', () => {
    const alpha = reportOf(second.report, 'Alpha')
    assert.equal(alpha.level, 'major')
    assert.equal(entryOf(second.inventory, 'Alpha').version, '2.0.0')
    assert.deepEqual(alpha.reasons, ['required prop added: required'])
  })

  test('a new prop with a default is minor', () => {
    assert.equal(reportOf(second.report, 'Beta').level, 'minor')
    assert.equal(entryOf(second.inventory, 'Beta').version, '1.1.0')
  })

  test('a prop change and a visual change in one release is one minor bump', () => {
    const gamma = reportOf(second.report, 'Gamma')
    assert.equal(gamma.level, 'minor')
    assert.equal(entryOf(second.inventory, 'Gamma').version, '1.1.0')
    // Both reasons are on record, and the version moved once.
    assert.deepEqual(gamma.reasons, ['optional prop added: hint', 'capture changed (1 changed region, 36 pixels)'])
  })

  test('a visual change with the same props is a patch', () => {
    const delta = reportOf(second.report, 'Delta')
    assert.equal(delta.level, 'patch')
    assert.equal(entryOf(second.inventory, 'Delta').version, '1.0.1')
    assert.deepEqual(delta.changes, [])
  })

  test('a difference under the noise threshold is no change', () => {
    assert.equal(reportOf(second.report, 'Epsilon').level, 'none')
    assert.equal(entryOf(second.inventory, 'Epsilon').version, '1.0.0')
  })

  test('a component with no capture bumps on props alone', () => {
    assert.equal(reportOf(second.report, 'Zeta').level, 'minor')
    assert.equal(entryOf(second.inventory, 'Zeta').version, '1.1.0')
    assert.equal(entryOf(second.inventory, 'Zeta').screenshot, '')
  })

  test('a component added in this release starts at 1.0.0', () => {
    assert.equal(reportOf(second.report, 'Eta').level, 'new')
    assert.equal(entryOf(second.inventory, 'Eta').version, '1.0.0')
  })

  test('a new version keeps the capture it was made with, and an unchanged one keeps its old screenshot', () => {
    // Delta and Alpha moved to a new version, so each stores this release's capture.
    assert.equal(entryOf(second.inventory, 'Delta').screenshot, '.klaus/screenshots/components/Delta/1.0.1.png')
    assert.deepEqual(read(repo, entryOf(second.inventory, 'Delta').screenshot), block6)
    assert.equal(entryOf(second.inventory, 'Alpha').screenshot, '.klaus/screenshots/components/Alpha/2.0.0.png')
    // Epsilon did not move, so its screenshot is still the one stored with 1.0.0, not the speck.
    assert.equal(entryOf(second.inventory, 'Epsilon').screenshot, '.klaus/screenshots/components/Epsilon/1.0.0.png')
    assert.deepEqual(read(repo, entryOf(second.inventory, 'Epsilon').screenshot), white)
  })

  test('a screen is named for the release only when its own capture changed', () => {
    const versions = Object.fromEntries(second.inventory.screens.map((s) => [s.route, s.version]))
    assert.deepEqual(versions, { '/': 'v1.1.0', '/new': 'v1.1.0', '/settings': '1.0.0' })
    assert.deepEqual(second.report.screens.map((s) => [s.route, s.changed]), [['/', true], ['/new', true], ['/settings', false]])
    assert.equal(second.inventory.screens.find((s) => s.route === '/').screenshot, '.klaus/screenshots/screens/%2F/v1.1.0.png')
  })

  test('the next release compares against the screenshot stored with the version, not against last release', () => {
    // Epsilon's capture was a 9-pixel speck last release, and a 12-pixel block now. Against last
    // release's capture the difference is a few pixels of noise. Against the 1.0.0 screenshot it is 12.
    assert.equal(reportOf(third.report, 'Epsilon').level, 'patch')
    assert.equal(entryOf(third.inventory, 'Epsilon').version, '1.0.1')
    assert.equal(entryOf(third.inventory, 'Epsilon').screenshot, '.klaus/screenshots/components/Epsilon/1.0.1.png')
  })

  test('versions carry on from the previous inventory', () => {
    assert.equal(entryOf(third.inventory, 'Alpha').version, '3.0.0')
    assert.equal(entryOf(third.inventory, 'Beta').version, '1.1.0')
    assert.equal(entryOf(third.inventory, 'Gamma').version, '1.1.0')
    assert.equal(entryOf(third.inventory, 'Delta').version, '1.0.1')
  })

  test('a component that moved to another file keeps its version and is read from where it was', () => {
    const zeta = entryOf(third.inventory, 'Zeta')
    assert.equal(zeta.file, 'packages/ui/src/moved/zeta.tsx')
    assert.equal(zeta.version, '1.1.0')
    assert.equal(reportOf(third.report, 'Zeta').level, 'none')
  })

  test('screens and entries without a capture this release are carried over untouched', () => {
    assert.deepEqual(third.inventory.screens, second.inventory.screens)
    assert.equal(entryOf(third.inventory, 'Delta').screenshot, entryOf(second.inventory, 'Delta').screenshot)
  })

  test('the inventory records which release and commit it was versioned for', () => {
    assert.equal(third.inventory.versioned.release, 'v1.2.0')
    assert.equal(third.inventory.versioned.commit, execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim())
    assert.equal(second.report.from, execFileSync('git', ['-C', repo, 'rev-parse', 'v1.0.0'], { encoding: 'utf8' }).trim())
  })

  test('a run that is repeated for the same release refuses, so the versions are never bumped twice', async () => {
    await assert.rejects(
      pickVersions({ root: repo, inventory: buildInventory({ root: repo, folders: FOLDERS }), previous: third.inventory, release: 'v1.2.0' }),
      (e) => e instanceof UserError && /already holds the versions for v1.2.0/.test(e.message),
    )
  })

  test('a dry run picks the same versions and copies no screenshot', async () => {
    const before = fs.readdirSync(path.join(repo, '.klaus/screenshots/components/Delta'))
    const captures = readCaptures(writeCaptures(tmpDir('klaus-caps'), { components: { Delta: block12 } }))
    const run = await pickVersions({ root: repo, inventory: buildInventory({ root: repo, folders: FOLDERS }), previous: third.inventory, from: 'v1.2.0', release: 'v1.3.0', captures, dryRun: true })
    assert.equal(entryOf(run.inventory, 'Delta').version, '1.0.2')
    assert.deepEqual(fs.readdirSync(path.join(repo, '.klaus/screenshots/components/Delta')), before)
  })

  test('a stored screenshot that has gone missing is reported, and the capture is not compared', async () => {
    const lost = structuredClone(third.inventory)
    entryOf(lost, 'Delta').screenshot = '.klaus/screenshots/components/Delta/9.9.9.png'
    const captures = readCaptures(writeCaptures(tmpDir('klaus-caps'), { components: { Delta: block12 } }))
    const run = await pickVersions({ root: repo, inventory: buildInventory({ root: repo, folders: FOLDERS }), previous: lost, from: 'v1.2.0', release: 'v1.3.0', captures, dryRun: true })
    assert.equal(reportOf(run.report, 'Delta').level, 'none')
    assert.ok(run.report.notes.some((n) => n.startsWith('Delta: the stored screenshot') && n.includes('9.9.9.png')))
  })

  test('a release with no captures at all still carries every screen and screenshot forward', async () => {
    const run = await pickVersions({ root: repo, inventory: buildInventory({ root: repo, folders: FOLDERS }), previous: third.inventory, from: 'v1.2.0', release: 'v1.3.0', dryRun: true })
    assert.deepEqual(run.inventory.screens, third.inventory.screens)
    assert.equal(run.report.pixelDiff, null)
    for (const e of run.inventory.entries) assert.equal(e.screenshot, entryOf(third.inventory, e.name).screenshot)
    assert.deepEqual(run.report.entries.map((e) => e.level), ['none', 'none', 'none', 'none', 'none', 'none', 'none'])
  })

  test('a capture for a name the inventory does not have is reported', async () => {
    const captures = readCaptures(writeCaptures(tmpDir('klaus-caps'), { components: { Nothing: white } }))
    const run = await pickVersions({ root: repo, inventory: buildInventory({ root: repo, folders: FOLDERS }), previous: third.inventory, from: 'v1.2.0', release: 'v1.3.0', captures, dryRun: true })
    assert.deepEqual(run.report.notes, ['The capture for "Nothing" matches no entry in the inventory.'])
  })

  test('uses the repo\'s own pixel diff when it has one', async () => {
    // A diff that never sees a change, standing in for the repo's Dieter. Delta's capture does change,
    // and the bundled diff would call it a patch.
    const own = `export const PIXEL = {}
export { readPng } from ${JSON.stringify(new URL('../bundled-diff.mjs', import.meta.url).href)}
export function diffMask() { return { count: 0, mask: new Uint8Array(0) } }
export function findRegions() { return { regions: [] } }
`
    writeFiles(repo, { 'scripts/dieter/regression/diff.mjs': own })
    try {
      const captures = readCaptures(writeCaptures(tmpDir('klaus-caps'), { components: { Delta: block12 } }))
      const run = await pickVersions({ root: repo, inventory: buildInventory({ root: repo, folders: FOLDERS }), previous: third.inventory, from: 'v1.2.0', release: 'v1.3.0', captures, dryRun: true })
      assert.equal(run.report.pixelDiff, 'dieter')
      assert.equal(reportOf(run.report, 'Delta').level, 'none')
    } finally {
      fs.rmSync(path.join(repo, 'scripts'), { recursive: true, force: true })
    }
  })
})

describe('input that cannot be versioned', () => {
  let repo

  before(() => {
    repo = newRepo()
    writeFiles(repo, { 'packages/ui/src/alpha.tsx': component('Alpha', 'size?: "sm";') })
    commitAll(repo, 'first', 'v1.0.0')
  })

  const inventory = () => buildInventory({ root: repo, folders: FOLDERS })

  test('needs a previous inventory unless it is the baseline', async () => {
    await assert.rejects(pickVersions({ root: repo, inventory: inventory(), release: 'v1.1.0' }), /no previous inventory/)
  })

  test('needs a release name', async () => {
    const { inventory: baseline } = await pickVersions({ root: repo, inventory: inventory(), baseline: true })
    assert.equal(baseline.versioned.release, 'baseline')
    await assert.rejects(pickVersions({ root: repo, inventory: inventory(), previous: baseline, from: 'v1.0.0' }), /Name the release/)
  })

  test('needs to know which release the previous versions belong to', async () => {
    const { inventory: baseline } = await pickVersions({ root: repo, inventory: inventory(), baseline: true })
    delete baseline.versioned.commit
    await assert.rejects(pickVersions({ root: repo, inventory: inventory(), previous: baseline, release: 'v1.1.0' }), /Say which release the previous versions belong to/)
  })

  test('names a ref the repo does not have', async () => {
    const { inventory: baseline } = await pickVersions({ root: repo, inventory: inventory(), baseline: true })
    await assert.rejects(pickVersions({ root: repo, inventory: inventory(), previous: baseline, from: 'v0.0.1', release: 'v1.1.0' }), (e) => e instanceof UserError && e.message.includes('"v0.0.1" is not a commit'))
  })

  test('says so when the old file is not in the old release, and leaves the entry unchanged', async () => {
    const { inventory: baseline } = await pickVersions({ root: repo, inventory: inventory(), baseline: true, release: 'v1.0.0' })
    entryOf(baseline, 'Alpha').file = 'packages/ui/src/not-there.tsx'
    const run = await pickVersions({ root: repo, inventory: inventory(), previous: baseline, from: 'v1.0.0', release: 'v1.1.0' })
    assert.equal(reportOf(run.report, 'Alpha').level, 'none')
    assert.deepEqual(run.report.notes, ['Alpha: packages/ui/src/not-there.tsx does not exist at v1.0.0, so its props were not compared.'])
  })

  test('says so when a name matches several entries of the previous inventory, and treats the entry as new', async () => {
    const { inventory: baseline } = await pickVersions({ root: repo, inventory: inventory(), baseline: true, release: 'v1.0.0' })
    const alpha = entryOf(baseline, 'Alpha')
    baseline.entries = [{ ...alpha, file: 'a/alpha.tsx' }, { ...alpha, file: 'b/alpha.tsx' }]
    const run = await pickVersions({ root: repo, inventory: inventory(), previous: baseline, from: 'v1.0.0', release: 'v1.1.0' })
    assert.equal(reportOf(run.report, 'Alpha').level, 'new')
    assert.deepEqual(run.report.notes, ['Alpha: 2 entries with this name were in the previous inventory (a/alpha.tsx, b/alpha.tsx), so it was treated as new.'])
  })

  test('rejects an inventory that is not one', async () => {
    await assert.rejects(pickVersions({ root: repo, inventory: { entries: [{ name: 'X' }] }, baseline: true }), /without a name and a file/)
    await assert.rejects(pickVersions({ root: repo, inventory: {}, baseline: true }), /entries array/)
  })

  test('rejects a captures file that points at nothing', () => {
    const dir = tmpDir('klaus-caps')
    fs.writeFileSync(path.join(dir, 'captures.json'), JSON.stringify({ components: { Alpha: 'missing.png' } }))
    assert.throws(() => readCaptures(path.join(dir, 'captures.json')), /capture for components "Alpha" does not exist/)
    fs.writeFileSync(path.join(dir, 'captures.json'), JSON.stringify({ screens: ['/'] }))
    assert.throws(() => readCaptures(path.join(dir, 'captures.json')), /"screens" must be an object/)
  })
})

describe('entries that are not a single component', () => {
  test('an icon set has no props and is versioned by its capture alone', async () => {
    const repo = newRepo()
    writeFiles(repo, {
      'packages/ui/src/icons/star.tsx': 'export function Star(): JSX.Element {\n  return <svg />\n}\n',
      'packages/ui/src/icons/moon.tsx': 'export function Moon(): JSX.Element {\n  return <svg />\n}\n',
    })
    commitAll(repo, 'one', 'v1')
    const inventory = () => buildInventory({ root: repo, folders: FOLDERS })
    const caps = (png) => readCaptures(writeCaptures(tmpDir('klaus-caps'), { components: { 'Icon set': png } }))

    const baseline = await pickVersions({ root: repo, inventory: inventory(), baseline: true, release: 'v1', captures: caps(white) })
    assert.equal(entryOf(baseline.inventory, 'Icon set').screenshot, '.klaus/screenshots/components/Icon-set/1.0.0.png')

    // A new icon changes the icon list and nothing the version reads.
    writeFiles(repo, { 'packages/ui/src/icons/sun.tsx': 'export function Sun(): JSX.Element {\n  return <svg />\n}\n' })
    commitAll(repo, 'two', 'v2')
    const unchanged = await pickVersions({ root: repo, inventory: inventory(), previous: baseline.inventory, from: 'v1', release: 'v2', captures: caps(white) })
    assert.equal(entryOf(unchanged.inventory, 'Icon set').version, '1.0.0')

    const changed = await pickVersions({ root: repo, inventory: inventory(), previous: baseline.inventory, from: 'v1', release: 'v2', captures: caps(block6) })
    assert.equal(entryOf(changed.inventory, 'Icon set').version, '1.0.1')
    assert.equal(reportOf(changed.report, 'Icon set').level, 'patch')
  })

  test('two entries with the same name keep their screenshots apart', async () => {
    const repo = tmpDir('klaus-repo')
    const entry = (file) => ({ name: 'Button', kind: 'shared', folder: 'x', file, props: [], variants: {}, parts: [], version: '', screenshot: '', usedIn: [] })
    const inventory = { schemaVersion: 1, folders: [], entries: [entry('packages/ui/src/button.tsx'), entry('apps/web/app/button.tsx')] }
    const captures = readCaptures(writeCaptures(tmpDir('klaus-caps'), { components: { Button: white } }))
    const { inventory: result } = await pickVersions({ root: repo, inventory, baseline: true, captures })
    assert.deepEqual(result.entries.map((e) => e.screenshot), [
      '.klaus/screenshots/components/packages-ui-src-button.tsx--Button/1.0.0.png',
      '.klaus/screenshots/components/apps-web-app-button.tsx--Button/1.0.0.png',
    ])
    for (const e of result.entries) assert.deepEqual(read(repo, e.screenshot), white)
  })
})

describe('where screenshots are kept', () => {
  test('two entries whose names slug to the same folder do not overwrite each other', async () => {
    const repo = tmpDir('klaus-repo')
    const entry = (name) => ({ name, kind: 'shared', folder: 'x', file: `src/${name}.tsx`, props: [], variants: {}, parts: [], version: '', screenshot: '', usedIn: [] })
    const inventory = { schemaVersion: 1, folders: [], entries: [entry('a b'), entry('a-b')] }
    const captures = readCaptures(writeCaptures(tmpDir('klaus-caps'), { components: { 'a b': white, 'a-b': block6 } }))
    const { inventory: result } = await pickVersions({ root: repo, inventory, baseline: true, captures })
    const [first, second] = result.entries.map((e) => e.screenshot)
    assert.notEqual(first, second)
    assert.deepEqual(read(repo, first), white)
    assert.deepEqual(read(repo, second), block6)
  })
})

describe('a repo whose root is a folder inside a larger git repo', () => {
  test('reads the old files relative to that folder', async () => {
    const outer = newRepo()
    const inner = path.join(outer, 'apps', 'web')
    fs.mkdirSync(inner, { recursive: true })
    fs.renameSync(path.join(outer, 'tsconfig.json'), path.join(inner, 'tsconfig.json'))
    fs.renameSync(path.join(outer, 'stubs'), path.join(inner, 'stubs'))
    fs.symlinkSync(klausModules, path.join(inner, 'node_modules'))
    fs.writeFileSync(path.join(outer, '.gitignore'), 'node_modules\n.klaus\n')
    writeFiles(inner, { 'src/alpha.tsx': component('Alpha', 'size?: "sm";'), 'package.json': '{ "name": "web", "private": true }\n' })
    commitAll(outer, 'one', 'v1')
    const folders = [{ path: 'src', role: 'app' }]
    const { inventory: baseline } = await pickVersions({ root: inner, inventory: buildInventory({ root: inner, folders }), baseline: true, release: 'v1' })
    writeFiles(inner, { 'src/alpha.tsx': component('Alpha', 'size?: "sm"; extra: string;') })
    commitAll(outer, 'two', 'v2')
    const { inventory, report } = await pickVersions({ root: inner, inventory: buildInventory({ root: inner, folders }), previous: baseline, from: 'v1', release: 'v2' })
    assert.equal(reportOf(report, 'Alpha').level, 'major')
    assert.equal(entryOf(inventory, 'Alpha').version, '2.0.0')
  })
})

describe('the command line', () => {
  const run = (args, options = {}) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', ...options })

  test('onboards a repo, then picks versions for a release', () => {
    const repo = newRepo()
    writeFiles(repo, { 'packages/ui/src/alpha.tsx': component('Alpha', 'size?: "sm";') })
    commitAll(repo, 'first', 'v1.0.0')
    const inventoryFile = path.join(repo, 'inventory.json')
    const build = () => fs.writeFileSync(inventoryFile, JSON.stringify(buildInventory({ root: repo, folders: FOLDERS })))
    const captures = (png) => writeCaptures(tmpDir('klaus-caps'), { components: { Alpha: png }, screens: { '/': png } })

    build()
    const onboard = run(['--root', repo, '--baseline', '--release', 'v1.0.0', '--captures', captures(white)])
    assert.equal(onboard.status, 0, onboard.stderr)
    assert.match(onboard.stdout, /Baseline: 1 entries and 1 screens at 1\.0\.0\./)
    const written = JSON.parse(fs.readFileSync(inventoryFile, 'utf8'))
    assert.equal(written.entries[0].version, '1.0.0')

    // The inventory is rebuilt for every release, which clears the versions, so the last run's is kept aside.
    const kept = path.join(tmpDir('klaus-keep'), 'inventory.json')
    fs.copyFileSync(inventoryFile, kept)
    writeFiles(repo, { 'packages/ui/src/alpha.tsx': component('Alpha', 'size?: "sm" | "md";') })
    commitAll(repo, 'second', 'v1.1.0')
    build()

    const dry = run(['--root', repo, '--previous', kept, '--from', 'v1.0.0', '--release', 'v1.1.0', '--captures', captures(block6), '--dry-run', '--json'])
    assert.equal(dry.status, 0, dry.stderr)
    const dryReport = JSON.parse(dry.stdout)
    assert.equal(dryReport.entries[0].version, '1.1.0')
    assert.match(dryReport.entries[0].reasons.join('; '), /type widened: size/)
    assert.equal(JSON.parse(fs.readFileSync(inventoryFile, 'utf8')).entries[0].version, '', 'a dry run writes nothing')

    const real = run(['--root', repo, '--previous', kept, '--from', 'v1.0.0', '--release', 'v1.1.0', '--captures', captures(block6)])
    assert.equal(real.status, 0, real.stderr)
    assert.match(real.stdout, /Alpha: 1\.0\.0 -> 1\.1\.0 \(minor: type widened: size \(\+ "md"\); capture changed \(1 changed region, 36 pixels\)\)/)
    assert.match(real.stdout, /Screen \/: 1\.0\.0 -> v1\.1\.0/)
    const after = JSON.parse(fs.readFileSync(inventoryFile, 'utf8'))
    assert.equal(after.entries[0].version, '1.1.0')
    assert.equal(after.versioned.release, 'v1.1.0')

    // The file now holds versions for v1.1.0, so the same run again is refused with exit 2.
    const again = run(['--root', repo, '--from', 'v1.0.0', '--release', 'v1.1.0'])
    assert.equal(again.status, 2)
    assert.match(again.stderr, /already holds the versions for v1\.1\.0/)
  })

  test('explains a freshly built inventory that has no versions to bump', () => {
    const repo = newRepo()
    writeFiles(repo, { 'packages/ui/src/alpha.tsx': component('Alpha', 'size?: "sm";') })
    commitAll(repo, 'first', 'v1.0.0')
    fs.writeFileSync(path.join(repo, 'inventory.json'), JSON.stringify(buildInventory({ root: repo, folders: FOLDERS })))
    const result = run(['--root', repo, '--release', 'v1.1.0'])
    assert.equal(result.status, 2)
    assert.match(result.stderr, /holds no versions to bump/)
    assert.match(result.stderr, /--previous/)
  })

  test('exits 2 on an unknown option and prints the usage', () => {
    const result = run(['--nonsense'])
    assert.equal(result.status, 2)
    assert.match(result.stderr, /--release <name>/)
  })
})
