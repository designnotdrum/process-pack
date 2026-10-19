import path from 'node:path'
import { resolveConfig, validateConfig } from '../frame/config.mjs'
import { UserError } from '../frame/errors.mjs'
import { readJsonFile } from '../frame/json-file.mjs'
import { readFolders } from '../inventory/config.mjs'

/**
 * Who writes and who checks the purpose comments when the settings say nothing. The writer is the
 * local Codex CLI, the checker one OpenRouter call for each component on a different model family.
 * A repo that connects Codex cloud or Cyrus changes both in `klaus.config.json`.
 */
export const DEFAULT_ONBOARDING = Object.freeze({
  writer: Object.freeze({ route: 'codex-cli', model: 'gpt-5.6-terra', effort: 'low', maxComponentsPerCall: 12, agent: null }),
  checker: Object.freeze({ route: 'openrouter', model: 'z-ai/glm-5.3-flash', secrets: Object.freeze(['OPENROUTER_API_KEY']), usageSnippets: 5, agent: null }),
  dataBoundImports: Object.freeze([]),
  docsDir: 'docs/klaus',
})

/** Packages whose use marks an app component as showing live data or the signed-in user. */
export const DATA_BOUND_PACKAGES = Object.freeze([
  '@clerk/',
  '@tanstack/react-query',
  '@apollo/client',
  '@supabase/',
  '@liveblocks/',
  '@hocuspocus/',
  '@trpc/',
  '@auth0/',
  '@reduxjs/toolkit',
  'react-redux',
  'react-query',
  'next-auth',
  'convex/',
  'swr',
  'urql',
  'firebase/',
])

/**
 * Reads klaus.config.json and returns the frame's resolved settings, the onboarding settings with
 * their defaults, and the inventory folders. Throws a UserError that names the setting when the
 * file is not valid.
 *
 * @param {string} root The repo.
 * @param {{ file?: string }} [options]
 */
export function readOnboardingConfig(root, { file } = {}) {
  const configPath = path.resolve(root, file ?? 'klaus.config.json')
  const raw = readJsonFile(configPath, 'Config')
  const { ok, errors } = validateConfig(raw)
  if (!ok) throw new UserError(`klaus.config.json is not valid:\n${errors.map((e) => `  ${e}`).join('\n')}`)
  const given = raw.onboarding ?? {}
  const onboarding = {
    writer: { ...DEFAULT_ONBOARDING.writer, ...given.writer },
    checker: { ...DEFAULT_ONBOARDING.checker, ...given.checker, secrets: [...(given.checker?.secrets ?? DEFAULT_ONBOARDING.checker.secrets)] },
    dataBoundImports: [...(given.dataBoundImports ?? DEFAULT_ONBOARDING.dataBoundImports)],
    docsDir: given.docsDir ?? DEFAULT_ONBOARDING.docsDir,
  }
  for (const part of ['writer', 'checker']) {
    if (onboarding[part].route === 'external' && !onboarding[part].agent) {
      throw new UserError(`klaus.config.json is not valid:\n  onboarding.${part}.agent: is required when onboarding.${part}.route is external. Say who does it, for example "Codex cloud (Terra)".`)
    }
  }
  if (onboarding.docsDir.split('/').some((part) => part === '..' || part === '')) {
    throw new UserError('klaus.config.json is not valid:\n  onboarding.docsDir: must be a folder inside the repo.')
  }
  const folders = readFolders(root)
  return { path: configPath, frame: resolveConfig(raw), onboarding, folders }
}
