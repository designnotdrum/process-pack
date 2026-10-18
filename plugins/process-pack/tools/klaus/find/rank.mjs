/**
 * Ranks the components in inventory.json against a purpose written in plain words.
 *
 * It is a word match, with no model. The rules came from a prototype run on a real repo:
 *
 * - A "Use when" text outweighs the component's name, and a "Not for" text counts against. A purpose
 *   written in those two parts is the only phrasing that put the right component first or second
 *   every time.
 * - A comment that is not in that form still counts, a good deal less. Only its first sentence is read.
 * - Words that say where a component lives, not what it does ("loop", "page"), count for little.
 * - A short synonym list bridges the common ways of naming one thing ("toggle" and "segmented").
 * - Names are split at capitals, so AIChip is "ai chip".
 *
 * @typedef {import('../inventory/inventory.mjs').Entry} Entry
 * @typedef {{ synonyms?: string[][], productNouns?: string[] }} Vocabulary
 *
 * @typedef {object} Candidate
 * @property {string} name
 * @property {Entry['kind']} kind
 * @property {string} file
 * @property {string} [route]
 * @property {number} score A number from 0 to 1.
 * @property {string[]} matched The words that counted for this component.
 * @property {string[]} against The words its "Not for" text counted against.
 * @property {Entry['purpose']} purpose
 * @property {string[]} alsoAt Other files that hold a component with the same name.
 *
 * @typedef {object} Ranking
 * @property {string[]} asked The words of the purpose Klaus matched on.
 * @property {boolean} nothingFits True when even the best candidate is below the threshold.
 * @property {Candidate[]} candidates At most five, best first. Present even when nothing fits, so a case can name the closest.
 */

/** The best score at or above this means something in the inventory fits. */
export const THRESHOLD = 0.2

/** The most components a `klaus find` returns. */
export const LIMIT = 5

const STOP_WORDS = new Set(
  'a an the and or of for to in on at by with from into its it is are be as that this which while when where one two three four each any all their there them they we our us you your show shows showing shown under over about only per new use used using how what who why whether not but if so than then can could should will would just also has have had been was were do does did'.split(' '),
)

/**
 * Names for the same part of an interface. Each row is a group of words that stand for one another.
 * This is only what most UIs share. A repo adds rows of its own as `synonyms` in the vocabulary.
 */
const SYNONYMS = [
  ['toggle', 'switch', 'segment', 'segmented', 'tab', 'view', 'mode', 'choice', 'option', 'exclusive'],
  ['load', 'skeleton', 'placeholder', 'spinner', 'busy', 'wait'],
  ['chip', 'badge', 'pill', 'label', 'tag'],
  ['sheet', 'panel', 'drawer', 'slide', 'side'],
  ['dialog', 'modal', 'window'],
  ['count', 'number', 'total', 'many'],
  ['ai', 'agent', 'assistant'],
  ['dial', 'gauge', 'meter', 'progress', 'score', 'percent'],
]

/**
 * Words that say where something sits on a screen, not what it does. Product names say the same
 * about the repo ("loop", "canvas"), so a repo adds its own as `productNouns` in the vocabulary.
 */
const LOW_WEIGHT = 'page header row index open small saying click clicking start starts'.split(' ')

/** Weight of a low-weight word in the question, against 1 for any other word. */
const LOW_WEIGHT_FACTOR = 0.15

/** What one question word is worth from a good match: a name (2) with a little over. A score is the total over this for every word asked. */
const GOOD_MATCH = 2.2

/** A synonym counts for this much of an exact match. */
const SYNONYM_FACTOR = 0.6

/** A component that lists more props than this is passing a DOM element's props through, and they say nothing about it. */
const MAX_PROPS = 30

/**
 * What one word in each part of a component is worth. A purpose outweighs a name. A comment that is
 * not in the Use when / Not for form was not written to say what the component is for, and it can run
 * to paragraphs, so it counts for little. At a weight near a purpose's, long comments out-scored the
 * right component on a real repo.
 */
const WEIGHT = { name: 2, part: 1, prop: 1, variant: 1, useWhen: 4, notFor: -3, unlabelled: 1, iconName: 1 }

/** The most one question word can add or take away for one component. Room for a name and a purpose to agree. */
const CAP = 6

/** One word, cut back so that "loading" and "loads" meet "load". Applied to both sides of every match. */
export function stem(word) {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.length > 4 && /(?:ss|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  if (word.length > 4 && word.endsWith('ing')) return word.slice(0, -3)
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2)
  return word
}

/** The stemmed words of a text. Capitals split words, and an acronym stays whole: "AIChip" is "ai" and "chip". */
export function words(text) {
  return String(text ?? '')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !STOP_WORDS.has(word))
    .map(stem)
}

const UNLABELLED_WORDS = 40

/** Comments that are not in the Use when / Not for form often run to paragraphs, so only the first sentence counts. */
export function firstSentence(text) {
  const sentence = String(text ?? '').trim().match(/^(.*?[.!?])(?:\s|$)/s)?.[1] ?? String(text ?? '').trim()
  return sentence.split(/\s+/).slice(0, UNLABELLED_WORDS).join(' ')
}

/** The weight of each word a component answers to. */
function bagOf(entry) {
  const bag = new Map()
  const addAll = (list, weight) => {
    for (const word of list) bag.set(word, (bag.get(word) ?? 0) + weight)
  }
  // Names, parts, props and variants count a word once each, so a family with twenty parts named alike
  // does not outweigh one that says it once. A purpose counts a word every time it is said.
  const add = (list, weight) => addAll(new Set(list), weight)
  const nameWords = new Set(words(entry.name))
  add(nameWords, WEIGHT.name)
  add(words(entry.parts.map((part) => part.name).join(' ')).filter((word) => !nameWords.has(word)), WEIGHT.part)
  if (entry.props.length <= MAX_PROPS) add(words(entry.props.map((prop) => prop.name).join(' ')), WEIGHT.prop)
  add(words(Object.entries(entry.variants).map(([key, options]) => `${key} ${options.join(' ')}`).join(' ')), WEIGHT.variant)
  if (entry.icons) add(words(entry.icons.join(' ')), WEIGHT.iconName)
  const { purpose } = entry
  if (purpose?.useWhen || purpose?.notFor) {
    addAll(words(purpose.useWhen), WEIGHT.useWhen)
    addAll(words(purpose.notFor), WEIGHT.notFor)
  } else if (purpose?.text) {
    addAll(words(firstSentence(purpose.text)), WEIGHT.unlabelled)
  }
  return bag
}

function synonymIndex(rows) {
  const index = new Map()
  for (const row of rows) {
    const stems = [...new Set(row.flatMap((word) => words(word)))]
    for (const word of stems) index.set(word, [...(index.get(word) ?? []), ...stems])
  }
  return index
}

/** Where a name is spelled once, entries that share it are the same component copied into more than one folder. */
const groupKey = (entry) => (entry.kind === 'icon-set' ? entry.file || entry.name : entry.name)

/** Shared components first, then the most used, so the copy a person should reach for leads. */
const byPreference = (a, b) => (a.entry.kind === 'shared' ? 0 : 1) - (b.entry.kind === 'shared' ? 0 : 1) || (b.entry.usedIn?.length ?? 0) - (a.entry.usedIn?.length ?? 0)

/**
 * @param {{ entries: Entry[] }} inventory The parsed inventory.json.
 * @param {string} purpose What the new component is for, in plain words.
 * @param {{ vocabulary?: Vocabulary }} [options]
 * @returns {Ranking}
 */
export function rank(inventory, purpose, { vocabulary = {} } = {}) {
  const asked = [...new Set(words(purpose))]
  if (!asked.length) return { asked, nothingFits: true, candidates: [] }

  const synonyms = synonymIndex([...SYNONYMS, ...(vocabulary.synonyms ?? [])])
  const lowWeight = new Set([...LOW_WEIGHT, ...(vocabulary.productNouns ?? [])].flatMap((word) => words(word)))
  const meaningful = asked.filter((word) => !lowWeight.has(word)).length || 1

  const scored = inventory.entries.map((entry) => {
    const bag = bagOf(entry)
    // A word of the component credited through a synonym counts once, however many question words lead to it.
    const credited = new Set()
    let total = 0
    const matched = []
    const against = []
    for (const word of asked) {
      let got = bag.get(word) ?? 0
      let via = word
      if (got === 0 && synonyms.has(word)) {
        let viaOther
        for (const other of synonyms.get(word)) {
          const weight = credited.has(other) ? 0 : (bag.get(other) ?? 0) * SYNONYM_FACTOR
          if (Math.abs(weight) > Math.abs(got)) {
            got = weight
            viaOther = other
            via = `${other} (for ${word})`
          }
        }
        if (viaOther) credited.add(viaOther)
      }
      if (got > 0) matched.push(via)
      if (got < 0) against.push(via)
      total += (lowWeight.has(word) ? LOW_WEIGHT_FACTOR : 1) * Math.max(-CAP, Math.min(got, CAP))
    }
    const score = Math.round(Math.min(Math.max(0, total / (meaningful * GOOD_MATCH)), 1) * 100) / 100
    return { entry, score, matched, against }
  })

  // One candidate per name. The best-scoring copy speaks for the others, which are listed beside it.
  const groups = new Map()
  for (const item of scored) groups.set(groupKey(item.entry), [...(groups.get(groupKey(item.entry)) ?? []), item])
  const candidates = [...groups.values()]
    .map((group) => {
      const [best, ...others] = [...group].sort((a, b) => b.score - a.score || byPreference(a, b))
      return { item: best, alsoAt: others.map((other) => other.entry.file) }
    })
    .filter(({ item }) => item.score > 0)
    .sort((a, b) => b.item.score - a.item.score || byPreference(a.item, b.item) || (a.item.entry.name < b.item.entry.name ? -1 : 1))
    .slice(0, LIMIT)
    .map(({ item: { entry, score, matched, against }, alsoAt }) => ({
      name: entry.name,
      kind: entry.kind,
      file: entry.file,
      ...(entry.route && { route: entry.route }),
      score,
      matched,
      against,
      purpose: entry.purpose,
      alsoAt,
    }))
  return { asked, nothingFits: !candidates.length || candidates[0].score < THRESHOLD, candidates }
}
