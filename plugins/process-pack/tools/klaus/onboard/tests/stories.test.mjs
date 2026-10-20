import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { loadTypeScript } from '../../inventory/components.mjs'
import { buildInventory } from '../../inventory/inventory.mjs'
import { createTsconfigLoader } from '../../inventory/tsconfig.mjs'
import { readOnboardingConfig } from '../config.mjs'
import { planStories, renderStory, sampleValue, storyArgs, storybookPackage } from '../stories.mjs'
import { makeSample } from './helpers.mjs'

let sample
let inventory
let plan
before(() => {
  sample = makeSample()
  const { folders } = readOnboardingConfig(sample.repo)
  const root = fs.realpathSync(sample.repo)
  inventory = buildInventory({ root, folders })
  const ts = loadTypeScript(root)
  plan = planStories({ ts, root, tsconfigs: createTsconfigLoader(ts, root), inventory })
})
after(() => sample.cleanup())

const item = (name) => plan.items.find((i) => i.name === name)

// A handler for a function that returns nothing: a comment keeps it from being an empty function, which lint flags.
const NOTHING = '() => { /* Nothing happens in a story. */ }'

test('sampleValue gives a value for the types a story can fill in, and null for the rest', () => {
  const cases = [
    ['label', 'string', "'Sample'"],
    ['href', 'string | undefined', "'#'"],
    ['count', 'number', '1'],
    ['open', 'boolean', 'false'],
    ['children', 'React.ReactNode', "'Sample'"],
    ['icon', 'ReactElement', '<span>Sample</span>'],
    ['size', '"sm" | "lg"', "'sm'"],
    ['level', '1 | 2 | 3', '1'],
    ['onClick', '() => void', NOTHING],
    ['onChange', '(value: string) => void', NOTHING],
    ['onSave', '(_value: string) => Promise<void>', '() => Promise.resolve()'],
    ['onSave', '(_value?: Date) => Promise<void>', '() => Promise.resolve()'],
    ['onSave', '((_value: string) => Promise<void>)', '() => Promise.resolve()'],
    ['onLoad', '() => Promise<string[]>', '() => Promise.resolve([])'],
    ['onLoad', '() => Promise<number>', '() => Promise.resolve(1)'],
    ['format', '(value: number) => string', "() => 'Sample'"],
    ['isValid', '() => boolean', '() => false'],
    ['onDone', '(cb: () => void) => void | Promise<void>', NOTHING],
    ['onUpdate', '((_sectionId: string, _width: number, _height: number) => void)', NOTHING],
    ['rows', 'string[]', '[]'],
    ['items', 'Array<Item>', '[]'],
    ['when', 'Date', "new Date('2026-01-01T00:00:00Z')"],
  ]
  for (const [name, type, want] of cases) assert.equal(sampleValue(name, type), want, `${name}: ${type}`)
  for (const type of ['{ a: string }', 'Record<string, string>', 'Project', 'T', '() => Project', '() => Promise<Project>', '<T>(value: T) => void']) assert.equal(sampleValue('x', type), null, type)
})

test('with Storybook\'s fn to hand, a function that returns nothing is fn(), and one that computes a value stays plain', () => {
  const spy = { spy: true }
  assert.equal(sampleValue('onClick', '() => void', spy), 'fn()')
  assert.equal(sampleValue('onDone', '(cb: () => void) => void | Promise<void>', spy), 'fn()')
  assert.equal(sampleValue('onSave', '(_value: string) => Promise<void>', spy), 'fn(() => Promise.resolve())')
  assert.equal(sampleValue('onLoad', '() => Promise<string[]>', spy), '() => Promise.resolve([])')
  assert.equal(sampleValue('format', '(value: number) => string', spy), "() => 'Sample'")
  assert.equal(sampleValue('label', 'string', spy), "'Sample'")
  assert.deepEqual(storyArgs({ props: [{ name: 'onClick', type: '() => void', required: true }] }, spy), { args: [['onClick', 'fn()']], blocked: null })
})

test('a story imports fn only when an arg uses it', () => {
  const entry = { name: 'Chip', props: [], variants: {} }
  const used = renderStory({ entry, importPath: './Chip', isDefault: false, framework: '@storybook/react', typed: true, args: [['onClick', 'fn()']], spy: 'storybook/test' })
  assert.match(used, /^import type \{ Meta, StoryObj \} from '@storybook\/react'\nimport \{ fn \} from 'storybook\/test'\nimport \{ Chip \} from '\.\/Chip'\n/)
  const unused = renderStory({ entry, importPath: './Chip', isDefault: false, framework: '@storybook/react', typed: true, args: [['label', "'Sample'"]], spy: 'storybook/test' })
  assert.doesNotMatch(unused, /\bfn\b/)
})

test('storyArgs fills required props only and names the prop it cannot fill', () => {
  const ok = storyArgs({ props: [{ name: 'title', type: 'string', required: true }, { name: 'subtitle', type: 'string', required: false }] })
  assert.deepEqual(ok, { args: [['title', "'Sample'"]], blocked: null })
  const blocked = storyArgs({ props: [{ name: 'project', type: 'Project', required: true }] })
  assert.match(blocked.blocked, /required prop project has the type `Project`/)
})

test('the plan sorts the fixture: one story exists, two are written, one is data-bound', () => {
  assert.equal(item('Button').status, 'exists')
  assert.equal(item('PrimaryButton').status, 'write')
  assert.equal(item('LinkButton').status, 'write')
  assert.equal(item('Hero').status, 'write')
  assert.equal(item('ActivityFeed').status, 'data-bound')
  assert.deepEqual(item('ActivityFeed').reasons, ['calls useActivity from @/hooks/useActivity'])
})

test('a story sits beside its component and imports it by name', () => {
  assert.equal(item('PrimaryButton').storyFile, 'packages/ui/src/PrimaryButton.stories.tsx')
  assert.equal(item('Hero').storyFile, 'apps/web/src/marketing/Hero.stories.tsx')
  assert.equal(item('Hero').importPath, './Hero')
  assert.equal(item('Hero').isDefault, false)
  assert.equal(plan.framework, '@storybook/react')
})

test('the story text is the typed form with one sample value for each required prop', () => {
  const hero = inventory.entries.find((e) => e.name === 'Hero')
  const text = renderStory({ entry: hero, importPath: './Hero', isDefault: false, framework: '@storybook/react', typed: true, args: item('Hero').args })
  assert.equal(text, `import type { Meta, StoryObj } from '@storybook/react'
import { Hero } from './Hero'

// Written by the Klaus onboarding run. Edit it freely: Klaus never rewrites a story that exists.
const meta = {
  component: Hero,
  args: { title: 'Sample' },
} satisfies Meta<typeof Hero>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
`)
})

test('variant props become one story each, and a default export is imported by default', () => {
  const entry = { name: 'Card', props: [], variants: { tone: ['quiet', 'loud'], size: [1, 2] } }
  const text = renderStory({ entry, importPath: './card', isDefault: true, framework: '@storybook/nextjs', typed: true, args: [] })
  assert.match(text, /^import type \{ Meta, StoryObj \} from '@storybook\/nextjs'\nimport Card from '\.\/card'/)
  for (const name of ['ToneQuiet', 'ToneLoud', 'Size1', 'Size2']) assert.match(text, new RegExp(`export const ${name}: Story = \\{ args: \\{ \\w+: `))
  assert.doesNotMatch(text, /args: \{\},/)
})

test('a plain JavaScript component gets a story without types', () => {
  const text = renderStory({ entry: { name: 'Tag', props: [], variants: {} }, importPath: './Tag', isDefault: false, framework: '@storybook/react', typed: false, args: [] })
  assert.doesNotMatch(text, /Meta|satisfies|Story\b/)
  assert.match(text, /export default \{\n  component: Tag,\n\}/)
})

test('the Storybook package comes from the stories, then package.json, then the plain React one', () => {
  assert.equal(storybookPackage(sample.repo, '@storybook/nextjs'), '@storybook/nextjs')
  const dir = fs.mkdtempSync(path.join(sample.base, 'pkg-'))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ devDependencies: { '@storybook/react-vite': '^8' } }))
  assert.equal(storybookPackage(dir, null), '@storybook/react-vite')
  assert.equal(storybookPackage(sample.repo, null), '@storybook/react')
})

test('a story file that already exists but imports something else is not overwritten', () => {
  fs.writeFileSync(path.join(sample.repo, 'apps/web/src/marketing/Hero.stories.tsx'), 'export default {}\n')
  try {
    const root = fs.realpathSync(sample.repo)
    const ts = loadTypeScript(root)
    const again = planStories({ ts, root, tsconfigs: createTsconfigLoader(ts, root), inventory })
    const hero = again.items.find((i) => i.name === 'Hero')
    assert.equal(hero.status, 'skipped')
    assert.match(hero.reason, /already exists/)
  } finally {
    fs.rmSync(path.join(sample.repo, 'apps/web/src/marketing/Hero.stories.tsx'))
  }
})
