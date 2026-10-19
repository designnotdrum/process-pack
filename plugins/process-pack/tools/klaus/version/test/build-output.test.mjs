import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import ts from 'typescript'
import { compareTrees } from '../props.mjs'
import { cleanup, tmpDir, writeFiles } from './helpers.mjs'

after(cleanup)

/**
 * A release of a component whose prop type comes from a workspace package's build output: the
 * source imports `@repo/ui`, `node_modules/@repo/ui` is a link to `packages/ui`, and the package's
 * types are in `dist/` in a file named with a hash. A rebuild changes the hash and nothing else.
 */
function builtTree(hash, props) {
  const dir = tmpDir('klaus-built')
  writeFiles(dir, {
    'package.json': '{ "name": "built-repo", "private": true }\n',
    'tsconfig.json': JSON.stringify({ compilerOptions: { jsx: 'preserve', module: 'esnext', moduleResolution: 'bundler', target: 'es2020', strict: true, noEmit: true, skipLibCheck: true, types: [] }, include: ['**/*.ts', '**/*.tsx'], exclude: ['node_modules', 'dist'] }),
    'stubs/jsx.d.ts': 'declare namespace JSX {\n  interface Element {}\n  interface IntrinsicElements {\n    [name: string]: any\n  }\n}\n',
    'packages/ui/package.json': '{ "name": "@repo/ui", "version": "0.0.0", "types": "dist/index.d.ts" }\n',
    'packages/ui/dist/index.d.ts': `export * as alignment from './alignment-utils-${hash}'\n`,
    [`packages/ui/dist/alignment-utils-${hash}.d.ts`]: "export declare const left: 'left'\nexport declare const right: 'right'\n",
    'packages/ui/src/overlay-props.ts': `import type { alignment } from '@repo/ui'\n\nexport interface OverlayProps {\n${props}\n}\n`,
    'packages/ui/src/overlay.tsx': "import type { OverlayProps } from './overlay-props'\n\nexport function Overlay(props: OverlayProps) {\n  return <div />\n}\n",
  })
  fs.mkdirSync(path.join(dir, 'node_modules', '@repo'), { recursive: true })
  fs.symlinkSync(path.join(dir, 'packages', 'ui'), path.join(dir, 'node_modules', '@repo', 'ui'))
  return dir
}

const file = 'packages/ui/src/overlay.tsx'

function compare(base, head) {
  return compareTrees({
    ts,
    base,
    head,
    jobs: [{ key: 'Overlay', primary: 'Overlay', names: ['Overlay'], baseFile: path.join(base, file), headFile: path.join(head, file) }],
  }).get('Overlay')
}

describe('a prop typed from a package\'s build output', () => {
  // TypeScript treats two copies of `@repo/ui` at one version as one package, so it loads the build
  // output from one release for both. Which hash a release reads is therefore not what is tested
  // here: the text must not name the file whichever one it reads.
  test('is described with no hashed file name, whichever release\'s build is read', () => {
    const base = builtTree('N1JdL0Og', '  edges: null')
    const head = builtTree('AvFrEbNh', '  edges: typeof alignment | null')
    const result = compare(base, head)
    assert.equal(result.changes.find((c) => c.kind === 'type widened' && c.where === 'edges').detail, '+ typeof import("packages/ui")')
    assert.equal(result.level, 'minor')
    assert.equal(result.changes.length, 1)
    assert.doesNotMatch(JSON.stringify(result), /N1JdL0Og|AvFrEbNh|\/dist\//)
  })

  test('reads the same text when the build is the other way round', () => {
    const base = builtTree('AvFrEbNh', '  edges: null')
    const head = builtTree('N1JdL0Og', '  edges: typeof alignment | null')
    const result = compare(base, head)
    assert.deepEqual(result.changes.map((c) => [c.kind, c.where, c.detail]), [['type widened', 'edges', '+ typeof import("packages/ui")']])
    assert.equal(result.level, 'minor')
    assert.doesNotMatch(JSON.stringify(result), /N1JdL0Og|AvFrEbNh|\/dist\//)
  })
})
