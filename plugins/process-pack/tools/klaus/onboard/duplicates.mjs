/**
 * Likely duplicates already in a repo, found without a model.
 *
 * Two components are a likely pair when they do the same job (the same kind of name, such as
 * Button and PrimaryButton, or the same name in two folders) and take similar props. Whether they
 * also look the same is read from the class names each one writes, because the onboarding run
 * has no screenshots to compare. Same-looking pairs become merge-into-one tickets. Pairs that look
 * different, and pairs whose look cannot be compared, go on the owner's decisions list.
 */
import path from 'node:path'
import { classTokens, parseSource } from './source.mjs'

/**
 * Where the lines are drawn. They are choices, not measurements: a pair needs at least half its
 * props in common to count as the same job, and at least three quarters of its class names in
 * common to count as the same look. Both numbers are printed in the list, so a person can see how
 * close each pair is.
 */
export const THRESHOLDS = Object.freeze({ props: 0.5, renamedCopy: 0.8, sameLook: 0.75 })

const words = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').toLowerCase().split(' ').filter(Boolean)
const stem = (word) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word)

/** The last word of a name, which says what kind of thing it is: PrimaryButton is a button. */
export const headNoun = (name) => stem(words(name).at(-1) ?? name.toLowerCase())

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return null
  let shared = 0
  for (const item of a) if (b.has(item)) shared++
  return shared / (a.size + b.size - shared)
}

const round = (n) => (n === null ? null : Math.round(n * 100) / 100)
const usedCount = (entry) => entry.usedIn.length

/** The entry to keep: shared before app, then the more used, then by name. */
function keepFirst(a, b) {
  const rank = (e) => (e.kind === 'shared' ? 0 : 1)
  return rank(a) - rank(b) || usedCount(b) - usedCount(a) || (a.name < b.name ? -1 : 1) || 0
}

const idOf = (entry) => `${entry.file}#${entry.name}`

/** Why the kept entry was picked, in the order keepFirst decides. */
export function keepReason(keep, drop) {
  if (keep.kind === 'shared' && drop.kind !== 'shared') return 'it is shared'
  if (usedCount(keep) > usedCount(drop)) return 'it is used in more places'
  return 'it comes first by name'
}

/**
 * @typedef {object} DuplicatePair
 * @property {string} id
 * @property {object} keep The entry to keep.
 * @property {object} drop The entry to merge into it.
 * @property {string[]} reasons Why the pair counts: same name, same kind of name, similar props.
 * @property {number | null} propsSimilarity Share of prop names the two have in common.
 * @property {string[]} sharedProps
 * @property {string[]} onlyKeep Props only the kept entry has.
 * @property {string[]} onlyDrop Props only the other entry has.
 * @property {number | null} lookSimilarity Share of class names in common, null when one writes none.
 * @property {string[]} classesOnlyKeep
 * @property {string[]} classesOnlyDrop
 * @property {'merge' | 'decide' | 'decide-look-unknown'} verdict
 */

/**
 * @param {{ ts: object, root: string, inventory: object }} options
 * @returns {DuplicatePair[]}
 */
export function findDuplicates({ ts, root, inventory }) {
  const entries = inventory.entries.filter((e) => e.kind !== 'icon-set')
  const tokens = new Map()
  const tokensOf = (entry) => {
    if (!tokens.has(entry.file)) tokens.set(entry.file, classTokens(ts, parseSource(ts, path.join(root, entry.file))))
    return tokens.get(entry.file)
  }
  const propNames = (entry) => new Set(entry.props.map((p) => p.name))

  const pairs = []
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i]
      const b = entries[j]
      if (a.file === b.file) continue
      const sameName = a.name === b.name
      const sameRole = headNoun(a.name) === headNoun(b.name)
      const pa = propNames(a)
      const pb = propNames(b)
      const propsSimilarity = jaccard(pa, pb)
      const sharedProps = [...pa].filter((p) => pb.has(p)).sort()
      const lookSimilarity = jaccard(tokensOf(a), tokensOf(b))
      const sameJob = sameName || (sameRole && (propsSimilarity ?? 0) >= THRESHOLDS.props) || (sharedProps.length >= 3 && (propsSimilarity ?? 0) >= THRESHOLDS.renamedCopy)
      // Two components with no props at all are compared on look alone, and only when they share a kind of name.
      const bare = sameRole && pa.size === 0 && pb.size === 0 && (lookSimilarity ?? 0) >= THRESHOLDS.sameLook
      if (!sameJob && !bare) continue

      const [keep, drop] = [a, b].sort(keepFirst)
      const reasons = []
      if (sameName) reasons.push(`both are named ${a.name}`)
      else if (sameRole) reasons.push(`both are a ${headNoun(a.name)}`)
      if (propsSimilarity !== null) reasons.push(`${Math.round(propsSimilarity * 100)}% of their props are the same`)
      const keepProps = propNames(keep)
      const dropProps = propNames(drop)
      const keepTokens = tokensOf(keep)
      const dropTokens = tokensOf(drop)
      const verdict = lookSimilarity === null ? 'decide-look-unknown' : lookSimilarity >= THRESHOLDS.sameLook ? 'merge' : 'decide'
      pairs.push({
        id: `${idOf(keep)} + ${idOf(drop)}`,
        keep,
        drop,
        reasons,
        propsSimilarity: round(propsSimilarity),
        sharedProps,
        onlyKeep: [...keepProps].filter((p) => !dropProps.has(p)).sort(),
        onlyDrop: [...dropProps].filter((p) => !keepProps.has(p)).sort(),
        lookSimilarity: round(lookSimilarity),
        classesOnlyKeep: [...keepTokens].filter((t) => !dropTokens.has(t)).sort(),
        classesOnlyDrop: [...dropTokens].filter((t) => !keepTokens.has(t)).sort(),
        verdict,
      })
    }
  }
  const score = (p) => (p.keep.name === p.drop.name ? 1 : 0) + (p.propsSimilarity ?? 0) + (p.lookSimilarity ?? 0)
  return pairs.sort((x, y) => score(y) - score(x) || (x.id < y.id ? -1 : 1))
}

const code = (text) => `\`${String(text).replace(/`/g, "'")}\``
const list = (items, empty = 'none') => (items.length === 0 ? empty : items.map(code).join(', '))
const percent = (n) => (n === null ? 'not comparable' : `${Math.round(n * 100)}%`)
const places = (entry) => `${usedCount(entry)} ${usedCount(entry) === 1 ? 'place' : 'places'}`

const VERDICT_TEXT = {
  merge: 'same look: a merge ticket',
  decide: 'different look: on the decisions list',
  'decide-look-unknown': 'look not comparable: on the decisions list',
}

/** A slug for a ticket file name. */
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
export const ticketFileName = (pair, number) => `${String(number).padStart(2, '0')}-merge-${slug(pair.drop.name)}-into-${slug(pair.keep.name)}.md`

/** The list of every pair, with what was compared. */
export function renderDuplicatesList(pairs) {
  const lines = [
    '# Likely duplicate components',
    '',
    'Written by the Klaus onboarding run. Nothing here has been changed in the code.',
    '',
    `A pair is listed when the two components do the same job: the same name in two files, or the same kind of name (Button and PrimaryButton) with at least ${Math.round(THRESHOLDS.props * 100)}% of their prop names in common. The look is compared by the class names each component writes, because the run has no screenshots. At ${Math.round(THRESHOLDS.sameLook * 100)}% or more in common, the pair looks the same. These cut-offs are choices, so the percentages are printed and a person can overrule them.`,
    '',
  ]
  if (pairs.length === 0) return [...lines, 'No likely duplicates were found.', ''].join('\n')
  lines.push('| Keep | Merge into it | Props in common | Class names in common | What happens |', '| --- | --- | --- | --- | --- |')
  for (const p of pairs) {
    lines.push(`| ${code(p.keep.name)} (${p.keep.file}) | ${code(p.drop.name)} (${p.drop.file}) | ${percent(p.propsSimilarity)} | ${percent(p.lookSimilarity)} | ${VERDICT_TEXT[p.verdict]} |`)
  }
  lines.push('', 'The entry to keep is the shared one, then the one used in more places, then the first by name.', '')
  return lines.join('\n')
}

/** One merge-into-one refactor ticket, as a file. The shape follows the repo's ticket rules: goal, done check, proof, size. */
export function renderTicket(pair) {
  const { keep, drop } = pair
  return [
    `# Merge ${drop.name} into ${keep.name}`,
    '',
    'Labels: klaus-duplicate, refactor',
    'Size: S',
    '',
    '## Goal',
    '',
    `Replace ${code(drop.name)} (${code(drop.file)}) with ${code(keep.name)} (${code(keep.file)}), so the app has one component for this job and agents find one entry when they ask what to reuse.`,
    '',
    '## What Klaus found',
    '',
    `- The onboarding run lists the two as a likely pair because ${pair.reasons.join(' and ')}.`,
    `- They look the same: ${percent(pair.lookSimilarity)} of the class names they write are shared.`,
    `- ${code(keep.name)} is used in ${places(keep)}, and ${code(drop.name)} in ${places(drop)}. ${code(keep.name)} is kept because ${keepReason(keep, drop)}.`,
    `- Props in both: ${list(pair.sharedProps)}.`,
    `- Props only ${code(drop.name)} has: ${list(pair.onlyDrop)}.${pair.onlyDrop.length > 0 ? ` Decide for each whether to add it to ${code(keep.name)} or drop it.` : ''}`,
    `- Class names only ${code(drop.name)} writes: ${list(pair.classesOnlyDrop.slice(0, 12))}${pair.classesOnlyDrop.length > 12 ? ', and more' : ''}.`,
    `- ${drop.kind === 'shared' ? 'Files that import' : 'Screens that show'} ${code(drop.name)}: ${list(drop.usedIn.slice(0, 10))}${drop.usedIn.length > 10 ? ', and more' : ''}.`,
    '',
    '## Done when',
    '',
    `- Nothing imports ${code(drop.name)} any more and its file is deleted.`,
    `- Every place that used ${code(drop.name)} uses ${code(keep.name)}, with the props mapped.`,
    '- The inventory, rebuilt, lists one entry instead of two, and the app builds and its checks pass.',
    `- The ${drop.kind === 'shared' ? 'screens that use these files' : 'screens above'} look the same before and after.`,
    '',
    '## Proof wanted',
    '',
    `The pull request shows the rebuilt inventory with ${code(drop.name)} gone, and before and after captures of the screens that use it, or the visual check's result for them.`,
    '',
  ].join('\n')
}

/** The owner's decisions list: pairs that look different, or whose look cannot be compared. */
export function renderDecisions(pairs) {
  const decide = pairs.filter((p) => p.verdict !== 'merge')
  const lines = [
    '# Decisions for the owner: which component wins',
    '',
    'Written by the Klaus onboarding run. Each pair below does the same job and looks different, or its look could not be compared. For each, say which one wins. Change DESIGN.md first so it names the winner, and then the merge becomes a ticket like the ones in the tickets folder.',
    '',
  ]
  if (decide.length === 0) return [...lines, 'No pairs need a decision.', ''].join('\n')
  decide.forEach((p, index) => {
    lines.push(
      `## ${index + 1}. ${p.keep.name} or ${p.drop.name}`,
      '',
      `- ${code(p.keep.name)}: ${code(p.keep.file)}, used in ${places(p.keep)}.`,
      `- ${code(p.drop.name)}: ${code(p.drop.file)}, used in ${places(p.drop)}.`,
      `- Why they are a pair: ${p.reasons.join(' and ')}.`,
      p.verdict === 'decide-look-unknown' ? '- Look: not comparable, because one of them does not style itself with class names. Open both in the app and compare.' : `- Look: ${percent(p.lookSimilarity)} of the class names are shared. Only ${code(p.keep.name)} writes ${list(p.classesOnlyKeep.slice(0, 10))}. Only ${code(p.drop.name)} writes ${list(p.classesOnlyDrop.slice(0, 10))}.`,
      `- Props only ${code(p.keep.name)} has: ${list(p.onlyKeep)}. Props only ${code(p.drop.name)} has: ${list(p.onlyDrop)}.`,
      `- If you do not choose: keep ${code(p.keep.name)}, because ${keepReason(p.keep, p.drop)}.`,
      `- Decision: [ ] keep ${p.keep.name}  [ ] keep ${p.drop.name}  [ ] keep both, and say why they differ`,
      '',
    )
  })
  return lines.join('\n')
}
