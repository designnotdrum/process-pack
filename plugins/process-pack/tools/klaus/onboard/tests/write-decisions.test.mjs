import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { main, writeDecisions } from '../write-decisions.mjs'
import { makeDecisionsSample } from './decisions-helpers.mjs'

let sample
before(() => {
  sample = makeDecisionsSample()
})
after(() => sample.cleanup())

const quiet = () => {}
const noBrowser = async () => {
  throw new Error('Playwright is not installed in /x.')
}

test('with --out the files go to that folder and the repo is only read', async () => {
  const out = path.join(sample.base, 'out')
  const { written, counts } = await writeDecisions({ repo: sample.repo, out, open: noBrowser, log: quiet, storybook: 'nowhere' })
  assert.deepEqual(counts, { pairs: 5, tickets: 3, merges: 0, removals: 3, decisions: 2 })
  assert.deepEqual(written.filter((w) => !w.includes('/tickets/')), ['docs/klaus/decisions.md', 'docs/klaus/duplicates.md', 'docs/klaus/duplicates.json'])
  assert.equal(fs.existsSync(path.join(out, 'docs/klaus/tickets/01-remove-tooltip-from-web.md')), true)
  assert.match(fs.readFileSync(path.join(out, 'docs/klaus/decisions.md'), 'utf8'), /No picture: no built Storybook was found/)
  assert.equal(fs.existsSync(path.join(sample.repo, 'docs')), false, 'nothing is written in the repo')
})

test('without --out the files go into the repo, below its docs folder', async () => {
  const second = makeDecisionsSample()
  try {
    await writeDecisions({ repo: second.repo, open: noBrowser, log: quiet, storybook: 'nowhere' })
    assert.equal(fs.existsSync(path.join(second.repo, 'docs/klaus/decisions.md')), true)
    assert.equal(fs.existsSync(path.join(second.repo, 'docs/klaus/tickets/03-remove-card-from-ui.md')), true)
  } finally {
    second.cleanup()
  }
})

test('the command says how to use it when the repo is missing, and exits 2', async () => {
  const errors = []
  const original = console.error
  console.error = (line) => errors.push(line)
  try {
    assert.equal(await main([]), 2)
  } finally {
    console.error = original
  }
  assert.match(errors.join('\n'), /Usage: write-decisions\.mjs --repo <dir>/)
})

test('files an earlier run wrote and this one does not are removed, and nothing else is', async () => {
  const second = makeDecisionsSample()
  try {
    const docs = path.join(second.repo, 'docs/klaus')
    fs.mkdirSync(path.join(docs, 'tickets'), { recursive: true })
    fs.mkdirSync(path.join(docs, 'decisions'), { recursive: true })
    fs.writeFileSync(path.join(docs, 'tickets/09-remove-oldthing-from-web.md'), 'old')
    fs.writeFileSync(path.join(docs, 'tickets/notes.md'), 'mine')
    fs.writeFileSync(path.join(docs, 'decisions/07-old-vs-older.png'), 'old')
    fs.writeFileSync(path.join(docs, 'decisions/logo.svg'), 'mine')
    const { removed } = await writeDecisions({ repo: second.repo, open: noBrowser, log: quiet, storybook: 'nowhere' })
    assert.deepEqual(removed.sort(), ['docs/klaus/decisions/07-old-vs-older.png', 'docs/klaus/tickets/09-remove-oldthing-from-web.md'])
    assert.equal(fs.existsSync(path.join(docs, 'tickets/09-remove-oldthing-from-web.md')), false)
    assert.equal(fs.existsSync(path.join(docs, 'decisions/07-old-vs-older.png')), false)
    assert.equal(fs.readFileSync(path.join(docs, 'tickets/notes.md'), 'utf8'), 'mine')
    assert.equal(fs.readFileSync(path.join(docs, 'decisions/logo.svg'), 'utf8'), 'mine')
  } finally {
    second.cleanup()
  }
})
