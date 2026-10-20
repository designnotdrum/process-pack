import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { loadTypeScript } from '../../inventory/components.mjs'
import { writeJsonFile } from '../../frame/json-file.mjs'
import { buildInventory } from '../../inventory/inventory.mjs'
import { createTsconfigLoader } from '../../inventory/tsconfig.mjs'
import { readOnboardingConfig } from '../config.mjs'
import { buildEstimate, renderEstimate } from '../estimate.mjs'
import { buildPlan } from '../plan.mjs'
import { BRANCHES, runOnboarding, workFolder } from '../run.mjs'
import { planStories, renderStory } from '../stories.mjs'
import { makeGitStoriesSample, makeStoriesSample, STUBS } from './helpers.mjs'

const NO_STORYBOOK = 'no Storybook in this repo loads stories from this folder'

let sample
beforeEach(() => {
  sample = makeStoriesSample()
})
afterEach(() => sample.cleanup())

function plan(repo = sample.repo) {
  const root = fs.realpathSync(repo)
  const { folders } = readOnboardingConfig(root)
  const inventory = buildInventory({ root, folders })
  const ts = loadTypeScript(root)
  return { ts, root, inventory, stories: planStories({ ts, root, tsconfigs: createTsconfigLoader(ts, root), inventory }) }
}
const byName = (stories, name) => stories.items.find((i) => i.name === name)

/** The compiler's errors for a package, read from its tsconfig as `tsc -p` reads it, with the story files on disk. */
function errorsOf(ts, tsconfig) {
  const config = ts.getParsedCommandLineOfConfigFile(tsconfig, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} })
  const program = ts.createProgram({ rootNames: config.fileNames, options: config.options })
  return ts.getPreEmitDiagnostics(program).filter((d) => d.category === ts.DiagnosticCategory.Error).map((d) => `${d.file ? path.basename(d.file.fileName) : ''}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`)
}

/** Every file in the repo but node_modules, with its text, so a test can tell that nothing was written. */
function snapshot(repo) {
  const found = {}
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) visit(full)
      else found[path.relative(repo, full)] = fs.readFileSync(full, 'utf8')
    }
  }
  visit(repo)
  return found
}

const storyText = (inventory, item) => renderStory({ entry: inventory.entries.find((e) => e.name === item.name), importPath: item.importPath, isDefault: item.isDefault, framework: item.framework, typed: item.typed, args: item.args, spy: item.spy })

/** Writes every story the plan would write beside its component, as the run does. */
function writeStoriesOf({ inventory, stories }) {
  for (const item of stories.items.filter((i) => i.status === 'write')) fs.writeFileSync(path.join(sample.repo, item.storyFile), storyText(inventory, item))
}

/**
 * A Storybook test package in the fixture's node_modules, with only the `fn` that stories use:
 * `storybook/test` as Storybook 9 and later ship it, or `@storybook/test` as Storybook 8 does.
 */
function installTestPackage(spec) {
  const nine = spec === 'storybook/test'
  const dir = path.join(sample.repo, 'node_modules', ...(nine ? ['storybook'] : ['@storybook', 'test']))
  fs.mkdirSync(dir, { recursive: true })
  const pkg = nine ? { name: 'storybook', version: '9.0.0', exports: { './test': { types: './test.d.ts' } } } : { name: '@storybook/test', version: '8.6.0', types: './index.d.ts' }
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg))
  fs.writeFileSync(path.join(dir, nine ? 'test.d.ts' : 'index.d.ts'), 'type Procedure = (...args: any[]) => any\nexport declare function fn<T extends Procedure = Procedure>(implementation?: T): T & { mock: { calls: unknown[][] } }\n')
}

// Lint flags an empty function (no-empty-function), and an async function with nothing to await (require-await).
const EMPTY_FUNCTION = /=>\s*\{\s*\}/
const ASYNC_WITH_NO_AWAIT = /async \(\) => (?!\{[^}]*await)/

test('a sync and an async function prop each get a handler with a body, never an empty function, and the story compiles', () => {
  const { ts, inventory, stories } = plan()
  const field = byName(stories, 'AsyncField')
  assert.equal(field.status, 'write')
  const text = storyText(inventory, field)
  assert.doesNotMatch(text, EMPTY_FUNCTION)
  assert.doesNotMatch(text, ASYNC_WITH_NO_AWAIT)
  assert.equal(field.spy, null, 'the fixture has no Storybook test package')
  assert.match(text, /onChange: \(\) => \{ \/\* Nothing happens in a story\. \*\/ \}/)
  assert.match(text, /onSave: \(\) => Promise\.resolve\(\)/)
  assert.match(text, /load: \(\) => Promise\.resolve\(\[\]\)/)
  assert.match(text, /format: \(\) => 'Sample'/)
  assert.doesNotMatch(text, /\bfn\b/)

  // Written for real beside the component, the whole package compiles as `tsc -p` would read it.
  writeStoriesOf({ inventory, stories })
  assert.deepEqual(errorsOf(ts, path.join(sample.repo, 'packages/ui/tsconfig.json')), [])
})

for (const spec of ['storybook/test', '@storybook/test']) {
  test(`with ${spec} in the repo, a handler is Storybook's fn(), and the story compiles`, () => {
    installTestPackage(spec)
    const { ts, inventory, stories } = plan()
    const field = byName(stories, 'AsyncField')
    assert.equal(field.status, 'write')
    assert.equal(field.spy, spec)
    const text = storyText(inventory, field)
    assert.match(text, new RegExp(`^import type \\{ Meta, StoryObj \\} from '@storybook/react'\\nimport \\{ fn \\} from '${spec}'\\nimport \\{ AsyncField \\} from '\\./AsyncField'\\n`))
    assert.match(text, /onChange: fn\(\)/)
    assert.match(text, /onSave: fn\(\(\) => Promise\.resolve\(\)\)/)
    // A function that computes a value stays a plain function, so the value keeps the type the prop asks for.
    assert.match(text, /load: \(\) => Promise\.resolve\(\[\]\)/)
    assert.match(text, /format: \(\) => 'Sample'/)
    assert.doesNotMatch(text, EMPTY_FUNCTION)
    assert.doesNotMatch(text, ASYNC_WITH_NO_AWAIT)
    // A story with no function to fill imports no fn.
    assert.doesNotMatch(storyText(inventory, byName(stories, 'Badge')), /\bfn\b/)

    writeStoriesOf({ inventory, stories })
    assert.deepEqual(errorsOf(ts, path.join(sample.repo, 'packages/ui/tsconfig.json')), [])
  })
}

test('a story in a separate stories folder that imports the component through nested index files counts, and no second story is written', () => {
  const src = path.join(sample.repo, 'packages/ui/src')
  fs.mkdirSync(path.join(src, 'components/forms'), { recursive: true })
  fs.mkdirSync(path.join(src, 'stories/forms'), { recursive: true })
  for (const name of ['Tray', 'Shelf']) fs.writeFileSync(path.join(src, `components/forms/${name}.tsx`), `export interface ${name}Props {\n  label: string\n}\n\nexport function ${name}({ label }: ${name}Props) {\n  return <span>{label}</span>\n}\n`)
  fs.writeFileSync(path.join(src, 'components/forms/index.ts'), "export * from './Tray'\nexport * from './Shelf'\n")
  fs.writeFileSync(path.join(src, 'components/index.ts'), "export * from './forms'\n")
  // `../../components` is a folder, so it resolves to its index file, which re-exports the index of a sub-folder.
  fs.writeFileSync(path.join(src, 'stories/forms/Tray.stories.tsx'), "import { Tray } from '../../components'\n\nexport default { component: Tray }\n")
  // A story that draws a screen from a namespace import is not a story of every part the barrel re-exports.
  fs.writeFileSync(path.join(src, 'stories/Screen.stories.tsx'), "import * as UI from '../components'\n\nexport default { component: UI.Shelf }\n")

  let { stories } = plan()
  assert.equal(byName(stories, 'Tray').status, 'exists')
  assert.equal(stories.items.some((i) => i.storyFile === 'packages/ui/src/components/forms/Tray.stories.tsx'), false, 'no second story for Tray')
  assert.equal(byName(stories, 'Shelf').status, 'write')

  // A namespace import counts for the component the story file is named for.
  fs.writeFileSync(path.join(src, 'stories/forms/Shelf.stories.tsx'), "import * as UI from '../../components'\n\nexport default { component: UI.Shelf }\n")
  ;({ stories } = plan())
  assert.equal(byName(stories, 'Shelf').status, 'exists')
})

test('the fixture reproduces the bug: a plain () => {} for a promise callback does not compile', () => {
  const { ts, stories } = plan()
  const field = byName(stories, 'AsyncField')
  const old = `import type { Meta, StoryObj } from '@storybook/react'
import { AsyncField } from './AsyncField'

const meta = {
  component: AsyncField,
  args: { ${field.args.map(([name, value]) => `${name}: ${name === 'onSave' ? '() => {}' : value}`).join(', ')} },
} satisfies Meta<typeof AsyncField>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
`
  fs.writeFileSync(path.join(sample.repo, 'packages/ui/src/AsyncField.stories.tsx'), old)
  const errors = errorsOf(ts, path.join(sample.repo, 'packages/ui/tsconfig.json'))
  assert.ok(errors.some((e) => /AsyncField.stories.tsx: .*'\(\) => void' is not assignable to type '\(value: string\) => Promise<void>'/.test(e)), errors.join('\n'))
})

test('a component with a required prop that a library declares is left for a person, not written with an empty story', () => {
  const { stories } = plan()
  const node = byName(stories, 'FlowNode')
  assert.equal(node.status, 'skipped')
  assert.equal(node.cause, 'needs-value')
  assert.match(node.reason, /the required prop data has the type `\{ label: string; \}`, and Klaus will not invent a value for it \(it is declared in @flow\/lib/)
  assert.equal(node.storyFile, undefined)
})

test('a story with a type error the plan cannot foresee is caught by the compiler and moved, with the compiler\'s message', () => {
  const { stories } = plan()
  const notice = byName(stories, 'Notice')
  assert.equal(notice.status, 'skipped')
  assert.equal(notice.cause, 'does-not-compile')
  assert.match(notice.reason, /does not type-check/)
  assert.match(notice.reason, /TS2322: Type '\{\}' is not assignable to type/)
  assert.match(notice.reason, /Property 'args' is missing/)
  assert.match(notice.reason, /checked with the tsconfig at packages\/ui\/tsconfig\.json/)
  assert.doesNotMatch(notice.reason, /\/tmp\/|\/var\/|klaus-stories-/, 'no absolute path reaches the committed list')
})

test('a story is written only where a Storybook config loads it, and the package it sits in can find Storybook', () => {
  const { stories } = plan()
  // packages/ui has a Storybook of its own.
  assert.equal(byName(stories, 'AsyncField').status, 'write')
  assert.equal(byName(stories, 'Badge').storyFile, 'packages/ui/src/Badge.stories.tsx')
  // apps/web has none, and no other config lists its folder.
  const banner = byName(stories, 'Banner')
  assert.equal(banner.status, 'skipped')
  assert.equal(banner.cause, 'no-storybook')
  assert.equal(banner.reason, NO_STORYBOOK)
  // The root Storybook loads packages/lab, but packages/lab cannot find @storybook/react, so a story there fails to compile.
  const probe = byName(stories, 'Probe')
  assert.equal(probe.status, 'skipped')
  assert.equal(probe.cause, 'storybook-missing')
  assert.match(probe.reason, /the package this story sits in cannot find `@storybook\/react`.*TS2307: Cannot find module '@storybook\/react'.*packages\/lab\/tsconfig\.json/)
  assert.deepEqual(stories.check, { typeChecked: 5, noStorybook: 1, needsValue: 1, storybookMissing: 1, didNotCompile: 1 })
})

test('each story is checked with the tsconfig of its own package', () => {
  const { stories } = plan()
  // The same Storybook types are visible from ui and not from lab, and the two packages' stories got different answers.
  assert.equal(byName(stories, 'Badge').status, 'write')
  assert.equal(byName(stories, 'Probe').cause, 'storybook-missing')
  assert.match(byName(stories, 'Notice').reason, /packages\/ui\/tsconfig\.json/)
  assert.match(byName(stories, 'Probe').reason, /packages\/lab\/tsconfig\.json/)
})

test('a Storybook config that cannot be read as plain patterns leaves the stories it might load for a person, with the reason', () => {
  fs.writeFileSync(path.join(sample.repo, '.storybook/main.ts'), `export default { stories: getStories(), framework: '@storybook/react' }\n`)
  const { stories } = plan()
  assert.equal(byName(stories, 'AsyncField').status, 'write', 'the config of packages/ui is still read')
  for (const name of ['Probe', 'Banner']) {
    const item = byName(stories, name)
    assert.equal(item.status, 'skipped', name)
    assert.equal(item.cause, 'unreadable-storybook', name)
    assert.match(item.reason, /Klaus cannot tell whether a Storybook loads stories from this folder: \.storybook\/main\.ts \(it has no `stories` list that is written out in the file\)/, name)
  }
})

test('planning writes nothing: every file in the repo is as it was', () => {
  const before = snapshot(sample.repo)
  plan()
  assert.deepEqual(snapshot(sample.repo), before)
})

// ---- the run

const prices = async () => ({ ok: true, json: async () => ({ data: [{ id: 'z-ai/glm-5.3-flash', pricing: { prompt: '0.0000000392', completion: '0.0000002' } }] }) })
const passes = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ verdict: 'pass', reason: 'matches the places it is used' }) } }], usage: { prompt_tokens: 300, completion_tokens: 55, cost: 0.00003 } }) })

/** Logs, for each commit hook run, the files staged and how many Klaus branches exist. */
const HOOK = `#!/bin/sh
echo hook >> "$STUB_ORDER_LOG"
echo "$(git diff --cached --name-only | tr '\\n' ' ')" >> "$HOOK_FILES_LOG"
echo "$(git branch --list 'klaus/*' | wc -l | tr -d ' ')" >> "$HOOK_BRANCHES_LOG"
exit 0
`

let git
let logs
let saved
beforeEach(() => {
  git = makeGitStoriesSample()
  logs = { codex: path.join(git.base, 'codex.log'), gh: path.join(git.base, 'gh.log'), order: path.join(git.base, 'order.log'), files: path.join(git.base, 'files.log'), branches: path.join(git.base, 'branches.log') }
  saved = { ...process.env }
  process.env.PATH = `${STUBS}${path.delimiter}${process.env.PATH}`
  process.env.STUB_LOG = logs.codex
  process.env.STUB_GH_LOG = logs.gh
  process.env.STUB_ORDER_LOG = logs.order
  process.env.HOOK_FILES_LOG = logs.files
  process.env.HOOK_BRANCHES_LOG = logs.branches
  process.env.OPENROUTER_API_KEY = 'sk-test-not-real'
  fs.mkdirSync(path.join(git.repo, '.git', 'hooks'), { recursive: true })
  fs.writeFileSync(path.join(git.repo, '.git', 'hooks', 'pre-commit'), HOOK)
  fs.chmodSync(path.join(git.repo, '.git', 'hooks', 'pre-commit'), 0o755)
})
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
  Object.assign(process.env, saved)
  git.cleanup()
})

async function estimate(repo = git.repo) {
  const { onboarding, folders } = readOnboardingConfig(repo)
  const result = await buildEstimate({ plan: buildPlan({ root: repo, folders, onboarding }), onboarding, fetchImpl: prices })
  fs.mkdirSync(workFolder(repo), { recursive: true })
  writeJsonFile(path.join(workFolder(repo), 'estimate.json'), result)
  return result
}
const run = (estimated) => runOnboarding({ repo: git.repo, approve: estimated.id, codex: path.join(STUBS, 'codex'), fetchImpl: passes, log: () => {}, commitTrailers: ['Co-Authored-By: Test <t@example.com>'], bodyFooter: 'Generated by the test.' })
const lines = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean) : [])
const show = (branch, file) => git.git('show', `${branch}:${file}`)

test('the estimate counts the stories the way the run writes them, moved ones included', async () => {
  const estimated = await estimate()
  assert.deepEqual(estimated.stories, { write: 2, exists: 0, dataBound: 0, skipped: 4 })
  assert.deepEqual(estimated.storyCheck, { typeChecked: 5, noStorybook: 1, needsValue: 1, storybookMissing: 1, didNotCompile: 1 })
  const text = renderEstimate(estimated)
  assert.match(text, /Stories: 2 written with no model\..*4 left for a person \(1 in folders no Storybook loads, 1 with a required prop Klaus cannot fill in, 2 whose story did not compile\)/)
  assert.match(text, /type-checked with the repo's own TypeScript and the tsconfig of its package/)

  const { report } = await run(estimated)
  assert.equal(report.actual.stories, estimated.stories.write)
  assert.equal(report.actual.storiesLeft, estimated.stories.skipped)
  const rows = Object.fromEntries(report.comparison.map((r) => [r.metric, r]))
  assert.deepEqual([rows['Stories written'].within, rows['Stories left for a person'].within], [true, true])
  assert.deepEqual(report.stories.filter((s) => s.status === 'skipped').map((s) => s.id).sort(), ['apps/web/src/Banner.tsx#Banner', 'packages/lab/src/Probe.tsx#Probe', 'packages/ui/src/FlowNode.tsx#FlowNode', 'packages/ui/src/Notice.tsx#Notice'])
})

test('the compiler runs before any branch or model call, and the third pull request holds only stories that compile', async () => {
  const estimated = await estimate()
  const { report } = await run(estimated)

  // The commit hook was tried on all three commits first, with no Klaus branch yet and no model call.
  assert.deepEqual(lines(logs.order).slice(0, 4), ['hook', 'hook', 'hook', 'codex'])
  assert.deepEqual(lines(logs.branches).slice(0, 3), ['0', '0', '0'], 'no branch existed while the stories were tried')
  const thirdTry = lines(logs.files)[2].split(' ').filter(Boolean).sort()
  assert.deepEqual(thirdTry, ['docs/klaus/stories.json', 'docs/klaus/stories.md', 'packages/ui/src/AsyncField.stories.tsx', 'packages/ui/src/Badge.stories.tsx'])

  // Nothing was made for the stories that were moved.
  const changed = git.git('diff', '--name-only', `${BRANCHES[1]}..${BRANCHES[2]}`).trim().split('\n').sort()
  assert.deepEqual(changed, thirdTry)
  for (const name of ['Notice', 'FlowNode', 'Probe', 'Banner']) assert.equal(git.git('ls-tree', '-r', '--name-only', BRANCHES[2]).includes(`${name}.stories`), false, name)

  // The list tells a person why, with the compiler's message.
  const view = show(BRANCHES[2], 'docs/klaus/stories.md')
  assert.match(view, /## Left for a person \(4\)/)
  assert.match(view, /`Notice` \| the story Klaus would write does not type-check \(`TS2322: Type '\{\}' is not assignable to type/)
  assert.match(view, /`FlowNode` \| the required prop data has the type/)
  assert.match(view, /`Probe` \| the package this story sits in cannot find `@storybook\/react`/)
  assert.match(view, new RegExp(`\`Banner\` \\| ${NO_STORYBOOK}`))
  assert.doesNotMatch(view, /klaus-stories-|\/var\/folders|\/tmp\//)

  // The branch compiles as the repo's own type check would read it.
  git.git('checkout', '-q', BRANCHES[2])
  try {
    const ts = loadTypeScript(git.repo)
    assert.deepEqual(errorsOf(ts, path.join(git.repo, 'packages/ui/tsconfig.json')), [])
  } finally {
    git.git('checkout', '-q', 'main')
  }
  assert.equal(report.pullRequests.length, 3)
})

test('planning leaves the working tree and the index as they were', async () => {
  const before = snapshot(git.repo)
  await estimate()
  const after = snapshot(git.repo)
  delete after[path.join('.git', 'klaus-onboarding', 'estimate.json')]
  assert.deepEqual(after, before)
  assert.equal(git.git('status', '--porcelain', '--untracked-files=all').trim(), '')
  assert.equal(git.git('diff', '--cached', '--name-only').trim(), '')
})

test('write-stories writes the same files the run commits for its third pull request, and no branch', async () => {
  const estimated = await estimate()
  await run(estimated)
  const { writeStories } = await import('../write-stories.mjs')
  const other = makeGitStoriesSample()
  try {
    const messages = []
    const { written } = await writeStories({ repo: other.repo, approve: estimated.id, log: (m) => messages.push(m) })
    assert.deepEqual(written.sort(), ['docs/klaus/stories.json', 'docs/klaus/stories.md', 'packages/ui/src/AsyncField.stories.tsx', 'packages/ui/src/Badge.stories.tsx'])
    for (const rel of written) assert.equal(fs.readFileSync(path.join(other.repo, rel), 'utf8'), show(BRANCHES[2], rel), rel)
    assert.match(messages[0], /Wrote 2 stories and the two lists\. 0 components are listed with their screens, 0 already had a story, 4 are left for a person\./)
    assert.equal(other.git('branch', '--list', 'klaus/*').trim(), '')
    assert.equal(other.git('diff', '--cached', '--name-only').trim(), '')
    // Only the files it names are new.
    assert.deepEqual(other.git('status', '--porcelain', '--untracked-files=all').trim().split('\n').map((l) => l.slice(3)).sort(), ['docs/klaus/stories.json', 'docs/klaus/stories.md', 'packages/ui/src/AsyncField.stories.tsx', 'packages/ui/src/Badge.stories.tsx'])
    await assert.rejects(() => writeStories({ repo: other.repo, approve: 'not-the-plan', log: () => {} }), /not-the-plan/)
  } finally {
    other.cleanup()
  }
})

test('write-stories says how to use it when the repo is missing', async () => {
  const { main: writeStoriesMain } = await import('../write-stories.mjs')
  const quiet = console.error
  console.error = () => {}
  try {
    assert.equal(await writeStoriesMain([]), 2)
  } finally {
    console.error = quiet
  }
})
