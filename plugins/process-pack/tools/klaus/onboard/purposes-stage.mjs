/**
 * The model work of the onboarding run: writing the purposes and checking them. It runs before
 * any branch is made, so a failure here leaves nothing behind.
 *
 * Each part has two routes. The local route runs the model from this command. The external route
 * (Codex cloud for writing, a Cyrus session for checking) is a pause: the run writes briefs and
 * stops, and a later run reads what came back, the writer's commits from a branch and the
 * checker's verdicts from a file. Both routes go through the same checks: the writer's files are
 * judged by verify.mjs, and the checker's verdicts are read as a verdict and a cleaned reason.
 */
import fs from 'node:fs'
import path from 'node:path'
import { UserError } from '../frame/errors.mjs'
import { readJsonFile } from '../frame/json-file.mjs'
import { checkerPrompt, cleanReason, isCheckable, runCheck } from './checker.mjs'
import { changedFiles, git, resetPaths } from './git.mjs'
import { assertPlainPath, mkdirPlain, removePlainFile } from './plain-path.mjs'
import { checkerContext } from './source.mjs'
import { judgeWrittenFile } from './verify.mjs'
import { newBoundary, runCodex, writerEnvironment, writerPrompt } from './writer.mjs'

/** A writer that has used this many times its estimate stops the run: the first try ran away to 515,484 tokens. */
export const RUNAWAY_FACTOR = 2
const CHECKER_CONCURRENCY = 4

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const pad = (n) => String(n).padStart(2, '0')

async function pool(items, size, worker) {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await worker(items[next++])
  }))
}

/** Writes a text file in the run's work folder. */
function writeWork(repo, work, rel, text) {
  const file = path.join(work, rel)
  mkdirPlain(repo, path.dirname(file))
  fs.writeFileSync(file, text)
  return file
}

/** Judges what the writer left in one file, and records each component as pending or rejected. */
function judgeCall({ ctx, call, items, pending, after, outside, failure }) {
  const { repo, plan } = ctx
  for (const file of call.files) {
    const entries = file.components
    const reject = (reason) => {
      for (const c of entries) items.set(c.id, { ...items.get(c.id), status: 'rejected', reason })
    }
    if (outside.length > 0) {
      reject(`the writer changed files the plan did not list (${outside.slice(0, 3).join(', ')})`)
      continue
    }
    if (!after.has(file.file)) {
      reject(failure ? `the writer did not finish: ${failure}` : 'the writer left the file unchanged')
      continue
    }
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

/**
 * One Codex call for each folder, run here. The tree is read after each call and put back. A call
 * an earlier run of this plan finished is read back from the store instead, and judged again.
 */
async function writeLocally({ ctx, state, items, pending }) {
  const { repo, plan, onboarding, log, env, codex, work, store } = ctx
  const guard = ctx.estimate.purposes.writerTokens ? ctx.estimate.purposes.writerTokens * RUNAWAY_FACTOR : Infinity
  let tokens = 0
  let executed = 0
  let reused = 0
  for (const [index, call] of plan.calls.entries()) {
    // A saved call costs nothing, so it is used even after the guard below has stopped the calls.
    const saved = store.loadWriterCall(call)
    if (saved) {
      reused += 1
      log(`Writer call ${index + 1} of ${plan.calls.length}: ${call.dir}, reused from an earlier run of this plan (no model call, no tokens)`)
      state.writerCalls.push({ id: call.id, dir: call.dir, ok: true, tokens: 0, durationMs: 0, error: null, unexpected: [], components: call.count, reused: true })
      judgeCall({ ctx, call, items, pending, after: saved.after, outside: saved.outside, failure: null })
      continue
    }
    if (tokens > guard) {
      for (const file of call.files) for (const c of file.components) items.set(c.id, { ...items.get(c.id), reason: `the run stopped before this call: the writer had used more than ${RUNAWAY_FACTOR} times its estimate` })
      state.guardNote = `The writer passed ${RUNAWAY_FACTOR} times its estimate, so the run stopped before the remaining calls.`
      continue
    }
    const dirAbs = path.join(repo, call.dir)
    // A component file at the repo root has the repo itself as its folder, which is the base and not a path to check.
    if (path.resolve(dirAbs) !== repo) assertPlainPath(repo, dirAbs)
    const planned = new Set(call.files.map((f) => f.file))
    log(`Writer call ${index + 1} of ${plan.calls.length}: ${call.dir} (${plural(call.count, 'component')} in ${plural(call.files.length, 'file')})`)
    const result = await runCodex({ codex, dir: dirAbs, prompt: writerPrompt(call), settings: onboarding.writer, env: writerEnvironment(env, onboarding.checker.secrets), eventsFile: path.join(work, 'events', `${pad(index + 1)}.jsonl`) })
    executed += 1
    tokens += result.summary.tokens ?? 0
    log(`  ${result.ok ? 'finished' : `failed: ${result.error}`}, ${result.summary.tokens ?? 0} tokens, ${Math.round(result.durationMs / 1000)} seconds${result.summary.unexpected.length ? `, used ${result.summary.unexpected.join(' and ')} (not expected)` : ''}`)
    state.writerCalls.push({ id: call.id, dir: call.dir, ok: result.ok, tokens: result.summary.tokens ?? 0, durationMs: result.durationMs, error: result.error ?? null, unexpected: result.summary.unexpected, components: call.count, reused: false })

    // Whatever happened, the working tree is read and then put back, so the next call starts clean.
    const changed = changedFiles(repo)
    const outside = changed.filter((c) => !planned.has(c.path)).map((c) => c.path)
    const after = new Map()
    for (const c of changed.filter((x) => planned.has(x.path) && x.status !== '??' && !x.status.includes('D'))) after.set(c.path, fs.readFileSync(path.join(repo, c.path), 'utf8'))
    resetPaths(repo, changed, (p) => removePlainFile(repo, path.join(repo, p)))
    if (changedFiles(repo).length > 0) throw new Error('The working tree was not restored after a writer call.')
    judgeCall({ ctx, call, items, pending, after, outside, failure: result.ok ? null : result.error })
    // Kept now, before the next call, so a stop at any later point does not lose it. A call that failed is made again next time.
    if (result.ok) store.saveWriterCall(call, { after, outside, tokens: result.summary.tokens ?? 0, items })
  }
  state.writerTokens = tokens
  state.writerExecuted = executed
  state.writerReused = reused
}

/** The briefs for an external writer: the same prompt the local route sends, with paths from the repo root. */
function writeWriterBriefs({ ctx }) {
  const { repo, plan, onboarding, work, base } = ctx
  const index = [`# Briefs for ${onboarding.writer.agent}`, '', `${plural(plan.calls.length, 'brief')}, one for each folder. Give each to ${onboarding.writer.agent} as a task on one branch cut from ${base}. All the edits go on that one branch, and nothing else is committed to it.`, '', 'Then run the onboarding run again with `--writer-branch <that branch>`. It reads the branch, checks every file against the plan, and writes the comments itself.', '']
  const written = plan.calls.map((call, i) => {
    const name = `briefs/writer-${pad(i + 1)}.md`
    writeWork(repo, work, name, writerPrompt(call, newBoundary(), { external: true }))
    index.push(`- ${name}: ${call.dir}, ${plural(call.count, 'component')}`)
    return path.join(work, name)
  })
  writeWork(repo, work, 'briefs/index.md', `${index.join('\n')}\n`)
  return written
}

/** What an external writer left on a branch, read as the local route reads the working tree. */
function readWriterBranch({ ctx, state, items, pending, ref }) {
  const { repo, plan, base, log } = ctx
  const commit = git(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { allowFail: true })?.trim()
  if (!commit) throw new UserError(`--writer-branch ${ref} is not a branch or commit in this repo. Fetch it first.`)
  const changed = git(repo, ['diff', '--name-only', '-z', base, commit]).split('\0').filter(Boolean)
  const everything = new Set(plan.calls.flatMap((c) => c.files.map((f) => f.file)))
  const outside = changed.filter((p) => !everything.has(p))
  log(`Writer branch ${ref}: ${plural(changed.length, 'file')} changed, ${plural(outside.length, 'file')} outside the plan`)
  for (const call of plan.calls) {
    const after = new Map()
    for (const file of call.files) {
      const text = changed.includes(file.file) ? git(repo, ['show', `${commit}:${file.file}`], { allowFail: true }) : null
      if (text !== null) after.set(file.file, text)
    }
    state.writerCalls.push({ id: call.id, dir: call.dir, ok: true, tokens: null, durationMs: null, error: null, unexpected: [], components: call.count })
    judgeCall({ ctx, call, items, pending, after, outside, failure: null })
  }
  state.writerTokens = null
  state.writerExecuted = plan.calls.length
}

/** What a component's purpose is checked against: its usage, its own comment and the comments that name it. */
export function contextOf({ plan, onboarding }, component) {
  return checkerContext({ ts: plan.ts, root: plan.root, usage: plan.usage, entry: component.entry, limit: onboarding.checker.usageSnippets })
}

const promptFor = (p) => checkerPrompt({ name: p.component.name, entry: p.component.entry, useWhen: p.useWhen, notFor: p.notFor, snippets: p.snippets, own: p.own, mentions: p.mentions })

function setVerdict(items, id, verdict, reason) {
  const current = items.get(id)
  if (verdict === 'pass') items.set(id, { ...current, status: 'kept', verdict: 'pass', reason })
  else if (verdict === 'fail') items.set(id, { ...current, status: 'dropped', verdict: 'fail', reason })
  else items.set(id, { ...current, status: 'unchecked', verdict: 'error', reason: `the checker could not answer: ${reason}` })
}

/**
 * One OpenRouter call for each component that is used somewhere. A verdict an earlier run of this
 * plan got for the same sentences and the same usage is read back from the store instead.
 */
async function checkLocally({ ctx, state, items, todo }) {
  const { onboarding, env, log, fetchImpl, store, sources } = ctx
  const { checker } = onboarding
  const key = env[checker.secrets[0]]
  const saved = new Map(todo.map((p) => [p.component.id, store.loadCheck(p, sources.get(p.file))]))
  const fresh = todo.filter((p) => !saved.get(p.component.id))
  log(`Checker: ${plural(fresh.length, 'call')} on ${checker.model}${fresh.length < todo.length ? `, and ${plural(todo.length - fresh.length, 'verdict')} reused from an earlier run of this plan` : ''}`)
  for (const p of todo.filter((x) => saved.get(x.component.id))) {
    const { verdict, reason } = saved.get(p.component.id)
    state.checkerRuns.push({ id: p.component.id, verdict, attempts: 0, tokens: 0, usd: 0, reused: true })
    setVerdict(items, p.component.id, verdict, reason)
  }
  await pool(fresh, CHECKER_CONCURRENCY, async (p) => {
    const result = await runCheck({ key, model: checker.model, prompt: promptFor(p), fetchImpl })
    state.checkerRuns.push({ id: p.component.id, verdict: result.verdict, attempts: result.attempts, tokens: result.tokens, usd: result.usd, reused: false })
    // Kept as it arrives. A check that could not answer is made again next time.
    store.saveCheck(p, sources.get(p.file), result)
    setVerdict(items, p.component.id, result.verdict, result.reason)
    log(`  ${p.component.name}: ${result.verdict}${result.reason ? `, ${result.reason}` : ''} (${result.tokens} tokens)`)
  })
}

function writeCheckerBriefs({ ctx, todo }) {
  const { repo, onboarding, work } = ctx
  const index = [`# Briefs for ${onboarding.checker.agent}`, '', `${plural(todo.length, 'brief')}, one for each written purpose that is used somewhere. Give each to ${onboarding.checker.agent}. It replies with one JSON object. Collect the replies in a file like checks.template.json, with a verdict of pass or fail and a reason, and run the onboarding run again with \`--checks-file <that file>\`.`, '']
  todo.forEach((p, i) => {
    const name = `briefs/checker-${pad(i + 1)}.md`
    writeWork(repo, work, name, promptFor(p))
    index.push(`- ${name}: ${p.component.id}`)
  })
  writeWork(repo, work, 'briefs/index.md', `${index.join('\n')}\n`)
  writeWork(repo, work, 'briefs/checks.template.json', `${JSON.stringify({ checks: todo.map((p) => ({ id: p.component.id, verdict: '', reason: '' })) }, null, 2)}\n`)
}

/** Reads the verdicts an external checker returned. A verdict that is not pass or fail leaves the purpose unchecked. */
function readChecksFile({ ctx, state, items, todo, file }) {
  const given = readJsonFile(path.resolve(ctx.repo, file), 'The checks file')
  const byId = new Map((Array.isArray(given?.checks) ? given.checks : []).map((c) => [String(c?.id), c]))
  for (const p of todo) {
    const found = byId.get(p.component.id)
    if (!found) setVerdict(items, p.component.id, 'error', 'no verdict was returned for it')
    else if (found.verdict === 'pass' || found.verdict === 'fail') setVerdict(items, p.component.id, found.verdict, cleanReason(found.reason))
    else setVerdict(items, p.component.id, 'error', 'the verdict was neither pass nor fail')
  }
  ctx.log(`Checks file ${file}: ${plural(todo.length, 'verdict')} read`)
}

/**
 * The model results an earlier run saved for this plan that a run would use again: the writer
 * calls, and the checks of the purposes those calls wrote. `checkable` is how many of those
 * purposes have something to be checked against, so `checkable - checks` are the checks still to
 * make for them. Calls no model and changes nothing.
 *
 * @returns {{ writerCalls: string[], checks: number, checkable: number }}
 */
export function savedWork({ plan, onboarding, store }) {
  const writerCalls = []
  let checks = 0
  let checkable = 0
  const ctx = { repo: plan.root, plan }
  for (const call of plan.calls) {
    const saved = store.loadWriterCall(call)
    if (!saved) continue
    writerCalls.push(call.id)
    const items = new Map(call.files.flatMap((f) => f.components.map((c) => [c.id, { id: c.id }])))
    const pending = []
    judgeCall({ ctx, call, items, pending, after: saved.after, outside: saved.outside, failure: null })
    for (const p of pending) {
      const context = contextOf({ plan, onboarding }, p.component)
      const source = call.files.find((f) => f.file === p.file).source
      if (!isCheckable(context)) continue
      checkable += 1
      if (store.loadCheck({ ...p, ...context }, source)) checks += 1
    }
  }
  return { writerCalls, checks, checkable }
}

/**
 * Writes the purposes and checks them.
 *
 * @returns {Promise<{ waiting: null | { part: string, message: string }, items: Map<string, object>, pending: object[] }>}
 */
export async function obtainPurposes({ ctx, state }) {
  const { plan, onboarding, options } = ctx
  const items = new Map(plan.purposes.components.map((c) => [c.id, { id: c.id, name: c.name, file: c.file, kind: c.kind, status: 'rejected', reason: 'the writer did not run' }]))
  for (const skipped of plan.purposes.skipped) items.set(skipped.id, { id: skipped.id, name: skipped.name, file: skipped.file, status: 'rejected', reason: skipped.reason })
  const pending = []

  if (onboarding.writer.route === 'external') {
    if (!options.writerBranch) {
      const files = writeWriterBriefs({ ctx })
      return { waiting: { part: 'writer', message: `Wrote ${plural(files.length, 'brief')} for ${onboarding.writer.agent} to ${path.join(ctx.work, 'briefs')}. Nothing else was done. When the edits are on a branch, run again with --writer-branch <branch>.` }, items, pending }
    }
    readWriterBranch({ ctx, state, items, pending, ref: options.writerBranch })
  } else await writeLocally({ ctx, state, items, pending })

  const contexts = new Map()
  const context = (component) => {
    if (!contexts.has(component.id)) contexts.set(component.id, contextOf(ctx, component))
    return contexts.get(component.id)
  }
  const todo = []
  for (const p of pending) {
    if (!isCheckable(context(p.component))) items.set(p.component.id, { ...items.get(p.component.id), status: 'unchecked', reason: 'it is not used anywhere and no comment names it, so there is nothing to check it against' })
    else todo.push({ ...p, ...context(p.component) })
  }
  // The estimate counts a check for every component that has something to check against. One whose
  // purpose the writer did not get through (rejected, or never written) is not checked, and the report says how many.
  const sent = new Set(todo.map((p) => p.component.id))
  state.checksNotReached = plan.purposes.components.filter((c) => !sent.has(c.id) && isCheckable(context(c))).map((c) => c.id)
  if (onboarding.checker.route === 'external') {
    if (todo.length > 0 && !options.checksFile) {
      writeCheckerBriefs({ ctx, todo })
      return { waiting: { part: 'checker', message: `Wrote ${plural(todo.length, 'brief')} for ${onboarding.checker.agent} to ${path.join(ctx.work, 'briefs')}. Nothing else was done. When the verdicts are in a file, run again with --checks-file <file>.` }, items, pending }
    }
    if (todo.length > 0) readChecksFile({ ctx, state, items, todo, file: options.checksFile })
  } else await checkLocally({ ctx, state, items, todo })
  return { waiting: null, items, pending }
}
