import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { readOnboardingConfig } from '../config.mjs'
import { buildPlan } from '../plan.mjs'
import { createResultStore } from '../results.mjs'
import { makeGitSample } from './helpers.mjs'

let sample
let plan
let work
before(() => {
  sample = makeGitSample()
  const { onboarding, folders } = readOnboardingConfig(sample.repo)
  plan = buildPlan({ root: sample.repo, folders, onboarding })
  work = path.join(fs.realpathSync(sample.repo), '.git', 'klaus-onboarding')
})
after(() => sample.cleanup())

const store = (planId = plan.id) => createResultStore({ repo: fs.realpathSync(sample.repo), work, planId })
const firstCall = () => plan.calls.find((c) => c.files.some((f) => f.file.endsWith('Hero.tsx')))
const written = (call) => new Map(call.files.map((f) => [f.file, `/**\n * Use when: a sample.\n * Not for: a test.\n */\n${f.source}`]))
const items = new Map()
const listFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map(String) : [])

test('a writer call is read back for the same plan, the same files and the same prompt', () => {
  const call = firstCall()
  store().saveWriterCall(call, { after: written(call), outside: [], tokens: 1234, items })
  const back = store().loadWriterCall(call)
  assert.deepEqual([...back.after.keys()], call.files.map((f) => f.file))
  assert.equal(back.tokens, 1234)
  // Written through a temporary file that was renamed: none is left.
  assert.deepEqual(listFiles(store().dir).filter((f) => f.endsWith('.tmp')), [])
})

test('a writer call is not read back for another plan, a file that changed, or a prompt that changed', () => {
  const call = firstCall()
  store().saveWriterCall(call, { after: written(call), outside: [], tokens: 1, items })
  assert.equal(store('another-plan').loadWriterCall(call), null)
  const changedFile = { ...call, files: call.files.map((f, i) => (i === 0 ? { ...f, source: `${f.source}\n// changed\n` } : f)) }
  assert.equal(store().loadWriterCall(changedFile), null)
  // The usage lines are in the prompt and come from files the plan id does not cover.
  const changedUsage = { ...call, files: call.files.map((f) => ({ ...f, components: f.components.map((c) => ({ ...c, snippets: [{ file: 'x.tsx', line: 1, text: '<Hero />' }] })) })) }
  assert.equal(store().loadWriterCall(changedUsage), null)
})

test('a damaged or foreign file in the store is ignored, not trusted', () => {
  const call = firstCall()
  store().saveWriterCall(call, { after: written(call), outside: [], tokens: 1, items })
  const [file] = listFiles(path.join(store().dir, 'writer')).map((f) => path.join(store().dir, 'writer', f))
  fs.writeFileSync(file, '{ "schemaVersion": 1, ')
  assert.equal(store().loadWriterCall(call), null)
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 99, planId: plan.id }))
  assert.equal(store().loadWriterCall(call), null)
})

const checkItem = (useWhen = 'a sample.') => {
  const component = plan.purposes.components.find((c) => c.name === 'Hero')
  return { component, file: component.file, useWhen, notFor: 'a test.', snippets: [{ file: 'apps/web/src/app/page.tsx', line: 3, text: '<Hero title="x" />' }] }
}
const source = () => fs.readFileSync(path.join(sample.repo, checkItem().file), 'utf8')

test('a verdict is read back only for the same sentences, the same usage and the same file', () => {
  store().saveCheck(checkItem(), source(), { verdict: 'fail', reason: 'it is [used](http://x) for more', tokens: 300, usd: 0.0001 })
  const back = store().loadCheck(checkItem(), source())
  assert.equal(back.verdict, 'fail')
  assert.equal(back.reason.includes('http'), false, 'the reason is cleaned again when it is read back')
  assert.equal(store().loadCheck(checkItem('another sentence.'), source()), null)
  assert.equal(store().loadCheck({ ...checkItem(), snippets: [] }, source()), null)
  assert.equal(store().loadCheck(checkItem(), `${source()}\n`), null)
  assert.equal(store('another-plan').loadCheck(checkItem(), source()), null)
})

test('a check that could not answer is not kept, so it is made again', () => {
  const item = { ...checkItem('an answer that never came.') }
  store().saveCheck(item, source(), { verdict: 'error', reason: 'OpenRouter answered 500', tokens: 0, usd: null })
  assert.equal(store().loadCheck(item, source()), null)
})
