/**
 * The onboarding run: three pull requests in order, from the plan the estimate was made on.
 *
 *   1. the list at 1.0.0, and the duplicates (no model)
 *   2. the missing purposes, written and then checked against where each component is used
 *   3. stories for components that have none, and the screens for the data-bound ones (no model)
 *
 * The model work (purposes-stage.mjs) comes first and changes no branch, so a failure in it leaves
 * nothing behind. Then the branches are made and stacked: the second is cut from the first, the
 * third from the second, and each pull request is based on the branch before it. Nothing is merged.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { UserError } from '../frame/errors.mjs'
import { readJsonFile, writeJsonFile } from '../frame/json-file.mjs'
import { toPosix } from '../inventory/files.mjs'
import { buildInventory } from '../inventory/inventory.mjs'
import { renderMarkdown } from '../inventory/markdown.mjs'
import { pickVersions, readCaptures } from '../version/version.mjs'
import { listBody, purposesBody, renderPurposesView, renderStoriesView, renderSummary, storiesBody } from './bodies.mjs'
import { readOnboardingConfig } from './config.mjs'
import { renderDecisions, renderDuplicatesList, renderTicket, ticketFileName } from './duplicates.mjs'
import { compareToEstimate } from './estimate.mjs'
import { changedFiles, commit, createPullRequest, currentBranch, editPullRequest, git, gitDir, run as runProgram, topLevel } from './git.mjs'
import { buildPlan } from './plan.mjs'
import { mkdirPlain, writePlainFile } from './plain-path.mjs'
import { obtainPurposes } from './purposes-stage.mjs'
import { renderStory } from './stories.mjs'
import { applyPurposes } from './verify.mjs'

export { RUNAWAY_FACTOR } from './purposes-stage.mjs'

export const BRANCHES = Object.freeze(['klaus/onboarding-1-list', 'klaus/onboarding-2-purposes', 'klaus/onboarding-3-stories'])
export const TITLES = Object.freeze([
  'Klaus onboarding 1 of 3: the list of components at 1.0.0, and the duplicates',
  'Klaus onboarding 2 of 3: purpose comments, written and then checked',
  'Klaus onboarding 3 of 3: stories for components that have none',
])

/** Where the run keeps its own files, inside the git folder so the working tree stays clean. */
export const workFolder = (repo) => path.join(gitDir(repo), 'klaus-onboarding')

export function writerLabel(onboarding) {
  const { writer } = onboarding
  return writer.route === 'external' ? writer.agent : `the local Codex CLI, ${writer.model} at ${writer.effort} effort, one call for each folder`
}

export function checkerLabel(onboarding) {
  const { checker } = onboarding
  return checker.route === 'external' ? checker.agent : `OpenRouter, ${checker.model}, one call for each component, billed for each token`
}

function writeInventoryFiles(repo, inventory) {
  writePlainFile(repo, path.join(repo, 'inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`)
  writePlainFile(repo, path.join(repo, 'INVENTORY.md'), renderMarkdown(inventory))
}

function preflight({ repo, approve, onboarding, env, options, log }) {
  if (changedFiles(repo).length > 0) throw new UserError('The working tree has changes. Commit or stash them first: the run needs a clean tree to tell what the writer changed.')
  if (git(repo, ['remote', 'get-url', 'origin'], { allowFail: true }) === null) throw new UserError('The repo has no origin remote to push the branches to.')
  if (runProgram('gh', repo, ['auth', 'status'], { allowFail: true }) === null) throw new UserError('gh is not signed in. Run gh auth login first.')
  const base = currentBranch(repo)
  const remoteDefault = runProgram('gh', repo, ['repo', 'view', '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name'], { allowFail: true })?.trim()
  if (remoteDefault && remoteDefault !== base) throw new UserError(`The run starts from the default branch, ${remoteDefault}, and the repo is on ${base}.`)
  // The pull requests are based on the remote branch, so anything that is only on this machine would be inside the first one.
  git(repo, ['fetch', '-q', 'origin', base])
  const remoteTip = git(repo, ['rev-parse', `refs/remotes/origin/${base}`], { allowFail: true })?.trim()
  if (remoteTip && remoteTip !== git(repo, ['rev-parse', 'HEAD']).trim()) throw new UserError(`${base} and origin/${base} are not the same commit. Push or pull first: the pull requests are based on origin/${base}, and a commit that is only here would end up in the first one.`)
  for (const branch of BRANCHES) {
    if (git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { allowFail: true }) !== null) throw new UserError(`The branch ${branch} already exists. The onboarding run has been started here before.`)
  }
  if (fs.existsSync(path.join(repo, 'inventory.json'))) throw new UserError('inventory.json already exists, so this repo has a baseline. Run the version picker for a release instead.')
  if (onboarding.writer.route === 'codex-cli') {
    try {
      execFileSync(options.codex ?? 'codex', ['--version'], { stdio: 'ignore' })
    } catch {
      throw new UserError('The Codex CLI is not installed. Install it and sign in with codex login, or set onboarding.writer.route to external.')
    }
  }
  if (onboarding.checker.route === 'openrouter') {
    const name = onboarding.checker.secrets[0]
    if (!name || !env[name]) throw new UserError(`${name ?? 'The checker key'} is not set in the environment. Run this command through your secret store so it is set for this command only.`)
  }
  log(`Base branch ${base}. The estimate's plan ${approve} matches.`)
  return base
}

const sumOf = (list, field) => list.reduce((total, item) => total + (item[field] ?? 0), 0)

/**
 * @param {object} options
 * @param {string} options.repo
 * @param {string} options.approve The plan id the estimate printed.
 * @param {string} [options.captures] Dieter's captures for the baseline.
 * @param {string} [options.writerBranch] Branch holding an external writer's edits.
 * @param {string} [options.checksFile] An external checker's verdicts.
 * @param {string[]} [options.commitTrailers]
 * @param {string} [options.bodyFooter]
 */
export async function runOnboarding(options) {
  const { approve, captures, commitTrailers = [], bodyFooter = '', log = console.log, env = process.env, fetchImpl = fetch, codex = 'codex' } = options
  const repo = fs.realpathSync(topLevel(path.resolve(options.repo)))
  const { onboarding, folders } = readOnboardingConfig(repo)
  const work = workFolder(repo)
  const estimateFile = path.join(work, 'estimate.json')
  if (!fs.existsSync(estimateFile)) throw new UserError('There is no estimate for this repo. Run onboard.mjs estimate first and read it.')
  const estimate = readJsonFile(estimateFile, 'Estimate')
  if (!approve) throw new UserError(`Say you have read the estimate: pass --approve ${estimate.id}.`)
  if (approve !== estimate.id) throw new UserError(`--approve must be the plan id the estimate shows, ${estimate.id}.`)

  const base = preflight({ repo, approve, onboarding, env, options: { codex }, log })
  const plan = buildPlan({ root: repo, folders, onboarding })
  if (plan.id !== estimate.id) throw new UserError(`The repo is not the one the estimate was made on (the plan is now ${plan.id}, the estimate says ${estimate.id}). Run onboard.mjs estimate again.`)
  const caps = captures ? readCaptures(path.resolve(repo, captures)) : undefined

  const state = { plan, estimate, prs: [], docsDir: onboarding.docsDir, writerLabel: writerLabel(onboarding), checkerLabel: checkerLabel(onboarding), writerCalls: [], writerExecuted: 0, writerTokens: 0, checkerRuns: [], purposes: { items: [] }, stories: null, rows: [], startedAt: new Date().toISOString() }
  mkdirPlain(repo, work)
  const ctx = { repo, plan, estimate, onboarding, log, env, fetchImpl, codex, work, base, options }

  // ---- the model work, before any branch exists
  const stage = await obtainPurposes({ ctx, state })
  if (stage.waiting) {
    log(stage.waiting.message)
    return { waiting: stage.waiting.part, state }
  }
  const { items, pending } = stage

  const open = (step, bodyFile, baseBranch) => {
    const pr = createPullRequest(repo, { base: baseBranch, head: BRANCHES[step - 1], title: TITLES[step - 1], bodyFile })
    state.prs.push({ step, branch: BRANCHES[step - 1], ...pr })
    log(`Pull request ${step} of 3: ${pr.url}`)
  }
  const bodyFile = (step, text) => {
    const file = path.join(work, `pr-${step}.md`)
    fs.writeFileSync(file, `${text}\n\n${bodyFooter}`.trimEnd() + '\n')
    return file
  }
  const finish = (step, message, paths) => {
    commit(repo, { message, paths, trailers: commitTrailers })
    git(repo, ['push', '-q', '-u', 'origin', BRANCHES[step - 1]])
  }
  const docs = onboarding.docsDir
  const put = (rel, text, into) => {
    writePlainFile(repo, path.join(repo, rel), text)
    into.push(toPosix(rel))
  }

  let actual
  let storyItems
  try {
    // ---- 1. the list and the duplicates
    git(repo, ['checkout', '-q', '-b', BRANCHES[0]])
    const baseline = await pickVersions({ root: repo, inventory: plan.inventory, baseline: true, captures: caps, ts: plan.ts })
    writeInventoryFiles(repo, baseline.inventory)
    const listPaths = ['inventory.json', 'INVENTORY.md']
    put(`${docs}/duplicates.md`, renderDuplicatesList(plan.duplicates), listPaths)
    put(`${docs}/duplicates.json`, `${JSON.stringify(plan.duplicates, null, 2)}\n`, listPaths)
    put(`${docs}/decisions.md`, renderDecisions(plan.duplicates), listPaths)
    plan.duplicates.filter((p) => p.verdict === 'merge').forEach((pair, index) => put(`${docs}/tickets/${ticketFileName(pair, index + 1)}`, renderTicket(pair), listPaths))
    finish(1, 'Add the component inventory at 1.0.0 and the duplicates list\n\nWritten by the Klaus onboarding run. No model ran.', listPaths)
    open(1, bodyFile(1, listBody(state)), base)

    // ---- 2. the purposes
    git(repo, ['checkout', '-q', '-b', BRANCHES[1]])
    const keep = pending.filter((p) => ['kept', 'unchecked'].includes(items.get(p.component.id).status))
    const purposePaths = []
    for (const file of [...new Set(keep.map((p) => p.file))]) {
      const before = fs.readFileSync(path.join(repo, file), 'utf8')
      writePlainFile(repo, path.join(repo, file), applyPurposes(plan.ts, path.join(repo, file), before, keep.filter((p) => p.file === file).map((p) => ({ name: p.component.name, useWhen: p.useWhen, notFor: p.notFor }))))
      purposePaths.push(file)
    }
    state.purposes.items = [...items.values()]
    const rebuilt = buildInventory({ root: repo, folders })
    const second = await pickVersions({ root: repo, inventory: rebuilt, baseline: true, captures: caps, ts: plan.ts })
    writeInventoryFiles(repo, second.inventory)
    purposePaths.push('inventory.json', 'INVENTORY.md')
    put(`${docs}/purposes.md`, renderPurposesView(state), purposePaths)
    finish(2, `Write ${keep.length} purpose comments, checked against where each component is used\n\nWritten by the Klaus onboarding run.`, purposePaths)
    open(2, bodyFile(2, purposesBody(state)), BRANCHES[0])

    // ---- 3. the stories
    git(repo, ['checkout', '-q', '-b', BRANCHES[2]])
    const storyPaths = []
    const byId = new Map(second.inventory.entries.map((e) => [`${e.file}#${e.name}`, e]))
    const captureOf = new Map((second.inventory.screens ?? []).map((s) => [s.route, s.screenshot]))
    storyItems = plan.stories.items.map((item) => {
      if (item.status === 'write') put(item.storyFile, renderStory({ entry: byId.get(item.id), importPath: item.importPath, isDefault: item.isDefault, framework: plan.stories.framework, typed: item.typed, args: item.args }), storyPaths)
      if (item.status !== 'data-bound') return item
      const screens = byId.get(item.id).usedIn
      return { ...item, screens, capture: screens.map((s) => captureOf.get(s)).find(Boolean) ?? null }
    })
    state.stories = { framework: plan.stories.framework, items: storyItems }
    put(`${docs}/stories.md`, renderStoriesView(state), storyPaths)
    put(`${docs}/stories.json`, `${JSON.stringify(state.stories, null, 2)}\n`, storyPaths)

    const external = (part) => onboarding[part].route === 'external'
    actual = {
      entries: second.inventory.entries.length,
      purposes: plan.purposes.components.length,
      writerCalls: state.writerExecuted,
      checkerCalls: external('checker') ? state.checkerRuns.length : sumOf(state.checkerRuns, 'attempts'),
      writerTokens: external('writer') ? null : state.writerTokens,
      checkerTokens: external('checker') ? null : sumOf(state.checkerRuns, 'tokens'),
      checkerUsd: external('checker') ? null : state.checkerRuns.some((r) => r.usd !== null) ? sumOf(state.checkerRuns, 'usd') : 0,
      stories: storyItems.filter((i) => i.status === 'write').length,
      pairs: plan.duplicates.length,
      tickets: plan.duplicates.filter((p) => p.verdict === 'merge').length,
      decisions: plan.duplicates.filter((p) => p.verdict !== 'merge').length,
    }
    state.actual = actual
    state.rows = compareToEstimate(estimate, actual)
    finish(3, `Add ${actual.stories} stories and list the data-bound components with their screens\n\nWritten by the Klaus onboarding run. No model wrote these stories.`, storyPaths)
    open(3, bodyFile(3, storiesBody(state)), BRANCHES[1])

    // ---- the three bodies again, now that each knows the others' numbers
    const bodies = { 1: listBody(state), 2: purposesBody(state), 3: storiesBody(state) }
    for (const pr of state.prs) editPullRequest(repo, pr.number, bodyFile(pr.step, bodies[pr.step]))
  } catch (error) {
    log(`The run stopped: ${error.message}`)
    log(`Branches made so far: ${state.prs.map((p) => p.branch).join(', ') || 'none'}. To start over, delete them and close their pull requests.`)
    throw error
  } finally {
    git(repo, ['checkout', '-q', base], { allowFail: true })
  }

  const report = {
    schemaVersion: 1,
    estimateId: estimate.id,
    startedAt: state.startedAt,
    finishedAt: new Date().toISOString(),
    pullRequests: state.prs,
    actual,
    comparison: state.rows,
    writerCalls: state.writerCalls,
    checkerRuns: state.checkerRuns,
    purposes: state.purposes.items.map(({ id, name, file, status, verdict, reason }) => ({ id, name, file, status, verdict: verdict ?? null, reason: reason ?? null })),
    stories: storyItems.map((s) => ({ id: s.id, status: s.status })),
    notes: state.guardNote ? [state.guardNote] : [],
  }
  writeJsonFile(path.join(work, 'report.json'), report)
  log(renderSummary(state))
  return { report, state }
}
