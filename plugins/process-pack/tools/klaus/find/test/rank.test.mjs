import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { firstSentence, LIMIT, rank, stem, THRESHOLD, words } from '../rank.mjs'
import { entries, entry, inventory, purpose, unlabelled } from './fixture.mjs'

const names = (ranking) => ranking.candidates.map((c) => c.name)
const scoreOf = (ranking, name) => ranking.candidates.find((c) => c.name === name)?.score

describe('words', () => {
  test('splits at capitals and keeps an acronym whole', () => {
    assert.deepEqual(words('AIChip'), ['ai', 'chip'])
    assert.deepEqual(words('SegmentedControlItem'), ['segment', 'control', 'item'])
    assert.deepEqual(words('HTMLParser'), ['html', 'parser'])
  })

  test('cuts word endings back so that forms of one word meet', () => {
    assert.equal(stem('loading'), stem('loads'))
    assert.equal(stem('memories'), stem('memory'))
    assert.equal(stem('switches'), stem('switch'))
    assert.equal(stem('class'), 'class')
  })

  test('drops words that carry no meaning', () => {
    assert.deepEqual(words('A toggle for the header, and how it is used'), ['toggle', 'header'])
  })
})

describe('firstSentence', () => {
  test('stops at the first full stop followed by a space', () => {
    assert.equal(firstSentence('The loops.css file styles it (NJM-1). The second sentence.'), 'The loops.css file styles it (NJM-1).')
  })

  test('keeps a text with no full stop, up to 40 words', () => {
    const long = Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ')
    assert.equal(firstSentence(long).split(' ').length, 40)
  })
})

describe('rank', () => {
  test('puts the component whose purpose fits first', () => {
    const ranking = rank(inventory, 'a switch between two views in a page header')
    assert.equal(ranking.candidates[0].name, 'SegmentedControl')
    assert.equal(ranking.nothingFits, false)
  })

  test('returns at most five components, best first, with scores from 0 to 1', () => {
    const ranking = rank(inventory, 'a button that switches a view or loads a panel in a dialog with a count badge')
    assert.ok(ranking.candidates.length <= LIMIT)
    assert.equal(ranking.candidates.length, LIMIT)
    const scores = ranking.candidates.map((c) => c.score)
    assert.deepEqual([...scores].sort((a, b) => b - a), scores)
    for (const s of scores) assert.ok(s > 0 && s <= 1, `score ${s}`)
  })

  test('lets a purpose outweigh a name', () => {
    const pool = {
      entries: [
        entry('Highlight', { purpose: purpose('something else entirely.', 'nothing.') }),
        entry('Thing', { purpose: purpose('showing a highlight around the active row.', 'nothing.') }),
      ],
    }
    const ranking = rank(pool, 'highlight')
    assert.deepEqual(names(ranking), ['Thing', 'Highlight'])
  })

  test('counts a Not for text against a component, and says which words', () => {
    const asked = 'a compact switch for a view inside a header row'
    const pool = (notFor) => ({ entries: [entry('ViewSwitch', { purpose: purpose('switching a view in a header row.', notFor) })] })
    const withNotFor = rank(pool('a compact view switch inside a header row.'), asked)
    const without = rank(pool('moving between pages.'), asked)
    assert.ok(without.candidates[0].score > (withNotFor.candidates[0]?.score ?? 0))
    assert.ok(withNotFor.candidates[0].against.includes('compact'))
    assert.ok(withNotFor.candidates[0].matched.includes('view'))
    assert.deepEqual(without.candidates[0].against, [])
  })

  test('finds a component through a synonym, for less than an exact match', () => {
    const segmented = rank({ entries: [entry('SegmentedControl')] }, 'toggle').candidates[0]
    assert.equal(segmented.name, 'SegmentedControl')
    assert.deepEqual(segmented.matched, ['segment (for toggle)'])
    const exact = rank({ entries: [entry('Toggle')] }, 'toggle').candidates[0]
    assert.ok(exact.score > segmented.score)
  })

  test('credits a word of the component once, however many question words lead to it', () => {
    const pool = { entries: [entry('Tabs'), entry('Unrelated')] }
    const one = rank(pool, 'toggle zzqq')
    const two = rank(pool, 'toggle switch')
    assert.equal(two.candidates[0].score, one.candidates[0].score)
  })

  test('weights words that say where a component lives, and a repo can add its own', () => {
    const pool = { entries: [entry('OrdersBanner'), entry('Card', { purpose: purpose('grouping a title, content and actions on one surface.', 'a full page section.') })] }
    const plain = rank(pool, 'orders card')
    const withNoun = rank(pool, 'orders card', { vocabulary: { productNouns: ['orders'] } })
    assert.ok(scoreOf(withNoun, 'OrdersBanner') < scoreOf(plain, 'OrdersBanner'))
    assert.equal(withNoun.candidates[0].name, 'Card')
    assert.ok(scoreOf(withNoun, 'Card') > scoreOf(plain, 'Card'))
  })

  test('takes synonym rows from the vocabulary', () => {
    const pool = { entries: [entry('Stepper', { purpose: purpose('moving through the steps of a flow.', 'a single form.') })] }
    assert.equal(rank(pool, 'wizard').candidates.length, 0)
    const ranking = rank(pool, 'wizard', { vocabulary: { synonyms: [['wizard', 'stepper']] } })
    assert.equal(ranking.candidates[0].name, 'Stepper')
  })

  test('says nothing fits when even the best component is under the threshold', () => {
    const ranking = rank(inventory, 'a dial showing how confident the team is in a hypothesis, from 0 to 100')
    assert.equal(ranking.nothingFits, true)
    assert.ok(ranking.candidates.length === 0 || ranking.candidates[0].score < THRESHOLD)
  })

  test('applies the threshold to the best score', () => {
    const pool = { entries: [entry('Tooltip')] }
    // A name that matches one question word scores 2 out of 2.2 for each word asked.
    const fits = rank(pool, 'tooltip aaa bbb ccc')
    const short = rank(pool, 'tooltip aaa bbb ccc ddd')
    assert.equal(fits.candidates[0].score, 0.23)
    assert.equal(fits.nothingFits, false)
    assert.equal(short.candidates[0].score, 0.18)
    assert.equal(short.nothingFits, true)
    assert.equal(THRESHOLD, 0.2)
  })

  test('still names the closest components when nothing fits, so a case can list them', () => {
    const ranking = rank({ entries: [entry('Card', { purpose: purpose('grouping content on one surface.', 'a page.') })] }, 'surface alpha beta gamma delta epsilon zeta eta theta iota kappa lambda')
    assert.equal(ranking.nothingFits, true)
    assert.equal(ranking.candidates[0].name, 'Card')
  })

  test('has nothing to match when the purpose is only filler words', () => {
    const ranking = rank(inventory, 'a the of and')
    assert.deepEqual(ranking.asked, [])
    assert.equal(ranking.nothingFits, true)
    assert.deepEqual(ranking.candidates, [])
  })

  test('reads only the first sentence of a comment that is not in the Use when / Not for form', () => {
    const pool = { entries: [entry('Avatar', { purpose: unlabelled('A person photo with initials. Also used for the sticker and the badge everywhere.') })] }
    assert.equal(rank(pool, 'initials').candidates[0].name, 'Avatar')
    assert.equal(rank(pool, 'sticker').candidates.length, 0)
  })

  test('counts a comment that is not in the Use when / Not for form for less than a purpose', () => {
    const text = 'switching a view between options in place.'
    const labelled = rank({ entries: [entry('A', { purpose: purpose(text, 'nothing.') })] }, 'switching a view between options')
    const loose = rank({ entries: [entry('A', { purpose: unlabelled(text) })] }, 'switching a view between options')
    assert.ok(loose.candidates[0].score < labelled.candidates[0].score)
  })

  test('ignores the props of a component that passes a whole element through', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ name: i === 7 ? 'gizmo' : `attr${i}`, type: 'string', required: false }))
    const pool = { entries: [entry('Wrapper', { props: many }), entry('Own', { props: [{ name: 'gizmo', type: 'string', required: false }] })] }
    assert.deepEqual(names(rank(pool, 'gizmo')), ['Own'])
  })

  test('matches on variants and on the names of parts', () => {
    assert.equal(rank(inventory, 'footer').candidates[0].name, 'Dialog')
    assert.equal(rank(inventory, 'outline').candidates[0].name, 'Button')
  })

  test('matches the icons inside an icon set', () => {
    const ranking = rank(inventory, 'moon')
    assert.equal(ranking.candidates[0].name, 'Icon set')
  })

  test('lists a name that is in two folders once, led by the shared copy', () => {
    const ranking = rank(inventory, 'content is loading and its shape is known')
    const skeletons = ranking.candidates.filter((c) => c.name === 'Skeleton')
    assert.equal(skeletons.length, 1)
    assert.equal(skeletons[0].kind, 'shared')
    assert.deepEqual(skeletons[0].alsoAt, ['apps/web/app/components/ui/skeleton.tsx'])
  })

  test('keeps two icon sets apart', () => {
    const pool = { entries: [entry('Icon set', { kind: 'icon-set', file: 'a/icons', icons: ['Moon'] }), entry('Icon set', { kind: 'icon-set', file: 'b/icons', icons: ['Moon'] })] }
    assert.equal(rank(pool, 'moon').candidates.length, 2)
  })

  test('is the same every time, with ties broken by shared first and then by name', () => {
    const pool = { entries: [entry('Zed', { kind: 'app', purpose: unlabelled('a thing.') }), entry('Alpha', { purpose: unlabelled('a thing.') }), entry('Beta', { purpose: unlabelled('a thing.') })] }
    assert.deepEqual(names(rank(pool, 'thing')), ['Alpha', 'Beta', 'Zed'])
  })

  test('does not change the inventory it reads', () => {
    const before = JSON.stringify(entries)
    rank(inventory, 'switch a view')
    assert.equal(JSON.stringify(entries), before)
  })
})
