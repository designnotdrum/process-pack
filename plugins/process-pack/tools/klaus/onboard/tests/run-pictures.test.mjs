/**
 * The normal onboarding run draws the pictures for the decisions list and commits them in the first
 * pull request, as it commits the list. The browser is a stand-in that draws nothing real.
 */
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { writeJsonFile } from '../../frame/json-file.mjs'
import { readOnboardingConfig } from '../config.mjs'
import { buildEstimate } from '../estimate.mjs'
import { buildPlan } from '../plan.mjs'
import { BRANCHES, runOnboarding, workFolder } from '../run.mjs'
import { findMerged } from '../stages.mjs'
import { makeGitSample, STUBS } from './helpers.mjs'

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7b5f6b00000000049454e44ae426082', 'hex')
const prices = async () => ({ ok: true, json: async () => ({ data: [{ id: 'z-ai/glm-5.3-flash', pricing: { prompt: '0.0000000392', completion: '0.0000002' } }] }) })
const checker = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ verdict: 'pass', reason: 'matches the places it is used' }) } }], usage: { prompt_tokens: 300, completion_tokens: 55, cost: 0.00003 } }) })

/** A browser that draws a one-pixel PNG for the Button story and nothing else. */
const fakeOpen = (opened) => async () => {
  opened.count += 1
  const page = {
    addStyleTag: async () => {},
    evaluate: async () => ({ look: { w: 90, h: 36, bg: [37, 99, 235, 1], color: [255, 255, 255, 1], radius: 6, borderWidth: 0, shadow: false, fontSize: 14, fontWeight: 500 }, box: { x: 0, y: 0, width: 90, height: 36 } }),
    screenshot: async () => PNG,
    setContent: async () => {},
    locator: () => ({ screenshot: async () => PNG }),
  }
  return { entries: [{ id: 'button--default', type: 'story', title: 'Button', name: 'Default', importPath: './packages/ui/src/Button.stories.tsx' }], page, show: async () => {}, close: async () => {} }
}

let sample
let saved
beforeEach(() => {
  sample = makeGitSample()
  saved = { ...process.env }
  process.env.PATH = `${STUBS}${path.delimiter}${process.env.PATH}`
  process.env.STUB_LOG = path.join(sample.base, 'codex.log')
  process.env.STUB_GH_LOG = path.join(sample.base, 'gh.log')
  process.env.OPENROUTER_API_KEY = 'sk-test-not-real'
})
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
  Object.assign(process.env, saved)
  sample.cleanup()
})

/** Puts a built Storybook next to the sample's `.storybook` folder and commits it, so the tree stays clean. */
function withBuild() {
  const build = path.join(sample.repo, 'storybook-static')
  fs.mkdirSync(build)
  fs.writeFileSync(path.join(build, 'iframe.html'), '<html></html>')
  fs.writeFileSync(path.join(build, 'index.json'), '{}')
  sample.git('add', '-A')
  sample.git('commit', '-q', '-m', 'a built Storybook')
  sample.git('push', '-q', 'origin', 'main')
}

async function estimate() {
  const { onboarding, folders } = readOnboardingConfig(sample.repo)
  const result = await buildEstimate({ plan: buildPlan({ root: sample.repo, folders, onboarding }), onboarding, fetchImpl: prices })
  fs.mkdirSync(workFolder(sample.repo), { recursive: true })
  writeJsonFile(path.join(workFolder(sample.repo), 'estimate.json'), result)
  return result
}

const run = (estimated, extra = {}) => runOnboarding({ repo: sample.repo, approve: estimated.id, codex: path.join(STUBS, 'codex'), fetchImpl: checker, log: () => {}, ...extra })
const bytesAt = (branch, file) => execFileSync('git', ['show', `${branch}:${file}`], { cwd: sample.repo, maxBuffer: 1 << 24 })

test('a normal run draws the pictures and commits the PNGs in the first pull request', async () => {
  withBuild()
  const opened = { count: 0 }
  const estimated = await estimate()
  await run(estimated, { openStorybook: fakeOpen(opened) })
  const [one] = BRANCHES
  const changed = sample.git('diff', '--name-only', `main..${one}`).trim().split('\n').sort()
  assert.deepEqual(changed, [
    'INVENTORY.md',
    'docs/klaus/decisions.md',
    'docs/klaus/decisions/01-linkbutton-vs-button.png',
    'docs/klaus/duplicates.json',
    'docs/klaus/duplicates.md',
    'docs/klaus/tickets/01-merge-primarybutton-into-button.md',
    'inventory.json',
  ])
  assert.equal(Buffer.compare(bytesAt(one, 'docs/klaus/decisions/01-linkbutton-vs-button.png'), PNG), 0, 'the PNG is committed byte for byte')
  const list = bytesAt(one, 'docs/klaus/decisions.md').toString('utf8')
  assert.match(list, /!\[[^\]]+\]\(decisions\/01-linkbutton-vs-button\.png\)/)
  assert.match(list, /Only one side is drawn: the shared UI package's LinkButton has no story\./)
  assert.equal(opened.count, 1, 'the browser is opened once')
  assert.equal(sample.git('status', '--porcelain').trim(), '')
  assert.match(fs.readFileSync(path.join(sample.base, 'gh.log'), 'utf8'), /1 question for the owner, each with the default stated, and 1 with a picture/)
})

test('a run with no built Storybook still makes the first pull request, and the list says there is no picture', async () => {
  const opened = { count: 0 }
  const estimated = await estimate()
  await run(estimated, { openStorybook: fakeOpen(opened) })
  const [one] = BRANCHES
  assert.equal(sample.git('diff', '--name-only', `main..${one}`).includes('.png'), false)
  assert.match(bytesAt(one, 'docs/klaus/decisions.md').toString('utf8'), /No picture: no built Storybook was found/)
  assert.equal(opened.count, 0, 'no browser is opened without a build')
})

test('a merged first pull request is still found when its list and pictures differ from what a new run draws', async () => {
  const docs = 'docs/klaus'
  const repo = path.join(sample.base, 'merged')
  fs.mkdirSync(path.join(repo, docs), { recursive: true })
  fs.writeFileSync(path.join(repo, docs, 'duplicates.md'), 'same')
  fs.writeFileSync(path.join(repo, docs, 'decisions.md'), 'a list with pictures, drawn on another day')
  const listFiles = [
    { rel: `${docs}/duplicates.md`, text: 'same' },
    { rel: `${docs}/decisions.md`, text: 'a list with no pictures', volatile: true },
  ]
  const found = findMerged({ repo, base: 'main', docs, listFiles })
  assert.equal(found.refusal, null)
  assert.equal(found.start, 2)
  const strict = findMerged({ repo, base: 'main', docs, listFiles: listFiles.map(({ rel, text }) => ({ rel, text })) })
  assert.match(strict.refusal, /decisions\.md/)
})
