#!/usr/bin/env node
/**
 * Klaus's onboarding run: builds a repo's baseline in three pull requests.
 *
 *   node onboard/onboard.mjs estimate --repo <dir> [--json]
 *       Works out what the run would do and cost, from the repo and its klaus.config.json. Calls no
 *       model and writes nothing to the working tree. It prints the estimate and a plan id, and keeps
 *       the estimate in the repo's git folder.
 *
 *   node onboard/onboard.mjs run --repo <dir> --approve <plan id> [options]
 *       Runs the three steps: the list at 1.0.0 with the duplicates, the purposes (written, then
 *       checked), and the stories. Each is a branch and a pull request, stacked on the one before.
 *       It refuses unless the plan id is the one the estimate printed and the repo still gives that
 *       plan. Nothing is merged.
 *         --captures <file>           Dieter's captures for the baseline versions, as version.mjs reads them.
 *         --codex <path>              The Codex executable. Default: found on PATH.
         --writer-branch <ref>       With an external writer: the branch that holds its edits. Without it the run
                                     writes the briefs and stops, having changed nothing.
         --checks-file <file>        With an external checker: its verdicts, as in briefs/checks.template.json.
                                     Without it the run writes the briefs and stops, having changed nothing.
 *         --commit-trailer <line>     A line to end each commit message with. May be repeated.
 *         --body-footer <text>        Text to end each pull request body with.
 *
 * The writer's key is never needed. The checker's key is read from the environment variable that
 * onboarding.checker.secrets names (OPENROUTER_API_KEY by default); start the command through your
 * secret store, for example `2password run --env "OPENROUTER_API_KEY=op://..." -- node ...`.
 *
 * Exit 0 when done, 2 on an error the person running it can fix, 3 on any other error.
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { UserError } from '../frame/errors.mjs'
import { writeJsonFile } from '../frame/json-file.mjs'
import { readOnboardingConfig } from './config.mjs'
import { buildEstimate, renderEstimate } from './estimate.mjs'
import { topLevel } from './git.mjs'
import { buildPlan } from './plan.mjs'
import { runOnboarding, workFolder } from './run.mjs'

const OPTIONS = {
  repo: { type: 'string' },
  approve: { type: 'string' },
  json: { type: 'boolean' },
  captures: { type: 'string' },
  codex: { type: 'string' },
  'writer-branch': { type: 'string' },
  'checks-file': { type: 'string' },
  'commit-trailer': { type: 'string', multiple: true },
  'body-footer': { type: 'string' },
}

const USAGE = 'Usage: onboard.mjs estimate|run --repo <dir> [options]. See the top of this file.'

async function estimateCommand(values) {
  const repo = fs.realpathSync(topLevel(path.resolve(values.repo)))
  const { onboarding, folders } = readOnboardingConfig(repo)
  const plan = buildPlan({ root: repo, folders, onboarding })
  const estimate = await buildEstimate({ plan, onboarding })
  const dir = workFolder(repo)
  fs.mkdirSync(dir, { recursive: true })
  writeJsonFile(path.join(dir, 'estimate.json'), estimate)
  if (values.json) console.log(JSON.stringify(estimate, null, 2))
  else console.log(`${renderEstimate(estimate)}\n\nTo run it: onboard.mjs run --repo ${values.repo} --approve ${estimate.id}`)
  return 0
}

async function runCommand(values) {
  await runOnboarding({
    repo: path.resolve(values.repo),
    approve: values.approve,
    captures: values.captures,
    codex: values.codex,
    writerBranch: values['writer-branch'],
    checksFile: values['checks-file'],
    commitTrailers: values['commit-trailer'] ?? [],
    bodyFooter: values['body-footer'] ?? '',
  })
  return 0
}

export async function main(argv) {
  try {
    const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true })
    const [command, ...extra] = positionals
    if (extra.length > 0) throw new UserError(`Unexpected argument ${JSON.stringify(extra[0])}.`)
    if (!values.repo) throw new UserError(`--repo <dir> is needed.\n${USAGE}`)
    if (command === 'estimate') return await estimateCommand(values)
    if (command === 'run') return await runCommand(values)
    throw new UserError(USAGE)
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
