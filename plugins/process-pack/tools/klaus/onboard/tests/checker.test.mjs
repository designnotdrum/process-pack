import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkerPrompt, cleanReason, parseVerdict, readPrice, runCheck } from '../checker.mjs'

const item = {
  name: 'Hero',
  entry: { props: [{ name: 'title', type: 'string', required: true }] },
  useWhen: 'a page opens with a headline.',
  notFor: 'a section further down the page.',
  snippets: [{ file: 'apps/web/src/app/page.tsx', line: 4, text: '<Hero\n  title="Plan" />' }],
}

const reply = (body, status = 200) => async () => ({ ok: status < 400, status, json: async () => body })
const ok = (content, usage = { prompt_tokens: 400, completion_tokens: 120, cost: 0.00004 }) => reply({ choices: [{ message: { content } }], usage })

test('the prompt puts repo text between two boundary lines and asks for one JSON object', () => {
  const prompt = checkerPrompt(item, 'DATA-test')
  assert.equal(prompt.split('\n').filter((line) => line === 'DATA-test').length, 2)
  assert.match(prompt, /Reply with one JSON object and nothing else/)
  assert.match(prompt, /Component: Hero\nProps: title: string\nUse when: a page opens with a headline\./)
  assert.match(prompt, /- apps\/web\/src\/app\/page\.tsx:4: <Hero title="Plan" \/>/)
})

test('a verdict is read from the first JSON object, and only pass or fail count', () => {
  assert.deepEqual(parseVerdict(' {"verdict":"pass","reason":"matches"}'), { verdict: 'pass', reason: 'matches' })
  assert.deepEqual(parseVerdict('Sure! {"verdict":"fail","reason":"it is used in a footer"} done'), { verdict: 'fail', reason: 'it is used in a footer' })
  for (const bad of ['', 'no json', '{"verdict":"maybe"}', '{"verdict":', '{"reason":"x"}']) assert.equal(parseVerdict(bad).verdict, 'error', bad)
})

test('a reason is cleaned so it cannot carry markdown, links or a long text into a file', () => {
  const dirty = 'see [x](http://evil) `code` | <b>bold</b> @me — ' + 'y'.repeat(400)
  const clean = cleanReason(dirty)
  assert.doesNotMatch(clean, /[\[\]()`|<>@—]/)
  assert.ok(clean.length <= 220)
})

test('a check sends the key in one header only and reads the verdict, tokens and cost', async () => {
  let seen
  const fetchImpl = async (url, init) => {
    seen = { url, init }
    return ok('{"verdict":"pass","reason":"fits"}')()
  }
  const result = await runCheck({ key: 'sk-secret-123', model: 'z-ai/glm-5.3-flash', prompt: 'p', fetchImpl })
  assert.deepEqual([result.verdict, result.reason, result.tokens, result.usd, result.attempts], ['pass', 'fits', 520, 0.00004, 1])
  assert.equal(seen.url, 'https://openrouter.ai/api/v1/chat/completions')
  assert.equal(seen.init.headers.authorization, 'Bearer sk-secret-123')
  assert.equal(seen.init.body.includes('sk-secret-123'), false)
  const body = JSON.parse(seen.init.body)
  assert.equal(body.model, 'z-ai/glm-5.3-flash')
  assert.equal(body.tools, undefined, 'the checker gets no tools')
})

test('a busy answer is tried once more, and its tokens are counted both times', async () => {
  const answers = [reply({ error: { message: 'busy' } }, 429), ok('{"verdict":"fail","reason":"wrong"}')]
  const result = await runCheck({ key: 'k', model: 'm', prompt: 'p', fetchImpl: async (...a) => answers.shift()(...a) })
  assert.deepEqual([result.verdict, result.attempts], ['fail', 2])
})

test('an error never carries the key and ends as an unchecked verdict', async () => {
  const failing = await runCheck({ key: 'sk-secret-123', model: 'm', prompt: 'p', fetchImpl: reply({ error: { message: 'bad key sk-secret-123' } }, 401) })
  assert.equal(failing.verdict, 'error')
  assert.equal(failing.attempts, 1)
  const thrown = await runCheck({ key: 'k', model: 'm', prompt: 'p', fetchImpl: async () => { throw Object.assign(new Error('x'), { code: 'ECONNRESET' }) } })
  assert.equal(thrown.verdict, 'error')
  assert.match(thrown.reason, /ECONNRESET/)
})

test('the price comes from the public models list, and a missing model gives null', async () => {
  const list = reply({ data: [{ id: 'z-ai/glm-5.3-flash', pricing: { prompt: '0.0000000392', completion: '0.0000002' } }] })
  const price = await readPrice('z-ai/glm-5.3-flash', list)
  assert.deepEqual([price.prompt, price.completion], [3.92e-8, 2e-7])
  assert.equal(await readPrice('nobody/none', list), null)
  assert.equal(await readPrice('x', async () => { throw new Error('offline') }), null)
})
