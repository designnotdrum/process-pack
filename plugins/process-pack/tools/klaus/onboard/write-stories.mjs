#!/usr/bin/env node
/**
 * Writes the third pull request's files into a working tree, and nothing else: the stories that
 * pass the checks (a Storybook loads their folder, and they type-check with the repo's own
 * TypeScript), and the lists `docs/klaus/stories.md` and `docs/klaus/stories.json`. It writes
 * the same text the onboarding run commits for its third pull request, because it uses the run's
 * own plan and the run's own function for the files. It makes no branch, commit or model call.
 *
 *   node onboard/write-stories.mjs --repo <dir> [--approve <plan id>] [--captures <file>]
 *
 * With --approve, it stops unless the repo gives the plan the estimate printed under that id.
 * With --captures, the screen captures are read as `onboard.mjs run --captures` reads them.
 * A story file that already exists is never overwritten: the plan leaves that component alone.
 *
 * Exit 0 when done, 2 on an error the person running it can fix, 3 on any other error.
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { UserError } from '../frame/errors.mjs'
import { toPosix } from '../inventory/files.mjs'
import { pickVersions, readCaptures } from '../version/version.mjs'
import { readOnboardingConfig } from './config.mjs'
import { topLevel } from './git.mjs'
import { buildPlan } from './plan.mjs'
import { writePlainFile } from './plain-path.mjs'
import { storyFiles } from './run.mjs'

const USAGE = 'Usage: write-stories.mjs --repo <dir> [--approve <plan id>] [--captures <file>]'

export async function writeStories({ repo: given, approve, captures, log = console.log }) {
  const repo = fs.realpathSync(topLevel(path.resolve(given)))
  const { onboarding, folders } = readOnboardingConfig(repo)
  const plan = buildPlan({ root: repo, folders, onboarding })
  if (approve && approve !== plan.id) throw new UserError(`The repo gives plan ${plan.id}, not ${approve}. Run onboard.mjs estimate again.`)
  const caps = captures ? readCaptures(path.resolve(repo, captures)) : undefined
  // The same list the run's commit hook check builds for the third pull request.
  const listed = (await pickVersions({ root: repo, inventory: plan.inventory, baseline: true, captures: caps, ts: plan.ts, dryRun: true })).inventory
  const { files, stories } = storyFiles(plan, listed, onboarding.docsDir)
  const written = []
  for (const file of files) {
    writePlainFile(repo, path.join(repo, file.rel), file.text)
    written.push(toPosix(file.rel))
  }
  const count = (status) => stories.items.filter((i) => i.status === status).length
  log(`Plan ${plan.id}. Wrote ${count('write')} stories and the two lists. ${count('data-bound')} components are listed with their screens, ${count('exists')} already had a story, ${count('skipped')} are left for a person.`)
  return { plan, written, stories }
}

export async function main(argv) {
  try {
    const { values, positionals } = parseArgs({ args: argv, options: { repo: { type: 'string' }, approve: { type: 'string' }, captures: { type: 'string' } }, allowPositionals: true })
    if (positionals.length > 0 || !values.repo) throw new UserError(USAGE)
    await writeStories(values)
    return 0
  } catch (error) {
    if (error instanceof UserError || (typeof error?.code === 'string' && error.code.startsWith('ERR_PARSE_ARGS'))) {
      console.error(error.message)
      return 2
    }
    console.error(error?.stack ?? error)
    return 3
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) process.exitCode = await main(process.argv.slice(2))
