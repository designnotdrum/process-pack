import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, test } from 'node:test'
import * as pictures from '../decisions-pictures.mjs'
import { renderDecisions } from '../duplicates.mjs'
import { makeDecisionsSample, planOf } from './decisions-helpers.mjs'

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7b5f6b00000000049454e44ae426082', 'hex')

let sample
let plan
before(() => {
  sample = makeDecisionsSample()
  plan = planOf(sample.repo)
  const build = path.join(sample.repo, 'storybook-static')
  fs.mkdirSync(build)
  fs.writeFileSync(path.join(build, 'iframe.html'), '<html></html>')
  fs.writeFileSync(path.join(build, 'index.json'), '{}')
})
after(() => sample.cleanup())

const story = (id, title, importPath) => ({ id, type: 'story', title, name: 'Default', importPath })
const INDEX = [story('switch--default', 'Switch', './packages/ui/src/Switch.stories.tsx'), story('badge--default', 'Badge', './packages/ui/src/Badge.stories.tsx'), story('web-badge--default', 'Web/Badge', './apps/web/src/components/Badge.stories.tsx')]
const LOOKS = {
  'switch--default': { w: 44, h: 24, bg: [37, 99, 235, 1], color: [255, 255, 255, 1], radius: 9999, borderWidth: 0, shadow: false, fontSize: 14, fontWeight: 500 },
  'badge--default': { w: 40, h: 20, bg: [37, 99, 235, 1], color: [255, 255, 255, 1], radius: 6, borderWidth: 0, shadow: false, fontSize: 12, fontWeight: 500 },
  'web-badge--default': { w: 48, h: 24, bg: [254, 226, 226, 1], color: [153, 27, 27, 1], radius: 9999, borderWidth: 0, shadow: false, fontSize: 14, fontWeight: 600 },
}

/** A browser that draws nothing: it answers with the looks above and a one-pixel PNG, and keeps what it was asked. */
function fakeBrowser({ failing = [] } = {}) {
  const log = { shown: [], sheets: [], closed: 0 }
  let current = null
  const page = {
    addStyleTag: async () => {},
    evaluate: async () => ({ look: LOOKS[current], box: { x: 0, y: 0, width: 100, height: 40 } }),
    screenshot: async () => PNG,
    setContent: async (html) => log.sheets.push(html),
    locator: () => ({ screenshot: async () => PNG }),
  }
  const storybook = {
    entries: INDEX,
    page,
    show: async (id) => {
      log.shown.push(id)
      if (failing.includes(id)) throw new Error(`The story ${id} failed to render: boom`)
      current = id
    },
    close: async () => {
      log.closed += 1
    },
  }
  return { log, open: async () => storybook }
}

const decisionPairs = () => plan.duplicates.filter((p) => p.verdict !== 'merge')
const byName = (map, name) => [...map].find(([id]) => id.includes(`#${name} +`) || id.includes(`#${name}`))?.[1]

test('both sides with a story are drawn into one picture, and the difference is measured', async () => {
  const { open, log } = fakeBrowser()
  const map = await pictures.attachDecisionPictures({ plan, storybookDir: 'storybook-static', open })
  const badge = byName(map, 'Badge')
  assert.deepEqual(badge.drawn, [true, true])
  assert.match(badge.file, /^decisions\/\d\d-badge-web-vs-ui\.png$/)
  assert.equal(Buffer.compare(badge.bytes.subarray(0, 8), PNG.subarray(0, 8)), 0, 'a PNG')
  assert.match(badge.difference, /^The web app's own Badge has a pale red background/)
  assert.match(badge.difference, /the shared UI package's Badge has a blue background/)
  const sheet = log.sheets.find((html) => html.includes('Badge'))
  assert.match(sheet, /the shared UI package's Badge \(2 places\)/)
  assert.match(sheet, /the web app's own Badge \(1 place\)/)
  assert.equal(log.closed, 1, 'the browser is closed once')
})

test('a side with no story is shown as a labelled gap beside the one that is drawn, and the reason is plain', async () => {
  const { open, log } = fakeBrowser()
  const map = await pictures.attachDecisionPictures({ plan, storybookDir: 'storybook-static', open })
  const sw = byName(map, 'Switch')
  assert.deepEqual(sw.drawn, [false, true])
  assert.deepEqual(sw.notDrawn, ["the web app's own Switch has no story", null])
  assert.equal(sw.difference, null, 'one side cannot be compared')
  assert.match(sw.file, /^decisions\/\d\d-switch-web-vs-ui\.png$/)
  assert.match(log.sheets.find((html) => html.includes('Switch')), /No story, so not drawn/)
})

test('the pictures are numbered as the decisions are', async () => {
  const { open } = fakeBrowser()
  const map = await pictures.attachDecisionPictures({ plan, storybookDir: 'storybook-static', open })
  const numbers = decisionPairs().map((p) => map.get(p.id).file.match(/^decisions\/(\d\d)-/)[1])
  assert.deepEqual(numbers, ['01', '02'])
})

test('a story that fails to draw leaves that side undrawn with the reason, and the rest carry on', async () => {
  const { open } = fakeBrowser({ failing: ['badge--default'] })
  const map = await pictures.attachDecisionPictures({ plan, storybookDir: 'storybook-static', open })
  const badge = byName(map, 'Badge')
  assert.deepEqual(badge.drawn, [true, false])
  assert.match(badge.notDrawn[1], /^the shared UI package's Badge has a story that did not draw/)
  assert.equal(byName(map, 'Switch').drawn[1], true)
})

test('a picture that cannot be put together leaves that decision without one, and the others carry on', async () => {
  const { open } = fakeBrowser()
  let sheets = 0
  const flaky = async (args) => {
    const storybook = await open(args)
    const setContent = storybook.page.setContent
    storybook.page.setContent = async (html) => {
      sheets += 1
      if (sheets === 1) throw new Error('the page crashed')
      return setContent(html)
    }
    return storybook
  }
  const map = await pictures.attachDecisionPictures({ plan, storybookDir: 'storybook-static', open: flaky })
  const reasons = [...map.values()].map((p) => p.reason)
  assert.equal(reasons.filter((r) => r === 'the picture could not be made (the page crashed)').length, 1)
  assert.equal([...map.values()].filter((p) => p.file).length, 1)
})

test('with no built Storybook nothing is drawn, and each item says why', async () => {
  let opened = 0
  const map = await pictures.attachDecisionPictures({ plan, storybookDir: 'nowhere', open: async () => (opened += 1) })
  assert.equal(opened, 0)
  for (const picture of map.values()) {
    assert.equal(picture.file, null)
    assert.match(picture.reason, /no built Storybook/)
  }
  const text = renderDecisions(plan.duplicates, map)
  assert.match(text, /No picture: no built Storybook was found/)
})

test('when the browser cannot be started, nothing is drawn and the reason names it', async () => {
  const map = await pictures.attachDecisionPictures({
    plan,
    storybookDir: 'storybook-static',
    open: async () => {
      throw new Error('Playwright is not installed in /x. Klaus reads computed styles with it.')
    },
  })
  for (const picture of map.values()) assert.match(picture.reason, /Playwright is not installed/)
})

test('the files for the first pull request are the list, the tickets and the pictures', async () => {
  const { open } = fakeBrowser()
  const map = await pictures.attachDecisionPictures({ plan, storybookDir: 'storybook-static', open })
  const files = pictures.decisionFiles({ pairs: plan.duplicates, pictures: map, docs: 'docs/klaus' })
  const rels = files.map((f) => f.rel)
  assert.ok(rels.includes('docs/klaus/decisions.md'))
  assert.deepEqual(rels.filter((r) => r.startsWith('docs/klaus/tickets/')), ['docs/klaus/tickets/01-remove-tooltip-from-web.md', 'docs/klaus/tickets/02-remove-table-from-web.md', 'docs/klaus/tickets/03-remove-card-from-ui.md'])
  const png = files.filter((f) => f.rel.endsWith('.png'))
  assert.equal(png.length, 2)
  assert.ok(Buffer.isBuffer(png[0].text))
  const md = files.find((f) => f.rel === 'docs/klaus/decisions.md').text
  for (const f of png) assert.ok(md.includes(`(${f.rel.replace('docs/klaus/', '')})`), 'each picture is embedded by a path relative to the list')
})

test('the static build is the configured one, else the one next to a Storybook config', () => {
  assert.equal(pictures.findStorybookBuild({ root: sample.repo, configured: 'storybook-static' }), path.join(fs.realpathSync(sample.repo), 'storybook-static'))
  assert.equal(pictures.findStorybookBuild({ root: sample.repo, configured: 'missing' }), null)
  assert.equal(pictures.findStorybookBuild({ root: sample.repo }), null)
})

test('a story finds its component through a barrel file, by a named, a default or a namespace import', async () => {
  const second = makeDecisionsSample()
  try {
    const src = path.join(second.repo, 'packages/ui/src')
    fs.writeFileSync(path.join(src, 'Pill.tsx'), 'export default function Pill() {\n  return <span>pill</span>\n}\n')
    fs.writeFileSync(path.join(src, 'Chip.tsx'), 'export function Chip() {\n  return <span>chip</span>\n}\n')
    fs.writeFileSync(path.join(src, 'barrel.ts'), "export { default } from './Pill'\nexport { default as PillAgain } from './Pill'\nexport * from './Chip'\n")
    fs.writeFileSync(path.join(src, 'Pill.stories.tsx'), "import Pill from './barrel'\nexport default { component: Pill }\n")
    fs.writeFileSync(path.join(src, 'PillAgain.stories.tsx'), "import { PillAgain } from './barrel'\nexport default { component: PillAgain }\n")
    fs.writeFileSync(path.join(src, 'Chip.stories.tsx'), "import { Chip } from './barrel'\nexport default { component: Chip }\n")
    fs.writeFileSync(path.join(src, 'Local.tsx'), 'export function Local() {\n  return <span>local</span>\n}\n')
    fs.writeFileSync(path.join(src, 'localbarrel.ts'), "import { Local } from './Local'\nexport { Local }\n")
    fs.writeFileSync(path.join(src, 'Local.stories.tsx'), "import { Local } from './localbarrel'\nexport default { component: Local }\n")
    fs.writeFileSync(path.join(src, 'Space.stories.tsx'), "import * as UI from './barrel'\nexport default { component: UI.Chip }\n")
    fs.writeFileSync(path.join(src, 'Held.tsx'), 'export function Held() {\n  return <span>held</span>\n}\n')
    fs.writeFileSync(path.join(src, 'heldbarrel.ts'), "import { Held } from './Held'\nexport { Held }\n")
    fs.writeFileSync(path.join(src, 'Held.stories.tsx'), "import * as UI from './heldbarrel'\nexport default { component: UI.Held }\n")
    const found = planOf(second.repo)
    const imports = pictures.storyImports({ ts: found.ts, root: found.root, tsconfigs: found.tsconfigs })
    const storiesOf = (file) => (imports.get(path.join(found.root, file)) ?? []).map((f) => path.basename(f)).sort()
    assert.deepEqual(storiesOf('packages/ui/src/Pill.tsx'), ['Pill.stories.tsx', 'PillAgain.stories.tsx', 'Space.stories.tsx'])
    assert.deepEqual(storiesOf('packages/ui/src/Held.tsx'), ['Held.stories.tsx'], 'a namespace import of a barrel that imports then exports')
    assert.deepEqual(storiesOf('packages/ui/src/Local.tsx'), ['Local.stories.tsx'], 'import then export, in the barrel')
    assert.deepEqual(storiesOf('packages/ui/src/Chip.tsx'), ['Chip.stories.tsx', 'Space.stories.tsx'], 'a namespace import reaches what the barrel re-exports')
  } finally {
    second.cleanup()
  }
})

test('one story that draws both sides cannot tell them apart, so neither is drawn alone', async () => {
  const second = makeDecisionsSample()
  try {
    const found = planOf(second.repo)
    fs.mkdirSync(path.join(second.repo, 'storybook-static'))
    fs.writeFileSync(path.join(second.repo, 'storybook-static', 'iframe.html'), '<html></html>')
    fs.writeFileSync(path.join(second.repo, 'storybook-static', 'index.json'), '{}')
    // The web app's Badge story also imports the shared Badge, and the build knows only that story.
    fs.writeFileSync(path.join(second.repo, 'apps/web/src/components/Badge.stories.tsx'), "import { Badge } from './Badge'\nimport { Badge as Shared } from '../../../../packages/ui/src/Badge'\nexport default { component: Badge }\nexport const Default = { render: () => [Badge, Shared] }\n")
    const { open } = fakeBrowser()
    const only = async (args) => ({ ...(await open(args)), entries: [INDEX[2]] })
    const map = await pictures.attachDecisionPictures({ plan: found, storybookDir: 'storybook-static', open: only })
    const badge = byName(map, 'Badge')
    assert.equal(badge.file, null)
    assert.match(badge.notDrawn[0], /the web app's own Badge and the shared UI package's Badge are drawn only together, by the one story web-badge--default/)
    const text = renderDecisions(found.duplicates, map)
    assert.match(text, /No picture: the web app's own Badge and the shared UI package's Badge are drawn only together/)
  } finally {
    second.cleanup()
  }
})

// A real browser, against a small static build written here. Set KLAUS_TEST_REPO to a repo that has
// Playwright and a browser installed, as the Figma adapter's real-build test does.
test('a real browser draws the two sides, measures them and writes one PNG', { skip: !process.env.KLAUS_TEST_REPO }, async () => {
  const build = path.join(sample.repo, 'real-build')
  fs.mkdirSync(build)
  const view = (css) => `<div style="padding:24px"><button style="${css}">On</button></div>`
  const designs = {
    'switch--default': view('background:#2563eb;color:#fff;border:0;border-radius:9999px;height:24px;padding:0 12px;font:500 14px sans-serif'),
    'badge--default': view('background:#2563eb;color:#fff;border:0;border-radius:6px;height:20px;padding:0 8px;font:500 12px sans-serif'),
    'web-badge--default': view('background:#fee2e2;color:#991b1b;border:0;border-radius:9999px;height:24px;padding:0 12px;font:600 14px sans-serif'),
  }
  fs.writeFileSync(path.join(build, 'index.json'), JSON.stringify({ v: 5, entries: Object.fromEntries(INDEX.map((e) => [e.id, e])) }))
  fs.writeFileSync(path.join(build, 'iframe.html'), `<!doctype html><body><div id="storybook-root"></div><script>const designs = ${JSON.stringify(designs)}; document.getElementById('storybook-root').innerHTML = designs[new URLSearchParams(location.search).get('id')] ?? ''</script>`)
  const { openStorybook } = await import('../../adapters/figma/capture.mjs')
  const map = await pictures.attachDecisionPictures({ plan, storybookDir: 'real-build', open: (args) => openStorybook({ ...args, root: process.env.KLAUS_TEST_REPO }) })
  const badge = byName(map, 'Badge')
  assert.deepEqual(badge.drawn, [true, true])
  assert.equal(badge.bytes.subarray(1, 4).toString(), 'PNG')
  assert.equal(badge.bytes.readUInt32BE(16), 1120, 'the sheet is 1120 pixels wide')
  assert.match(badge.difference, /^The web app's own Badge has a pale red background and red text/)
  assert.match(badge.difference, /the shared UI package's Badge has a blue background and white text/)
  assert.deepEqual(byName(map, 'Switch').drawn, [false, true])
})
