import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { loadTypeScript } from '../../inventory/components.mjs'
import { classTokens, dataBoundReasons, docCommentOf, findComponent, importsOf, parseSource, usageSnippets } from '../source.mjs'
import { KLAUS } from './helpers.mjs'

const ts = loadTypeScript(KLAUS)
const parse = (text, file = '/x/Thing.tsx') => parseSource(ts, file, text)

test('findComponent places a function, a const and a default export', () => {
  const sf = parse(`
export function A() { return <div /> }
const B = () => <div />
export { B }
function C() { return <div /> }
export default C
`)
  assert.deepEqual([findComponent(ts, sf, 'A').named, findComponent(ts, sf, 'A').isDefault], [true, false])
  assert.equal(findComponent(ts, sf, 'B').named, true)
  const c = findComponent(ts, sf, 'C')
  assert.deepEqual([c.named, c.isDefault], [false, true])
  assert.equal(findComponent(ts, sf, 'Missing'), null)
})

test('findComponent follows an export under another name and an anonymous default named for its file', () => {
  const aliased = parse('function Inner() { return <div /> }\nexport { Inner as Outer }\n')
  assert.equal(findComponent(ts, aliased, 'Outer').localName, 'Inner')
  const anon = parse('export default () => <div />\n', '/x/side-bar.tsx')
  assert.equal(findComponent(ts, anon, 'SideBar').isDefault, true)
})

test('docCommentOf returns the last doc comment above the statement, and not a plain comment', () => {
  const text = '/** old */\n/** Use when: x. */\nexport function A() { return <div /> }\n// plain\nexport function B() { return <div /> }\n'
  const sf = parse(text)
  const doc = docCommentOf(ts, sf, findComponent(ts, sf, 'A').statement)
  assert.equal(doc.text, '/** Use when: x. */')
  assert.equal(text.slice(doc.start, doc.end), doc.text)
  assert.equal(docCommentOf(ts, sf, findComponent(ts, sf, 'B').statement), null)
})

test('classTokens reads className strings and the arguments of cva, cn and clsx', () => {
  const sf = parse(`
const v = cva('base a', { variants: { size: { sm: 'p-1', lg: 'p-4' } } })
export function A({ on }: { on: boolean }) {
  return <div className={cn('x y', on && 'z', \`w-\${1} q\`)} data-foo="not a class" />
}
`)
  assert.deepEqual([...classTokens(ts, sf)].sort(), ['a', 'base', 'p-1', 'p-4', 'q', 'w-', 'x', 'y', 'z'].sort())
})

test('dataBoundReasons marks live data packages, local data hooks and fetch', () => {
  const clerk = parse("import { useUser } from '@clerk/nextjs'\nexport function A() { return <div /> }\n")
  assert.deepEqual(dataBoundReasons(ts, clerk), ['imports @clerk/nextjs'])
  const hook = parse("import { useProjects } from '@/hooks/useProjects'\nexport function A() { return <div /> }\n")
  assert.deepEqual(dataBoundReasons(ts, hook), ['calls useProjects from @/hooks/useProjects'])
  const theme = parse("import { useTheme } from '@/lib/theme'\nexport function A() { return <div /> }\n")
  assert.deepEqual(dataBoundReasons(ts, theme), [])
  const fetches = parse("export async function A() { await fetch('/api'); return <div /> }\n")
  assert.deepEqual(dataBoundReasons(ts, fetches), ['calls fetch'])
  const extra = parse("import x from 'my-data-lib'\nexport function A() { return <div /> }\n")
  assert.deepEqual(dataBoundReasons(ts, extra, ['my-data-lib']), ['imports my-data-lib'])
})

test('importsOf leaves out type-only imports', () => {
  const sf = parse("import type { A } from './a'\nimport { b } from './b'\nimport C from './c'\n")
  assert.deepEqual(importsOf(ts, sf).map((i) => [i.module, i.names.length, i.defaultName]), [['./a', 0, null], ['./b', 1, null], ['./c', 0, 'C']])
})

test('usageSnippets finds the JSX that uses a component, one file at a time', () => {
  const dir = path.join(KLAUS, 'onboard', 'tests', 'fixtures', 'sample')
  const files = ['apps/web/src/app/dashboard/page.tsx', 'apps/web/src/app/pricing/page.tsx'].map((f) => path.join(dir, f))
  const found = usageSnippets({ ts, root: dir, importers: files, names: ['Button'], limit: 5 })
  assert.deepEqual(found.map((s) => s.file), ['apps/web/src/app/dashboard/page.tsx', 'apps/web/src/app/pricing/page.tsx'])
  assert.match(found[0].text, /<Button variant="outline"/)
  assert.equal(found[0].line, 8)
  assert.equal(usageSnippets({ ts, root: dir, importers: files, names: ['Button'], limit: 1 }).length, 1)
})
