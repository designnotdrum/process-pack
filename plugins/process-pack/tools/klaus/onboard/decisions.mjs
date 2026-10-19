/**
 * The owner's decisions list for duplicate components, and the removal tickets, written to be read
 * cold by someone who has not seen the repo.
 *
 * Each side of a pair is named by where it lives and how many places use it ("the shared UI
 * package's Tooltip (13 places)"), never by its export name alone. A pair is a decision only when
 * both sides are used and the look differs. Each decision is one question with its default
 * stated, a picture of the two side by side when both could be drawn, and one plain sentence on
 * what differs. Class names and file paths are in a collapsed block for whoever does the merge.
 * Nothing here says anything about accessibility: Klaus makes no such judgement.
 */

const code = (text) => `\`${String(text).replace(/`/g, "'")}\``
const list = (items, empty = 'none') => (items.length === 0 ? empty : items.map(code).join(', '))
const percent = (n) => (n === null ? 'not comparable' : `${Math.round(n * 100)}%`)
const usedCount = (entry) => entry.usedIn.length
const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
export const places = (entry) => count(usedCount(entry), 'place')
const usedText = (entry) => (usedCount(entry) === 0 ? 'unused' : places(entry))
/** The places that use `entry`, not counting the other copy's own file: a copy built on this one is not a user of it. */
const usesOf = (entry, other) => entry.usedIn.filter((user) => user !== other.file)
const upperFirst = (text) => text.charAt(0).toUpperCase() + text.slice(1)
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/** Why the kept entry was picked, in the order the pair was ranked. */
export function keepReason(keep, drop) {
  if (keep.kind === 'shared' && drop.kind !== 'shared') return 'it is shared'
  if (usedCount(keep) > usedCount(drop)) return 'it is used in more places'
  return 'it comes first by name'
}

const words = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').toLowerCase().split(' ').filter(Boolean)

/** True when the names are the same, or one holds all the words of the other: PrimaryButton and Button. */
export function isVariantName(a, b) {
  if (a === b) return true
  const [wa, wb] = [words(a), words(b)]
  const [small, large] = wa.length <= wb.length ? [wa, wb] : [wb, wa]
  return small.every((w) => large.includes(w))
}

// ---- where a component lives

const GENERIC_FOLDERS = new Set(['src', 'app', 'components', 'lib', 'source'])

/**
 * Where an entry lives, in the words a person uses for it: the folder `packages/ui/src` of the
 * shared role is "the shared UI package", and `apps/web/app` is "the web app". `short` is a single
 * word for file names.
 */
export function areaOf(entry) {
  const parts = (entry.folder ?? '').split('/').filter(Boolean)
  const after = (marker) => {
    const at = parts.indexOf(marker)
    return at >= 0 && parts[at + 1] ? parts[at + 1] : null
  }
  const lastNamed = parts.filter((p) => !GENERIC_FOLDERS.has(p)).at(-1) ?? null
  if (entry.kind === 'shared') {
    const name = after('packages') ?? lastNamed
    if (!name) return { owner: 'the shared components', short: 'shared' }
    const shown = name === 'shared' ? '' : name.length <= 3 && !/\d/.test(name) ? `${name.toUpperCase()} ` : `${name} `
    return { owner: `the shared ${shown}package`, short: name }
  }
  const name = after('apps') ?? lastNamed
  return name ? { owner: `the ${name} app`, short: name } : { owner: 'the app', short: 'app' }
}

const possessive = (owner) => (owner.endsWith('s') ? `${owner}'` : `${owner}'s`)

/**
 * How each side of a pair is named. A copy in an app of a component the shared package also has is
 * "the web app's own Tooltip". Two sides in the same place with the same name are told apart by
 * the folder they are in.
 */
export function sidesOf(pair) {
  const { keep, drop } = pair
  const sameName = keep.name === drop.name
  const build = (entry) => {
    const area = areaOf(entry)
    return { entry, area, text: `${possessive(area.owner)} ${sameName && entry.kind !== 'shared' ? 'own ' : ''}${entry.name}` }
  }
  const [a, b] = [build(keep), build(drop)]
  if (a.text === b.text) {
    for (const side of [a, b]) {
      const inside = side.entry.file.slice(0, side.entry.file.lastIndexOf('/')).slice((side.entry.folder ?? '').length).replace(/^\//, '')
      side.text = `${side.text} (in ${inside || 'the top folder'})`
    }
  }
  const uses = (side, other) => usesOf(side.entry, other.entry).length
  const label = (side, other) => `${side.text} (${uses(side, other) === 0 ? 'unused' : count(uses(side, other), 'place')})`
  // Two different components in the same place: the second mention leaves the place out, "the web app's A" then "B".
  const then = (side, other) => (keep.name !== drop.name && side.area.owner === other.area.owner ? side.entry.name : side.text)
  return { keep: { ...a, label: label(a, b), uses: uses(a, b), then: then(a, b) }, drop: { ...b, label: label(b, a), uses: uses(b, a), then: then(b, a) } }
}

// ---- the question and its default

/** What a "yes" would do, said once. */
function yesText(pair, sides) {
  const n = sides.drop.uses
  const users = n === 0 ? 'nothing else used it, so nothing moves' : n === 1 ? `the 1 place that used it uses ${sides.keep.then} instead` : `the ${n} places that used it use ${sides.keep.then} instead`
  return `Yes means: ${sides.drop.text} is deleted, and ${users}.`
}

/** The default answer if the owner says nothing, and the reason. */
export function defaultAnswer(pair) {
  const sides = sidesOf(pair)
  const { keep, drop } = pair
  const sameJobName = isVariantName(keep.name, drop.name)
  if (sides.keep.uses > sides.drop.uses && sameJobName) return { yes: true, because: `${sides.keep.text} is used in more places (${sides.keep.uses} against ${sides.drop.uses})` }
  if (keep.kind === 'shared' && drop.kind !== 'shared' && sameJobName) return { yes: true, because: `${sides.keep.text} is the shared one, so other code is meant to reuse it` }
  if (!sameJobName) return { yes: false, because: 'the two have different names, so they may be different things' }
  return { yes: false, because: 'neither is used in more places than the other' }
}

/** The decisions: pairs the data did not settle. */
export const decisionPairs = (pairs) => pairs.filter((p) => p.verdict !== 'merge')

/** The file name of a decision's picture, below the decisions folder. It names the left side, the one that would be replaced, first. */
export function decisionPictureName(pair, number) {
  const nn = String(number).padStart(2, '0')
  if (pair.keep.name === pair.drop.name) return `${nn}-${slug(pair.drop.name)}-${slug(areaOf(pair.drop).short)}-vs-${slug(areaOf(pair.keep).short)}.png`
  return `${nn}-${slug(pair.drop.name)}-vs-${slug(pair.keep.name)}.png`
}

const countOf = (pairs) => ({
  decisions: decisionPairs(pairs).length,
  removals: pairs.filter((p) => p.verdict === 'merge' && p.ticket === 'remove').length,
  merges: pairs.filter((p) => p.verdict === 'merge' && p.ticket !== 'remove').length,
})

function details(pair) {
  const { keep, drop } = pair
  const lines = [
    '<details>',
    '<summary>Class names and file paths, for whoever does the merge</summary>',
    '',
    `- Left, would be replaced: ${code(drop.file)}`,
    `- Right, would stay: ${code(keep.file)}`,
    `- Why Klaus lists them as a pair: ${pair.reasons.join(' and ')}.`,
    `- Props only the left has: ${list(pair.onlyDrop)}. Props only the right has: ${list(pair.onlyKeep)}.`,
    pair.verdict === 'decide-look-unknown' ? '- Class names: one of the two writes none, so they cannot be compared.' : `- Class names the two have in common: ${percent(pair.lookSimilarity)}.`,
  ]
  if (pair.verdict !== 'decide-look-unknown') lines.push(`- Class names only the left writes: ${list(pair.classesOnlyDrop.slice(0, 20))}${pair.classesOnlyDrop.length > 20 ? ', and more' : ''}.`, `- Class names only the right writes: ${list(pair.classesOnlyKeep.slice(0, 20))}${pair.classesOnlyKeep.length > 20 ? ', and more' : ''}.`)
  lines.push(`- Where the left is used (${usedText(drop)}): ${list(drop.usedIn.slice(0, 10))}${drop.usedIn.length > 10 ? ', and more' : ''}.`, `- Where the right is used (${usedText(keep)}): ${list(keep.usedIn.slice(0, 10))}${keep.usedIn.length > 10 ? ', and more' : ''}.`, '', '</details>')
  return lines
}

/** What a component is for, in its own words, when it has a purpose comment. */
const purposeOf = (entry) => (entry.purpose?.useWhen ? ` Use when ${String(entry.purpose.useWhen).replace(/^use when:?\s*/i, '').replace(/\.$/, '')}.` : '')

/** The lines about the picture, or the plain reason there is none. */
function pictureLines(sides, picture) {
  if (picture?.file) {
    const lines = [`![${sides.drop.text} on the left and ${sides.keep.text} on the right](${picture.file})`]
    const missing = (picture.notDrawn ?? []).filter(Boolean)
    if (missing.length > 0) lines.push('', `Only one side is drawn: ${missing.join(' and ')}.`)
    return lines
  }
  const reasons = (picture?.notDrawn ?? []).filter(Boolean)
  const neither = reasons.length === 2 && reasons.every((r) => r.endsWith(' has no story'))
  const reason = picture?.reason ?? (neither ? 'neither has a story' : reasons.length > 0 ? reasons.join(' and ') : 'Klaus did not draw these two in this run')
  return [`No picture: ${reason}.`]
}

/** The line on what differs: measured from the picture, else read from the class names, else a plain admission. */
function differenceLine(pair, picture) {
  if (picture?.difference) return `- What you can see: ${picture.difference}`
  if (pair.lookNote) return `- From the class names, not from a picture: ${pair.lookNote}`
  const why = picture?.file ? 'only one side is drawn' : 'there is no picture'
  if (pair.verdict === 'decide-look-unknown') return `- What differs on screen is not known: ${why}, and one of the two does not style itself with class names. Open both in the app and compare.`
  return `- What differs on screen is not known: ${why}, and the two write too many class names to read it from them. Open both in the app and compare. The class names that differ are in the block below.`
}

/**
 * The owner's decisions list.
 *
 * @param {object[]} pairs Every pair; the ones the data settled are counted and left out.
 * @param {Map<string, object>} [pictures] By pair id: { file, drawn, notDrawn, difference, reason }.
 */
export function renderDecisions(pairs, pictures = new Map()) {
  const decide = decisionPairs(pairs)
  const { removals, merges } = countOf(pairs)
  const settled = [removals > 0 ? count(removals, 'removal ticket') : null, merges > 0 ? count(merges, 'merge ticket') : null].filter(Boolean)
  const away = pairs.dismissed?.length ?? 0
  const lines = [
    '# Decisions for the owner: duplicate components',
    '',
    `Klaus found components that may do the same job twice. This list holds only the ones it could not settle from the code: ${count(decide.length, 'question')}.${settled.length > 0 ? ` It settled the others without asking, as ${settled.join(' and ')} in the [tickets folder](tickets/).` : ''}${away > 0 ? ` It set aside ${count(away, 'pair')} as different components, such as one built on the other. They are listed with the reason at the end of duplicates.md.` : ''}`,
    '',
  ]
  if (decide.length === 0) return [...lines, 'There is nothing to decide. No pairs need a decision.', ''].join('\n')
  lines.push('Tick one box under each question. Nothing in the code changes because of this list: a yes is written up afterwards as a ticket like the ones in the tickets folder.', '', 'Klaus is the tool that keeps the list of this repo\'s components. It draws a component from its story, a Storybook example page for that one component. Where a component has no story it cannot be drawn, and the item says so.', '')
  decide.forEach((pair, index) => {
    const sides = sidesOf(pair)
    const picture = pictures.get(pair.id)
    const answer = defaultAnswer(pair)
    lines.push(
      `## ${index + 1}. Replace ${sides.drop.text} with ${sides.keep.then}?`,
      '',
      ...pictureLines(sides, picture),
      '',
      `- Left, would be replaced: ${sides.drop.label}.${purposeOf(pair.drop)}`,
      `- Right, would stay: ${sides.keep.label}.${purposeOf(pair.keep)}`,
      differenceLine(pair, picture),
      `- ${yesText(pair, sides)}`,
      '',
      `Default if you do not answer: ${answer.yes ? 'yes' : 'no, keep both'}, because ${answer.because}.`,
      '',
      '- [ ] Yes, replace it',
      '- [ ] No, keep both, because:',
      '',
      ...details(pair),
      '',
    )
  })
  return lines.join('\n')
}

// ---- the removal ticket

export function removalFileName(pair, number) {
  return `${String(number).padStart(2, '0')}-remove-${slug(pair.drop.name)}-from-${slug(areaOf(pair.drop).short)}.md`
}

/**
 * One ticket to delete a copy that nothing uses, as a file. The shape follows the repo's ticket
 * rules: goal, done check, proof, size. The copy that goes is always `drop`.
 */
export function renderRemovalTicket(pair) {
  const sides = sidesOf(pair)
  const { keep, drop } = pair
  const lines = [
    `# Delete ${sides.drop.text}`,
    '',
    'Labels: klaus-duplicate, refactor',
    'Size: S',
    '',
    '## Goal',
    '',
    `Delete ${sides.drop.text} (${code(drop.file)}), because nothing in this repo uses it. ${keep.name === drop.name ? `${upperFirst(sides.keep.text)} does the same job, so the repo ends with one component for it.` : `${upperFirst(sides.keep.text)} has a similar name and props, so look at it first: it may already do what ${sides.drop.then} was for.`}`,
    '',
    '## What Klaus found',
    '',
    `- ${upperFirst(sides.drop.text)} is used in no place. Klaus counts the files that import it.`,
    `- ${upperFirst(sides.keep.label)} is the copy that stays.${usedCount(keep) === 0 ? ' It is also used nowhere. This ticket does not touch it: decide separately whether to keep it.' : ''}`,
    `- Klaus lists the two as a pair because ${pair.reasons.join(' and ')}.`,
    `- Props only ${sides.drop.text} has: ${list(pair.onlyDrop)}. Props only ${sides.keep.text} has: ${list(pair.onlyKeep)}.`,
  ]
  if (drop.kind === 'shared') lines.push('- It is in the shared package. Klaus reads only this repo, so check that another repo does not import it before deleting.')
  if (pair.alsoSimilarTo?.length > 0) lines.push(`- Klaus also listed it against ${list(pair.alsoSimilarTo)} as separate pairs. They are folded into this ticket.`)
  lines.push(
    '',
    '## Done when',
    '',
    `- ${code(drop.file)} is deleted and nothing imports it. Any story, test or export of it is removed with it: Klaus does not count those as uses.`,
    '- Search the repo for the name once more before deleting. Klaus reads imports, so a component used only through a string or a dynamic import would show as unused.',
    '- The inventory, rebuilt, lists one entry fewer, and the app builds and its checks pass.',
    '',
    '## Proof wanted',
    '',
    'The pull request shows the result of the search for the name, and the rebuilt inventory without the deleted entry. No screen changes, so no before and after captures are needed.',
    '',
  )
  return lines.join('\n')
}
