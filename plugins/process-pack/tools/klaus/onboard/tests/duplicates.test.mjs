import assert from 'node:assert/strict'
import fs from 'node:fs'
import { after, before, test } from 'node:test'
import { loadTypeScript } from '../../inventory/components.mjs'
import { buildInventory } from '../../inventory/inventory.mjs'
import { readOnboardingConfig } from '../config.mjs'
import { findDuplicates, headNoun, keepReason, renderDecisions, renderDuplicatesList, renderTicket, ticketFileName } from '../duplicates.mjs'
import { makeSample } from './helpers.mjs'

let sample
let pairs
before(() => {
  sample = makeSample()
  const { folders } = readOnboardingConfig(sample.repo)
  const root = fs.realpathSync(sample.repo)
  pairs = findDuplicates({ ts: loadTypeScript(root), root, inventory: buildInventory({ root, folders }) })
})
after(() => sample.cleanup())

const pair = (a, b) => pairs.find((p) => [p.keep.name, p.drop.name].sort().join() === [a, b].sort().join())

test('a kind of name is its last word', () => {
  assert.equal(headNoun('PrimaryButton'), 'button')
  assert.equal(headNoun('AIChips'), 'chip')
  assert.equal(headNoun('Dialog'), 'dialog')
})

test('the fixture has two pairs among the buttons and none involving Hero or ActivityFeed', () => {
  assert.equal(pairs.length, 2)
  assert.ok(pairs.every((p) => ['Button', 'LinkButton', 'PrimaryButton'].includes(p.keep.name) && ['Button', 'LinkButton', 'PrimaryButton'].includes(p.drop.name)))
})

test('LinkButton and PrimaryButton are set aside: neither name holds the other\'s words and the look differs', () => {
  assert.deepEqual(pairs.dismissed.map((d) => [d.keep.name, d.drop.name, d.reason]), [['LinkButton', 'PrimaryButton', 'the names differ and the look differs, so they are different components']])
})

test('a pair with the same props and the same class names is a merge, and the more used one is kept', () => {
  const p = pair('Button', 'PrimaryButton')
  assert.equal(p.verdict, 'merge')
  assert.equal(p.keep.name, 'Button')
  assert.equal(p.lookSimilarity, 1)
  assert.equal(p.propsSimilarity, 0.75)
  assert.deepEqual(p.onlyKeep, ['variant'])
  assert.deepEqual(p.sharedProps, ['children', 'disabled', 'onClick'])
})

test('a pair with similar props and different class names goes to the decisions list', () => {
  const p = pair('Button', 'LinkButton')
  assert.equal(p.verdict, 'decide')
  assert.ok(p.lookSimilarity < 0.75)
  assert.deepEqual(p.classesOnlyDrop.sort(), ['hover:text-blue-800', 'text-blue-600', 'underline'].sort())
})

test('the list says what was compared, and the ticket has a goal, a done check, proof and a size', () => {
  const list = renderDuplicatesList(pairs)
  assert.match(list, /75% or more in common/)
  assert.match(list, /\| `Button` \(packages\/ui\/src\/Button.tsx\) \| `PrimaryButton`/)
  const merge = pairs.find((p) => p.verdict === 'merge')
  const ticket = renderTicket(merge)
  for (const heading of ['## Goal', '## What Klaus found', '## Done when', '## Proof wanted']) assert.ok(ticket.includes(heading), heading)
  assert.match(ticket, /^Size: S$/m)
  assert.match(ticket, /`Button` is kept because it is used in more places\./)
  assert.match(ticket, /Files that import `PrimaryButton`: `apps\/web\/src\/app\/page\.tsx`\./)
  assert.doesNotMatch(ticket, /Decide for each/, 'no props to decide on')
  assert.ok(ticket.split(/\s+/).length >= 120, `${ticket.split(/\s+/).length} words`)
  assert.equal(ticketFileName(merge, 1), '01-merge-primarybutton-into-button.md')
})

test('the decisions list holds only pairs that need a ruling, each with a choice to tick', () => {
  const text = renderDecisions(pairs)
  assert.equal((text.match(/^## \d+\./gm) ?? []).length, 1)
  assert.doesNotMatch(text, /PrimaryButton or Button/)
  assert.equal((text.match(/^- \[ \] Yes, replace it$/gm) ?? []).length, 1)
  assert.equal((text.match(/^- \[ \] No, keep both, because:$/gm) ?? []).length, 1)
})

test('nothing the run writes uses an em dash', () => {
  const merge = pairs.find((p) => p.verdict === 'merge')
  for (const text of [renderDuplicatesList(pairs), renderDecisions(pairs), renderTicket(merge)]) assert.equal(text.includes('\u2014'), false)
})

test('an empty result still reads as a result', () => {
  assert.match(renderDuplicatesList([]), /No likely duplicates were found/)
  assert.match(renderDecisions([]), /No pairs need a decision/)
})

test('the reason an entry is kept follows the order it was picked in', () => {
  const entry = (kind, used) => ({ kind, usedIn: new Array(used).fill('x') })
  assert.equal(keepReason(entry('shared', 0), entry('app', 5)), 'it is shared')
  assert.equal(keepReason(entry('app', 3), entry('app', 1)), 'it is used in more places')
  assert.equal(keepReason(entry('app', 1), entry('app', 1)), 'it comes first by name')
})
