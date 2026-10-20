/**
 * The onboarding run: three pull requests in order, from the plan the estimate was made on.
 *
 *   1. the list at 1.0.0, and the duplicates (no model)
 *   2. the missing purposes, written and then checked against where each component is used
 *   3. stories for components that have none, and the screens for the data-bound ones (no model)
 *
 * Before any model call, the files that need no model are worked out, each story is type-checked
 * with the repo's own TypeScript (story-check.mjs, inside the plan), and the repo's pre-commit
 * hook is tried on each commit's files (hook-check.mjs), so a hook or a compiler that would refuse
 * a commit stops the run before anything is spent. A story that does not compile is left for a
 * person and is not written. The model work (purposes-stage.mjs) comes next and
 * changes no branch, and each result is saved as it arrives (results.mjs), so a stop after it
 * does not lose it. Then the branches are made and stacked: the second is cut from the first, the
 * third from the second, and each pull request is based on the branch before it. Nothing is merged.
 *
 * A run of the same plan after a stop continues from the first pull request that is not merged
 * (stages.mjs decides which are). It makes that one and the ones after it again: their branches
 * are cut again from the plan, an open pull request for one of them is closed and replaced by a new
 * one that says which it replaces, and the model's saved results are used again. A merged pull
 * request whose files are not what the plan writes stops the run, with the files that differ.
 * With --refresh, a merged first pull request whose files differ is made again as a refresh
 * instead: a branch of its own cut from the default branch, holding only the files that change,
 * with the second and third stacked on it. The estimate lists those files, and the plan id it
 * prints approves them.
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
import { decisionPairs, decisionPictureName } from './decisions.mjs'
import { attachDecisionPictures, decisionFiles, mergedPictureFiles } from './decisions-pictures.mjs'
import { renderDuplicatesList } from './duplicates.mjs'
import { compareToEstimate, comparisonNotes } from './estimate.mjs'
import { changedFiles, closePullRequest, commit, createPullRequest, currentBranch, editPullRequest, git, gitDir, listPullRequests, pushBranch, remoteTip, resetPaths, run as runProgram, topLevel } from './git.mjs'
import { checkCommitHooks } from './hook-check.mjs'
import { buildPlan } from './plan.mjs'
import { mkdirPlain, removePlainFile, writePlainFile } from './plain-path.mjs'
import { obtainPurposes, savedWork } from './purposes-stage.mjs'
import { createResultStore } from './results.mjs'
import { findMerged, REFRESH_BRANCH, REFRESH_TITLE, refreshChanges } from './stages.mjs'
import { renderStory } from './stories.mjs'
import { applyPurposes } from './verify.mjs'

export { RUNAWAY_FACTOR } from './purposes-stage.mjs'

export const BRANCHES = Object.freeze(['klaus/onboarding-1-list', 'klaus/onboarding-2-purposes', 'klaus/onboarding-3-stories'])
export const TITLES = Object.freeze([
  'Klaus onboarding 1 of 3: the list of components at 1.0.0, and the duplicates',
  'Klaus onboarding 2 of 3: purpose comments, written and then checked',
  'Klaus onboarding 3 of 3: stories for components that have none',
])
export { REFRESH_BRANCH, REFRESH_TITLE }

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

const inventoryFiles = (inventory) => [
  { rel: 'inventory.json', text: `${JSON.stringify(inventory, null, 2)}\n` },
  { rel: 'INVENTORY.md', text: renderMarkdown(inventory) },
]

/**
 * The files of the first pull request: the list at 1.0.0 and the duplicates. None needs a model.
 * The decisions list, the tickets and the pictures come from decisions-pictures.mjs, with the
 * pictures the run drew (`plan.decisionPictures`). Before they are drawn, as when the run finds out
 * what an earlier run merged, the decisions list says it has none.
 */
function listFiles(plan, inventory, docs) {
  return [
    ...inventoryFiles(inventory),
    { rel: `${docs}/duplicates.md`, text: renderDuplicatesList(plan.duplicates) },
    { rel: `${docs}/duplicates.json`, text: `${JSON.stringify(plan.duplicates, null, 2)}\n` },
    ...decisionFiles({ pairs: plan.duplicates, pictures: plan.decisionPictures, docs }),
  ]
}

/**
 * The files of the third pull request, the stories and their lists, and the story items for the
 * report. None needs a model: a story is made from the component's name and props, which a
 * purpose comment does not change.
 */
export function storyFiles(plan, inventory, docs) {
  const byId = new Map(inventory.entries.map((e) => [`${e.file}#${e.name}`, e]))
  const captureOf = new Map((inventory.screens ?? []).map((s) => [s.route, s.screenshot]))
  const files = []
  const items = plan.stories.items.map((item) => {
    if (item.status === 'write') files.push({ rel: item.storyFile, text: renderStory({ entry: byId.get(item.id), importPath: item.importPath, isDefault: item.isDefault, framework: item.framework ?? plan.stories.framework, typed: item.typed, args: item.args }) })
    if (item.status !== 'data-bound') return item
    const screens = byId.get(item.id).usedIn
    return { ...item, screens, capture: screens.map((s) => captureOf.get(s)).find(Boolean) ?? null }
  })
  const stories = { framework: plan.stories.framework, items }
  files.push({ rel: `${docs}/stories.md`, text: renderStoriesView({ stories }) }, { rel: `${docs}/stories.json`, text: `${JSON.stringify(stories, null, 2)}\n` })
  return { files, stories }
}

/** What the purpose comments read as in the commit hook check, before the writer has written one. */
export const PLACEHOLDER_PURPOSE = Object.freeze({
  useWhen: 'this placeholder stands in for the purpose the writer will write, so the commit hook can be tried first.',
  notFor: 'anything that is committed, because the onboarding run writes the real purpose before it commits.',
})

/**
 * The files of the second pull request as they would be with a placeholder purpose in each file
 * the writer is given. The real commit holds only the purposes that pass, so it is a part of this.
 */
function placeholderPurposeFiles(state, plan, inventory, docs) {
  // A file with many components can be split over two calls, and its commit holds them all.
  const byFile = new Map()
  for (const f of plan.calls.flatMap((call) => call.files)) byFile.set(f.file, { source: f.source, names: [...(byFile.get(f.file)?.names ?? []), ...f.components.map((c) => c.name)] })
  const files = [...byFile].map(([file, { source, names }]) => ({ rel: file, text: applyPurposes(plan.ts, path.join(plan.root, file), source, names.map((name) => ({ name, ...PLACEHOLDER_PURPOSE }))) }))
  const items = plan.purposes.components.map((c) => ({ id: c.id, name: c.name, file: c.file, status: 'kept', verdict: 'pass', reason: null, ...PLACEHOLDER_PURPOSE }))
  return [...files, ...inventoryFiles(inventory), { rel: `${docs}/purposes.md`, text: renderPurposesView({ ...state, purposes: { items } }) }]
}

/**
 * What a refresh of the first pull request commits on the default branch, which the repo is on:
 * the files that are not there or differ, as the plan writes them, and the old tickets and
 * pictures to remove. `changes` says which is which, for the estimate and the pull request.
 */
export function refreshCommit({ repo, files, docs, mayWrite }) {
  const changes = refreshChanges({ repo, docs, files, mayWrite })
  const changed = new Set(changes.filter((c) => c.change !== 'removed').map((c) => c.rel))
  return { files: files.filter((f) => changed.has(f.rel)), remove: changes.filter((c) => c.change === 'removed').map((c) => c.rel), changes }
}

/**
 * The three commits as the commit hook check tries them, in order, from the plan and the list at
 * 1.0.0. The first and third hold what the real commits will. The second has a placeholder purpose.
 * With `refresh`, the first is the refresh of the merged one: only its files that change, and the removals.
 */
export function commitsToTry({ state, plan, inventory, docs, refresh = null }) {
  let first = { label: 'pull request 1 (the list and the duplicates)', files: listFiles(plan, inventory, docs) }
  if (refresh) {
    const { files, remove } = refreshCommit({ repo: refresh.repo, files: first.files, docs })
    first = { label: 'pull request 1 (the refresh of the list and the duplicates)', files, remove }
  }
  return [
    first,
    { label: 'pull request 2 (the purpose comments, each written as a placeholder)', files: placeholderPurposeFiles(state, plan, inventory, docs) },
    { label: 'pull request 3 (the stories)', files: storyFiles(plan, inventory, docs).files },
  ]
}

function preflight({ repo }) {
  if (changedFiles(repo).length > 0) throw new UserError('The working tree has changes. Commit or stash them first: the run needs a clean tree to tell what the writer changed.')
  if (git(repo, ['remote', 'get-url', 'origin'], { allowFail: true }) === null) throw new UserError('The repo has no origin remote to push the branches to.')
  if (runProgram('gh', repo, ['auth', 'status'], { allowFail: true }) === null) throw new UserError('gh is not signed in. Run gh auth login first.')
  const base = currentBranch(repo)
  const remoteDefault = runProgram('gh', repo, ['repo', 'view', '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name'], { allowFail: true })?.trim()
  if (remoteDefault && remoteDefault !== base) throw new UserError(`The run starts from the default branch, ${remoteDefault}, and the repo is on ${base}.`)
  // The pull requests are based on the remote branch, so anything that is only on this machine would be inside the first one.
  git(repo, ['fetch', '-q', 'origin', base])
  const remoteTipOfBase = git(repo, ['rev-parse', `refs/remotes/origin/${base}`], { allowFail: true })?.trim()
  if (remoteTipOfBase && remoteTipOfBase !== git(repo, ['rev-parse', 'HEAD']).trim()) throw new UserError(`${base} and origin/${base} are not the same commit. Push or pull first: the pull requests are based on origin/${base}, and a commit that is only here would end up in the first one.`)
  return base
}

/** The writer and the checker can run: each is checked only when the run will call it. */
function checkModelRoutes({ onboarding, env, codex, writer, checker }) {
  if (writer && onboarding.writer.route === 'codex-cli') {
    try {
      execFileSync(codex ?? 'codex', ['--version'], { stdio: 'ignore' })
    } catch {
      throw new UserError('The Codex CLI is not installed. Install it and sign in with codex login, or set onboarding.writer.route to external.')
    }
  }
  if (checker && onboarding.checker.route === 'openrouter') {
    const name = onboarding.checker.secrets[0]
    if (!name || !env[name]) throw new UserError(`${name ?? 'The checker key'} is not set in the environment. Run this command through your secret store so it is set for this command only.`)
  }
}

/**
 * Which pull requests an earlier run already merged, and so where a run starts (stages.mjs), with
 * the list at 1.0.0 it compared. Changes nothing. The estimate shows the answer, and the run acts on it.
 *
 * When the first pull request is merged with files that differ, `refreshFiles` says what a refresh
 * would change. The pictures are not drawn yet, so when the plan has questions on the decisions list
 * (`redrawn`), the list and its pictures are left out: the run draws them and knows only then.
 */
export async function earlierRuns({ repo, plan, onboarding, captures, base = currentBranch(repo), refresh = false }) {
  const caps = captures ? readCaptures(path.resolve(repo, captures)) : undefined
  const listed = (await pickVersions({ root: repo, inventory: plan.inventory, baseline: true, captures: caps, ts: plan.ts, dryRun: true })).inventory
  const docs = onboarding.docsDir
  const files = listFiles(plan, listed, docs)
  // The pictures are not drawn here, so the ones the merged decisions list shows are the ones that have to be there.
  const found = findMerged({ repo, base, docs, listFiles: [...files, ...mergedPictureFiles({ repo, docs })], refresh })
  if (!found.refreshable) return { listed, ...found }
  const questions = decisionPairs(plan.duplicates)
  const redrawn = questions.length > 0
  const mayWrite = questions.map((pair, index) => `${docs}/decisions/${decisionPictureName(pair, index + 1)}`)
  const { changes } = refreshCommit({ repo, docs, files: redrawn ? files.filter((f) => !f.volatile) : files, mayWrite: [...mayWrite, `${docs}/decisions.md`] })
  return { listed, ...found, refreshFiles: { base, changes, redrawn } }
}

/**
 * Refuses a refresh the estimate did not list. The plan id does not cover what is on the default
 * branch, so --approve covers a refresh only when the estimate listed the same changes. The decisions
 * list and its pictures are left out: the estimate cannot draw them, and says the run draws them again.
 *
 * Only the set of files and the kind of each change are held, not the first place a file differs.
 * What the refresh writes is the plan's text, which the plan id approves. The default branch decides
 * only which files are in the refresh, and each one is shown in a pull request before anything merges.
 */
function holdRefreshToEstimate({ estimate, approve, changes }) {
  const approved = estimate.earlier?.refreshFiles?.changes
  if (!approved) throw new UserError(`The estimate lists no refresh of the first pull request, so --approve ${approve} does not approve one. Run onboard.mjs estimate again and read it.`)
  const lines = (list) => list.filter((c) => !c.volatile).map((c) => `${c.rel} ${c.change}`)
  const now = lines(changes)
  const then = lines(approved)
  if (now.join('\n') === then.join('\n')) return
  const added = now.filter((c) => !then.includes(c))
  const gone = then.filter((c) => !now.includes(c))
  throw new UserError(`The files a refresh would change are not the ones the estimate lists.${added.length ? ` Now: ${added.join('; ')}.` : ''}${gone.length ? ` No longer: ${gone.join('; ')}.` : ''} Run onboard.mjs estimate again and read it.`)
}

const sumOf = (list, field) => list.reduce((total, item) => total + (item[field] ?? 0), 0)

/**
 * @param {object} options
 * @param {string} options.repo
 * @param {string} options.approve The plan id the estimate printed.
 * @param {string} [options.captures] Dieter's captures for the baseline.
 * @param {string} [options.storybookDir] The static Storybook build the decisions' pictures are drawn from, relative to the repo. Found when not given.
 * @param {Function} [options.openStorybook] Opens that build in a browser. The Figma adapter's reader by default; a test gives its own.
 * @param {string} [options.writerBranch] Branch holding an external writer's edits.
 * @param {string} [options.checksFile] An external checker's verdicts.
 * @param {string[]} [options.commitTrailers]
 * @param {string} [options.bodyFooter]
 * @param {boolean} [options.refresh] Make a merged first pull request whose files differ again, as a refresh, instead of refusing.
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

  const base = preflight({ repo })
  const plan = buildPlan({ root: repo, folders, onboarding })
  if (plan.id !== estimate.id) throw new UserError(`The repo is not the one the estimate was made on (the plan is now ${plan.id}, the estimate says ${estimate.id}). Run onboard.mjs estimate again.`)
  const caps = captures ? readCaptures(path.resolve(repo, captures)) : undefined
  const docs = onboarding.docsDir

  // ---- what an earlier run of this plan already merged. A dry run copies no screenshot, so the tree stays clean.
  const earlier = await earlierRuns({ repo, plan, onboarding, captures, base, refresh: options.refresh === true })
  if (earlier.refusal) throw new UserError(earlier.refusal)
  const { listed, start } = earlier
  if (earlier.refresh) holdRefreshToEstimate({ estimate, approve, changes: earlier.refreshFiles.changes })
  if (earlier.note) log(earlier.note)
  const state = { plan, estimate, base, prs: [], merged: earlier.merged.map((step) => ({ step, ...mergedPullRequest(repo, step) })), refresh: earlier.refresh ? { of: mergedPullRequest(repo, 1), changes: [] } : null, replaced: {}, docsDir: docs, writerLabel: writerLabel(onboarding), checkerLabel: checkerLabel(onboarding), writerCalls: [], writerExecuted: 0, writerReused: 0, writerTokens: 0, checkerRuns: [], checksNotReached: [], purposes: { items: [] }, stories: null, rows: [], notes: [], startedAt: new Date().toISOString() }
  if (start > 3) {
    log('Nothing to do: the three pull requests are merged.')
    return { done: true, state, report: null }
  }
  // ---- the pictures for the decisions, drawn from the repo's static Storybook build. Only the first pull request holds them.
  if (start <= 1) plan.decisionPictures = await attachDecisionPictures({ plan, storybookDir: options.storybookDir, open: options.openStorybook, log })
  const modelWork = start <= 2
  mkdirPlain(repo, work)
  const store = createResultStore({ repo, work, planId: plan.id })
  if (modelWork) {
    // A run that has every result it needs saved calls no model, so it needs neither the Codex CLI nor the key.
    // Which checks are needed is known only once every writer call is: until then the key is needed.
    const saved = savedWork({ plan, onboarding, store })
    const allWritten = saved.writerCalls.length === plan.calls.length
    checkModelRoutes({ onboarding, env, codex, writer: !allWritten, checker: !allWritten || saved.checkable > saved.checks })
  }
  log(`Base branch ${base}. The estimate's plan ${approve} matches.`)
  const { check } = plan.stories
  log(`Stories: ${check.typeChecked} type-checked with the repo's own TypeScript before any branch or model call. Left for a person: ${plan.stories.items.filter((i) => i.status === 'skipped').length} (${check.noStorybook} in folders no Storybook loads, ${check.needsValue} with a required prop to fill in, ${check.storybookMissing + check.didNotCompile} that did not compile).`)

  const sources = new Map(plan.calls.flatMap((call) => call.files.map((f) => [f.file, f.source])))
  const ctx = { repo, plan, estimate, onboarding, log, env, fetchImpl, codex, work, base, options, store, sources }

  // ---- the commit hook, tried on the files of every commit still to make, before anything is spent
  log('Trying the repo\'s pre-commit hook on the files of each pull request, before any model call.')
  checkCommitHooks({ repo, log, hookRun: options.hookRun, outputFile: path.join(work, 'hook-check.txt'), steps: commitsToTry({ state, plan, inventory: listed, docs, refresh: state.refresh ? { repo } : null }).slice(start - 1) })

  // ---- the model work, before any branch is made. Once the purposes are merged there is none.
  let items = new Map()
  let pending = []
  if (modelWork) {
    const stage = await obtainPurposes({ ctx, state })
    if (stage.waiting) {
      log(stage.waiting.message)
      return { waiting: stage.waiting.part, state }
    }
    items = stage.items
    pending = stage.pending
  }

  const bodyFile = (step, text) => {
    const file = path.join(work, `pr-${step}.md`)
    fs.writeFileSync(file, `${text}\n\n${bodyFooter}`.trimEnd() + '\n')
    return file
  }
  /** The step's branch. A refresh of the first pull request has its own, and the second is stacked on it. */
  const branchOf = (step) => (step === 1 && state.refresh ? REFRESH_BRANCH : BRANCHES[step - 1])
  /** Cuts the step's branch from where HEAD is. A branch an earlier run made is moved, so its old commits stay in its reflog. */
  const cut = (step) => {
    const branch = branchOf(step)
    const old = git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { allowFail: true })?.trim()
    git(repo, ['checkout', '-q', '-B', branch])
    if (old) log(`The branch ${branch} is made again from the plan. It was at ${old.slice(0, 10)}, which its reflog keeps.`)
  }
  /**
   * Pushes the step's branch and opens its pull request. An open one for the same branch, from an
   * earlier run, is closed first, and the new one says which it replaces.
   */
  const publish = (step, body) => {
    const branch = branchOf(step)
    const previous = listPullRequests(repo, branch, 'open')
    state.replaced[step] = previous
    const file = bodyFile(step, body())
    for (const pr of previous) {
      closePullRequest(repo, pr.number, `Replaced: the Klaus onboarding run made ${branch} again from the same plan and opened a new pull request for it.`)
      log(`Closed pull request #${pr.number}, which an earlier run opened for ${branch}.`)
    }
    pushBranch(repo, branch, remoteTip(repo, branch))
    const baseBranch = step === start ? base : branchOf(step - 1)
    const pr = createPullRequest(repo, { base: baseBranch, head: branch, title: branch === REFRESH_BRANCH ? REFRESH_TITLE : TITLES[step - 1], bodyFile: file })
    state.prs.push({ step, branch, ...pr })
    log(`Pull request ${step} of 3: ${pr.url}${previous.length ? `, in place of ${previous.map((p) => `#${p.number}`).join(', ')}` : ''}`)
  }
  const put = (rel, text, into) => {
    writePlainFile(repo, path.join(repo, rel), text)
    into.push(toPosix(rel))
  }

  let actual
  let storyItems
  try {
    let inventoryNow = listed
    // ---- 1. the list and the duplicates, or a refresh of the merged ones: only the files that change, cut from the default branch
    if (start <= 1) {
      cut(1)
      const baseline = await pickVersions({ root: repo, inventory: plan.inventory, baseline: true, captures: caps, ts: plan.ts })
      const listPaths = []
      if (state.refresh) {
        // The pictures are drawn now, so an old one that the new decisions list does not show is removed. Pictures are left out of the approval check.
        const refresh = refreshCommit({ repo, files: listFiles(plan, baseline.inventory, docs), docs })
        // The list the commit writes is made again here, without the dry run, so it is held to the estimate again before anything is written.
        holdRefreshToEstimate({ estimate, approve, changes: refresh.changes })
        state.refresh.changes = refresh.changes
        for (const file of refresh.files) put(file.rel, file.text, listPaths)
        for (const rel of refresh.remove) {
          removePlainFile(repo, path.join(repo, rel))
          listPaths.push(rel)
        }
        const of = state.refresh.of.number ? ` merged in #${state.refresh.of.number}` : ''
        commit(repo, { message: `Refresh the component inventory at 1.0.0 and the duplicates list\n\nWritten by the Klaus onboarding run, run with --refresh. The files${of} are not what this plan writes now, so ${refresh.changes.length} ${refresh.changes.length === 1 ? 'file changes' : 'files change'}. No model ran.`, paths: listPaths, trailers: commitTrailers })
      } else {
        for (const file of listFiles(plan, baseline.inventory, docs)) put(file.rel, file.text, listPaths)
        commit(repo, { message: 'Add the component inventory at 1.0.0 and the duplicates list\n\nWritten by the Klaus onboarding run. No model ran.', paths: listPaths, trailers: commitTrailers })
      }
      inventoryNow = baseline.inventory
      publish(1, () => listBody(state))
    }

    // ---- 2. the purposes
    if (start <= 2) {
      cut(2)
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
      for (const file of inventoryFiles(second.inventory)) put(file.rel, file.text, purposePaths)
      put(`${docs}/purposes.md`, renderPurposesView(state), purposePaths)
      commit(repo, { message: `Write ${keep.length} purpose comments, checked against where each component is used\n\nWritten by the Klaus onboarding run. A doc comment that was there keeps all of its text.`, paths: purposePaths, trailers: commitTrailers })
      inventoryNow = second.inventory
      publish(2, () => purposesBody(state))
    }

    // ---- 3. the stories
    cut(3)
    const storyPaths = []
    const written = storyFiles(plan, inventoryNow, docs)
    for (const file of written.files) put(file.rel, file.text, storyPaths)
    state.stories = written.stories
    storyItems = written.stories.items

    const external = (part) => onboarding[part].route === 'external'
    const made = state.checkerRuns.filter((r) => !r.reused)
    const reusedChecks = state.checkerRuns.filter((r) => r.reused)
    // With the purposes already merged, this run did no model work, and there is nothing of it to compare.
    const modelNumber = (value) => (modelWork ? value : null)
    actual = {
      entries: inventoryNow.entries.length,
      purposes: modelNumber(plan.purposes.components.length),
      writerCalls: modelNumber(state.writerExecuted),
      writerReused: state.writerCalls.filter((c) => c.reused).map((c) => c.id),
      checkerCalls: modelNumber(external('checker') ? made.length : sumOf(made, 'attempts')),
      checksMade: made.length,
      checkerReused: reusedChecks.map((r) => r.id),
      checksNotReached: state.checksNotReached,
      writerTokens: modelNumber(external('writer') ? null : state.writerTokens),
      checkerTokens: modelNumber(external('checker') ? null : sumOf(made, 'tokens')),
      checkerUsd: modelNumber(external('checker') ? null : made.some((r) => r.usd !== null) ? sumOf(made, 'usd') : 0),
      stories: storyItems.filter((i) => i.status === 'write').length,
      storiesLeft: storyItems.filter((i) => i.status === 'skipped').length,
      pairs: plan.duplicates.length,
      tickets: plan.duplicates.filter((p) => p.verdict === 'merge').length,
      decisions: plan.duplicates.filter((p) => p.verdict !== 'merge').length,
    }
    state.actual = actual
    state.rows = compareToEstimate(estimate, actual)
    const refreshNote = state.refresh ? [`The run refreshed the first pull request: ${state.refresh.of.number ? `#${state.refresh.of.number}` : 'it'} was merged with files this plan no longer writes, so pull request 1 is a refresh from ${base} that changes ${state.refresh.changes.length} ${state.refresh.changes.length === 1 ? 'file' : 'files'}, and the second and third are stacked on it.`] : []
    state.notes = [...refreshNote, ...(start > 1 ? [`The run continued at pull request ${start}: ${earlier.merged.map((s) => `pull request ${s}`).join(' and ')} ${earlier.merged.length === 1 ? 'was' : 'were'} already merged.${modelWork ? '' : ' It made no model call, so the model rows are not compared.'}`] : []), ...comparisonNotes(estimate, actual)]
    commit(repo, { message: `Add ${actual.stories} stories and list the data-bound components with their screens\n\nWritten by the Klaus onboarding run. No model wrote these stories.`, paths: storyPaths, trailers: commitTrailers })
    publish(3, () => storiesBody(state))

    // ---- the bodies again, now that each knows the others' numbers
    const bodies = { 1: () => listBody(state), 2: () => purposesBody(state), 3: () => storiesBody(state) }
    for (const pr of state.prs) editPullRequest(repo, pr.number, bodyFile(pr.step, bodies[pr.step]()))
  } catch (error) {
    log(`The run stopped: ${error.message}`)
    // The run started from a clean tree, so whatever is left uncommitted is its own: the files of
    // the commit that failed. They are put back, so the base branch can be checked out again.
    try {
      git(repo, ['reset', '-q'])
      resetPaths(repo, changedFiles(repo), (p) => removePlainFile(repo, path.join(repo, p)))
    } catch (restoreError) {
      log(`The files of the commit that failed could not all be put back (${restoreError.message}). Check git status before the next run.`)
    }
    const branches = [...(state.refresh ? [REFRESH_BRANCH] : []), ...BRANCHES].filter((b) => git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`], { allowFail: true }) !== null)
    log(`Branches made so far: ${branches.join(', ') || 'none'}. Pull requests opened: ${state.prs.map((p) => p.url).join(', ') || 'none'}. To go on, run the same command again: it keeps a pull request that is merged, makes the others again, and closes and replaces any of them that is still open.`)
    if (fs.existsSync(store.dir)) log(`The model's results are kept in ${store.dir}. A run with the same plan uses them again instead of calling the model.`)
    throw error
  } finally {
    git(repo, ['checkout', '-q', base], { allowFail: true })
  }

  const report = {
    schemaVersion: 1,
    estimateId: estimate.id,
    startedAt: state.startedAt,
    finishedAt: new Date().toISOString(),
    continuedAt: start,
    alreadyMerged: state.merged,
    refreshed: state.refresh ? [{ step: 1, of: state.refresh.of, changes: state.refresh.changes.map(({ rel, change }) => ({ rel, change })) }] : [],
    pullRequests: state.prs,
    replaced: Object.entries(state.replaced).flatMap(([step, list]) => list.map((pr) => ({ step: Number(step), ...pr }))),
    actual,
    comparison: state.rows,
    writerCalls: state.writerCalls,
    checkerRuns: state.checkerRuns,
    purposes: state.purposes.items.map(({ id, name, file, status, verdict, reason }) => ({ id, name, file, status, verdict: verdict ?? null, reason: reason ?? null })),
    stories: storyItems.map((s) => ({ id: s.id, status: s.status, ...(s.status === 'skipped' ? { reason: s.reason } : {}) })),
    notes: [...(state.guardNote ? [state.guardNote] : []), ...state.notes],
  }
  writeJsonFile(path.join(work, 'report.json'), report)
  log(renderSummary(state))
  return { report, state }
}

/**
 * The merged pull request of a step, for the links in the bodies, or nothing when gh cannot say.
 * For the first, a merged refresh comes before the pull request it refreshed, since it is the later one.
 */
function mergedPullRequest(repo, step) {
  try {
    for (const branch of step === 1 ? [REFRESH_BRANCH, BRANCHES[0]] : [BRANCHES[step - 1]]) {
      const [pr] = listPullRequests(repo, branch, 'merged')
      if (pr) return { number: pr.number, url: pr.url }
    }
    return {}
  } catch {
    return {}
  }
}
