import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import ts from 'typescript'
import { findStorybookConfigs, globRegExp, readStorybookConfig, storybookFor } from '../storybook.mjs'

let dir
before(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'klaus-storybook-')))
})
after(() => fs.rmSync(dir, { recursive: true, force: true }))

function config(name, text) {
  const file = path.join(dir, name, '.storybook', 'main.ts')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  return readStorybookConfig(ts, file)
}
const loads = (c, rel) => storybookFor([c], path.join(dir, rel)).loadedBy !== null

/** Meridian's packages/ui/.storybook/main.ts, as far as the stories and the framework go. */
const MERIDIAN = `
import path from "node:path";
import type { StorybookConfig } from "@storybook/nextjs-vite";
const getAbsolutePath = (value: string): string => path.dirname(require.resolve(path.join(value, "package.json")));
const config: StorybookConfig = {
  stories: ["../src/**/*.mdx", "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
  framework: getAbsolutePath("@storybook/nextjs-vite"),
  staticDirs: [{ from: "../../../apps/web/public/images", to: "/images" }],
};
export default config;
`

test('a glob is matched as Storybook reads it: ** crosses folders, * does not, and the groups choose', () => {
  const cases = [
    ['/r/src/**/*.stories.@(js|jsx|mjs|ts|tsx)', '/r/src/a.stories.tsx', true],
    ['/r/src/**/*.stories.@(js|jsx|mjs|ts|tsx)', '/r/src/a/b/c.stories.ts', true],
    ['/r/src/**/*.stories.@(js|jsx|mjs|ts|tsx)', '/r/src/a.stories.css', false],
    ['/r/src/**/*.stories.@(js|jsx|mjs|ts|tsx)', '/r/other/a.stories.tsx', false],
    ['/r/src/*.tsx', '/r/src/a/b.tsx', false],
    ['/r/{a,b}/x.tsx', '/r/b/x.tsx', true],
    ['/r/{a,b}/x.tsx', '/r/c/x.tsx', false],
    ['/r/x?.tsx', '/r/xy.tsx', true],
    ['/r/x?.tsx', '/r/x.tsx', false],
    ['/r/x.stories.tsx', '/r/xastoriestsx', false],
    ['/r/**/*.stories.tsx', '/r/a.stories.tsx', true],
  ]
  for (const [glob, file, want] of cases) assert.equal(globRegExp(glob).test(file), want, `${glob} against ${file}`)
  assert.throws(() => globRegExp('/r/!(a|b).tsx'), /negated/)
})

test('Meridian\'s config: the globs are read from the .storybook folder, and the framework through getAbsolutePath', () => {
  const c = config('ui', MERIDIAN)
  assert.equal(c.unreadable, null)
  assert.equal(c.framework, '@storybook/nextjs-vite')
  assert.equal(loads(c, 'ui/src/components/ui/form.stories.tsx'), true)
  assert.equal(loads(c, 'ui/src/index.mdx'), true)
  assert.equal(loads(c, 'apps/web/app/components/Projects/AddItemPopover.stories.tsx'), false, 'a story in an app is not loaded')
  assert.equal(loads(c, 'ui/other/Thing.stories.tsx'), false, 'a story outside src is not loaded')
})

test('a stories entry can be an object, a name declared in the file, or use the default files', () => {
  const object = config('object', `export default { stories: [{ directory: '../src', files: '**/*.stories.tsx', titlePrefix: 'X' }, { directory: '../lib' }], framework: { name: '@storybook/react-vite', options: {} } }`)
  assert.equal(object.framework, '@storybook/react-vite')
  assert.equal(loads(object, 'object/src/a/B.stories.tsx'), true)
  assert.equal(loads(object, 'object/src/a/B.stories.jsx'), false)
  assert.equal(loads(object, 'object/lib/C.stories.jsx'), true, 'the default files take every kind of story')
  const named = config('named', `const stories = ['../components/**/*.stories.ts']\nmodule.exports = { stories, framework: '@storybook/react' }`)
  assert.equal(loads(named, 'named/components/x/Y.stories.ts'), true)
  assert.equal(loads(named, 'named/components/x/Y.stories.tsx'), false)
})

test('a config whose stories cannot be read as plain patterns loads nothing, and says why', () => {
  for (const [name, text, why] of [
    ['negated', `export default { stories: ['../src/!(legacy).stories.tsx'] }`, /negated/],
    ['spread', `const more = []\nexport default { stories: [...more, '../src/*.stories.tsx'] }`, /not a plain pattern/],
    ['computed', `export default { stories: getStories() }`, /no `stories` list/],
    ['excluded', `export default { stories: ['../src/*.stories.tsx', '!../src/old/*.stories.tsx'] }`, /excludes files/],
  ]) {
    const c = config(name, text)
    assert.match(c.unreadable, why, name)
    assert.deepEqual(c.globs, [])
    const found = storybookFor([c], path.join(dir, name, 'src/A.stories.tsx'))
    assert.equal(found.loadedBy, null)
    assert.deepEqual(found.unreadable.map((u) => u.file), [c.file])
  }
})

test('every config in the repo is found, whatever its extension, and node_modules is not searched', () => {
  const repo = path.join(dir, 'find')
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true })
    fs.writeFileSync(path.join(repo, rel), text)
  }
  write('.storybook/main.js', `module.exports = { stories: ['../a/*.stories.js'] }`)
  write('packages/ui/.storybook/main.mts', `export default { stories: ['../src/*.stories.ts'] }`)
  write('packages/ui/.storybook/preview.tsx', 'export default {}')
  write('node_modules/lib/.storybook/main.js', `module.exports = { stories: ['../*.stories.js'] }`)
  write('apps/web/src/main.ts', 'export {}')
  assert.deepEqual(findStorybookConfigs({ ts, root: repo }).map((c) => path.relative(repo, c.file)), ['.storybook/main.js', 'packages/ui/.storybook/main.mts'])
})
