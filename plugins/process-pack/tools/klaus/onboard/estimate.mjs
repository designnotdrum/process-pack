/**
 * The one-time estimate shown before the onboarding run, and the comparison made after it.
 *
 * Counts of calls, files and pairs are worked out exactly from the plan. Tokens are predicted from
 * the size of each prompt and from rates measured on real calls (below). Dollars are the checker's
 * tokens at the price OpenRouter's models list gives on the day of the estimate. The writer has no
 * dollar figure: Codex use is billed to the ChatGPT plan's quota, not per token.
 */
import { checkerPrompt, isCheckable, readPrice } from './checker.mjs'
import { checkerContext } from './source.mjs'
import { writerPrompt } from './writer.mjs'

/**
 * Fitted on 2026-10-19 to real calls of codex-cli 0.163.0 with gpt-5.6-terra at low effort, shell
 * off and no user config. Each call made two requests (one that patches, one that says done).
 *
 *   one file, one component, a prompt of 1,070 characters:   35,069 input + 170 output = 35,239 tokens
 *   two files, two components, a prompt of 3,232 characters: 37,198 and 37,236 tokens in two calls
 *
 * Two equations cannot fix three rates, so `charsPerToken` is assumed (3.0 for code with markup)
 * and the other two are solved from the two calls: a request carries about 16,900 tokens before
 * the prompt, and each component costs about 270 tokens in the patch. The prompts were 1 to 3
 * thousand characters, so a prompt of tens of thousands of characters is an extrapolation and
 * its report may land outside the margin.
 * The first try, with no file in the prompt, ran 16 failed patches and used 515,484 tokens:
 * that is why the files are in the prompt and why the run has a guard.
 */
export const WRITER_RATES = Object.freeze({ requests: 2, requestBaseTokens: 16900, charsPerToken: 3.0, patchBaseTokens: 40, patchTokensPerComponent: 270, replyTokens: 20 })

/**
 * Measured on 2026-10-19 over 4 calls to z-ai/glm-5.3-flash on the sample's components: prompts of
 * 1,057 to 1,281 characters were 283 to 333 tokens (3.8 characters a token), and the replies,
 * which include the model's reasoning (it cannot be switched off), were 37, 45, 56 and 72 tokens.
 * OpenRouter reported 1.7 times the price on its models list for the same tokens, because it
 * routes to providers that charge more than the list shows.
 */
export const CHECKER_RATES = Object.freeze({ charsPerToken: 3.8, replyTokens: 55, priceFactor: 1.7 })

/** How far a run may land from its estimate. Calls and counts must match exactly. */
export const MARGINS = Object.freeze({ tokens: 0.3, usd: 1, usdFloor: 0.001 })

const PLACEHOLDER_SENTENCE = 'x'.repeat(150)

/** The tokens one writer call is predicted to use. */
export function predictWriterTokens(promptChars, components) {
  const prompt = promptChars / WRITER_RATES.charsPerToken
  const patch = WRITER_RATES.patchBaseTokens + WRITER_RATES.patchTokensPerComponent * components
  // Two requests each carry the base and the prompt. The second also carries the first one's patch.
  return Math.round(WRITER_RATES.requests * (WRITER_RATES.requestBaseTokens + prompt) + patch + WRITER_RATES.replyTokens + patch)
}

/** The tokens one checker call is predicted to use: the prompt, and a reply of the measured size. */
export function predictCheckerTokens(promptChars) {
  return Math.round(promptChars / CHECKER_RATES.charsPerToken + CHECKER_RATES.replyTokens)
}

/**
 * @param {object} options
 * @param {object} options.plan From buildPlan.
 * @param {object} options.onboarding Resolved onboarding settings.
 * @param {typeof fetch} [options.fetchImpl] For the price lookup.
 */
export async function buildEstimate({ plan, onboarding, fetchImpl }) {
  const { writer, checker } = onboarding
  const components = plan.purposes.components
  const byKind = (kind) => plan.inventory.entries.filter((e) => e.kind === kind).length

  const calls = plan.calls.map((call) => ({ id: call.id, dir: call.dir, components: call.count, files: call.files.length, promptChars: writerPrompt(call, 'DATA-0000000000000000').length }))
  const writerTokens = writer.route === 'external' ? null : calls.map((c) => predictWriterTokens(c.promptChars, c.components))
  // Each call's own figure is kept, so a run that reuses some calls can be held to the estimate for the rest.
  if (writerTokens) calls.forEach((c, i) => { c.tokens = writerTokens[i] })

  const checks = components.map((component) => {
    const context = checkerContext({ ts: plan.ts, root: plan.root, usage: plan.usage, entry: component.entry, limit: checker.usageSnippets })
    const chars = checkerPrompt({ name: component.name, entry: component.entry, useWhen: PLACEHOLDER_SENTENCE, notFor: PLACEHOLDER_SENTENCE, ...context }, 'DATA-0000000000000000').length
    return { id: component.id, checkable: isCheckable(context), promptChars: chars }
  })
  const checkable = checks.filter((c) => c.checkable)
  const checkerTokens = checker.route === 'external' ? null : checkable.map((c) => predictCheckerTokens(c.promptChars))

  const price = checker.route === 'openrouter' ? await readPrice(checker.model, fetchImpl) : null
  let checkerUsd = null
  // Input is the prompt; everything else the call uses is reply and is priced as completion.
  const usdOf = (c) => CHECKER_RATES.priceFactor * ((c.promptChars / CHECKER_RATES.charsPerToken) * price.prompt + CHECKER_RATES.replyTokens * price.completion)
  if (price && checkerTokens) checkerUsd = checkable.reduce((sum, c) => sum + usdOf(c), 0)
  const checkerCallDetails = checker.route === 'external' ? null : checkable.map((c, i) => ({ id: c.id, promptChars: c.promptChars, tokens: checkerTokens[i], usd: price ? usdOf(c) : null }))
  const sum = (list) => (list ? list.reduce((a, b) => a + b, 0) : null)
  const items = plan.stories.items
  const count = (status) => items.filter((i) => i.status === status).length

  return {
    schemaVersion: 1,
    id: plan.id,
    createdAt: new Date().toISOString(),
    settings: { writer, checker },
    list: { entries: plan.inventory.entries.length, shared: byKind('shared'), app: byKind('app'), local: byKind('local'), iconSets: byKind('icon-set'), folders: plan.folders.map((f) => f.path) },
    purposes: {
      components: components.length,
      missing: components.filter((c) => c.kind === 'missing').length,
      unformatted: components.filter((c) => c.kind === 'unformatted').length,
      skipped: plan.purposes.skipped,
      writerCalls: calls.length,
      writerCallDetails: calls,
      writerTokens: sum(writerTokens),
      checkerCalls: checkable.length,
      unchecked: components.length - checkable.length,
      checkerTokens: sum(checkerTokens),
      checkerUsd,
      checkerCallDetails,
    },
    stories: { write: count('write'), exists: count('exists'), dataBound: count('data-bound'), skipped: count('skipped') },
    storyCheck: plan.stories.check,
    duplicates: { pairs: plan.duplicates.length, tickets: plan.duplicates.filter((p) => p.verdict === 'merge').length, decisions: plan.duplicates.filter((p) => p.verdict !== 'merge').length },
    price,
    rates: { writer: WRITER_RATES, checker: CHECKER_RATES },
    margins: MARGINS,
  }
}

const whole = (n) => Math.round(n).toLocaleString('en-US')
const plural = (n, one, many = `${one}s`) => `${whole(n)} ${n === 1 ? one : many}`
const dollars = (v) => `USD ${v < 0.001 ? v.toFixed(5) : v < 0.01 ? v.toFixed(4) : v.toFixed(2)}`
const perMillion = (v) => `USD ${(v * 1e6) >= 0.1 ? (v * 1e6).toFixed(2) : (v * 1e6).toFixed(4)}`
/** A figure that is a prediction is shown to two significant digits, so it does not look more exact than it is. */
const approx = (n) => (n < 100 ? whole(n) : whole(Number(n.toPrecision(2))))

/** Plain text for a person to read before the run. */
export function renderEstimate(estimate) {
  const { settings, list, purposes, stories, storyCheck, duplicates, price, margins } = estimate
  const { writer, checker } = settings
  const lines = [`Onboarding run: the one-time estimate (plan ${estimate.id})`]
  lines.push(`  The list: ${plural(list.entries, 'entry', 'entries')} (${list.shared} shared, ${list.app} app, ${list.local} local, ${plural(list.iconSets, 'icon set')}) in ${plural(list.folders.length, 'folder')}. No model. Every entry starts at 1.0.0.`)
  lines.push(`  Purposes: ${plural(purposes.components, 'component')} need one (${purposes.missing} with no doc comment, ${purposes.unformatted} with a doc comment not in the Use when and Not for form, which keeps all of its text and gets the two lines added).${purposes.skipped.length ? ` ${plural(purposes.skipped.length, 'more is', 'more are')} left for a person: ${purposes.skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}.` : ''}`)
  if (writer.route === 'external') {
    lines.push(`    Writer: ${writer.agent}. ${plural(purposes.writerCalls, 'brief')}, one for each folder, handed over by hand. No estimate: ${writer.agent} bills on its own plan.`)
  } else {
    lines.push(`    Writer: the local Codex CLI, ${writer.model} at ${writer.effort} effort. ${plural(purposes.writerCalls, 'call')}, one for each folder, about ${approx(purposes.writerTokens)} tokens. Codex use counts against the ChatGPT plan's Codex quota and has no price for each token (unverified: the plan's limits were not read).`)
  }
  if (checker.route === 'external') {
    lines.push(`    Checker: ${checker.agent}. ${plural(purposes.checkerCalls, 'brief')}, one for each component that is used somewhere or that a comment talks about. No estimate: ${checker.agent} bills on its own plan.`)
  } else {
    const cost = price
      ? ` Billed for each token through OpenRouter, at ${perMillion(price.prompt)} for a million input tokens and ${perMillion(price.completion)} for a million output tokens (OpenRouter's models list, read ${price.readAt}), times ${CHECKER_RATES.priceFactor} because OpenRouter routes to providers that charge more than its list shows (measured on 4 calls), so about ${dollars(estimate.purposes.checkerUsd)}.`
      : ' No dollar figure: the model list could not be read, so the price is unknown. It is billed for each token.'
    lines.push(`    Checker: OpenRouter, ${checker.model}, a different model family from the writer. ${plural(purposes.checkerCalls, 'call')}, one for each component that is used somewhere or that a comment talks about, about ${approx(purposes.checkerTokens)} tokens.${cost}`)
  }
  lines.push('    The checker is shown the places a component is used, its own comment and the comments elsewhere that name it, and fails a purpose that any of them contradicts.')
  if (purposes.unchecked > 0) lines.push(`    ${plural(purposes.unchecked, 'component')} ${purposes.unchecked === 1 ? 'is' : 'are'} not used anywhere and no comment names ${purposes.unchecked === 1 ? 'it' : 'them'}, so there is nothing to check against. Their purposes are kept and listed as unchecked.`)
  lines.push('    A purpose the writer gets wrong is rejected before the check and is not checked. The report counts those with the checker calls and says how many.')
  lines.push(`  Stories: ${stories.write} written with no model. ${stories.dataBound} listed with the screens they appear on instead, because they show live data. ${stories.exists} already had a story. ${stories.skipped} left for a person${storyCheck ? ` (${storyCheck.noStorybook} in folders no Storybook loads, ${storyCheck.needsValue} with a required prop Klaus cannot fill in, ${storyCheck.storybookMissing + storyCheck.didNotCompile} whose story did not compile)` : ''}.`)
  if (storyCheck) lines.push(`    Each story is type-checked with the repo's own TypeScript and the tsconfig of its package, and written only if a Storybook config in the repo loads its path (${plural(storyCheck.typeChecked, 'story', 'stories')} checked). Nothing is written to check them.`)
  lines.push(`  Duplicates: ${plural(duplicates.pairs, 'likely pair')}. ${duplicates.tickets} ${duplicates.tickets === 1 ? 'becomes a merge ticket' : 'become merge tickets'} and ${duplicates.decisions} ${duplicates.decisions === 1 ? 'goes' : 'go'} on the decisions list, as files in the pull request. Nothing is filed in a tracker. No model.`)
  const sends = []
  if (writer.route !== 'external') sends.push('the source of the files in each folder goes to OpenAI through the Codex CLI')
  if (checker.route !== 'external') sends.push('each component\'s props and a few places it is used go to OpenRouter')
  if (sends.length > 0) lines.push(`  Your code leaves this machine: ${sends.join(', and ')}.`)
  lines.push('  Pull requests: three, in order, each on a branch stacked on the one before. Nothing is merged.')
  const kept = writer.route !== 'external' || checker.route !== 'external' ? ' Each result the run gets from a model is kept in the git folder as it arrives, and a later run of this plan uses it again instead of calling the model.' : ''
  lines.push(`  Before any model call, the run tries the repo's pre-commit hook on the files of each pull request, so a hook that would refuse a commit stops the run before anything is spent.${kept}`)
  lines.push(`  The report sets these numbers beside what the run did. Calls and counts must match exactly. Tokens must land within ${Math.round(margins.tokens * 100)}%, and dollars within ${Math.round(margins.usd * 100)}% or ${dollars(margins.usdFloor)}, whichever is more.`)
  if (estimate.earlier) lines.push(...renderEarlier(estimate))
  return lines.join('\n')
}

/** What an earlier run left, and so what this run will do: where it continues, and what it does not pay for again. */
function renderEarlier(estimate) {
  const { earlier, purposes, settings } = estimate
  const nothingEarlier = earlier.start === 1 && !earlier.refusal && earlier.savedWriterCalls.length === 0 && earlier.savedChecks === 0 && (earlier.otherPlans ?? []).length === 0
  if (nothingEarlier) return []
  const lines = ['  Earlier runs:']
  if (earlier.refusal) {
    lines.push(`    The run would refuse to start. ${earlier.refusal.split('\n').join('\n    ')}`)
    return lines
  }
  lines.push(`    ${earlier.note ?? 'No pull request of an earlier run is merged, so the run makes all three. One that is still open is closed and replaced.'}`)
  if (earlier.start > 3) return lines
  if (earlier.start > 2) {
    lines.push('    The purposes are merged, so the run makes no model call. The model numbers above are not compared.')
    return lines
  }
  if (earlier.start === 2) lines.push('    The first pull request is not made again. The second and third are, and an open one is closed and replaced by a new one that says which it replaces.')
  const reused = new Set(earlier.savedWriterCalls)
  const toMake = purposes.writerCalls - reused.size
  const tokens = (purposes.writerCallDetails ?? []).filter((c) => !reused.has(c.id)).reduce((sum, c) => sum + (c.tokens ?? 0), 0)
  lines.push(`    Model results saved for this plan: ${plural(reused.size, 'writer call')} of ${whole(purposes.writerCalls)} and ${plural(earlier.savedChecks, 'check')}. The run uses them again instead of calling the model, so it makes ${plural(toMake, 'writer call')}${settings.writer.route === 'external' || toMake === 0 ? '' : `, about ${approx(tokens)} tokens`}, and at most ${plural(Math.max(0, purposes.checkerCalls - earlier.savedChecks), 'check')}.`)
  for (const other of earlier.otherPlans ?? []) lines.push(`    Results saved for another plan, ${other.planId} (${plural(other.writer, 'writer call')} and ${plural(other.checker, 'check')}), are not used: a saved result is used only by the plan it was made for, and the plan changes when a component file, a call, a story or a duplicate pair does.`)
  return lines
}

/**
 * The estimate for the part of the work the run did itself. A writer call or a check reused from
 * an earlier run of the plan costs nothing this time, and a check the run never reached (the
 * writer's text was rejected first) was never made, so their share is taken out of the tokens and
 * dollars. Each share is the call's own figure from the estimate. An estimate made before those
 * were kept has only the totals, and the share is then the average.
 */
function estimateForWorkDone(estimate, actual) {
  const { purposes } = estimate
  const skippedWriter = new Set(actual.writerReused ?? [])
  const skippedChecks = new Set([...(actual.checkerReused ?? []), ...(actual.checksNotReached ?? [])])
  const writerDetails = purposes.writerCallDetails ?? []
  const writerShare = (c) => c.tokens ?? predictWriterTokens(c.promptChars, c.components)
  const writerTokens = purposes.writerTokens === null || skippedWriter.size === 0 ? purposes.writerTokens : purposes.writerTokens - writerDetails.filter((c) => skippedWriter.has(c.id)).reduce((sum, c) => sum + writerShare(c), 0)
  const minus = (total, field) => {
    if (total === null || total === undefined || skippedChecks.size === 0) return total ?? null
    if (purposes.checkerCallDetails) return total - purposes.checkerCallDetails.filter((c) => skippedChecks.has(c.id)).reduce((sum, c) => sum + (c[field] ?? 0), 0)
    return purposes.checkerCalls ? total * Math.max(0, purposes.checkerCalls - skippedChecks.size) / purposes.checkerCalls : total
  }
  return { writerTokens, checkerTokens: minus(purposes.checkerTokens, 'tokens'), checkerUsd: minus(purposes.checkerUsd, 'usd') }
}

/**
 * Sets the estimate beside the run's actual numbers.
 *
 * The calls must match exactly, so each call the estimate counted is accounted for: the writer's
 * are made or reused, and the checker's are made, reused, or not reached because the writer's
 * text for that component was rejected before the check. The estimate cannot know beforehand
 * which text will be rejected, so the report counts those and says so. Tokens and dollars are
 * compared for the calls made in this run only.
 *
 * @param {object} estimate
 * @param {object} actual { writerCalls, checkerCalls, writerTokens, checkerTokens, checkerUsd, purposes, stories, pairs, tickets, decisions, entries }
 *   and, when some work was not done in this run, the ids in `writerReused`, `checkerReused` and `checksNotReached`.
 * @returns {{ metric: string, estimated: number | null, actual: number | null, rule: string, within: boolean | null }[]}
 */
export function compareToEstimate(estimate, actual) {
  const { margins } = estimate
  const forWorkDone = estimateForWorkDone(estimate, actual)
  const count = (list) => list?.length ?? 0
  const rows = []
  const exact = (metric, estimated, got) => rows.push({ metric, estimated, actual: got, rule: 'exact', within: estimated === null || got === null ? null : estimated === got })
  const relative = (metric, estimated, got, share, floor = 0) => {
    const within = estimated === null || got === null ? null : Math.abs(got - estimated) <= Math.max(estimated * share, floor)
    rows.push({ metric, estimated, actual: got, rule: `within ${Math.round(share * 100)}%${floor ? ` or ${dollars(floor)}` : ''}`, within })
  }
  exact('Entries in the list', estimate.list.entries, actual.entries)
  exact('Components needing a purpose', estimate.purposes.components, actual.purposes)
  // A run that made no model work (the purposes were merged before it) has no call counts to compare.
  const plus = (value, ...lists) => (value === null || value === undefined ? null : value + lists.reduce((sum, list) => sum + count(list), 0))
  exact('Writer calls', estimate.purposes.writerCalls, plus(actual.writerCalls, actual.writerReused))
  exact('Checker calls', estimate.purposes.checkerCalls, plus(actual.checkerCalls, actual.checkerReused, actual.checksNotReached))
  relative('Writer tokens', forWorkDone.writerTokens, actual.writerTokens, margins.tokens)
  relative('Checker tokens', forWorkDone.checkerTokens, actual.checkerTokens, margins.tokens)
  relative('Checker dollars', forWorkDone.checkerUsd, actual.checkerUsd, margins.usd, margins.usdFloor)
  exact('Stories written', estimate.stories.write, actual.stories)
  if (actual.storiesLeft !== undefined) exact('Stories left for a person', estimate.stories.skipped, actual.storiesLeft)
  exact('Likely duplicate pairs', estimate.duplicates.pairs, actual.pairs)
  exact('Merge tickets', estimate.duplicates.tickets, actual.tickets)
  exact('Decisions on the list', estimate.duplicates.decisions, actual.decisions)
  return rows
}

/** The lines under the comparison that say what the call counts are made of, when it is more than the calls made. */
export function comparisonNotes(estimate, actual) {
  const notes = []
  const reusedWriter = actual.writerReused?.length ?? 0
  const reusedChecks = actual.checkerReused?.length ?? 0
  const notReached = actual.checksNotReached?.length ?? 0
  if (reusedWriter > 0) notes.push(`Writer calls: ${plural(actual.writerCalls, 'call')} made, and ${plural(reusedWriter, 'call')} reused from an earlier run of this plan, at no cost this time. The writer tokens are compared with the estimate for the calls made.`)
  if (reusedChecks > 0 || notReached > 0) {
    const parts = [`${plural(actual.checksMade ?? actual.checkerCalls, 'check')} made`]
    if (reusedChecks > 0) parts.push(`${plural(reusedChecks, 'check')} reused from an earlier run of this plan, at no cost this time`)
    if (notReached > 0) parts.push(`${plural(notReached, 'component')} not checked, because the writer's text for ${notReached === 1 ? 'it' : 'them'} was rejected or not written, so there was nothing to check (the purposes list ${notReached === 1 ? 'it' : 'them'} as rejected, with the reason)`)
    notes.push(`Checker calls: of the ${plural(estimate.purposes.checkerCalls, 'check')} the estimate counted, ${parts.join(', ')}. The checker tokens and dollars are compared with the estimate for the checks made.`)
  }
  const retries = (actual.checkerCalls ?? 0) - (actual.checksMade ?? actual.checkerCalls ?? 0)
  if (retries > 0) notes.push(`The checker sent ${plural(retries, 'request')} more than it made checks: ${retries === 1 ? 'a request was' : 'requests were'} sent again after an error.`)
  return notes
}

/** The comparison as a markdown table for a pull request. */
export function renderComparison(rows) {
  const show = (v, metric) => (v === null ? 'none' : metric.endsWith('dollars') ? dollars(v) : whole(v))
  const lines = ['| What | Estimated | The run | Rule | Within |', '| --- | ---: | ---: | --- | --- |']
  for (const row of rows) lines.push(`| ${row.metric} | ${show(row.estimated, row.metric)} | ${show(row.actual, row.metric)} | ${row.rule} | ${row.within === null ? 'not compared' : row.within ? 'yes' : 'NO'} |`)
  return lines.join('\n')
}
