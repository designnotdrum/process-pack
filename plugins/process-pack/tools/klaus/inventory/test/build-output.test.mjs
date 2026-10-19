import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { BUILD_OUTPUT_DIRS } from '../files.mjs'
import { buildInventory } from '../inventory.mjs'
import { relativeTypeText } from '../type-text.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const cli = path.join(here, '..', 'inventory.mjs')

// The compiler writes a backslash in a path as two, because the path is inside a string literal.
const print = (file, roots = ['/home/me/repo']) => relativeTypeText(`import(${JSON.stringify(file)}).Thing`, roots)

describe('a type declared in a package\'s build output', () => {
  test('is named by the folder that holds the build folder, so a rebuilt hash changes nothing', () => {
    assert.equal(print('/home/me/repo/packages/ui/dist/alignment-utils-N1JdL0Og'), 'import("packages/ui").Thing')
    assert.equal(print('/home/me/repo/packages/ui/dist/alignment-utils-AvFrEbNh'), 'import("packages/ui").Thing')
  })

  test('is named the same way for every build folder the inventory skips', () => {
    for (const folder of BUILD_OUTPUT_DIRS) {
      assert.equal(print(`/home/me/repo/apps/web/${folder}/types/chunk-1a2b3c`), 'import("apps/web").Thing', folder)
    }
  })

  test('is named by the first build folder when a build folder sits inside another', () => {
    assert.equal(print('/home/me/repo/packages/ui/dist/build/chunk-1a2b3c'), 'import("packages/ui").Thing')
  })

  test('is named "." when the build folder is at the repo root', () => {
    assert.equal(print('/home/me/repo/dist/index-1a2b3c'), 'import(".").Thing')
  })

  test('is named by the folder above a folder of hand-written code that is called like a build folder', () => {
    // The folder walk skips such a folder too, so the inventory treats it as build output either way.
    assert.equal(print('/home/me/repo/packages/ui/build/types/chunk'), 'import("packages/ui").Thing')
  })

  test('is named by the package specifier when a dependency ships it, scoped or not', () => {
    assert.equal(print('/home/me/repo/node_modules/.pnpm/foo@1.0.0/node_modules/foo/dist/chunk-1a2b3c'), 'import("foo").Thing')
    assert.equal(print('/home/me/repo/node_modules/.pnpm/@s+foo@1.0.0/node_modules/@s/foo/dist/esm/chunk-1a2b3c'), 'import("@s/foo").Thing')
    assert.equal(print('/home/me/repo/node_modules/foo/lib/build/chunk-1a2b3c'), 'import("foo/lib").Thing')
  })

  test('is named by the folder above the build folder when the file is outside every root', () => {
    assert.equal(print('/home/me/other/ui/dist/alignment-utils-N1JdL0Og'), 'import("ui").Thing')
    assert.equal(print('/tmp/dist/chunk-1a2b3c'), 'import("tmp").Thing')
    assert.equal(print('/dist/chunk-1a2b3c'), 'import(".").Thing')
  })

  test('is named the same way from a Windows path, in any of several roots', () => {
    const roots = ['C:\\work\\base', 'C:\\work\\head']
    assert.equal(print('C:\\work\\head\\packages\\ui\\dist\\alignment-utils-N1JdL0Og', roots), 'import("packages/ui").Thing')
    assert.equal(print('C:/work/base/packages/ui/dist/alignment-utils-AvFrEbNh', roots), 'import("packages/ui").Thing')
  })

  test('is left alone when the checkout itself sits in a folder named like a build folder', () => {
    assert.equal(print('/home/me/build/repo/packages/ui/src/types', ['/home/me/build/repo']), 'import("packages/ui/src/types").Thing')
    assert.equal(print('/home/me/dist/repo/packages/ui/dist/chunk-1a2b3c', ['/home/me/dist/repo']), 'import("packages/ui").Thing')
  })

  test('is not confused with a source file or a package that is named like a build folder', () => {
    assert.equal(print('/home/me/repo/packages/ui/src/build'), 'import("packages/ui/src/build").Thing')
    assert.equal(print('/home/me/repo/node_modules/build/index'), 'import("build/index").Thing')
    assert.equal(print('/home/me/repo/node_modules/@s/out/index'), 'import("@s/out/index").Thing')
    assert.equal(print('/home/me/other/types'), 'import("types").Thing')
  })

  test('keeps the rest of the text, and a specifier that is not a path', () => {
    const text = 'Record<string, import("/home/me/repo/packages/ui/dist/a-1a2b3c").A | import("react").B>[]'
    assert.equal(relativeTypeText(text, ['/home/me/repo']), 'Record<string, import("packages/ui").A | import("react").B>[]')
  })
})

/**
 * A repo laid out the way a pnpm workspace is: the app imports `@repo/ui`, `node_modules/@repo/ui`
 * is a link to `packages/ui`, and the package's types come from its `dist` folder. A build writes
 * the types into a file named with a hash of its content, so a rebuild renames the file and the
 * source does not change.
 */
function writeBuiltRepo(repo, hash) {
  const files = {
    'package.json': '{ "name": "built-repo", "private": true }\n',
    'tsconfig.json': JSON.stringify({ compilerOptions: { jsx: 'preserve', module: 'esnext', moduleResolution: 'bundler', target: 'es2020', strict: true, noEmit: true, skipLibCheck: true, types: [] }, include: ['**/*.ts', '**/*.tsx'], exclude: ['node_modules', 'dist'] }),
    'stubs/jsx.d.ts': 'declare namespace JSX {\n  interface Element {}\n  interface IntrinsicElements {\n    [name: string]: any\n  }\n}\n',
    'packages/ui/package.json': '{ "name": "@repo/ui", "version": "0.0.0", "types": "dist/index.d.ts" }\n',
    'packages/ui/dist/index.d.ts': `export type { AlignFn, AlignTarget } from './alignment-utils-${hash}'\n`,
    [`packages/ui/dist/alignment-utils-${hash}.d.ts`]: "export interface AlignTarget {\n  edge: 'left' | 'right'\n}\nexport type AlignFn = (target: AlignTarget) => void\n",
    'packages/ui/src/overlay-props.ts': "import type { AlignFn, AlignTarget } from '@repo/ui'\n\nexport interface OverlayProps {\n  onAlign: AlignFn\n  target: AlignTarget\n}\n",
    'packages/ui/src/overlay.tsx': "import type { OverlayProps } from './overlay-props'\n\nexport function Overlay(props: OverlayProps) {\n  return <div>{props.target.edge}</div>\n}\n",
  }
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
    fs.writeFileSync(path.join(repo, file), text)
  }
  fs.mkdirSync(path.join(repo, 'node_modules', '@repo'), { recursive: true })
  fs.symlinkSync(path.join(repo, 'packages', 'ui'), path.join(repo, 'node_modules', '@repo', 'ui'))
  fs.symlinkSync(fs.realpathSync(path.join(here, '..', '..', 'node_modules', 'typescript')), path.join(repo, 'node_modules', 'typescript'))
}

describe('an inventory of a package that was rebuilt', () => {
  let parent
  const repos = {}
  before(() => {
    parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'klaus-built-')))
    for (const hash of ['N1JdL0Og', 'AvFrEbNh']) {
      repos[hash] = path.join(parent, hash, 'repo')
      writeBuiltRepo(repos[hash], hash)
    }
  })
  after(() => fs.rmSync(parent, { recursive: true, force: true }))

  const propType = (hash, name) => buildInventory({ root: repos[hash], folders: [{ path: 'packages/ui/src', role: 'shared' }] }).entries.find((e) => e.name === 'Overlay').props.find((p) => p.name === name).type

  test('prints a prop typed from the build output without the hashed file', () => {
    for (const hash of Object.keys(repos)) {
      assert.equal(propType(hash, 'onAlign'), 'import("packages/ui").AlignFn', hash)
      assert.equal(propType(hash, 'target'), 'import("packages/ui").AlignTarget', hash)
    }
  })

  test('writes an identical inventory.json for both builds, with no build folder in it', () => {
    const written = Object.keys(repos).map((hash) => {
      const out = path.join(parent, hash, 'out')
      const result = spawnSync('node', [cli, '--root', repos[hash], '--out', out, 'packages/ui/src'], { encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr)
      return fs.readFileSync(path.join(out, 'inventory.json'), 'utf8')
    })
    assert.ok(written[0].includes('AlignFn'), 'inventory.json must hold the prop types, or the checks below test nothing')
    assert.equal(written[0], written[1])
    assert.doesNotMatch(written[0], /\/dist\/|N1JdL0Og|AvFrEbNh/)
  })
})
