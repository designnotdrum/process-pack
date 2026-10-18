import { LIMIT, THRESHOLD } from './rank.mjs'

const SHOWN_TEXT = 240

/** The line a person copies into the PR body to say what they chose. */
export const NEW_COMPONENT_LINE = 'Klaus: new component, see case'

const oneLine = (text) => String(text).replace(/\s+/g, ' ').trim()
const clip = (text) => (oneLine(text).length > SHOWN_TEXT ? `${oneLine(text).slice(0, SHOWN_TEXT).trimEnd()}...` : oneLine(text))
const code = (text) => `\`${text}\``
const score = (candidate) => candidate.score.toFixed(2)

function where(candidate) {
  if (candidate.kind === 'local') return `local to ${candidate.route}`
  return candidate.kind === 'icon-set' ? 'icon set' : candidate.kind
}

/**
 * How a component says what it is for. A comment that is not in the Use when / Not for form is shown
 * as such, because it was not written to answer this question.
 */
export function purposeLines(candidate) {
  const { purpose } = candidate
  if (!purpose) return candidate.kind === 'icon-set' ? [] : ['Purpose: none written yet.']
  if (!purpose.useWhen && !purpose.notFor) return [`Purpose, not yet in the Use when / Not for form: ${clip(purpose.text)}`]
  return [purpose.useWhen && `Use when: ${clip(purpose.useWhen)}`, purpose.notFor && `Not for: ${clip(purpose.notFor)}`].filter(Boolean)
}

function candidateLines(candidate, index) {
  const lines = [`${index + 1}. ${candidate.name}, score ${score(candidate)}, ${where(candidate)}`, `   ${code(candidate.file)}`]
  for (const line of purposeLines(candidate)) lines.push(`   ${line}`)
  if (candidate.matched.length) lines.push(`   Matched on: ${[...new Set(candidate.matched)].join(', ')}`)
  if (candidate.against.length) lines.push(`   Counted against by its Not for: ${[...new Set(candidate.against)].join(', ')}`)
  if (candidate.alsoAt.length) lines.push(`   The same name is also in: ${candidate.alsoAt.map(code).join(', ')}`)
  return lines
}

/**
 * What `klaus find` prints.
 *
 * @param {string} purpose
 * @param {import('./rank.mjs').Ranking} ranking
 */
export function renderFind(purpose, ranking) {
  const lines = [`Purpose: ${oneLine(purpose)}`, '']
  if (!ranking.candidates.length) {
    lines.push('Nothing fits. No component in the inventory shares a word with this purpose.', '', `Writing a new component needs a case. Run this again with --case and put its output in the PR body.`)
    return `${lines.join('\n')}\n`
  }
  if (ranking.nothingFits) {
    lines.push(`Nothing fits. No component scores ${THRESHOLD.toFixed(2)} or more for this purpose. The closest are below, for the case:`, '')
  } else {
    lines.push(`The ${ranking.candidates.length === 1 ? 'closest component' : `${ranking.candidates.length} closest components`} in the inventory, best first:`, '')
  }
  ranking.candidates.forEach((candidate, index) => lines.push(...candidateLines(candidate, index), ''))
  if (ranking.nothingFits) {
    lines.push('Writing a new component needs a case. Run this again with --case and put its output in the PR body.')
  } else {
    lines.push('Choose one and put one line in the PR body: `Klaus: used <Name>`, `Klaus: extended <Name>`, or `Klaus: new component, see case`.')
    lines.push('For a new component, run this again with --case.')
  }
  return `${lines.join('\n')}\n`
}

const fill = (hint) => `[fill in: ${hint}]`

function folderLine(folders) {
  const named = (role) => folders.filter((folder) => folder.role === role).map((folder) => folder.path)
  const list = (paths) => (paths.length ? ` (${paths.join(', ')})` : '')
  return `shared${list(named('shared'))} or app-level${list(named('app'))}`
}

/**
 * What `klaus find --case` prints: the PR body line and the "New component case" section, with
 * everything Klaus knows filled in and the rest marked to fill in.
 *
 * @param {string} purpose
 * @param {import('./rank.mjs').Ranking} ranking
 * @param {{ path: string, role: 'shared'|'app' }[]} folders
 */
export function renderCase(purpose, ranking, folders) {
  const lines = [NEW_COMPONENT_LINE, '', '## New component case', '', '**What the new component is for**', '', `- Use when: ${oneLine(purpose)}`, `- Not for: ${fill('what it must not be used for')}`, '']
  if (!ranking.candidates.length) {
    lines.push('**What the inventory has**', '', 'No component in the inventory shares a word with this purpose.', '')
  } else {
    const heading = ranking.nothingFits
      ? `**The closest components in the inventory** (none scores ${THRESHOLD.toFixed(2)} or more, so none fits as is)`
      : `**The closest components in the inventory** (the top ${Math.min(ranking.candidates.length, LIMIT)}, best first)`
    lines.push(heading, '')
    ranking.candidates.forEach((candidate, index) => {
      lines.push(`${index + 1}. ${candidate.name}, score ${score(candidate)}, ${code(candidate.file)}`)
      for (const line of purposeLines(candidate)) lines.push(`   - ${line}`)
      lines.push(
        `   - Why it fails as is: ${fill(`what ${candidate.name} cannot do for this purpose`)}`,
        `   - As a new variant: ${fill(`why a variant or prop on ${candidate.name} does not fit`)}`,
        `   - Composed: ${fill(`why building this from ${candidate.name} does not fit`)}`,
      )
    })
    lines.push('')
  }
  lines.push(
    '**The new component**',
    '',
    `- Name: ${fill('the component name')}`,
    `- Where it lives: ${fill(folderLine(folders))}`,
    `- DESIGN.md change, for a shared component: ${fill('the section it adds or changes, and what it says')}`,
  )
  return `${lines.join('\n')}\n`
}
