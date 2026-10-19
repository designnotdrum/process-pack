import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'
import { writeJsonFile } from '../../frame/json-file.mjs'
import { loadTypeScript, parsePurpose } from '../../inventory/components.mjs'
import { checkerPrompt } from '../checker.mjs'
import { readOnboardingConfig } from '../config.mjs'
import { buildEstimate } from '../estimate.mjs'
import { buildPlan } from '../plan.mjs'
import { BRANCHES, runOnboarding, workFolder } from '../run.mjs'
import { checkerContext, docCommentOf, findComponent, parseSource } from '../source.mjs'
import { applyPurposes, judgeWrittenFile } from '../verify.mjs'
import { writerPrompt } from '../writer.mjs'
import { KLAUS, makeGitSample, STUBS } from './helpers.mjs'

const ts = loadTypeScript(KLAUS)
const FILE = '/x/Panel.tsx'
const RATIONALE = [
  '/**',
  ' * Panel, the canvas\'s own container.',
  ' *',
  ' * QA-BLOCKER follow-up: `TooltipProvider` wraps this whole component, because a Tooltip',
  ' * below it throws when no provider is above it. One provider here, not nine.',
  ' */',
].join('\n')
const BEFORE = `import type { ReactNode } from 'react'\n\n${RATIONALE}\nexport function Panel({ children }: { children: ReactNode }) {\n  return <div>{children}</div>\n}\n`
const PURPOSE = { name: 'Panel', useWhen: 'framing a canvas with its controls.', notFor: 'a page section, use Section.' }
const components = [{ id: 'Panel.tsx#Panel', name: 'Panel' }]
const judge = (after, before = BEFORE) => judgeWrittenFile({ ts, file: FILE, before, after, components })
const added = '\n *\n * Use when: framing a canvas with its controls.\n * Not for: a page section, use Section.'

/** What the inventory reads as the purpose: the doc comment's text before its first tag. */
function inventoryPurpose(text, name = 'Panel') {
  const sourceFile = parseSource(ts, FILE, text)
  const doc = docCommentOf(ts, sourceFile, findComponent(ts, sourceFile, name).statement)
  return parsePurpose(ts.getTextOfJSDocComment(doc.node.comment) ?? '')
}

test('a doc comment not in the form keeps every line, and gains the two lines after its text', () => {
  const out = applyPurposes(ts, FILE, BEFORE, [PURPOSE])
  assert.equal(out, BEFORE.replace('One provider here, not nine.\n */', `One provider here, not nine.${added}\n */`))
  // Every line of the old file is still there, in order: the change is only lines added.
  const kept = out.split('\n')
  let at = 0
  for (const line of BEFORE.split('\n')) {
    at = kept.indexOf(line, at)
    assert.ok(at >= 0, `line kept: ${line}`)
  }
  const read = inventoryPurpose(out)
  assert.deepEqual([read.useWhen, read.notFor], [PURPOSE.useWhen, PURPOSE.notFor])
  assert.match(read.text, /QA-BLOCKER follow-up/)
})

test('the two lines go before the first tag, where the inventory reads them, and a comment of tags only keeps its tags', () => {
  const tagged = BEFORE.replace('One provider here, not nine.\n */', 'One provider here, not nine.\n *\n * @example\n * <Panel>x</Panel>\n */')
  const out = applyPurposes(ts, FILE, tagged, [PURPOSE])
  assert.match(out, /One provider here, not nine\.\n \*\n \* Use when: framing a canvas with its controls\.\n \* Not for: a page section, use Section\.\n \*\n \* @example\n \* <Panel>x<\/Panel>\n \*\//)
  assert.equal(inventoryPurpose(out).notFor, PURPOSE.notFor)

  const tagsOnly = BEFORE.replace(RATIONALE, '/**\n * @component Panel\n * @description The canvas container.\n */')
  const out2 = applyPurposes(ts, FILE, tagsOnly, [PURPOSE])
  assert.match(out2, /\/\*\*\n \* Use when: framing a canvas with its controls\.\n \* Not for: a page section, use Section\.\n \*\n \* @component Panel\n \* @description The canvas container\.\n \*\//)
  assert.equal(inventoryPurpose(out2).useWhen, PURPOSE.useWhen)
})

test('a writer that keeps the comment and adds the two lines passes, with the sentences read out', () => {
  const after = BEFORE.replace('One provider here, not nine.\n */', 'One provider here, not nine.\n * Use when: framing a canvas with its controls.\n * Not for: a page section, use Section.\n */')
  assert.deepEqual(judge(after).results, [{ id: 'Panel.tsx#Panel', ok: true, useWhen: PURPOSE.useWhen, notFor: PURPOSE.notFor }])
})

test('a writer edit that removes, rewords or moves the comment\'s text is rejected', () => {
  const replaced = BEFORE.replace(RATIONALE, '/**\n * Use when: framing a canvas with its controls.\n * Not for: a page section, use Section.\n */')
  const reworded = BEFORE.replace('not nine.\n */', 'not ten.\n * Use when: framing a canvas with its controls.\n * Not for: a page section, use Section.\n */')
  const moved = BEFORE.replace('/**\n * Panel,', '/**\n * Use when: framing a canvas with its controls.\n * Not for: a page section, use Section.\n * Panel,')
  for (const [name, after] of Object.entries({ replaced, reworded, moved })) {
    const [result] = judge(after).results
    assert.equal(result.ok, false, name)
    assert.match(result.reason, /did not keep the existing comment whole/, name)
  }
})

test('the writer is shown the existing comment and told to keep it, and the checker sees it and the comments that name the component', () => {
  const sample = makeGitSample()
  try {
    const { repo } = sample
    fs.writeFileSync(path.join(repo, 'packages/ui/src/PrimaryButton.tsx'), fs.readFileSync(path.join(repo, 'packages/ui/src/PrimaryButton.tsx'), 'utf8').replace('export function PrimaryButton', '/**\n * The one filled button on a screen. Two read as a choice, see DESIGN.md.\n */\nexport function PrimaryButton'))
    const page = path.join(repo, 'apps/web/src/app/page.tsx')
    fs.writeFileSync(page, fs.readFileSync(page, 'utf8').replace('  return <Hero', '  // PrimaryButton is the only filled button on the home page, on purpose.\n  return <Hero'))
    const { onboarding, folders } = readOnboardingConfig(repo)
    const plan = buildPlan({ root: repo, folders, onboarding })
    const component = plan.purposes.components.find((c) => c.name === 'PrimaryButton')
    assert.equal(component.kind, 'unformatted')

    const prompt = writerPrompt(plan.calls.find((c) => c.dir === 'packages/ui/src'), 'DATA-test')
    assert.match(prompt, /^- PrimaryButton, in PrimaryButton\.tsx\. .* It has a doc comment that is not in the form above\. Keep all of its text and add the two lines to it\. It reads: The one filled button on a screen\. Two read as a choice, see DESIGN\.md\.$/m)
    assert.match(prompt, /keep every word of it exactly where it is and add the two lines inside it/)
    assert.equal(prompt.includes('replace that one comment'), false)

    const context = checkerContext({ ts: plan.ts, root: plan.root, usage: plan.usage, entry: component.entry, limit: 5 })
    assert.equal(context.own, 'The one filled button on a screen. Two read as a choice, see DESIGN.md.')
    assert.deepEqual(context.mentions, [{ file: 'apps/web/src/app/page.tsx', line: 5, text: 'PrimaryButton is the only filled button on the home page, on purpose.' }])
    const check = checkerPrompt({ name: 'PrimaryButton', entry: component.entry, useWhen: 'a.', notFor: 'b.', ...context }, 'DATA-test')
    assert.match(check, /Its own comment: The one filled button on a screen\./)
    assert.match(check, /Comments elsewhere that name it:\n- apps\/web\/src\/app\/page\.tsx:5: PrimaryButton is the only filled button/)
    assert.match(check, /3\. Does the component's own comment, or a comment elsewhere that names it, contradict either sentence\?/)
  } finally {
    sample.cleanup()
  }
})

test('a comment with an @ after text on a line is left for a person: TypeScript reads it as a tag, and the lines would split that line', () => {
  const sample = makeGitSample()
  try {
    const file = path.join(sample.repo, 'packages/ui/src/PrimaryButton.tsx')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('export function PrimaryButton', '/**\n * The main button.\n *\n * Lives in @sample/ui because both apps render it.\n */\nexport function PrimaryButton'))
    const hero = path.join(sample.repo, 'apps/web/src/marketing/Hero.tsx')
    fs.writeFileSync(hero, fs.readFileSync(hero, 'utf8').replace('export function Hero', '/** @deprecated use Banner */\nexport function Hero'))
    const { onboarding, folders } = readOnboardingConfig(sample.repo)
    const plan = buildPlan({ root: sample.repo, folders, onboarding })
    assert.match(plan.purposes.skipped.find((s) => s.name === 'PrimaryButton').reason, /an @ after text on a line/)
    // A tag on a line of its own, here the one-line comment's only text, is fine: the lines go before it.
    const component = plan.purposes.components.find((c) => c.name === 'Hero')
    const out = applyPurposes(ts, path.join(plan.root, component.file), fs.readFileSync(hero, 'utf8'), [{ name: 'Hero', useWhen: 'a page opens with a headline.', notFor: 'a section further down.' }])
    assert.match(out, /\/\*\*\n \* Use when: a page opens with a headline\.\n \* Not for: a section further down\.\n \*\n \* @deprecated use Banner\n \*\/\nexport function Hero/)
  } finally {
    sample.cleanup()
  }
})

test('a comment with half a purpose is left for a person, since a second label would hide the new one', () => {
  const sample = makeGitSample()
  try {
    const file = path.join(sample.repo, 'packages/ui/src/PrimaryButton.tsx')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('export function PrimaryButton', '/** Use when: the screen has one main action. */\nexport function PrimaryButton'))
    const { onboarding, folders } = readOnboardingConfig(sample.repo)
    const plan = buildPlan({ root: sample.repo, folders, onboarding })
    assert.equal(plan.purposes.components.some((c) => c.name === 'PrimaryButton'), false)
    assert.match(plan.purposes.skipped.find((s) => s.name === 'PrimaryButton').reason, /already has a Use when or a Not for line/)
  } finally {
    sample.cleanup()
  }
})

// ---- the run, end to end, on a sample whose PrimaryButton has a comment with its reason in it

describe('the run on a component with a comment', () => {

  const prices = async () => ({ ok: true, json: async () => ({ data: [{ id: 'z-ai/glm-5.3-flash', pricing: { prompt: '0.0000000392', completion: '0.0000002' } }] }) })
  let sample
  let saved
  let prompts
  const checker = async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[0].content
    prompts.push(prompt)
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"verdict":"pass","reason":"fits"}' } }], usage: { prompt_tokens: 300, completion_tokens: 55, cost: 0.00003 } }) }
  }
  const KEPT = '/**\n * The one filled button on a screen. Two read as a choice, see DESIGN.md.\n *\n * @deprecated in forms, where Button with variant solid submits.\n */\n'

  beforeEach(() => {
    sample = makeGitSample()
    saved = { ...process.env }
    prompts = []
    process.env.PATH = `${STUBS}${path.delimiter}${process.env.PATH}`
    process.env.STUB_LOG = path.join(sample.base, 'codex.log')
    process.env.STUB_GH_LOG = path.join(sample.base, 'gh.log')
    process.env.OPENROUTER_API_KEY = 'sk-test-not-real'
    const file = path.join(sample.repo, 'packages/ui/src/PrimaryButton.tsx')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('export function PrimaryButton', `${KEPT}export function PrimaryButton`))
    sample.git('commit', '-qam', 'a comment with a reason in it')
    sample.git('push', '-q', 'origin', 'main')
  })
  afterEach(() => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
    Object.assign(process.env, saved)
    sample.cleanup()
  })

  async function estimateAndRun() {
    const { onboarding, folders } = readOnboardingConfig(sample.repo)
    const estimated = await buildEstimate({ plan: buildPlan({ root: sample.repo, folders, onboarding }), onboarding, fetchImpl: prices })
    fs.mkdirSync(workFolder(sample.repo), { recursive: true })
    writeJsonFile(path.join(workFolder(sample.repo), 'estimate.json'), estimated)
    return runOnboarding({ repo: sample.repo, approve: estimated.id, codex: path.join(STUBS, 'codex'), fetchImpl: checker, log: () => {} })
  }

  test('the run keeps a comment that was there: the purposes pull request only adds lines to it, and the checker was shown it', async () => {
    const { report } = await estimateAndRun()
    assert.equal(report.purposes.find((p) => p.name === 'PrimaryButton').status, 'kept')
    const diff = sample.git('diff', '-U0', BRANCHES[0], BRANCHES[1], '--', 'packages/ui/src/PrimaryButton.tsx')
    const changed = diff.split('\n').filter((l) => /^[+-](?![+-])/.test(l))
    assert.deepEqual(changed.filter((l) => l.startsWith('-')), [], 'no line of the file was removed')
    // The comment already has a blank line before its tag, so the two lines take that place and add one after them.
    assert.deepEqual(changed, [' * Use when: the PrimaryButton component is the right choice here.', ' * Not for: places where another component fits better.', ' *'].map((l) => `+${l}`))
    const text = sample.git('show', `${BRANCHES[1]}:packages/ui/src/PrimaryButton.tsx`)
    assert.ok(text.includes('The one filled button on a screen. Two read as a choice, see DESIGN.md.'))
    assert.ok(text.includes('@deprecated in forms, where Button with variant solid submits.'))
    const listed = JSON.parse(sample.git('show', `${BRANCHES[1]}:inventory.json`)).entries.find((e) => e.name === 'PrimaryButton')
    assert.equal(listed.purpose.useWhen, 'the PrimaryButton component is the right choice here.')
    const seen = prompts.find((p) => p.includes('Component: PrimaryButton'))
    assert.match(seen, /Its own comment: The one filled button on a screen\. Two read as a choice, see DESIGN\.md\. @deprecated in forms/)
  })

  test('a writer that replaces the comment, as the writer did before, is rejected and the comment stays as it was', async () => {
    process.env.STUB_MODE = 'replace'
    const { report } = await estimateAndRun()
    const primary = report.purposes.find((p) => p.name === 'PrimaryButton')
    assert.equal(primary.status, 'rejected')
    assert.match(primary.reason, /did not keep the existing comment whole/)
    assert.equal(sample.git('show', `${BRANCHES[1]}:packages/ui/src/PrimaryButton.tsx`), sample.git('show', 'main:packages/ui/src/PrimaryButton.tsx'))
    // A component with no comment before is not affected.
    assert.equal(report.purposes.find((p) => p.name === 'Hero').status, 'kept')
  })
})
