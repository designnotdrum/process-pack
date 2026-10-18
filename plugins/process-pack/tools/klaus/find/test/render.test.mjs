import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { rank } from '../rank.mjs'
import { renderCase, renderFind } from '../render.mjs'
import { entry, folders, inventory, purpose, unlabelled } from './fixture.mjs'

const NOTHING = 'a dial showing how confident the team is in a hypothesis, from 0 to 100'
const SWITCH = 'a switch between two views in a page header'
// Five components share a word with this, so a case lists five.
const MANY = 'a button that switches a view or loads a panel in a dialog with a count badge'
// One component shares a word with this, but only one word in twelve: close, and not near enough.
const WEAK = 'tooltip alpha beta gamma delta epsilon zeta eta theta iota kappa lambda'

const count = (text, needle) => text.split(needle).length - 1

describe('renderFind', () => {
  test('lists each component with its score, where it is and its Use when and Not for', () => {
    const text = renderFind(SWITCH, rank(inventory, SWITCH))
    assert.match(text, /^Purpose: a switch between two views in a page header\n/)
    assert.match(text, /1\. SegmentedControl, score \d\.\d\d, shared\n/)
    assert.match(text, /`packages\/ui\/src\/components\/SegmentedControl\.tsx`/)
    assert.match(text, /Use when: switching a view, layout or filter between two to four options in place/)
    assert.match(text, /Not for: moving between pages, or an on or off setting\./)
    assert.match(text, /Matched on: .*switch/)
  })

  test('tells the person how to record the choice', () => {
    const text = renderFind(SWITCH, rank(inventory, SWITCH))
    assert.match(text, /`Klaus: used <Name>`/)
    assert.match(text, /`Klaus: extended <Name>`/)
    assert.match(text, /`Klaus: new component, see case`/)
    assert.match(text, /--case/)
    assert.doesNotMatch(text, /Nothing fits/)
  })

  test('shows a comment that is not in the Use when / Not for form, marked as such', () => {
    const pool = { entries: [entry('Avatar', { purpose: unlabelled("A person's avatar with an initials fallback.") })] }
    const text = renderFind('avatar with initials', rank(pool, 'avatar with initials'))
    assert.match(text, /Purpose, not yet in the Use when \/ Not for form: A person's avatar with an initials fallback\./)
    assert.doesNotMatch(text, /Use when: /)
  })

  test('shows a component with no purpose as having none written', () => {
    const pool = { entries: [entry('Divider')] }
    assert.match(renderFind('divider', rank(pool, 'divider')), /Purpose: none written yet\./)
  })

  test('cuts a long comment short on one line', () => {
    const pool = { entries: [entry('Avatar', { purpose: unlabelled(`An avatar.\n${'word '.repeat(100)}`) })] }
    const line = renderFind('avatar', rank(pool, 'avatar')).split('\n').find((l) => l.includes('not yet in the Use when'))
    assert.ok(line.endsWith('...'))
    assert.ok(line.length < 340)
  })

  test('says where a local component belongs and names the other copies of a name', () => {
    const local = renderFind('table of orders', rank(inventory, 'table of orders'))
    assert.match(local, /OrdersTable, score \d\.\d\d, local to \/orders/)
    const copies = renderFind('content is loading', rank(inventory, 'content is loading'))
    assert.match(copies, /The same name is also in: `apps\/web\/app\/components\/ui\/skeleton\.tsx`/)
  })

  test('falls back to the file when a local component has no route', () => {
    const pool = { entries: [entry('OrdersTable', { kind: 'local', file: 'apps/web/app/orders/OrdersTable.tsx' })] }
    assert.match(renderFind('orders table', rank(pool, 'orders table')), /local to apps\/web\/app\/orders\/OrdersTable\.tsx/)
  })

  test('says nothing fits below the threshold, still lists the closest, and points to the case', () => {
    const text = renderFind(WEAK, rank(inventory, WEAK))
    assert.match(text, /Nothing fits\. No component scores 0\.20 or more/)
    assert.match(text, /1\. Tooltip, score 0\.0\d/)
    assert.match(text, /Writing a new component needs a case\. Run this again with --case/)
    assert.doesNotMatch(text, /`Klaus: used <Name>`/)
  })

  test('says nothing fits when no component shares a word with the purpose', () => {
    const text = renderFind('zxqv wibble', rank(inventory, 'zxqv wibble'))
    assert.match(text, /Nothing fits\. No component in the inventory shares a word with this purpose\./)
    assert.doesNotMatch(text, /^1\. /m)
  })
})

describe('renderCase', () => {
  const caseFor = (asked) => renderCase(asked, rank(inventory, asked), folders)

  test('starts with the PR body line, then the New component case section', () => {
    const text = caseFor(NOTHING)
    const [first, second, third] = text.split('\n')
    assert.equal(first, 'Klaus: new component, see case')
    assert.equal(second, '')
    assert.equal(third, '## New component case')
  })

  test('fills the purpose in as Use when and leaves Not for to fill in', () => {
    const text = caseFor(NOTHING)
    assert.match(text, /- Use when: a dial showing how confident the team is in a hypothesis, from 0 to 100\n/)
    assert.match(text, /- Not for: \[fill in: what it must not be used for\]\n/)
  })

  test('gives each of the closest components its purpose and three things to say', () => {
    const ranking = rank(inventory, MANY)
    const text = renderCase(MANY, ranking, folders)
    assert.equal(ranking.candidates.length, 5)
    assert.equal(count(text, 'Why it fails as is: [fill in:'), 5)
    assert.equal(count(text, 'As a new variant: [fill in:'), 5)
    assert.equal(count(text, 'Composed: [fill in:'), 5)
    const first = ranking.candidates[0].name
    assert.match(text, new RegExp(`1\\. ${first}, score \\d\\.\\d\\d, \`packages/ui/src/components/${first}\\.tsx\`\\n {3}- Use when: `))
    assert.match(text, new RegExp(`- Not for: .*\\n {3}- Why it fails as is: \\[fill in: what ${first} cannot do for this purpose\\]`))
    assert.match(text, new RegExp(`As a new variant: \\[fill in: why a variant or prop on ${first} does not fit\\]`))
    assert.match(text, new RegExp(`Composed: \\[fill in: why building this from ${first} does not fit\\]`))
  })

  test('marks a comment that is not in the Use when / Not for form', () => {
    const pool = { entries: [entry('Avatar', { purpose: unlabelled('A person avatar.') })] }
    const text = renderCase('avatar', rank(pool, 'avatar'), folders)
    assert.match(text, /- Purpose, not yet in the Use when \/ Not for form: A person avatar\./)
  })

  test('asks for the name, whether it is shared or app-level, and the DESIGN.md change', () => {
    const text = caseFor(NOTHING)
    assert.match(text, /\*\*The new component\*\*/)
    assert.match(text, /- Name: \[fill in: the component name\]/)
    assert.match(text, /- Where it lives: \[fill in: shared \(packages\/ui\/src\) or app-level \(apps\/web\/app\)\]/)
    assert.match(text, /- DESIGN\.md change, for a shared component: \[fill in: /)
  })

  test('says so when none of the closest components fits', () => {
    assert.match(caseFor(WEAK), /none scores 0\.20 or more, so none fits as is/)
    assert.doesNotMatch(caseFor(SWITCH), /none scores/)
  })

  test('says the inventory has nothing close when no component shares a word', () => {
    const text = caseFor('zxqv wibble')
    assert.match(text, /No component in the inventory shares a word with this purpose\./)
    assert.doesNotMatch(text, /Why it fails as is/)
    assert.match(text, /- Name: /)
  })

  test('lists several folders of one role, and copes with a repo that has none of a role', () => {
    const many = renderCase('x', rank(inventory, 'tooltip'), [
      { path: 'packages/ui', role: 'shared' },
      { path: 'packages/forms', role: 'shared' },
      { path: 'apps/web', role: 'app' },
    ])
    assert.match(many, /shared \(packages\/ui, packages\/forms\) or app-level \(apps\/web\)/)
    const none = renderCase('x', rank(inventory, 'tooltip'), [])
    assert.match(none, /Where it lives: \[fill in: shared or app-level\]/)
  })

  test('renders as plain Markdown: nothing that GitHub would hide as an HTML tag', () => {
    const text = caseFor(SWITCH)
    assert.doesNotMatch(text, /[<>]/)
  })
})

describe('the text Klaus prints', () => {
  test('has no em dash anywhere', () => {
    const outputs = [
      renderFind(SWITCH, rank(inventory, SWITCH)),
      renderFind(NOTHING, rank(inventory, NOTHING)),
      renderFind('zxqv wibble', rank(inventory, 'zxqv wibble')),
      renderCase(SWITCH, rank(inventory, SWITCH), folders),
      renderCase(NOTHING, rank(inventory, NOTHING), folders),
    ]
    // Written as a code point, so this file holds no dash itself.
    const emDash = String.fromCodePoint(0x2014)
    for (const text of outputs) assert.ok(!text.includes(emDash), 'em dash in output')
  })

  test('keeps a multi-line purpose on one line', () => {
    const asked = 'a toggle\nin the   header'
    const text = renderCase(asked, rank({ entries: [entry('Toggle', { purpose: purpose('a toggle.', 'nothing.') })] }, asked), folders)
    assert.match(text, /- Use when: a toggle in the header\n/)
  })
})
