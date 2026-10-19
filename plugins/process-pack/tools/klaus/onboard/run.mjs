/**
 * The onboarding run: three pull requests in order, from the plan the estimate was made on.
 *
 *   1. the list at 1.0.0, and the duplicates (no model)
 *   2. the missing purposes, written and then checked against where each component is used
 *   3. stories for components that have none, and the screens for the data-bound ones (no model)
 *
 * The branches are stacked: the second is cut from the first, the third from the second, and each
 * pull request is based on the branch before it. Nothing is merged.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { UserError } from '../frame/errors.mjs'
import { writeJsonFile, readJsonFile } from '../frame/json-file.mjs'
import { toPosix } from '../inventory/files.mjs'
import { buildInventory } from '../inventory/inventory.mjs'
import { renderMarkdown } from '../inventory/markdown.mjs'
import { pickVersions, readCaptures } from '../version/version.mjs'
import { listBody, purposesBody, renderPurposesView, renderStoriesView, renderSummary, storiesBody } from './bodies.mjs'
import { checkerPrompt, runCheck } from './checker.mjs'
import { readOnboardingConfig } from './config.mjs'
import { renderDecisions, renderDuplicatesList, renderTicket, ticketFileName } from './duplicates.mjs'
import { compareToEstimate } from './estimate.mjs'
import { changedFiles, commit, createPullRequest, currentBranch, editPullRequest, git, gitDir, resetPaths, run as runProgram, topLevel } from './git.mjs'
import { buildPlan } from './plan.mjs'
import { assertPlainPath, mkdirPlain, removePlainFile, writePlainFile } from './plain-path.mjs'
import { renderStory } from './stories.mjs'
import { snippetsFor } from './source.mjs'
import { applyPurposes, judgeWrittenFile } from './verify.mjs'
import { runCodex, writerEnvironment, writerPrompt } from './writer.mjs'

export const BRANCHES = Object.freeze(['klaus/onboarding-1-list', 'klaus/onboarding-2-purposes', 'klaus/onboarding-3-stories'])
export const TITLES = Object.freeze([
  'Klaus onboarding 1 of 3: the list of components at 1.0.0, and the duplicates',
  'Klaus onboarding 2 of 3: purpose comments, written and then checked',
  'Klaus onboarding 3 of 3: stories for components that have none',
])
/** A writer that has used this many times its estimate stops the run: the first try ran away to 515,484 tokens. */
export const RUNAWAY_FACTOR = 2
const CHECKER_CONCURRENCY = 4

/** Where the run keeps its own files, inside the git folder so the working tree stays clean. */
export const workFolder = (repo) => path.join(gitDir(repo), 'klaus-onboarding')

async function pool(items, size, worker) {
  const results = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index], index)
    }
  }))
  return results
}

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

function preflight({ repo, approve, onboarding, env, log }) {
  if (changedFiles(repo).length > 0) throw new UserError('The working tree has changes. Commit or stash them first: the run needs a clean tree to tell what the writer changed.')
  if (git(repo, ['remote', 'get-url', 'origin'], { allowFail: true }) === null) throw new UserError('The repo has no origin remote to push the branches to.')
  if (runProgram('gh', repo, ['auth', 'status'], { allowFail: true }) === null) throw new UserError('gh is not signed in. Run gh auth login first.')
  const base = currentBranch(repo)
  const remoteDefault = runProgram('gh', repo, ['repo', 'view', '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name'], { allowFail: true })?.trim()
  if (remoteDefault && remoteDefault !== base) throw new UserError(`The run starts from the default branch, ${remoteDefault}, and the repo is on ${base}.`)
  for (const branch of BRANCHES) {
    if (git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { allowFail: true }) !== null) throw new UserError(`The branch ${branch} already exists. The onboarding run has been started here before.`)
  }
  if (fs.existsSync(path.join(repo, 'inventory.json'))) throw new UserError('inventory.json already exists, so this repo has a baseline. Run the version picker for a release instead.')
  if (onboarding.writer.route === 'codex-cli') {
    try {
      execFileSync('codex', ['--version'], { stdio: 'ignore' })
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

async function writePurposes({ ctx, state }) {
  const { repo, plan, onboarding, log, env, codex } = ctx
  const { writer, checker } = onboarding
  const eventsDir = path.join(workFolder(repo), 'events')
  const guard = ctx.estimate.purposes.writerTokens ? ctx.estimate.purposes.writerTokens * RUNAWAY_FACTOR : Infinity
  const secretNames = checker.secrets
  const pending = []
  const items = new Map(plan.purposes.components.map((c) => [c.id, { id: c.id, name: c.name, file: c.file, kind: c.kind, status: 'rejected', reason: 'the writer did not run' }]))
  for (const skipped of plan.purposes.skipped) items.set(skipped.id, { id: skipped.id, name: skipped.name, file: skipped.file, status: 'rejected', reason: skipped.reason })
  let tokens = 0
  let executed = 0

  for (const call of plan.calls) {
    if (tokens > guard) {
      for (const file of call.files) for (const c of file.components) items.set(c.id, { ...items.get(c.id), reason: 'the run stopped before this call: the writer had used more than twice its estimate' })
      state.guardNote = `The writer passed ${RUNAWAY_FACTOR} times its estimate, so the run stopped before the remaining calls.`
      continue
    }
    const dirAbs = path.join(repo, call.dir)
    assertPlainPath(repo, dirAbs)
    const planned = new Map(call.files.map((f) => [f.file, f]))
    log(`Writer call ${executed + 1} of ${plan.calls.length}: ${call.dir} (${call.count} component${call.count === 1 ? '' : 's'} in ${call.files.length} file${call.files.length === 1 ? '' : 's'})`)
    const result = await runCodex({ codex, dir: dirAbs, prompt: writerPrompt(call), settings: writer, env: writerEnvironment(env, secretNames), eventsFile: path.join(eventsDir, `${String(executed + 1).padStart(2, '0')}.jsonl`) })
    executed += 1
    tokens += result.summary.tokens ?? 0
    log(`  ${result.ok ? 'finished' : `failed: ${result.error}`}, ${result.summary.tokens ?? 0} tokens, ${Math.round(result.durationMs / 1000)} seconds${result.summary.unexpected.length ? `, used ${result.summary.unexpected.join(' and ')} (not expected)` : ''}`)
    state.writerCalls.push({ id: call.id, dir: call.dir, ok: result.ok, tokens: result.summary.tokens ?? 0, durationMs: result.durationMs, error: result.error ?? null, unexpected: result.summary.unexpected, components: call.count })

    // Whatever happened, the working tree is read and then put back, so the next call starts clean.
    const changed = changedFiles(repo)
    const outside = changed.filter((c) => !planned.has(c.path))
    const after = new Map()
    for (const c of changed.filter((x) => planned.has(x.path) && x.status !== '??' && !x.status.includes('D'))) after.set(c.path, fs.readFileSync(path.join(repo, c.path), 'utf8'))
    resetPaths(repo, changed, (p) => removePlainFile(repo, path.join(repo, p)))
    if (changedFiles(repo).length > 0) throw new Error('The working tree was not restored after a writer call.')

    for (const file of call.files) {
      const entries = file.components
      const reject = (reason) => { for (const c of entries) items.set(c.id, { ...items.get(c.id), status: 'rejected', reason }) }
      if (outside.length > 0) { reject(`the writer changed files the plan did not list (${outside.slice(0, 3).map((o) => o.path).join(', ')})`); continue }
      if (!after.has(file.file)) { reject(result.ok ? 'the writer left the file unchanged' : `the writer did not finish: ${result.error}`); continue }
      const judged = judgeWrittenFile({ ts: plan.ts, file: path.join(repo, file.file), before: file.source, after: after.get(file.file), components: entries.map((c) => ({ id: c.id, name: c.name })) })
      for (const verdict of judged.results) {
        const component = entries.find((c) => c.id === verdict.id)
        if (verdict.ok) {
          items.set(component.id, { ...items.get(component.id), status: 'pending', reason: null, useWhen: verdict.useWhen, notFor: verdict.notFor })
          pending.push({ component, file: file.file, useWhen: verdict.useWhen, notFor: verdict.notFor })
        } else items.set(component.id, { ...items.get(component.id), status: 'rejected', reason: verdict.reason })
      }
    }
  }
  state.writerTokens = tokens
  state.writerExecuted = executed
  return { pending, items }
}

async function checkPurposes({ ctx, state, pending, items }) {
  const { plan, onboarding, env, log, fetchImpl } = ctx
  const { checker } = onboarding
  const key = checker.route === 'openrouter' ? env[checker.secrets[0]] : null
  const snippetsOf = (component) => snippetsFor({ ts: plan.ts, root: plan.root, usage: plan.usage, entry: component.entry, limit: checker.usageSnippets })
  const todo = []
  for (const p of pending) {
    const snippets = snippetsOf(p.component)
    if (snippets.length === 0) items.set(p.component.id, { ...items.get(p.component.id), status: 'unchecked', reason: 'it is not used anywhere, so there is no usage to check against' })
    else if (checker.route === 'external') items.set(p.component.id, { ...items.get(p.component.id), status: 'unchecked', reason: `waiting for ${checker.agent}` })
    else todo.push({ ...p, snippets })
  }
  log(`Checker: ${todo.length} call${todo.length === 1 ? '' : 's'} on ${checker.model}`)
  state.checkerRuns = []
  await pool(todo, CHECKER_CONCURRENCY, async (p) => {
    const prompt = checkerPrompt({ name: p.component.name, entry: p.component.entry, useWhen: p.useWhen, notFor: p.notFor, snippets: p.snippets })
    const result = await runCheck({ key, model: checker.model, prompt, fetchImpl })
    state.checkerRuns.push({ id: p.component.id, verdict: result.verdict, attempts: result.attempts, tokens: result.tokens, usd: result.usd })
    const current = items.get(p.component.id)
    if (result.verdict === 'pass') items.set(p.component.id, { ...current, status: 'kept', verdict: 'pass', reason: result.reason })
    else if (result.verdict === 'fail') items.set(p.component.id, { ...current, status: 'dropped', verdict: 'fail', reason: result.reason })
    else items.set(p.component.id, { ...current, status: 'unchecked', verdict: 'error', reason: `the checker could not answer: ${result.reason}` })
    log(`  ${p.component.name}: ${result.verdict}${result.reason ? `, ${result.reason}` : ''} (${result.tokens} tokens)`)
  })
}

const sumOf = (list, field) => list.reduce((total, item) => total + (item[field] ?? 0), 0)

function docsPath(repo, docsDir, ...parts) {
  return path.join(repo, docsDir, ...parts)
}

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

  const base = preflight({ repo, approve, onboarding, env, log })
  const plan = buildPlan({ root: repo, folders, onboarding })
  if (plan.id !== estimate.id) throw new UserError(`The repo is not the one the estimate was made on (the plan is now ${plan.id}, the estimate says ${estimate.id}). Run onboard.mjs estimate again.`)
  const caps = captures ? readCaptures(path.resolve(repo, captures)) : undefined

  const ctx = { repo, plan, estimate, onboarding, log, env, fetchImpl, codex }
  const state = { plan, estimate, prs: [], docsDir: onboarding.docsDir, writerLabel: writerLabel(onboarding), checkerLabel: checkerLabel(onboarding), writerCalls: [], writerExecuted: 0, writerTokens: 0, checkerRuns: [], purposes: { items: [] }, stories: null, rows: [], startedAt: new Date().toISOString() }
  mkdirPlain(repo, work)

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

  let actual
  let storyItems
  try {
    // ---- 1. the list and the duplicates
    git(repo, ['checkout', '-q', '-b', BRANCHES[0]])
    const baseline = await pickVersions({ root: repo, inventory: plan.inventory, baseline: true, captures: caps, ts: plan.ts })
    writeInventoryFiles(repo, baseline.inventory)
    const docs = onboarding.docsDir
    const listPaths = ['inventory.json', 'INVENTORY.md']
    const put = (rel, text, into) => {
      writePlainFile(repo, path.join(repo, rel), text)
      into.push(toPosix(rel))
    }
    put(`${docs}/duplicates.md`, renderDuplicatesList(plan.duplicates), listPaths)
    put(`${docs}/duplicates.json`, `${JSON.stringify(plan.duplicates, null, 2)}\n`, listPaths)
    put(`${docs}/decisions.md`, renderDecisions(plan.duplicates), listPaths)
    plan.duplicates.filter((p) => p.verdict === 'merge').forEach((pair, index) => put(`${docs}/tickets/${ticketFileName(pair, index + 1)}`, renderTicket(pair), listPaths))
    finish(1, 'Add the component inventory at 1.0.0 and the duplicates list\n\nWritten by the Klaus onboarding run. No model ran.', listPaths)
    open(1, bodyFile(1, listBody(state)), base)

    // ---- 2. the purposes
    git(repo, ['checkout', '-q', '-b', BRANCHES[1]])
    const { pending, items } = await writePurposes({ ctx, state })
    await checkPurposes({ ctx, state, pending, items })
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
    const byFile = new Map(second.inventory.entries.map((e) => [`${e.file}#${e.name}`, e]))
    const screenshots = new Map((second.inventory.screens ?? []).map((s) => [s.route, s.screenshot]))
    storyItems = plan.stories.items.map((item) => {
      if (item.status === 'write') {
        const entry = byFile.get(item.id)
        put(item.storyFile, renderStory({ entry, importPath: item.importPath, isDefault: item.isDefault, framework: plan.stories.framework, typed: item.typed, args: item.args }), storyPaths)
      }
      if (item.status === 'data-bound') {
        const entry = byFile.get(item.id)
        const screens = entry.usedIn
        const capture = screens.map((s) => screenshots.get(s)).find(Boolean)
        return { ...item, screens, capture: capture ?? null }
      }
      return item
    })
    state.stories = { framework: plan.stories.framework, items: storyItems }
    put(`${docs}/stories.md`, renderStoriesView(state), storyPaths)
    put(`${docs}/stories.json`, `${JSON.stringify(state.stories, null, 2)}\n`, storyPaths)

    const checkerUsd = state.checkerRuns.some((r) => r.usd !== null) ? sumOf(state.checkerRuns.map((r) => ({ usd: r.usd })), 'usd') : null
    actual = {
      entries: second.inventory.entries.length,
      purposes: plan.purposes.components.length,
      writerCalls: state.writerExecuted,
      checkerCalls: sumOf(state.checkerRuns, 'attempts'),
      writerTokens: onboarding.writer.route === 'external' ? null : state.writerTokens,
      checkerTokens: onboarding.checker.route === 'external' ? null : sumOf(state.checkerRuns, 'tokens'),
      checkerUsd: onboarding.checker.route === 'external' ? null : checkerUsd ?? 0,
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

  const report = { schemaVersion: 1, estimateId: estimate.id, startedAt: state.startedAt, finishedAt: new Date().toISOString(), pullRequests: state.prs, actual, comparison: state.rows, writerCalls: state.writerCalls, checkerRuns: state.checkerRuns, purposes: state.purposes.items.map(({ id, name, file, status, verdict, reason }) => ({ id, name, file, status, verdict: verdict ?? null, reason: reason ?? null })), stories: storyItems.map((s) => ({ id: s.id, status: s.status })), notes: state.guardNote ? [state.guardNote] : [] }
  writeJsonFile(path.join(work, 'report.json'), report)
  log(renderSummary(state))
  return { report, state }
}
