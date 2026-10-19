import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { readOnboardingConfig } from '../config.mjs'
import { buildEstimate, compareToEstimate, predictCheckerTokens, predictWriterTokens, renderComparison, renderEstimate, WRITER_RATES } from '../estimate.mjs'
import { buildPlan } from '../plan.mjs'
import { makeSample } from './helpers.mjs'

let sample
let config
let plan
const prices = async () => ({ ok: true, json: async () => ({ data: [{ id: 'z-ai/glm-5.3-flash', pricing: { prompt: '0.0000000392', completion: '0.0000002' } }] }) })
before(() => {
  sample = makeSample()
  config = readOnboardingConfig(sample.repo)
  plan = buildPlan({ root: sample.repo, folders: config.folders, onboarding: config.onboarding })
})
after(() => sample.cleanup())

test('the writer prediction reproduces the two measured calls it was fitted on', () => {
  // 35,239 tokens for a 1,070 character prompt with one component, and 37,217 for 3,232 characters with two.
  for (const [chars, components, measured] of [[1070, 1, 35239], [3232, 2, 37217]]) {
    const predicted = predictWriterTokens(chars, components)
    assert.ok(Math.abs(predicted - measured) / measured < 0.02, `${predicted} against ${measured}`)
  }
  assert.equal(WRITER_RATES.requests, 2)
})

test('the checker prediction grows with the prompt', () => {
  assert.ok(predictCheckerTokens(4000) > predictCheckerTokens(1000))
})

test('the estimate counts calls and files exactly, and prices the checker from the models list', async () => {
  const estimate = await buildEstimate({ plan, onboarding: config.onboarding, fetchImpl: prices })
  assert.equal(estimate.id, plan.id)
  assert.deepEqual([estimate.purposes.components, estimate.purposes.missing, estimate.purposes.unformatted], [4, 4, 0])
  assert.deepEqual([estimate.purposes.writerCalls, estimate.purposes.checkerCalls, estimate.purposes.unchecked], [3, 4, 0])
  assert.deepEqual(estimate.stories, { write: 3, exists: 1, dataBound: 1, skipped: 0 })
  assert.deepEqual(estimate.duplicates, { pairs: 3, tickets: 1, decisions: 2 })
  assert.ok(estimate.purposes.writerTokens > 90000 && estimate.purposes.writerTokens < 130000, `${estimate.purposes.writerTokens}`)
  assert.match(renderEstimate(estimate), /times 1\.7 because OpenRouter routes to providers that charge more than its list shows/)
  assert.ok(estimate.purposes.checkerUsd > 0 && estimate.purposes.checkerUsd < 0.001)
  assert.equal(estimate.price.prompt, 3.92e-8)
})

test('without a price the estimate says so and gives no dollar figure', async () => {
  const estimate = await buildEstimate({ plan, onboarding: config.onboarding, fetchImpl: async () => { throw new Error('offline') } })
  assert.equal(estimate.purposes.checkerUsd, null)
  assert.match(renderEstimate(estimate), /No dollar figure: the model list could not be read/)
})

test('the text names who does what, what leaves the machine, the margins, and never calls the checker free', async () => {
  const text = renderEstimate(await buildEstimate({ plan, onboarding: config.onboarding, fetchImpl: prices }))
  assert.match(text, /^Onboarding run: the one-time estimate \(plan [0-9a-f]{12}\)/)
  assert.match(text, /Writer: the local Codex CLI, gpt-5\.6-terra at low effort\. 3 calls, one for each folder/)
  assert.match(text, /Checker: OpenRouter, z-ai\/glm-5\.3-flash, a different model family from the writer\. 4 calls/)
  assert.match(text, /Billed for each token through OpenRouter/)
  assert.match(text, /Your code leaves this machine/)
  assert.match(text, /Tokens must land within 30%, and dollars within 100% or USD 0\.0010/)
  assert.doesNotMatch(text, /\bfree\b/i)
  assert.equal(text.includes('—'), false)
})

test('external routes get briefs and no estimate of what they bill', async () => {
  const external = { ...config.onboarding, writer: { ...config.onboarding.writer, route: 'external', agent: 'Codex cloud (Terra)' }, checker: { ...config.onboarding.checker, route: 'external', agent: 'a Cyrus session on GLM' } }
  const estimate = await buildEstimate({ plan, onboarding: external, fetchImpl: prices })
  assert.equal(estimate.purposes.writerTokens, null)
  assert.equal(estimate.purposes.checkerTokens, null)
  const text = renderEstimate(estimate)
  assert.match(text, /Writer: Codex cloud \(Terra\)\. 3 briefs/)
  assert.match(text, /No estimate: Codex cloud \(Terra\) bills on its own plan/)
  assert.doesNotMatch(text, /leaves this machine/)
})

test('a run is compared with its estimate: counts must match exactly, tokens and dollars within a margin', async () => {
  const estimate = await buildEstimate({ plan, onboarding: config.onboarding, fetchImpl: prices })
  const actual = {
    entries: 5, purposes: 4, writerCalls: 3, checkerCalls: 4,
    writerTokens: Math.round(estimate.purposes.writerTokens * 1.2),
    checkerTokens: Math.round(estimate.purposes.checkerTokens * 0.9),
    checkerUsd: estimate.purposes.checkerUsd * 1.4,
    stories: 3, pairs: 3, tickets: 1, decisions: 2,
  }
  const rows = compareToEstimate(estimate, actual)
  assert.ok(rows.every((r) => r.within === true), JSON.stringify(rows.filter((r) => !r.within)))
  const off = compareToEstimate(estimate, { ...actual, writerCalls: 4, writerTokens: Math.round(estimate.purposes.writerTokens * 1.5) })
  assert.deepEqual(off.filter((r) => r.within === false).map((r) => r.metric), ['Writer calls', 'Writer tokens'])
  assert.match(renderComparison(off), /\| Writer calls \| 3 \| 4 \| exact \| NO \|/)
})

test('a dollar figure that is tiny passes on the floor even when it is far off in percent', async () => {
  const estimate = await buildEstimate({ plan, onboarding: config.onboarding, fetchImpl: prices })
  const rows = compareToEstimate(estimate, { entries: 5, purposes: 4, writerCalls: 3, checkerCalls: 4, writerTokens: estimate.purposes.writerTokens, checkerTokens: estimate.purposes.checkerTokens, checkerUsd: estimate.purposes.checkerUsd + 0.0009, stories: 3, pairs: 3, tickets: 1, decisions: 2 })
  assert.equal(rows.find((r) => r.metric === 'Checker dollars').within, true)
})
