import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { readOnboardingConfig } from '../config.mjs'
import { main } from '../onboard.mjs'
import { buildPlan } from '../plan.mjs'
import { makeGitSample } from './helpers.mjs'

const prices = async () => ({ ok: true, json: async () => ({ data: [{ id: 'z-ai/glm-5.3-flash', pricing: { prompt: '0.0000000392', completion: '0.0000002' } }] }) })

let sample
let icons
let original
let lines
beforeEach(() => {
  sample = makeGitSample({ icons: true })
  icons = path.join(sample.repo, 'packages', 'ui', 'src', 'icons')
  lines = []
  original = { log: console.log, error: console.error }
  console.log = (...a) => lines.push(a.join(' '))
  console.error = () => {}
})
afterEach(() => {
  Object.assign(console, original)
  sample.cleanup()
})

const planId = () => {
  const config = readOnboardingConfig(sample.repo)
  return buildPlan({ root: sample.repo, folders: config.folders, onboarding: config.onboarding }).id
}

test('estimate succeeds on a repo whose inventory has an icon set, and counts the set', async () => {
  const config = readOnboardingConfig(sample.repo)
  const plan = buildPlan({ root: sample.repo, folders: config.folders, onboarding: config.onboarding })
  const set = plan.inventory.entries.find((e) => e.kind === 'icon-set')
  assert.equal(set.file, 'packages/ui/src/icons')
  assert.deepEqual(set.icons, ['ArrowIcon', 'CheckIcon'])

  assert.equal(await main(['estimate', '--repo', sample.repo], { fetchImpl: prices }), 0)
  const text = lines.join('\n')
  assert.match(text, /^Onboarding run: the one-time estimate \(plan ([0-9a-f]{12})\)/)
  assert.match(text, /1 icon set/)
  assert.equal(sample.git('status', '--porcelain').trim(), '')
})

test('the plan id is the same after a change outside the icons, and after hidden files and folders appear in the icon folder', () => {
  const before = planId()
  fs.appendFileSync(path.join(sample.repo, 'README.md'), 'a note outside the icon folder\n')
  fs.writeFileSync(path.join(icons, '.DS_Store'), 'a hidden file that Finder adds')
  fs.mkdirSync(path.join(icons, '.cache'))
  fs.writeFileSync(path.join(icons, '.cache', 'StaleIcon.tsx'), 'export function StaleIcon() {\n  return null\n}\n')
  assert.equal(planId(), before)
})

test('editing one icon file changes the plan id', () => {
  const before = planId()
  fs.appendFileSync(path.join(icons, 'CheckIcon.tsx'), '// a changed path\n')
  assert.notEqual(planId(), before)
})

test('adding or removing a file in the icon folder changes the plan id', () => {
  const before = planId()
  fs.writeFileSync(path.join(icons, 'PlusIcon.tsx'), 'export function PlusIcon() {\n  return <svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10" /></svg>\n}\n')
  const added = planId()
  assert.notEqual(added, before)
  fs.rmSync(path.join(icons, 'PlusIcon.tsx'))
  assert.equal(planId(), before)
})

test('a file in a nested folder of the icon set counts, and a symbolic link in it does not break the plan', () => {
  const before = planId()
  fs.mkdirSync(path.join(icons, 'filled'))
  fs.writeFileSync(path.join(icons, 'filled', 'StarIcon.tsx'), 'export function StarIcon() {\n  return <svg viewBox="0 0 16 16"><path d="M8 1l2 5h5l-4 3 2 5-5-3-5 3 2-5-4-3h5z" /></svg>\n}\n')
  const nested = planId()
  assert.notEqual(nested, before)
  fs.symlinkSync(path.join(sample.repo, 'packages', 'ui', 'src'), path.join(icons, 'loop'))
  assert.equal(planId(), nested)
})
