/**
 * The text of the three pull requests and the run's own summary. Plain markdown. Anything that
 * came from the repo or from a model is shown as code or cleaned, never as free markdown.
 */
import { summarize } from '../inventory/inventory.mjs'
import { whatHappens } from './duplicates.mjs'
import { renderComparison } from './estimate.mjs'

const MAX_ROWS = 60
const code = (text) => `\`${String(text).replace(/`/g, "'")}\``
const whole = (n) => Math.round(n).toLocaleString('en-US')
const dollars = (v) => `USD ${v < 0.001 ? v.toFixed(5) : v < 0.01 ? v.toFixed(4) : v.toFixed(2)}`
const cell = (text) => String(text ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ')

function table(header, rows) {
  const shown = rows.slice(0, MAX_ROWS)
  const lines = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...shown.map((r) => `| ${r.map(cell).join(' | ')} |`)]
  if (rows.length > shown.length) lines.push('', `${rows.length - shown.length} more rows are in the files in this pull request.`)
  return lines.join('\n')
}

function stack(state, step) {
  const merged = (n) => state.merged?.find((m) => m.step === n)
  const link = (n) => {
    const pr = merged(n) ?? state.prs.find((p) => p.step === n)
    return pr?.number ? `#${pr.number}` : `pull request ${n}`
  }
  const done = (n) => (merged(n) ? ' Merged.' : '')
  const refreshed = state.refresh ? ` A refresh of ${refreshedOf(state)}, which is merged.` : ''
  return [
    '## The three pull requests',
    '',
    `1. ${link(1)}: the list of components at 1.0.0, and the duplicates.${done(1)}${refreshed}`,
    `2. ${link(2)}: the missing purposes, written and then checked against where each component is used.${done(2)}`,
    `3. ${link(3)}: stories for components that have none, and the screens that show the data-bound ones.${done(3)}`,
    '',
    `This is ${step} of 3. Each is stacked on the one before it. Merge them in order, and merge each without deleting its branch: GitHub closes a pull request whose base branch is deleted. After a merge, change the next pull request's base to the default branch.`,
  ].join('\n')
}

/** The merged first pull request a refresh brings up to date, as a link when gh could say which. */
const refreshedOf = (state) => (state.refresh.of?.number ? `#${state.refresh.of.number}` : 'the first onboarding pull request')

/** How the refresh section names each kind of change. A changed file also shows the first place it differs, which came from the repo. */
const REFRESH_CHANGE = Object.freeze({
  added: () => 'added',
  changed: (c) => `changed, ${code(c.why)}`,
  removed: () => 'removed, no pair needs it now',
})

/** The section that opens a refresh of the first pull request: why it exists, and each file it changes. */
function refreshes(state) {
  if (!state.refresh) return []
  const line = (c) => `- ${code(c.rel)}: ${REFRESH_CHANGE[c.change](c)}.`
  return [
    '## A refresh',
    '',
    `This pull request refreshes ${refreshedOf(state)}, which is merged. The files on ${code(state.base)} are not what this plan writes now: Klaus, or the repo, changed after it merged. The run was given \`--refresh\`, so it made this pull request from ${code(state.base)} instead of refusing. It holds only the files that change, as this plan writes them:`,
    '',
    ...state.refresh.changes.map(line),
    '',
  ]
}

/** The line that opens a pull request made in place of one an earlier run opened. */
function replaces(state, step) {
  const old = state.replaced?.[step] ?? []
  if (old.length === 0) return []
  const which = old.map((p) => `#${p.number}`).join(' and ')
  return [`It replaces ${which}, which an earlier run of this plan opened. The run closed ${old.length === 1 ? 'it' : 'them'} and made this branch again from the plan.`, '']
}

/** How many of the decisions have a picture, for the summary. */
const pictureWords = (plan) => {
  const drawn = [...(plan.decisionPictures?.values() ?? [])].filter((p) => p.file).length
  return drawn > 0 ? `, and ${drawn} with a picture` : ''
}

/** What the list says when no pair is left: none were found, or every one found was set aside. */
const noPairs = (duplicates, docsDir) => (duplicates.dismissed?.length > 0 ? `No pair needs a ticket or a question. ${duplicates.dismissed.length} ${duplicates.dismissed.length === 1 ? 'was' : 'were'} set aside as different components, and ${code(`${docsDir}/duplicates.md`)} lists ${duplicates.dismissed.length === 1 ? 'it' : 'them'} with the reason.` : 'None were found.')

export function listBody(state) {
  const { plan, estimate } = state
  const lines = [
    ...replaces(state, 1),
    ...refreshes(state),
    '## What this is',
    '',
    'The first of three pull requests that give this repo its Klaus baseline. This one is the list: every component the repo ships, read by a script from the TypeScript compiler and the imports. No model ran. Every entry starts at version 1.0.0.',
    '',
    state.refresh ? '## What the first pull request holds' : '## What changed',
    '',
    '- `inventory.json` and `INVENTORY.md` at the repo root.',
    `- ${code(`${state.docsDir}/duplicates.md`)} and ${code(`${state.docsDir}/duplicates.json`)}: the likely duplicate pairs and what was compared.`,
    `- ${code(`${state.docsDir}/tickets/`)}: ${estimate.duplicates.tickets} ticket${estimate.duplicates.tickets === 1 ? '' : 's'}, as files: ${estimate.duplicates.tickets - (estimate.duplicates.removals ?? 0)} to merge one copy into another and ${estimate.duplicates.removals ?? 0} to delete a copy that nothing uses. Nothing was filed in a tracker.`,
    `- ${code(`${state.docsDir}/decisions.md`)}: ${estimate.duplicates.decisions} question${estimate.duplicates.decisions === 1 ? '' : 's'} for the owner, each with the default stated${pictureWords(plan)}.`,
    '',
    '## The list',
    '',
    ...summarize(plan.inventory).map((line) => `- ${line}`),
    '',
    '## Likely duplicates',
    '',
    plan.duplicates.length === 0 ? noPairs(plan.duplicates, state.docsDir) : table(['Keep', 'The other copy', 'Props in common', 'Class names in common', 'What happens'], plan.duplicates.map((p) => [code(p.keep.name), code(p.drop.name), p.propsSimilarity === null ? 'none' : `${Math.round(p.propsSimilarity * 100)}%`, p.lookSimilarity === null ? 'not comparable' : `${Math.round(p.lookSimilarity * 100)}%`, whatHappens(p)])),
    '',
    'The look is compared by the class names each component writes. The run has no screenshots. A pair at 75% or more looks the same.',
    '',
    stack(state, 1),
    '',
    'The estimate the run was held to, and what it did, is the table on the third pull request.',
  ]
  return lines.join('\n')
}

export function purposesBody(state) {
  const { purposes } = state
  const kept = purposes.items.filter((i) => i.status === 'kept' || i.status === 'unchecked')
  const unchecked = purposes.items.filter((i) => i.status === 'unchecked')
  const lines = [
    ...replaces(state, 2),
    '## What this is',
    '',
    'The second of three pull requests. It writes a purpose comment above each component that had none. A component that had a doc comment not in the "Use when" and "Not for" form keeps all of its text, and the two lines are added to it. Each purpose was then checked against the places the component is used, its own comment and the comments elsewhere that name it.',
    '',
    '## Who did it',
    '',
    `- Writer: ${state.writerLabel}.`,
    `- Checker: ${state.checkerLabel}.`,
    '- A writer edits the files of its folder. The run then compares each file with the plan: only the doc comments of the listed components may differ, and a comment that was there may only gain the two lines. It reads the two sentences out of each comment and writes the two lines itself in one fixed form, so nothing else the model produced reaches a file and no text of a comment is removed.',
    '',
    '## Result',
    '',
    `- ${purposes.items.length} components needed a purpose.`,
    `- ${purposes.items.filter((i) => i.status === 'kept').length} written and passed the check.`,
    ...(unchecked.length > 0 ? [`- ${unchecked.length} written and not checked (${unchecked.map((i) => `${i.name}: ${i.reason}`).join('; ')}). They are in this pull request.`] : []),
    `- ${purposes.items.filter((i) => i.status === 'dropped').length} failed the check and are not in this pull request. Their proposed text and the checker's reason are in ${code(`${state.docsDir}/purposes.md`)}.`,
    `- ${purposes.items.filter((i) => i.status === 'rejected').length} were rejected because the writer changed more than the comment, removed text from a comment that was there, or wrote text that was not acceptable.`,
    '',
    table(['Component', 'File', 'Status', 'Check', 'Use when'], purposes.items.map((i) => [code(i.name), code(i.file), i.status, i.reason ? `${i.verdict ?? ''} ${i.reason}`.trim() : i.verdict ?? '', i.useWhen ?? ''])),
    '',
    `${kept.length} purposes are in the code. \`inventory.json\` and \`INVENTORY.md\` are rebuilt from it, still at 1.0.0.`,
    '',
    stack(state, 2),
  ]
  return lines.join('\n')
}

export function storiesBody(state) {
  const { stories, rows } = state
  const written = stories.items.filter((i) => i.status === 'write')
  const bound = stories.items.filter((i) => i.status === 'data-bound')
  const skipped = stories.items.filter((i) => i.status === 'skipped')
  const lines = [
    ...replaces(state, 3),
    '## What this is',
    '',
    'The third of three pull requests. It adds a story for each component that had none and shows no live data. A component that shows live data is not drawn alone, because it would need a signed-in user and a server. It is listed with the screens it appears on instead. No model wrote these stories.',
    '',
    `## Stories written (${written.length})`,
    '',
    written.length === 0 ? 'None.' : table(['Component', 'Story file'], written.map((i) => [code(i.name), code(i.storyFile)])),
    '',
    `Storybook types come from ${code(stories.framework)}. A story gives each required prop a sample value from its type. The stories have not been rendered by this run.`,
    '',
    `## Shown through their screens (${bound.length})`,
    '',
    bound.length === 0 ? 'None.' : table(['Component', 'Why it is data-bound', 'Appears on', 'Screen capture'], bound.map((i) => [code(i.name), i.reasons.map(code).join(', '), i.screens.length ? i.screens.map(code).join(', ') : 'no screen found', i.capture ?? 'none yet'])),
    '',
    `## Left for a person (${skipped.length})`,
    '',
    skipped.length === 0 ? 'None.' : table(['Component', 'Why'], skipped.map((i) => [code(i.name), i.reason])),
    '',
    `The same lists are in ${code(`${state.docsDir}/stories.md`)} and ${code(`${state.docsDir}/stories.json`)}.`,
    '',
    '## The estimate and what the run did',
    '',
    renderComparison(rows),
    '',
    ...(state.notes ?? []).flatMap((note) => [note, '']),
    state.guardNote ?? '',
    stack(state, 3),
  ]
  return lines.filter((l) => l !== undefined).join('\n')
}

/** The stories view that is committed: all four statuses with their reasons. */
export function renderStoriesView(state) {
  const { stories } = state
  const section = (title, items, columns, row) => [`## ${title} (${items.length})`, '', items.length === 0 ? 'None.' : table(columns, items.map(row)), '']
  return [
    '# Stories and screens',
    '',
    'Written by the Klaus onboarding run. A component with a story is drawn by Storybook. A component that shows live data is shown through the screens it appears on.',
    '',
    ...section('Stories written', stories.items.filter((i) => i.status === 'write'), ['Component', 'Story file'], (i) => [code(i.name), code(i.storyFile)]),
    ...section('Shown through their screens', stories.items.filter((i) => i.status === 'data-bound'), ['Component', 'Why it is data-bound', 'Appears on', 'Screen capture'], (i) => [code(i.name), i.reasons.map(code).join(', '), i.screens.length ? i.screens.map(code).join(', ') : 'no screen found', i.capture ?? 'none yet']),
    ...section('Already had a story', stories.items.filter((i) => i.status === 'exists'), ['Component'], (i) => [code(i.name)]),
    ...section('Left for a person', stories.items.filter((i) => i.status === 'skipped'), ['Component', 'Why'], (i) => [code(i.name), i.reason]),
  ].join('\n')
}

/** The committed record of every purpose: kept, dropped, rejected or unchecked. */
export function renderPurposesView(state) {
  const { purposes } = state
  const lines = ['# Purposes written by the onboarding run', '', `Writer: ${state.writerLabel}. Checker: ${state.checkerLabel}.`, '']
  const section = (title, status, note) => {
    const items = purposes.items.filter((i) => i.status === status)
    lines.push(`## ${title} (${items.length})`, '', note, '')
    if (items.length === 0) lines.push('None.', '')
    for (const i of items) {
      lines.push(`### ${i.name}`, '', `- File: ${code(i.file)}`)
      if (i.useWhen) lines.push(`- Use when: ${i.useWhen}`, `- Not for: ${i.notFor}`)
      if (i.verdict) lines.push(`- Check: ${i.verdict}${i.reason ? `, ${i.reason}` : ''}`)
      else if (i.reason) lines.push(`- Note: ${i.reason}`)
      lines.push('')
    }
  }
  section('Written and checked', 'kept', 'These are in the code.')
  section('Written and not checked', 'unchecked', 'These are in the code. There was nothing to check them against, or the checker could not answer.')
  section('Failed the check', 'dropped', 'These are not in the code. The text is the writer\'s proposal. A person can edit it and add it.')
  section('Rejected', 'rejected', 'The writer changed more than the comment, removed text from a comment that was there, or wrote text that was not acceptable. Nothing was written.')
  return lines.join('\n')
}

/** What the run prints at the end. */
export function renderSummary(state) {
  const lines = ['Onboarding run finished.', '']
  for (const pr of state.merged ?? []) lines.push(`  Pull request ${pr.step} of 3: already merged${pr.url ? `, ${pr.url}` : ''}`)
  for (const pr of state.prs) lines.push(`  Pull request ${pr.step} of 3: ${pr.url}${state.replaced?.[pr.step]?.length ? `, in place of ${state.replaced[pr.step].map((p) => `#${p.number}`).join(', ')}` : ''}`)
  lines.push('', renderComparison(state.rows))
  for (const note of state.notes ?? []) lines.push('', note)
  const out = state.rows.filter((r) => r.within === false)
  lines.push('', out.length === 0 ? 'Every number landed within its margin.' : `${out.length} number${out.length === 1 ? '' : 's'} landed outside the margin: ${out.map((r) => r.metric).join(', ')}.`)
  return lines.join('\n')
}

export { dollars, whole }
