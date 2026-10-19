import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { UserError } from '../../frame/errors.mjs'
import { DEFAULT_ONBOARDING, readOnboardingConfig } from '../config.mjs'
import { makeSample } from './helpers.mjs'

function withConfig(change) {
  const sample = makeSample()
  const file = path.join(sample.repo, 'klaus.config.json')
  const config = JSON.parse(fs.readFileSync(file, 'utf8'))
  change(config)
  fs.writeFileSync(file, JSON.stringify(config))
  return sample
}

test('with no onboarding section the writer is the Codex CLI and the checker is OpenRouter', () => {
  const sample = makeSample()
  try {
    const { onboarding } = readOnboardingConfig(sample.repo)
    assert.deepEqual(onboarding.writer, DEFAULT_ONBOARDING.writer)
    assert.equal(onboarding.writer.model, 'gpt-5.6-terra')
    assert.equal(onboarding.checker.model, 'z-ai/glm-5.3-flash')
    assert.deepEqual(onboarding.checker.secrets, ['OPENROUTER_API_KEY'])
    assert.equal(onboarding.docsDir, 'docs/klaus')
  } finally {
    sample.cleanup()
  }
})

test('the settings can name another model, and an external agent for either part', () => {
  const sample = withConfig((c) => {
    c.onboarding = { writer: { route: 'external', agent: 'Codex cloud (Terra)' }, checker: { route: 'external', agent: 'a Cyrus session on GLM' }, docsDir: 'docs/baseline' }
  })
  try {
    const { onboarding } = readOnboardingConfig(sample.repo)
    assert.equal(onboarding.writer.route, 'external')
    assert.equal(onboarding.writer.agent, 'Codex cloud (Terra)')
    assert.equal(onboarding.checker.route, 'external')
    assert.equal(onboarding.docsDir, 'docs/baseline')
  } finally {
    sample.cleanup()
  }
})

test('an external route without an agent is refused, naming the setting', () => {
  const sample = withConfig((c) => {
    c.onboarding = { writer: { route: 'external' } }
  })
  try {
    assert.throws(() => readOnboardingConfig(sample.repo), (error) => error instanceof UserError && error.message.includes('onboarding.writer.agent'))
  } finally {
    sample.cleanup()
  }
})

test('a key pasted in as a model name is refused, and the error does not repeat it', () => {
  const key = 'sk-or-v1-0123456789abcdef0123456789abcdef0123456789abcdef'
  const sample = withConfig((c) => {
    c.onboarding = { checker: { model: key } }
  })
  try {
    assert.throws(
      () => readOnboardingConfig(sample.repo),
      (error) => error instanceof UserError && error.message.includes('onboarding.checker.model') && !error.message.includes(key),
    )
  } finally {
    sample.cleanup()
  }
})

test('settings the schema does not know are refused, and a docs folder cannot leave the repo', () => {
  const unknown = withConfig((c) => {
    c.onboarding = { writer: { sandbox: 'danger-full-access' } }
  })
  const outside = withConfig((c) => {
    c.onboarding = { docsDir: '../elsewhere' }
  })
  try {
    assert.throws(() => readOnboardingConfig(unknown.repo), /onboarding\.writer\.sandbox/)
    assert.throws(() => readOnboardingConfig(outside.repo), /docsDir/)
  } finally {
    unknown.cleanup()
    outside.cleanup()
  }
})
