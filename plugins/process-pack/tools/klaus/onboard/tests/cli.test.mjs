import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { main } from '../onboard.mjs'
import { workFolder } from '../run.mjs'
import { makeGitSample } from './helpers.mjs'

const prices = async () => ({ ok: true, json: async () => ({ data: [{ id: 'z-ai/glm-5.3-flash', pricing: { prompt: '0.0000000392', completion: '0.0000002' } }] }) })

let sample
let lines
let errors
let original
beforeEach(() => {
  sample = makeGitSample()
  lines = []
  errors = []
  original = { log: console.log, error: console.error }
  console.log = (...a) => lines.push(a.join(' '))
  console.error = (...a) => errors.push(a.join(' '))
})
afterEach(() => {
  Object.assign(console, original)
  sample.cleanup()
})

test('estimate prints the estimate and the plan id, keeps it in the git folder and leaves the tree clean', async () => {
  const code = await main(['estimate', '--repo', sample.repo], { fetchImpl: prices })
  assert.equal(code, 0)
  const text = lines.join('\n')
  assert.match(text, /^Onboarding run: the one-time estimate \(plan ([0-9a-f]{12})\)/)
  const id = /\(plan ([0-9a-f]{12})\)/.exec(text)[1]
  assert.ok(text.includes(`To run it: onboard.mjs run --repo ${sample.repo} --approve ${id}`))
  const kept = JSON.parse(fs.readFileSync(path.join(workFolder(sample.repo), 'estimate.json'), 'utf8'))
  assert.equal(kept.id, id)
  assert.equal(sample.git('status', '--porcelain').trim(), '')
})

test('estimate --json prints the estimate as data', async () => {
  assert.equal(await main(['estimate', '--repo', sample.repo, '--json'], { fetchImpl: prices }), 0)
  const estimate = JSON.parse(lines.join('\n'))
  assert.deepEqual(estimate.duplicates, { pairs: 2, tickets: 1, removals: 0, decisions: 1 })
})

test('mistakes are exit 2 with a plain message, and no stack', async () => {
  assert.equal(await main([]), 2)
  assert.match(errors.join('\n'), /--repo <dir> is needed/)
  errors.length = 0
  assert.equal(await main(['estimate']), 2)
  assert.equal(await main(['frobnicate', '--repo', sample.repo]), 2)
  assert.match(errors.join('\n'), /Usage: onboard\.mjs/)
  assert.equal(await main(['estimate', '--repo', sample.repo, '--nope']), 2)
  errors.length = 0
  assert.equal(await main(['run', '--repo', sample.repo, '--approve', 'abc']), 2)
  assert.match(errors.join('\n'), /There is no estimate for this repo/)
})

test('run without --approve names the plan id to pass', async () => {
  await main(['estimate', '--repo', sample.repo], { fetchImpl: prices })
  errors.length = 0
  assert.equal(await main(['run', '--repo', sample.repo]), 2)
  assert.match(errors.join('\n'), /pass --approve [0-9a-f]{12}/)
})
