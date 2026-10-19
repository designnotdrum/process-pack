/**
 * The duplicate decisions list, read by someone who has not seen the repo. The fixture is a shared
 * package and a web app that each write a Tooltip, a Switch, a Badge, a Table and a Card.
 */
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import * as duplicates from '../duplicates.mjs'
import { makeDecisionsSample, planOf } from './decisions-helpers.mjs'

let sample
let plan
let pairs
before(() => {
  sample = makeDecisionsSample()
  plan = planOf(sample.repo)
  pairs = plan.duplicates
})
after(() => sample.cleanup())

const pairOf = (name, kind) => pairs.find((p) => [p.keep, p.drop].some((e) => e.name === name && e.kind === kind))
const decisions = () => pairs.filter((p) => p.verdict !== 'merge')
const items = (text) => text.split(/^## /m).slice(1)
/** The part of an item a reader sees without opening the details block. */
const visible = (item) => item.replace(/<details>[\s\S]*<\/details>/, '')
const withoutDetails = (text) => text.replace(/<details>[\s\S]*?<\/details>/g, '')

test('components that share only generic props are not a pair', () => {
  assert.equal(pairs.some((p) => [p.keep.name, p.drop.name].some((n) => /Provider$/.test(n))), false)
  assert.deepEqual(duplicates.GENERIC_PROPS && [...duplicates.GENERIC_PROPS].sort(), ['asChild', 'children', 'className', 'id', 'key', 'ref', 'style'])
})

test('a copy that nothing uses is settled by the data: a removal ticket, not a decision', () => {
  const p = pairOf('Tooltip', 'shared')
  assert.equal(p.verdict, 'merge', 'the run writes a ticket file for every pair with this verdict')
  assert.equal(p.ticket, 'remove')
  assert.deepEqual(p.removes, ['apps/web/src/components/Tooltip.tsx#Tooltip'])
  assert.equal(p.keep.kind, 'shared')
  assert.equal(decisions().some((d) => d.keep.name === 'Tooltip'), false)
})

test('when both copies are unused, the app copy is removed and the ticket says the other is unused too', () => {
  const p = pairOf('Table', 'shared')
  assert.equal(p.ticket, 'remove')
  assert.deepEqual(p.removes, ['apps/web/src/components/Table.tsx#Table'])
  assert.equal(p.keep.kind, 'shared')
  assert.match(duplicates.renderTicket(p), /also used nowhere/)
})

test('the unused copy is the one removed even when it is the shared one', () => {
  const p = pairOf('Card', 'shared')
  assert.equal(p.ticket, 'remove')
  assert.equal(p.keep.kind, 'app', 'the used copy stays')
  assert.deepEqual(p.removes, ['packages/ui/src/Card.tsx#Card'])
  const ticket = duplicates.renderTicket(p)
  assert.match(ticket, /shared UI package's Card/)
  assert.match(ticket, /another repo/, 'a shared copy may have users outside this repo')
})

test('only pairs where both sides are used and the look differs reach the decisions list', () => {
  assert.deepEqual(decisions().map((p) => p.keep.name).sort(), ['Badge', 'Switch'])
  const text = duplicates.renderDecisions(pairs)
  assert.equal(items(text).length, 2)
  assert.doesNotMatch(text, /Tooltip|Table|Card/)
})

test('each side is named by where it lives and how many places use it, never only by its export name', () => {
  const [badge] = items(duplicates.renderDecisions(pairs)).filter((i) => i.includes('Badge'))
  assert.match(visible(badge), /the shared UI package's Badge \(2 places\)/)
  assert.match(visible(badge), /the web app's own Badge \(1 place\)/)
  const heading = badge.split('\n')[0]
  assert.doesNotMatch(heading, /Badge or Badge/)
})

test('each decision is one question with the default stated, and the heading is the question', () => {
  const text = duplicates.renderDecisions(pairs)
  for (const item of items(text)) {
    const [heading] = item.split('\n')
    assert.match(heading, /^\d+\. Replace the web app's own (Badge|Switch) with the shared UI package's \1\?$/)
    assert.equal((visible(item).match(/\?/g) ?? []).length, 1, 'one question mark in what a reader sees')
    assert.match(item, /Default if you do not answer: yes, because the shared UI package's \w+ is used in more places \(\d+ against \d+\)/)
    assert.match(visible(item), /Yes means: the web app's own (Badge|Switch) is deleted, and the 1 place that used it uses the shared UI package's \1 instead\./)
    assert.match(item, /- \[ \] Yes, replace it/)
    assert.match(item, /- \[ \] No, keep both, because:/)
  }
})

test('class names and file paths are inside a collapsed details block only', () => {
  const text = duplicates.renderDecisions(pairs)
  for (const item of items(text)) {
    assert.match(item, /<details>\s*<summary>[^<]*class names and file paths[^<]*<\/summary>/i)
    const seen = visible(item)
    assert.doesNotMatch(seen, /apps\/web|packages\/ui|\.tsx/, 'no path outside the block')
    assert.doesNotMatch(seen, /rounded-|bg-|shadow-|px-/, 'no class name outside the block')
    assert.match(item, /<details>[\s\S]*apps\/web\/src\/components\//)
    assert.match(item, /<details>[\s\S]*(rounded-full|rounded-md)/)
  }
})

test('a decision with no picture says so in plain words and still asks', () => {
  const text = duplicates.renderDecisions(pairs)
  for (const item of items(text)) {
    assert.doesNotMatch(item, /!\[/)
    assert.match(visible(item), /^No picture: Klaus did not draw these two in this run\.$/m)
    assert.match(item, /\?/)
  }
})

test('a picture is embedded by a path relative to the decisions file, and the visible difference is one sentence', () => {
  const entries = decisions().map((p, i) => [p.id, { file: `decisions/0${i + 1}-picture.png`, drawn: [true, true], notDrawn: [null, null], difference: "The shared UI package's Badge has a blue background; the web app's own Badge has a pale red background." }])
  const text = duplicates.renderDecisions(pairs, new Map(entries))
  for (const [index, item] of items(text).entries()) {
    assert.match(item, new RegExp(`!\\[[^\\]]+\\]\\(decisions/0${index + 1}-picture\\.png\\)`))
    assert.match(visible(item), /What you can see: The shared UI package's Badge has a blue background; the web app's own Badge has a pale red background\./)
    assert.doesNotMatch(visible(item), /No picture/)
  }
})

test('a side with no story is named in plain words next to the picture of the other', () => {
  const [p] = decisions().filter((d) => d.keep.name === 'Switch')
  const text = duplicates.renderDecisions(pairs, new Map([[p.id, { file: 'decisions/02-switch.png', drawn: [false, true], notDrawn: ["the web app's own Switch has no story", null], difference: null }]]))
  const [item] = items(text).filter((i) => i.includes('Switch'))
  assert.match(visible(item), /Only one side is drawn: the web app's own Switch has no story\./)
})

test('without a picture the difference is read from the class names, and says so', () => {
  const text = duplicates.renderDecisions(pairs)
  const [switchItem] = items(text).filter((i) => i.includes('Switch'))
  assert.match(visible(switchItem), /From the class names, not from a picture: /)
})

test('the list opens with what it is, how to answer, and the counts', () => {
  const text = duplicates.renderDecisions(pairs)
  const top = text.split(/^## /m)[0]
  assert.match(top, /^# /)
  assert.match(top, /2 questions/)
  assert.match(top, /3 removal tickets/)
  assert.match(top, /Tick one box/)
  assert.match(top, /Nothing in the code changes/)
})

test('the removal ticket has a goal, what Klaus found, a done check, proof and a size, and names the place', () => {
  const p = pairOf('Tooltip', 'shared')
  const ticket = duplicates.renderTicket(p)
  for (const heading of ['## Goal', '## What Klaus found', '## Done when', '## Proof wanted']) assert.ok(ticket.includes(heading), heading)
  assert.match(ticket, /^# Delete the web app's own Tooltip$/m)
  assert.match(ticket, /^Size: S$/m)
  assert.match(ticket, /^Labels: klaus-duplicate, refactor$/m)
  assert.match(ticket, /used in no place/)
  assert.match(ticket, /Search the repo for the name once more/)
  assert.match(ticket, /The shared UI package's Tooltip \(2 places\) is the copy that stays/)
  assert.doesNotMatch(ticket, /Replace .* with /)
  assert.ok(ticket.split(/\s+/).length >= 120, `${ticket.split(/\s+/).length} words`)
  assert.equal(duplicates.ticketFileName(p, 1), '01-remove-tooltip-from-web.md')
})

test('the merge ticket of a same-looking pair is unchanged', () => {
  const merge = { ...pairOf('Tooltip', 'shared'), ticket: 'merge', removes: [] }
  assert.equal(duplicates.ticketFileName(merge, 2), '02-merge-tooltip-into-tooltip.md')
})

test('what happens to each pair, and the counts the summary uses', () => {
  assert.deepEqual(pairs.map((p) => duplicates.whatHappens?.(p)).sort(), ['decisions list', 'decisions list', 'removal ticket', 'removal ticket', 'removal ticket'])
  assert.deepEqual(duplicates.countDuplicates?.(pairs), { pairs: 5, tickets: 3, merges: 0, removals: 3, decisions: 2 })
})

test('the list of all pairs says what happens to each, in words', () => {
  const list = duplicates.renderDuplicatesList(pairs)
  assert.match(list, /one copy is used nowhere: a removal ticket/)
  assert.match(list, /different look: on the decisions list/)
  assert.match(list, /children, className/, 'the generic props are named')
})

test('nothing the run writes uses an em dash or claims an accessibility effect', () => {
  const removal = pairOf('Tooltip', 'shared')
  const all = [duplicates.renderDuplicatesList(pairs), duplicates.renderDecisions(pairs), duplicates.renderTicket(removal), duplicates.renderTicket(pairOf('Card', 'shared'))]
  for (const text of all) {
    assert.equal(text.includes('\u2014'), false)
    assert.doesNotMatch(withoutDetails(text), /accessib|WCAG|contrast|screen reader|keyboard/i)
  }
})

test('when every pair is set aside, duplicates.md still lists them with their reasons', () => {
  const none = Object.assign([], { dismissed: [{ id: 'x', keep: entry('A', 'app', 'apps/web/app', 1), drop: entry('B', 'app', 'apps/web/app', 1), reason: 'the names differ and the look differs, so they are different components' }] })
  const list = duplicates.renderDuplicatesList(none)
  assert.doesNotMatch(list, /No likely duplicates were found/)
  assert.match(list, /No pair needs a ticket or a question\./)
  assert.match(list, /## Set aside: not asked about[\s\S]*`A` \(apps\/web\/app\/A\.tsx\) \| `B` \(apps\/web\/app\/B\.tsx\) \| the names differ/)
})

test('an empty result still reads as a result', () => {
  assert.match(duplicates.renderDecisions([]), /No pairs need a decision/)
})

// ---- pairs built by hand, for wording that the fixture does not reach

const entry = (name, kind, folder, used, extra = {}) => ({ name, kind, folder, file: `${folder}/${name}.tsx`, usedIn: new Array(used).fill('x.tsx'), props: [], ...extra })
const handmade = (keep, drop, extra = {}) => ({ id: `${keep.file}#${keep.name} + ${drop.file}#${drop.name}`, keep, drop, reasons: ['both are a node'], propsSimilarity: 0.8, sharedProps: [], onlyKeep: [], onlyDrop: [], lookSimilarity: 0.3, classesOnlyKeep: [], classesOnlyDrop: [], verdict: 'decide', ticket: null, removes: [], alsoSimilarTo: [], lookNote: null, ...extra })

test('two different components in the same place are named in full once, then by name', () => {
  const pair = handmade(entry('HypothesisCardNode', 'app', 'apps/web/app', 2), entry('InsightCardNode', 'app', 'apps/web/app', 1))
  const [item] = items(duplicates.renderDecisions([pair]))
  assert.match(item.split('\n')[0], /^1\. Replace the web app's InsightCardNode with HypothesisCardNode\?$/)
  assert.match(visible(item), /- Left, would be replaced: the web app's InsightCardNode \(1 place\)\./)
  assert.match(visible(item), /- Right, would stay: the web app's HypothesisCardNode \(2 places\)\./)
  assert.match(visible(item), /Yes means: the web app's InsightCardNode is deleted, and the 1 place that used it uses HypothesisCardNode instead\./)
  assert.match(visible(item), /Default if you do not answer: no, keep both, because the two have different names, so they may be different things\./)
})

test('two pairs with the same name and the same place are told apart by the folder they are in', () => {
  const pair = handmade(entry('Breadcrumb', 'app', 'apps/web/app', 2, { file: 'apps/web/app/layouts/Breadcrumb.tsx' }), entry('Breadcrumb', 'app', 'apps/web/app', 1, { file: 'apps/web/app/projects/Breadcrumb.tsx' }))
  const [item] = items(duplicates.renderDecisions([pair]))
  assert.match(item.split('\n')[0], /^1\. Replace the web app's own Breadcrumb \(in projects\) with the web app's own Breadcrumb \(in layouts\)\?$/)
})

test('equal use decides by what is shared, and with nothing to go on the default is to keep both', () => {
  const shared = handmade(entry('Badge', 'shared', 'packages/ui/src', 2), entry('Badge', 'app', 'apps/web/src', 2))
  assert.match(duplicates.renderDecisions([shared]), /Default if you do not answer: yes, because the shared UI package's Badge is the shared one, so other code is meant to reuse it\./)
  const neither = handmade(entry('Badge', 'app', 'apps/web/src', 2), entry('Badge', 'app', 'apps/web/src', 2, { file: 'apps/web/src/other/Badge.tsx' }))
  assert.match(duplicates.renderDecisions([neither]), /Default if you do not answer: no, keep both, because neither is used in more places than the other\./)
})

test('without a picture, a component that writes many class names gets no guessed sentence', () => {
  const pair = handmade(entry('A', 'app', 'apps/web/app', 1), entry('B', 'app', 'apps/web/app', 1))
  const [item] = items(duplicates.renderDecisions([pair]))
  assert.match(visible(item), /What differs on screen is not known: there is no picture, and the two write too many class names to read it from them\./)
  const half = { file: 'decisions/01-b-vs-a.png', bytes: null, drawn: [false, true], notDrawn: ["the web app's B has no story", null], difference: null, reason: null }
  assert.match(visible(items(duplicates.renderDecisions([pair], new Map([[pair.id, half]])))[0]), /What differs on screen is not known: only one side is drawn, and/)
  assert.doesNotMatch(visible(item), /From the class names/)
})

test('with no story on either side the picture line is short', () => {
  const pair = handmade(entry('A', 'app', 'apps/web/app', 1), entry('B', 'app', 'apps/web/app', 1))
  const picture = { file: null, bytes: null, drawn: [false, false], notDrawn: ["the web app's A has no story", "the web app's B has no story"], difference: null, reason: null }
  assert.match(visible(items(duplicates.renderDecisions([pair], new Map([[pair.id, picture]])))[0]), /^No picture: neither has a story\.$/m)
})

test('a class-name sentence is read only from a component that writes few class names', () => {
  const [switchPair] = decisions().filter((d) => d.keep.name === 'Switch')
  assert.match(switchPair.lookNote, /^The web app's own Switch has a white background/)
  const many = pairs.find((p) => p.lookNote === null && p.verdict === 'decide')
  assert.equal(many, undefined, 'the fixture components all write few class names')
})

test('several pairs against the same unused copy give one removal ticket, and the others are folded into it', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const second = makeDecisionsSample()
  try {
    for (const name of ['Email', 'Password', 'Session']) {
      fs.writeFileSync(path.join(second.repo, 'apps/web/src/components', `${name}Panel.tsx`), `export function ${name}Panel({ isEditing }: { isEditing: boolean }) {\n  return <section className="p-4">{String(isEditing)}</section>\n}\n`)
    }
    const found = planOf(second.repo).duplicates.filter((p) => p.keep.name.endsWith('Panel'))
    assert.equal(found.length, 2, 'three pairs, one folded away')
    assert.deepEqual(found.map((p) => p.removes[0].split('#')[1]).sort(), ['PasswordPanel', 'SessionPanel'])
    const folded = found.find((p) => p.drop.name === 'SessionPanel')
    assert.deepEqual(folded.alsoSimilarTo, ['PasswordPanel'])
    assert.match(duplicates.renderTicket(folded), /Klaus also listed it against `PasswordPanel` as separate pairs\. They are folded into this ticket\./)
    assert.match(duplicates.renderTicket(found[0]), /It is also used nowhere/)
  } finally {
    second.cleanup()
  }
})

test('different components with similar props are not asked about, but a variant of a name is', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const second = makeDecisionsSample()
  try {
    const components = path.join(second.repo, 'apps/web/src/components')
    const card = (name, classes) => `export function ${name}({ data, selected }: { data: string; selected?: boolean }) {\n  return <div className="${classes}" data-selected={selected}>{data}</div>\n}\n`
    fs.writeFileSync(path.join(components, 'InsightCard.tsx'), card('InsightCard', 'rounded bg-sky-100 px-2 text-sky-700'))
    fs.writeFileSync(path.join(components, 'HypothesisCard.tsx'), card('HypothesisCard', 'rounded-full border bg-white px-4 py-2'))
    fs.writeFileSync(path.join(components, 'PrimaryCard.tsx'), card('PrimaryCard', 'shadow-lg bg-gray-900 text-white'))
    fs.mkdirSync(path.join(second.repo, 'apps/web/src/app/cards'))
    fs.writeFileSync(path.join(second.repo, 'apps/web/src/app/cards/page.tsx'), "import { HypothesisCard } from '@/components/HypothesisCard'\nimport { InsightCard } from '@/components/InsightCard'\nimport { PrimaryCard } from '@/components/PrimaryCard'\n\nexport default function CardsPage() {\n  return [HypothesisCard, InsightCard, PrimaryCard]\n}\n")
    fs.writeFileSync(path.join(components, 'Card.tsx'), card('Card', 'rounded border bg-white'))
    fs.writeFileSync(path.join(components, 'WrappedCard.tsx'), "import { Card } from './Card'\n\nexport function WrappedCard({ data, selected }: { data: string; selected?: boolean }) {\n  return <Card data={data} selected={selected} />\n}\n")
    fs.mkdirSync(path.join(second.repo, 'apps/web/src/app/more'))
    fs.writeFileSync(path.join(second.repo, 'apps/web/src/app/more/page.tsx'), "import { Card } from '@/components/Card'\nimport { WrappedCard } from '@/components/WrappedCard'\n\nexport default function MorePage() {\n  return [Card, WrappedCard]\n}\n")
    const found = planOf(second.repo).duplicates
    const names = (p) => [p.keep.name, p.drop.name].sort().join('+')
    assert.equal(found.some((p) => names(p) === 'HypothesisCard+InsightCard'), false, 'Insight and Hypothesis are different things')
    assert.equal(found.some((p) => names(p) === 'HypothesisCard+PrimaryCard'), false)
    assert.ok(found.some((p) => p.verdict === 'decide' && names(p) === 'Card+PrimaryCard'), 'PrimaryCard holds the words of Card, so it may be a variant of it')
    assert.equal(found.some((p) => names(p) === 'Card+WrappedCard'), false, 'WrappedCard is built on Card')
    const reasons = Object.fromEntries(found.dismissed.map((d) => [[d.keep.name, d.drop.name].sort().join('+'), d.reason]))
    assert.equal(reasons['Card+WrappedCard'], "the web app's WrappedCard is built on Card")
    assert.equal(reasons['HypothesisCard+InsightCard'], 'the names differ and the look differs, so they are different components')
    assert.match(duplicates.renderDuplicatesList(found), /## Set aside: not asked about[\s\S]*`WrappedCard` \(apps\/web\/src\/components\/WrappedCard\.tsx\) \| the web app's WrappedCard is built on Card/)
    assert.match(duplicates.renderDecisions(found), /It set aside \d+ pairs as different components, such as one built on the other\. They are listed with the reason at the end of duplicates\.md\./)
    assert.equal(JSON.stringify(found).includes('built on'), false, 'duplicates.json holds only the pairs')
    const all = planOf(second.repo, { setAside: false })
    assert.equal(all.duplicates.dismissed.length, 0)
    assert.ok(all.duplicates.some((p) => p.verdict === 'decide' && names(p) === 'HypothesisCard+InsightCard'), 'asking about everything keeps the pairs that were set aside')
    assert.ok(all.duplicates.some((p) => p.verdict !== 'merge' && names(p) === 'Card+WrappedCard'))
  } finally {
    second.cleanup()
  }
})

test('a copy built on the other is not counted among the other\'s users', () => {
  const keep = entry('Sidebar', 'shared', 'packages/ui/src', 2, { usedIn: ['apps/web/app/AppWrapper.tsx', 'apps/web/app/Sidebar.tsx'] })
  const drop = entry('Sidebar', 'app', 'apps/web/app', 1, { file: 'apps/web/app/Sidebar.tsx', usedIn: ['/ (layout)'] })
  const [item] = items(duplicates.renderDecisions([handmade(keep, drop)]))
  assert.match(visible(item), /- Right, would stay: the shared UI package's Sidebar \(1 place\)\./)
  assert.match(visible(item), /Default if you do not answer: yes, because the shared UI package's Sidebar is the shared one, so other code is meant to reuse it\./)
  assert.doesNotMatch(visible(item), /used in more places/, 'one user against one is not more')
})

test('the list says what Klaus and a story are, once, before the first question', () => {
  const text = duplicates.renderDecisions(pairs)
  assert.match(text.split(/^## /m)[0], /Klaus is the tool that keeps the list of this repo's components\. It draws a component from its story, a Storybook example page for that one component\./)
})

test('a wrapper is found by the file it imports, under any local name and through a barrel file', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const second = makeDecisionsSample()
  try {
    const components = path.join(second.repo, 'apps/web/src/components')
    const tile = (name, classes, body = '<div className="' + classes + '">{data}</div>') => `export function ${name}({ data, selected }: { data: string; selected?: boolean }) {\n  return ${body}\n}\n`
    fs.writeFileSync(path.join(components, 'Base.tsx'), 'export default function BaseTile({ data, selected }: { data: string; selected?: boolean }) {\n  return <div className="rounded border bg-white" data-selected={selected}>{data}</div>\n}\n')
    fs.writeFileSync(path.join(components, 'index.ts'), "import BaseTile from './Base'\nexport { BaseTile }\n")
    fs.writeFileSync(path.join(components, 'FancyBaseTile.tsx'), "import Anything from './Base'\n\n" + tile('FancyBaseTile', 'shadow-lg', '<Anything data={data} selected={selected} />'))
    fs.writeFileSync(path.join(components, 'BigBaseTile.tsx'), "import { BaseTile as Thing } from './index'\n\n" + tile('BigBaseTile', 'shadow-lg', '<Thing data={data} selected={selected} />'))
    fs.mkdirSync(path.join(second.repo, 'apps/web/src/app/tiles'))
    fs.writeFileSync(path.join(second.repo, 'apps/web/src/app/tiles/page.tsx'), "import BaseTile from '@/components/Base'\nimport { FancyBaseTile } from '@/components/FancyBaseTile'\nimport { BigBaseTile } from '@/components/BigBaseTile'\n\nexport default function TilesPage() {\n  return [BaseTile, FancyBaseTile, BigBaseTile]\n}\n")
    const found = planOf(second.repo).duplicates
    const reasons = found.dismissed.map((d) => d.reason)
    assert.ok(reasons.includes("the web app's FancyBaseTile is built on BaseTile"), reasons.join(' | '))
    assert.ok(reasons.includes("the web app's BigBaseTile is built on BaseTile"), reasons.join(' | '))
    assert.equal(found.some((p) => [p.keep.name, p.drop.name].includes('BaseTile')), false, 'neither wrapper is asked about against what it is built on')
    // The two wrappers write no class names, so their look cannot be compared. That is not evidence that they differ, so it stays a question.
    const wrappers = found.find((p) => [p.keep.name, p.drop.name].sort().join('+') === 'BigBaseTile+FancyBaseTile')
    assert.equal(wrappers?.verdict, 'decide-look-unknown')
  } finally {
    second.cleanup()
  }
})

test('the pull request summary says when every pair found was set aside', async () => {
  const { listBody } = await import('../bodies.mjs')
  const none = Object.assign([], { dismissed: [{ id: 'x', keep: entry('A', 'app', 'apps/web/app', 1), drop: entry('B', 'app', 'apps/web/app', 1), reason: 'the names differ and the look differs, so they are different components' }] })
  const state = { plan: { inventory: plan.inventory, duplicates: none }, estimate: { duplicates: { pairs: 0, tickets: 0, removals: 0, decisions: 0 } }, docsDir: 'docs/klaus', prs: [] }
  assert.match(listBody(state), /No pair needs a ticket or a question\. 1 was set aside as different components, and `docs\/klaus\/duplicates\.md` lists it with the reason\./)
  assert.doesNotMatch(listBody(state), /None were found/)
  const nothing = { ...state, plan: { ...state.plan, duplicates: [] } }
  assert.match(listBody(nothing), /None were found\./)
})

test('a same-looking pair is a merge ticket only when neither is built on the other', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const second = makeDecisionsSample()
  try {
    const components = path.join(second.repo, 'apps/web/src/components')
    const body = (name, inner) => `export function ${name}({ data, selected }: { data: string; selected?: boolean }) {\n  return ${inner}\n}\n`
    fs.writeFileSync(path.join(components, 'Sheet.tsx'), body('Sheet', '<div className="rounded border bg-white">{data}</div>'))
    fs.writeFileSync(path.join(components, 'WideSheet.tsx'), `import { Sheet } from './Sheet'\n\n${body('WideSheet', '<div className="rounded border bg-white"><Sheet data={data} selected={selected} /></div>')}`)
    fs.writeFileSync(path.join(components, 'Plain.tsx'), body('PlainSheet', '<div className="rounded border bg-white">{data}</div>'))
    fs.mkdirSync(path.join(second.repo, 'apps/web/src/app/sheets'))
    fs.writeFileSync(path.join(second.repo, 'apps/web/src/app/sheets/page.tsx'), "import { Sheet } from '@/components/Sheet'\nimport { WideSheet } from '@/components/WideSheet'\nimport { PlainSheet } from '@/components/Plain'\n\nexport default function SheetsPage() {\n  return [Sheet, WideSheet, PlainSheet]\n}\n")
    const found = planOf(second.repo).duplicates
    const names = (p) => [p.keep.name, p.drop.name].sort().join('+')
    assert.ok(found.dismissed.some((d) => d.reason === "the web app's WideSheet is built on Sheet"), 'identical class names do not hide that one wraps the other')
    assert.equal(found.some((p) => names(p) === 'Sheet+WideSheet'), false)
    assert.ok(found.some((p) => names(p) === 'PlainSheet+Sheet' && p.ticket === 'merge'), 'a pair that is not built on each other is still a merge ticket')
  } finally {
    second.cleanup()
  }
})

test('an import from a package outside this repo that has the same name is not a wrapper', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const second = makeDecisionsSample()
  try {
    const components = path.join(second.repo, 'apps/web/src/components')
    const body = (name, inner) => `export function ${name}({ data, selected }: { data: string; selected?: boolean }) {\n  return ${inner}\n}\n`
    fs.writeFileSync(path.join(components, 'Frame.tsx'), body('Frame', '<div className="rounded border bg-white">{data}</div>'))
    fs.writeFileSync(path.join(components, 'WideFrame.tsx'), `import { Frame } from '@vendor/ui'\n\n${body('WideFrame', '<div className="shadow-lg"><Frame /></div>')}`)
    fs.mkdirSync(path.join(second.repo, 'apps/web/src/app/frames'))
    fs.writeFileSync(path.join(second.repo, 'apps/web/src/app/frames/page.tsx'), "import { Frame } from '@/components/Frame'\nimport { WideFrame } from '@/components/WideFrame'\n\nexport default function FramesPage() {\n  return [Frame, WideFrame]\n}\n")
    const found = planOf(second.repo).duplicates
    assert.equal(found.dismissed.some((d) => d.reason.includes('built on')), false)
    assert.ok(found.some((p) => [p.keep.name, p.drop.name].sort().join('+') === 'Frame+WideFrame' && p.verdict === 'decide'))
  } finally {
    second.cleanup()
  }
})

test('an import from another package of this repo does not make a wrapper of a same-named component', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const second = makeDecisionsSample()
  try {
    const components = path.join(second.repo, 'apps/web/src/components')
    const body = (name, inner) => `export function ${name}({ data, selected }: { data: string; selected?: boolean }) {\n  return ${inner}\n}\n`
    fs.writeFileSync(path.join(components, 'Crate.tsx'), body('Crate', '<div className="rounded border bg-white">{data}</div>'))
    // The wrapper takes a Crate from the shared package, not the app's own.
    fs.writeFileSync(path.join(components, 'WideCrate.tsx'), `import { Crate } from '@sample/ui'\n\n${body('WideCrate', '<div className="shadow-lg"><Crate /></div>')}`)
    fs.mkdirSync(path.join(second.repo, 'apps/web/src/app/crates'))
    fs.writeFileSync(path.join(second.repo, 'apps/web/src/app/crates/page.tsx'), "import { Crate } from '@/components/Crate'\nimport { WideCrate } from '@/components/WideCrate'\n\nexport default function CratesPage() {\n  return [Crate, WideCrate]\n}\n")
    const found = planOf(second.repo).duplicates
    assert.equal(found.dismissed.some((d) => d.reason.includes('built on')), false)
    assert.ok(found.some((p) => [p.keep.name, p.drop.name].sort().join('+') === 'Crate+WideCrate' && p.verdict === 'decide'))
  } finally {
    second.cleanup()
  }
})

test('a namespace import of a barrel makes a wrapper when the file uses the component through it', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const second = makeDecisionsSample()
  try {
    const components = path.join(second.repo, 'apps/web/src/components')
    const body = (name, inner) => `export function ${name}({ data, selected }: { data: string; selected?: boolean }) {\n  return ${inner}\n}\n`
    fs.writeFileSync(path.join(components, 'Slab.tsx'), body('Slab', '<div className="rounded border bg-white">{data}</div>'))
    fs.writeFileSync(path.join(components, 'index.ts'), "export * from './Slab'\n")
    fs.writeFileSync(path.join(components, 'WideSlab.tsx'), `import * as UI from './index'\n\n${body('WideSlab', '<div className="rounded border bg-white"><UI.Slab data={data} selected={selected} /></div>')}`)
    fs.writeFileSync(path.join(components, 'OtherSlab.tsx'), `import * as UI from './index'\n\n${body('OtherSlab', '<div className="rounded border bg-white">{String(UI)}</div>')}`)
    fs.mkdirSync(path.join(second.repo, 'apps/web/src/app/slabs'))
    fs.writeFileSync(path.join(second.repo, 'apps/web/src/app/slabs/page.tsx'), "import { Slab } from '@/components/Slab'\nimport { WideSlab } from '@/components/WideSlab'\nimport { OtherSlab } from '@/components/OtherSlab'\n\nexport default function SlabsPage() {\n  return [Slab, WideSlab, OtherSlab]\n}\n")
    const found = planOf(second.repo).duplicates
    const reasons = found.dismissed.map((d) => d.reason)
    assert.ok(reasons.includes("the web app's WideSlab is built on Slab"), reasons.join(' | '))
    assert.equal(reasons.includes("the web app's OtherSlab is built on Slab"), false, 'it imports the barrel but never uses Slab')
    assert.ok(found.some((p) => [p.keep.name, p.drop.name].sort().join('+') === 'OtherSlab+Slab' && p.ticket === 'merge'))
  } finally {
    second.cleanup()
  }
})

test('an import of a package of this repo that resolves to source is followed, so a same-named component elsewhere in the package is not a wrapper target', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const second = makeDecisionsSample()
  try {
    const tsconfig = JSON.parse(fs.readFileSync(path.join(second.repo, 'tsconfig.json'), 'utf8'))
    tsconfig.compilerOptions.paths['@sample/ui'] = ['./packages/ui/src/index.ts']
    fs.writeFileSync(path.join(second.repo, 'tsconfig.json'), JSON.stringify(tsconfig))
    const body = (name, classes) => `export function ${name}({ data, selected }: { data: string; selected?: boolean }) {\n  return <div className="${classes}" data-selected={selected}>{data}</div>\n}\n`
    const ui = path.join(second.repo, 'packages/ui/src')
    fs.mkdirSync(path.join(ui, 'legacy'))
    fs.writeFileSync(path.join(ui, 'Crate.tsx'), body('Crate', 'rounded border bg-white'))
    fs.writeFileSync(path.join(ui, 'legacy/Crate.tsx'), body('Crate', 'shadow-lg bg-gray-900'))
    fs.appendFileSync(path.join(ui, 'index.ts'), "export { Crate } from './Crate'\n")
    fs.writeFileSync(path.join(second.repo, 'apps/web/src/components/WideCrate.tsx'), `import { Crate } from '@sample/ui'\n\n${body('WideCrate', 'rounded-xl bg-red-100').replace('{data}</div>', '<Crate data={data} /></div>')}`)
    fs.mkdirSync(path.join(second.repo, 'apps/web/src/app/crates'))
    fs.writeFileSync(path.join(second.repo, 'apps/web/src/app/crates/page.tsx'), "import { Crate as Old } from '../../../../../packages/ui/src/legacy/Crate'\nimport { WideCrate } from '@/components/WideCrate'\n\nexport default function CratesPage() {\n  return [Old, WideCrate]\n}\n")
    const found = planOf(second.repo).duplicates
    const reasons = found.dismissed.map((d) => d.reason)
    assert.ok(reasons.some((r) => r === "the web app's WideCrate is built on the shared UI package's Crate"), reasons.join(' | '))
    // The wrapper does not import the legacy Crate, so that pair is still a question.
    assert.ok(found.some((p) => p.verdict === 'decide' && [p.keep.file, p.drop.file].includes('packages/ui/src/legacy/Crate.tsx') && [p.keep.name, p.drop.name].includes('WideCrate')), 'the legacy Crate and the wrapper')
  } finally {
    second.cleanup()
  }
})
