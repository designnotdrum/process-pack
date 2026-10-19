/**
 * Likely duplicates already in a repo, found without a model.
 *
 * Two components are a likely pair when they do the same job (the same kind of name, such as
 * Button and PrimaryButton, or the same name in two folders) and take similar props. Whether they
 * also look the same is read from the class names each one writes, because the onboarding run
 * has no screenshots to compare. The data settles what it can without asking: a pair where one copy
 * is used in no place becomes a removal ticket, and a same-looking pair becomes a merge-into-one
 * ticket. Only the rest, pairs that look different or whose look cannot be compared, go on the
 * owner's decisions list (decisions.mjs).
 */
import path from 'node:path'
import { describeClassDifference, READABLE_CLASS_COUNT } from './decisions-look.mjs'
import { isVariantName, keepReason, removalFileName, renderDecisions, renderRemovalTicket, sidesOf } from './decisions.mjs'
import { classTokens, importsOf, parseSource } from './source.mjs'

export { keepReason, renderDecisions }

/**
 * Where the lines are drawn. They are choices, not measurements: a pair needs at least half its
 * props in common to count as the same job, and at least three quarters of its class names in
 * common to count as the same look. Both numbers are printed in the list, so a person can see how
 * close each pair is.
 */
export const THRESHOLDS = Object.freeze({ props: 0.5, renamedCopy: 0.8, sameLook: 0.75 })

/**
 * Props nearly every component takes. Two components with different names are the same job only
 * on the evidence of other props: all the context providers in an app take only children.
 */
export const GENERIC_PROPS = new Set(['children', 'className', 'style', 'id', 'key', 'ref', 'asChild'])

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
/**
 * Why a pair is set aside as two different components, or null: one is built on the other (`built`
 * says which), or the names differ without one holding the other's words and the look differs.
 */
function setAsideReason(pair, built, variantNames) {
  const sides = sidesOf(pair)
  if (built) return built.on === pair.keep ? `${sides.keep.text} is built on ${sides.drop.then}` : `${sides.drop.text} is built on ${sides.keep.then}`
  return variantNames ? null : 'the names differ and the look differs, so they are different components'
}
const specific = (props) => new Set([...props].filter((p) => !GENERIC_PROPS.has(p)))

/** The entry to keep: shared before app, then the more used, then by name. */
function keepFirst(a, b) {
  const rank = (e) => (e.kind === 'shared' ? 0 : 1)
  return rank(a) - rank(b) || usedCount(b) - usedCount(a) || (a.name < b.name ? -1 : 1) || 0
}

const idOf = (entry) => `${entry.file}#${entry.name}`

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
 * @property {'merge' | 'decide' | 'decide-look-unknown'} verdict 'merge' means the data settles it and the pair becomes a ticket, of the kind `ticket` says.
 * @property {'merge' | 'remove' | null} ticket A merge ticket moves the other copy's users over; a removal ticket deletes a copy that nothing uses.
 * @property {string[]} removes The ids (file#name) a removal ticket deletes.
 * @property {string[]} alsoSimilarTo Other components that were listed against the same unused copy and are folded into its ticket.
 * @property {string | null} lookNote One sentence on how the two differ, read from the class names.
 */

/**
 * @param {{ ts: object, root: string, inventory: object, setAside?: boolean }} options `setAside: false` asks about every pair the data does not settle, including ones built on each other or with different names.
 * @returns {DuplicatePair[]}
 */
export function findDuplicates({ ts, root, inventory, setAside: setAsideOn = true }) {
  const entries = inventory.entries.filter((e) => e.kind !== 'icon-set')
  const tokens = new Map()
  const tokensOf = (entry) => {
    if (!tokens.has(entry.file)) tokens.set(entry.file, classTokens(ts, parseSource(ts, path.join(root, entry.file))))
    return tokens.get(entry.file)
  }
  const propNames = (entry) => new Set(entry.props.map((p) => p.name))
  const imported = new Map()
  /** True when the file of `entry` imports something called `name`, so it is built on a component of that name. */
  const builtOn = (entry, name) => {
    if (!imported.has(entry.file)) imported.set(entry.file, importsOf(ts, parseSource(ts, path.join(root, entry.file))))
    return imported.get(entry.file).some((item) => item.defaultName === name || item.names.some((n) => n.imported === name))
  }

  const pairs = []
  const dismissed = []
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
      // Different names are the same job only on the evidence of props other than the generic ones.
      const [sa, sb] = [specific(pa), specific(pb)]
      const specificShared = [...sa].filter((p) => sb.has(p)).length
      const specificSimilarity = jaccard(sa, sb) ?? 0
      const sameJob = sameName || (sameRole && specificShared >= 1 && specificSimilarity >= THRESHOLDS.props) || (specificShared >= 3 && specificSimilarity >= THRESHOLDS.renamedCopy)
      // Two components with no props at all are compared on look alone, and only when they share a kind of name.
      const bare = sameRole && pa.size === 0 && pb.size === 0 && (lookSimilarity ?? 0) >= THRESHOLDS.sameLook
      if (!sameJob && !bare) continue

      let [keep, drop] = [a, b].sort(keepFirst)
      // The copy that is used stays, even when the other one is the shared one.
      if (usedCount(keep) === 0 && usedCount(drop) > 0) [keep, drop] = [drop, keep]
      const reasons = []
      if (sameName) reasons.push(`both are named ${a.name}`)
      else if (sameRole) reasons.push(`both are a ${headNoun(a.name)}`)
      if (propsSimilarity !== null) reasons.push(`${Math.round(propsSimilarity * 100)}% of their props are the same`)
      const keepProps = propNames(keep)
      const dropProps = propNames(drop)
      const keepTokens = tokensOf(keep)
      const dropTokens = tokensOf(drop)
      const unused = usedCount(keep) === 0 || usedCount(drop) === 0
      const ticket = unused ? 'remove' : lookSimilarity !== null && lookSimilarity >= THRESHOLDS.sameLook ? 'merge' : null
      // The data can also say a pair is no pair: one is built on the other, or the names differ and so does the look. Those are set aside, with the reason, not asked about.
      const built = ticket || !setAsideOn ? null : builtOn(keep, drop.name) ? { on: keep } : builtOn(drop, keep.name) ? { on: drop } : null
      const reason = ticket || !setAsideOn ? null : setAsideReason({ keep, drop }, built, isVariantName(a.name, b.name))
      if (reason) {
        dismissed.push({ id: `${idOf(keep)} + ${idOf(drop)}`, keep, drop, reason })
        continue
      }
      const verdict = ticket ? 'merge' : lookSimilarity === null ? 'decide-look-unknown' : 'decide'
      const pair = {
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
        ticket,
        // The copy that nothing uses goes, and it is always the drop side: a used copy is kept first, and when both are unused the second goes and the first stays.
        removes: ticket === 'remove' ? [idOf(drop)] : [],
        alsoSimilarTo: [],
        lookNote: null,
      }
      if (!ticket && lookSimilarity !== null && keepTokens.size <= READABLE_CLASS_COUNT && dropTokens.size <= READABLE_CLASS_COUNT) {
        const sides = sidesOf(pair)
        pair.lookNote = describeClassDifference([...dropTokens].sort(), [...keepTokens].sort(), sides.drop.text, sides.keep.text)
      }
      pairs.push(pair)
    }
  }
  const score = (p) => (p.keep.name === p.drop.name ? 1 : 0) + (p.propsSimilarity ?? 0) + (p.lookSimilarity ?? 0)
  const ranked = pairs.sort((x, y) => score(y) - score(x) || (x.id < y.id ? -1 : 1))
  // One ticket for each unused copy. A second pair against a copy that is already going is folded into the first one's ticket.
  const claimed = new Map()
  const listed = ranked.filter((pair) => {
    if (pair.ticket !== 'remove') return true
    const [id] = pair.removes
    const owner = claimed.get(id)
    if (!owner) {
      claimed.set(id, pair)
      return true
    }
    const partner = pair.keep.name
    if (partner !== owner.keep.name && !owner.alsoSimilarTo.includes(partner)) owner.alsoSimilarTo.push(partner)
    return false
  })
  // The pairs that were set aside travel with the list as a property of the array, so the files written from it can say what was left out. JSON of the array does not hold it.
  listed.dismissed = dismissed.sort((x, y) => (x.id < y.id ? -1 : 1))
  return listed
}

/** What happens to a pair: a ticket of one of two kinds, or a question for the owner. */
export function whatHappens(pair) {
  if (pair.verdict !== 'merge') return 'decisions list'
  return pair.ticket === 'remove' ? 'removal ticket' : 'merge ticket'
}

/** How many pairs go each way. `tickets` counts both kinds, because the run writes a file for every pair the data settles. */
export function countDuplicates(pairs) {
  const removals = pairs.filter((p) => whatHappens(p) === 'removal ticket').length
  const merges = pairs.filter((p) => whatHappens(p) === 'merge ticket').length
  return { pairs: pairs.length, tickets: merges + removals, merges, removals, decisions: pairs.length - merges - removals }
}

const code = (text) => `\`${String(text).replace(/`/g, "'")}\``
const list = (items, empty = 'none') => (items.length === 0 ? empty : items.map(code).join(', '))
const percent = (n) => (n === null ? 'not comparable' : `${Math.round(n * 100)}%`)
const places = (entry) => `${usedCount(entry)} ${usedCount(entry) === 1 ? 'place' : 'places'}`

const VERDICT_TEXT = {
  'merge ticket': 'same look: a merge ticket',
  'removal ticket': 'one copy is used nowhere: a removal ticket',
}

const whatText = (pair) => VERDICT_TEXT[whatHappens(pair)] ?? (pair.verdict === 'decide' ? 'different look: on the decisions list' : 'look not comparable: on the decisions list')

/** A slug for a ticket file name. */
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
export const ticketFileName = (pair, number) => (pair.ticket === 'remove' ? removalFileName(pair, number) : `${String(number).padStart(2, '0')}-merge-${slug(pair.drop.name)}-into-${slug(pair.keep.name)}.md`)

/** The list of every pair, with what was compared. */
export function renderDuplicatesList(pairs) {
  const lines = [
    '# Likely duplicate components',
    '',
    'Written by the Klaus onboarding run. Nothing here has been changed in the code.',
    '',
    `A pair is listed when the two components do the same job: the same name in two files, or the same kind of name (Button and PrimaryButton) with at least ${Math.round(THRESHOLDS.props * 100)}% of their prop names in common. Props that nearly every component takes (${[...GENERIC_PROPS].join(', ')}) do not count toward that, so two components that share only those are not a pair. A pair is also set aside, and listed at the end with the reason, when one component is built on the other (its file imports the other by name), or when the names differ, neither name holds all the words of the other (InsightCard and HypothesisCard, but not Button and PrimaryButton) and the look differs. The look is compared by the class names each component writes, because the run has no screenshots. At ${Math.round(THRESHOLDS.sameLook * 100)}% or more in common, the pair looks the same. These cut-offs are choices, so the percentages are printed and a person can overrule them.`,
    '',
    'What happens to a pair: if one copy is used in no place, it becomes a removal ticket. If the two look the same, it becomes a merge ticket. Otherwise it is a question for the owner, in decisions.md.',
    '',
  ]
  if (pairs.length === 0) return [...lines, 'No likely duplicates were found.', ''].join('\n')
  lines.push('| Keep | The other copy | Props in common | Class names in common | What happens |', '| --- | --- | --- | --- | --- |')
  for (const p of pairs) {
    lines.push(`| ${code(p.keep.name)} (${p.keep.file}) | ${code(p.drop.name)} (${p.drop.file}) | ${percent(p.propsSimilarity)} | ${percent(p.lookSimilarity)} | ${whatText(p)} |`)
  }
  lines.push('', 'The entry to keep is the one that is used, then the shared one, then the one used in more places, then the first by name.', '')
  if (pairs.dismissed?.length > 0) {
    lines.push('## Set aside: not asked about', '', 'These pairs matched by name and props, and the code says they are different components. No ticket and no question were made for them.', '', '| One | The other | Why it was set aside |', '| --- | --- | --- |')
    for (const d of pairs.dismissed) lines.push(`| ${code(d.keep.name)} (${d.keep.file}) | ${code(d.drop.name)} (${d.drop.file}) | ${d.reason} |`)
    lines.push('')
  }
  return lines.join('\n')
}

/** One ticket as a file: a removal ticket when a copy is unused, else the merge-into-one refactor ticket. The shape follows the repo's ticket rules: goal, done check, proof, size. */
export function renderTicket(pair) {
  if (pair.ticket === 'remove') return renderRemovalTicket(pair)
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
