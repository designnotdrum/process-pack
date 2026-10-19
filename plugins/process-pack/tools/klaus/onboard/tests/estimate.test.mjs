import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { readOnboardingConfig } from '../config.mjs'
import { buildEstimate, compareToEstimate, comparisonNotes, predictCheckerTokens, predictWriterTokens, renderComparison, renderEstimate, WRITER_RATES } from '../estimate.mjs'
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
  assert.deepEqual(estimate.duplicates, { pairs: 2, tickets: 1, removals: 0, decisions: 1 })
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
  assert.equal(text.includes('\u2014'), false)
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
    stories: 3, pairs: 2, tickets: 1, decisions: 1,
  }
  const rows = compareToEstimate(estimate, actual)
  assert.ok(rows.every((r) => r.within === true), JSON.stringify(rows.filter((r) => !r.within)))
  const off = compareToEstimate(estimate, { ...actual, writerCalls: 4, writerTokens: Math.round(estimate.purposes.writerTokens * 1.5) })
  assert.deepEqual(off.filter((r) => r.within === false).map((r) => r.metric), ['Writer calls', 'Writer tokens'])
  assert.match(renderComparison(off), /\| Writer calls \| 3 \| 4 \| exact \| NO \|/)
})

test('a dollar figure that is tiny passes on the floor even when it is far off in percent', async () => {
  const estimate = await buildEstimate({ plan, onboarding: config.onboarding, fetchImpl: prices })
  const rows = compareToEstimate(estimate, { entries: 5, purposes: 4, writerCalls: 3, checkerCalls: 4, writerTokens: estimate.purposes.writerTokens, checkerTokens: estimate.purposes.checkerTokens, checkerUsd: estimate.purposes.checkerUsd + 0.0009, stories: 3, pairs: 2, tickets: 1, decisions: 1 })
  assert.equal(rows.find((r) => r.metric === 'Checker dollars').within, true)
})

test('the estimate keeps each call\'s own figure, and they add up to the totals', async () => {
  const estimate = await buildEstimate({ plan, onboarding: config.onboarding, fetchImpl: prices })
  const { purposes } = estimate
  assert.equal(purposes.writerCallDetails.reduce((sum, c) => sum + c.tokens, 0), purposes.writerTokens)
  assert.equal(purposes.checkerCallDetails.length, purposes.checkerCalls)
  assert.equal(purposes.checkerCallDetails.reduce((sum, c) => sum + c.tokens, 0), purposes.checkerTokens)
  assert.ok(Math.abs(purposes.checkerCallDetails.reduce((sum, c) => sum + c.usd, 0) - purposes.checkerUsd) < 1e-12)
})

test('calls reused or never reached count toward the calls, and only the calls made toward the tokens', async () => {
  const estimate = await buildEstimate({ plan, onboarding: config.onboarding, fetchImpl: prices })
  const [reusedCall] = estimate.purposes.writerCallDetails
  const [notReached, reusedCheck] = estimate.purposes.checkerCallDetails
  const writerLeft = estimate.purposes.writerTokens - reusedCall.tokens
  const checkerLeft = estimate.purposes.checkerTokens - notReached.tokens - reusedCheck.tokens
  const actual = {
    entries: 5, purposes: 4, writerCalls: 2, writerReused: [reusedCall.id], checkerCalls: 2, checksMade: 2, checkerReused: [reusedCheck.id], checksNotReached: [notReached.id],
    writerTokens: writerLeft, checkerTokens: checkerLeft, checkerUsd: estimate.purposes.checkerUsd / 2, stories: 3, pairs: 2, tickets: 1, decisions: 1,
  }
  const rows = compareToEstimate(estimate, actual)
  const row = (metric) => rows.find((r) => r.metric === metric)
  assert.deepEqual([row('Writer calls').actual, row('Checker calls').actual], [3, 4])
  assert.ok(rows.every((r) => r.within === true), JSON.stringify(rows.filter((r) => !r.within)))
  assert.deepEqual([row('Writer tokens').estimated, row('Checker tokens').estimated], [writerLeft, checkerLeft])
  const notes = comparisonNotes(estimate, actual).join('\n')
  assert.match(notes, /2 calls made, and 1 call reused from an earlier run of this plan/)
  assert.match(notes, /of the 4 checks the estimate counted, 2 checks made, 1 check reused from an earlier run of this plan, at no cost this time, 1 component not checked/)
  // Without the reused and unreached ids the calls do not add up, which is what the run reported before.
  assert.equal(compareToEstimate(estimate, { ...actual, writerReused: [], checkerReused: [], checksNotReached: [] }).find((r) => r.metric === 'Checker calls').within, false)
})

test('an estimate made before each call\'s figure was kept is shared out evenly', async () => {
  const estimate = await buildEstimate({ plan, onboarding: config.onboarding, fetchImpl: prices })
  const old = { ...estimate, purposes: { ...estimate.purposes, checkerCallDetails: undefined, writerCallDetails: estimate.purposes.writerCallDetails.map(({ tokens, ...rest }) => rest) } }
  const rows = compareToEstimate(old, { entries: 5, purposes: 4, writerCalls: 2, writerReused: [old.purposes.writerCallDetails[0].id], checkerCalls: 3, checksMade: 3, checksNotReached: ['x'], writerTokens: 1, checkerTokens: 1, checkerUsd: 0, stories: 3, pairs: 2, tickets: 1, decisions: 1 })
  const row = (metric) => rows.find((r) => r.metric === metric)
  const first = old.purposes.writerCallDetails[0]
  assert.equal(row('Writer tokens').estimated, old.purposes.writerTokens - predictWriterTokens(first.promptChars, first.components))
  assert.equal(row('Checker tokens').estimated, old.purposes.checkerTokens * 3 / 4)
  assert.equal(row('Checker calls').within, true)
})

test('a retried checker request is said, and makes the calls more than the estimate', async () => {
  const estimate = await buildEstimate({ plan, onboarding: config.onboarding, fetchImpl: prices })
  const actual = { entries: 5, purposes: 4, writerCalls: 3, checkerCalls: 5, checksMade: 4, writerTokens: estimate.purposes.writerTokens, checkerTokens: estimate.purposes.checkerTokens, checkerUsd: estimate.purposes.checkerUsd, stories: 3, pairs: 2, tickets: 1, decisions: 1 }
  assert.equal(compareToEstimate(estimate, actual).find((r) => r.metric === 'Checker calls').within, false)
  assert.match(comparisonNotes(estimate, actual).join('\n'), /The checker sent 1 request more than it made checks/)
})
