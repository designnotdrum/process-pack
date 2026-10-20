/**
 * Stories for components that have none, written from the inventory with no model.
 *
 * A component gets a story when it has no story yet, it shows no live data, and every prop it
 * requires can be given a sample value from its type. A component that shows live data is not
 * drawn in isolation: it is listed with the screens it appears on instead. A component whose
 * required props cannot be filled in is skipped, with the prop named, for a person to write.
 */
import fs from 'node:fs'
import path from 'node:path'
import { pascalCase, toPosix } from '../inventory/files.mjs'
import { declaringFile, reExportedFiles } from './barrels.mjs'
import { dataBoundReasons, findComponent, importsOf, parseSource } from './source.mjs'
import { checkStories } from './story-check.mjs'
import { findStorybookConfigs, NOT_SEARCHED, storybookFor } from './storybook.mjs'

const STORY_FILE = /\.(?:stories|story)\.[cm]?[jt]sx?$/
const MAX_VARIANT_STORIES = 8
const DEFAULT_FRAMEWORK = '@storybook/react'
const FRAMEWORKS = ['@storybook/nextjs', '@storybook/nextjs-vite', '@storybook/react-vite', '@storybook/react-webpack5', '@storybook/react']

/** Every story file in the repo, links not followed. */
export function findStoryFiles(root) {
  const found = []
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!NOT_SEARCHED.has(entry.name)) visit(full)
      } else if (entry.isFile() && STORY_FILE.test(entry.name)) found.push(toPosix(full))
    }
  }
  visit(root)
  return found.sort()
}

/**
 * The component files one story reaches, resolved with the repo's own TypeScript: each file it
 * imports, and the file that declares each name it imports, followed through barrel files
 * (barrels.mjs). A namespace import reaches every file the barrel re-exports; `namespace` marks those.
 *
 * @returns {{ file: string, namespace: boolean }[]}
 */
function reachedBy({ ts, tsconfigs, story, sourceFile }) {
  const reached = []
  for (const item of importsOf(ts, sourceFile)) {
    const resolved = ts.resolveModuleName(item.module, story, tsconfigs.optionsFor(story), ts.sys).resolvedModule?.resolvedFileName
    if (!resolved || resolved.endsWith('.d.ts')) continue
    const module = toPosix(resolved)
    reached.push({ file: module, namespace: false })
    // A default import is the barrel's `default` export, which may be re-exported from the component's file.
    for (const imported of [...item.names.map((n) => n.imported), ...(item.defaultName ? ['default'] : [])]) {
      const declared = declaringFile({ ts, tsconfigs, file: module, name: imported })
      if (declared && declared !== module) reached.push({ file: declared, namespace: false })
    }
    if (item.namespace) for (const target of reExportedFiles({ ts, tsconfigs, file: module })) reached.push({ file: target, namespace: true })
  }
  return reached
}

/** Each story file, parsed, with the ones that cannot be read left out. */
function parsedStories(ts, storyFiles) {
  const parsed = []
  for (const story of storyFiles) {
    try {
      parsed.push({ story, sourceFile: parseSource(ts, story) })
    } catch {
      // A story that cannot be read imports nothing Klaus can see.
    }
  }
  return parsed
}

/** The story files that import each component file, directly or through a barrel file, resolved with the repo's own TypeScript. */
export function storyImports({ ts, root, tsconfigs }) {
  const byComponent = new Map()
  for (const { story, sourceFile } of parsedStories(ts, findStoryFiles(root))) {
    for (const { file } of reachedBy({ ts, tsconfigs, story, sourceFile })) byComponent.set(file, [...new Set([...(byComponent.get(file) ?? []), story])])
  }
  return byComponent
}

const simple = (text) => String(text).toLowerCase().replace(/[^a-z0-9]/g, '')
const stemOf = (file) => simple(path.posix.basename(file).replace(/\.(?:stories|story)\.[^.]+$|\.[^.]+$/, ''))

/**
 * The component files that a story already imports, and the package the stories take `Meta` from.
 * A story is found by what it imports, so a story named something else still counts. An import
 * through a barrel file counts for the file that declares the name, as `storyImports` finds it. A
 * namespace import of a barrel counts only for the component the story file is named for, so a
 * story that draws a whole screen is not counted as a story of every part.
 *
 * @returns {{ covered: Set<string>, framework: string | null, storyFiles: string[] }}
 */
export function storyCoverage({ ts, root, tsconfigs }) {
  const covered = new Set()
  let framework = null
  const storyFiles = findStoryFiles(root)
  for (const { story, sourceFile } of parsedStories(ts, storyFiles)) {
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
      const spec = statement.moduleSpecifier.text
      if (!framework && spec.startsWith('@storybook/') && statement.getText(sourceFile).includes('Meta')) framework = spec
    }
    for (const { file, namespace } of reachedBy({ ts, tsconfigs, story, sourceFile })) if (!namespace || stemOf(file) === stemOf(story)) covered.add(file)
  }
  return { covered, framework, storyFiles }
}

const SPY_MODULES = ['storybook/test', '@storybook/test']

/**
 * The module a story at this path can import Storybook's `fn` from, or null. `storybook/test` is
 * where Storybook 9 and later ship it, `@storybook/test` where Storybook 8 does. A module counts
 * when the repo's own TypeScript resolves it from the story's folder with the tsconfig of its
 * package, the same way the story is type-checked.
 */
export function spyModule({ ts, tsconfigs, file }) {
  const options = tsconfigs.optionsFor(file)
  return SPY_MODULES.find((spec) => ts.resolveModuleName(spec, file, options, ts.sys).resolvedModule) ?? null
}

/** The Storybook package to import types from: the existing stories', else package.json's, else the plain React one. */
export function storybookPackage(root, fromStories) {
  if (fromStories) return fromStories
  for (const dir of [root]) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
      const names = new Set(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }))
      const match = FRAMEWORKS.find((name) => names.has(name))
      if (match) return match
    } catch {
      // No readable package.json: use the default.
    }
  }
  return DEFAULT_FRAMEWORK
}

const SAMPLE_TEXT = { href: '#', url: '#', src: '#', id: 'sample-id', key: 'sample-key', email: 'sample@example.com' }
const quote = (text) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/**
 * The return type of a function type written `(params) => Return`, or null when the text is not
 * one. The parameter list is found by matching its parentheses, so a parameter that is itself a
 * function type does not end it early.
 */
function returnTypeOf(type) {
  if (!type.startsWith('(')) return null
  let depth = 0
  let quote = null
  for (let i = 0; i < type.length; i++) {
    const c = type[i]
    if (quote) {
      if (c === '\\') i += 1
      else if (c === quote) quote = null
    } else if (c === '"' || c === "'" || c === '`') quote = c
    else if (c === '(') depth += 1
    else if (c === ')' && --depth === 0) return /^\s*=>\s*(\S[\s\S]*)$/.exec(type.slice(i + 1))?.[1].trim() ?? null
  }
  return null
}

/** The members of a union written at its top level, so `Promise<void | null> | string` has two. */
function unionMembers(type) {
  const members = []
  let depth = 0
  let start = 0
  for (let i = 0; i < type.length; i++) {
    const c = type[i]
    if ('(<[{'.includes(c)) depth += 1
    else if (')>]}'.includes(c) && !(c === '>' && type[i - 1] === '=')) depth -= 1
    else if (c === '|' && depth === 0) {
      members.push(type.slice(start, i).trim())
      start = i + 1
    }
  }
  members.push(type.slice(start).trim())
  return members
}

const NOTHING = /^(?:void|unknown|any)$/
const returnsNothing = (type) => unionMembers(type).some((member) => NOTHING.test(member))

/**
 * A handler for a function that returns nothing. The comment keeps it from being an empty
 * function, which lint flags (no-empty-function). `() => undefined` is not used: Ultracite's
 * oxlint preset flags it (unicorn/no-useless-undefined).
 */
const DOES_NOTHING = '() => { /* Nothing happens in a story. */ }'

/**
 * A function that returns what its type says it returns: nothing for `void`, a promise for
 * `Promise<...>`, and a sample value of the right kind otherwise. A promise comes from
 * `Promise.resolve`, not from an async function, which lint flags when it has nothing to await
 * (require-await). Null when the return type is one Klaus will not invent a value for.
 *
 * With `spy`, a function that returns nothing, or a promise of nothing, is Storybook's `fn()`,
 * which also shows each call in the Actions panel. A function that computes a value stays a plain
 * one: `fn` would type the value from the sample alone, so a literal such as 'sm' would no longer
 * match the prop's type.
 */
function sampleFunction(returnType, spy) {
  if (returnsNothing(returnType)) return spy ? 'fn()' : DOES_NOTHING
  const promised = /^Promise<([\s\S]*)>$/.exec(returnType)?.[1].trim()
  if (promised !== undefined) {
    if (returnsNothing(promised)) return spy ? 'fn(() => Promise.resolve())' : '() => Promise.resolve()'
    const value = sampleValue('', promised)
    return value === null ? null : `() => Promise.resolve(${value})`
  }
  const value = sampleValue('', returnType)
  return value === null ? null : `() => ${value}`
}

/**
 * A sample value, as source text, for a prop of this printed type. Null when the type is one Klaus
 * will not invent a value for (an object shape, a generic, a type from another file). With `spy`,
 * a function that returns nothing is Storybook's `fn()`; the story then imports `fn`.
 */
export function sampleValue(name, type, { spy = false } = {}) {
  let t = type.replace(/\s*\|\s*(?:undefined|null)\b/g, '').replace(/\b(?:undefined|null)\s*\|\s*/g, '').trim()
  // A function type in parentheses, such as `(() => void)`, loses the outer pair.
  if (/^\(.*\)$/.test(t) && !/^\([^()]*\)\s*=>/.test(t) && /=>/.test(t)) t = t.slice(1, -1).trim()
  if (/^(?:React\.)?(?:ReactNode|ReactText)$/.test(t)) return quote('Sample')
  if (/^(?:React\.)?ReactElement(?:<.*>)?$|^JSX\.Element$/.test(t)) return '<span>Sample</span>'
  if (t === 'string') return quote(SAMPLE_TEXT[name] ?? 'Sample')
  if (t === 'number') return '1'
  if (t === 'boolean' || t === 'false') return 'false'
  if (t === 'true') return 'true'
  if (/^(?:"[^"]*"|'[^']*')(?:\s*\|\s*(?:"[^"]*"|'[^']*'))*$/.test(t)) return quote(t.match(/^(?:"([^"]*)"|'([^']*)')/).slice(1).find((x) => x !== undefined))
  if (/^-?\d+(?:\s*\|\s*-?\d+)*$/.test(t)) return t.split('|')[0].trim()
  const returned = returnTypeOf(t)
  if (returned !== null) return sampleFunction(returned, spy)
  if (/^(?:readonly\s+)?[\w.<>]+\[\]$/.test(t) || /^(?:Readonly)?Array<.*>$/.test(t)) return '[]'
  if (t === 'Date') return "new Date('2026-01-01T00:00:00Z')"
  return null
}

/**
 * The args a story needs: one sample value for each required prop. `blocked` names the first
 * required prop that cannot be given one. With `spy`, a function that returns nothing is `fn()`.
 *
 * @returns {{ args: [string, string][], blocked: string | null }}
 */
export function storyArgs(entry, { spy = false } = {}) {
  const args = []
  for (const prop of entry.props.filter((p) => p.required)) {
    const value = sampleValue(prop.name, prop.type, { spy })
    if (value === null) {
      const type = (prop.type.length > 60 ? `${prop.type.slice(0, 57)}...` : prop.type).replace(/`/g, "'")
      return { args: [], blocked: `the required prop ${prop.name} has the type \`${type}\`, and Klaus will not invent a value for it` }
    }
    args.push([prop.name, value])
  }
  return { args, blocked: null }
}

const argsText = (args) => `{ ${args.map(([name, value]) => `${/^[A-Za-z_$][\w$]*$/.test(name) ? name : quote(name)}: ${value}`).join(', ')} }`
const literal = (value) => (typeof value === 'number' ? String(value) : quote(String(value)))

/** The variant stories: one for each value of each variant prop, up to a small limit. */
function variantStories(entry) {
  const stories = []
  for (const [prop, values] of Object.entries(entry.variants ?? {})) {
    for (const value of values) {
      const name = `${pascalCase(prop)}${pascalCase(String(value)) || 'Value'}`
      if (/^[A-Za-z_]\w*$/.test(name)) stories.push({ name, args: [[prop, literal(value)]] })
    }
  }
  return stories.slice(0, MAX_VARIANT_STORIES)
}

/**
 * The text of a story file. Plain JavaScript files get a story without the type annotations.
 *
 * @param {object} options
 * @param {object} options.entry The inventory entry.
 * @param {string} options.importPath The path the story imports the component from, such as ./Button.
 * @param {boolean} options.isDefault Whether the component is the file's default export.
 * @param {string} options.framework The package to import types from.
 * @param {boolean} options.typed False for a .jsx or .js component.
 * @param {[string, string][]} options.args
 * @param {string | null} [options.spy] The module to import Storybook's `fn` from, imported only when an arg uses it.
 */
export function renderStory({ entry, importPath, isDefault, framework, typed, args, spy = null }) {
  const importLine = isDefault ? `import ${entry.name} from '${importPath}'` : `import { ${entry.name} } from '${importPath}'`
  const variants = variantStories(entry)
  const meta = [`  component: ${entry.name},`]
  if (args.length > 0) meta.push(`  args: ${argsText(args)},`)
  const lines = []
  if (typed) lines.push(`import type { Meta, StoryObj } from '${framework}'`)
  if (spy && args.some(([, value]) => value.startsWith('fn('))) lines.push(`import { fn } from '${spy}'`)
  lines.push(importLine, '')
  lines.push('// Written by the Klaus onboarding run. Edit it freely: Klaus never rewrites a story that exists.')
  lines.push(typed ? 'const meta = {' : 'export default {', ...meta, typed ? '} satisfies Meta<typeof ' + entry.name + '>' : '}')
  if (typed) lines.push('', 'export default meta', 'type Story = StoryObj<typeof meta>')
  const story = (name, own) => `\nexport const ${name}${typed ? ': Story' : ''} = ${own ? `{ args: ${argsText(own)} }` : '{}'}`
  lines.push(story('Default', null))
  for (const variant of variants) if (variant.name !== 'Default') lines.push(story(variant.name, variant.args))
  return `${lines.join('\n')}\n`
}

const NO_STORYBOOK = 'no Storybook in this repo loads stories from this folder'

/**
 * Decides, for every entry, whether it gets a story and what the story says.
 *
 * Statuses: `write` (a story file is written), `exists` (a story already imports this file),
 * `data-bound` (listed with its screens), `skipped` (with the reason, and a `cause` when the reason
 * is one of these checks: `no-storybook`, `unreadable-storybook`, `needs-value`, `storybook-missing`
 * or `does-not-compile`).
 *
 * A story is written only if a Storybook config in the repo loads its path, and only if it type-checks
 * with the repo's own TypeScript and the tsconfig of the package it sits in. Both are decided here,
 * from the repo alone, so the estimate counts the stories left for a person the same way the run does.
 *
 * @returns {{ framework: string, items: object[], check: { typeChecked: number, noStorybook: number, needsValue: number, storybookMissing: number, didNotCompile: number } }}
 */
export function planStories({ ts, root, tsconfigs, inventory, dataBoundImports = [] }) {
  const coverage = storyCoverage({ ts, root, tsconfigs })
  const framework = storybookPackage(root, coverage.framework)
  const configs = findStorybookConfigs({ ts, root })
  const taken = new Set()
  const fileUses = new Map()
  for (const entry of inventory.entries) fileUses.set(entry.file, (fileUses.get(entry.file) ?? 0) + 1)
  const entries = new Map(inventory.entries.map((entry) => [`${entry.file}#${entry.name}`, entry]))

  let items = inventory.entries.map((entry) => {
    const id = `${entry.file}#${entry.name}`
    const base = { id, name: entry.name, file: entry.file, kind: entry.kind }
    if (entry.kind === 'icon-set') return { ...base, status: 'skipped', reason: 'an icon set is shown by its own page, not by a story for each icon' }
    const abs = path.join(root, entry.file)
    if (coverage.covered.has(toPosix(abs))) return { ...base, status: 'exists' }
    const sourceFile = parseSource(ts, abs)
    const reasons = dataBoundReasons(ts, sourceFile, dataBoundImports)
    if (reasons.length > 0) return { ...base, status: 'data-bound', reasons }
    const found = findComponent(ts, sourceFile, entry.name)
    if (!found) return { ...base, status: 'skipped', reason: 'Klaus cannot tell how the file exports this component' }
    const { args, blocked } = storyArgs(entry)
    if (blocked) return { ...base, status: 'skipped', cause: 'needs-value', reason: blocked }
    const ext = /\.[jt]sx$|\.[jt]s$/.exec(entry.file)?.[0] ?? '.tsx'
    const typed = !/\.jsx?$/.test(ext)
    const dir = path.posix.dirname(entry.file)
    const stem = path.posix.basename(entry.file).replace(/\.[^.]+$/, '')
    const first = `${dir}/${fileUses.get(entry.file) > 1 ? entry.name : stem}.stories${typed ? '.tsx' : '.jsx'}`
    if (taken.has(first) || fs.existsSync(path.join(root, first)) || STORY_FILE_VARIANTS.some((v) => fs.existsSync(path.join(root, first.replace(/\.stories\.[jt]sx$/, `.stories${v}`))))) {
      return { ...base, status: 'skipped', reason: `${first} already exists and does not import this component` }
    }
    // A story that no Storybook loads is never drawn, and nothing type-checks it where it sits.
    const { loadedBy, unreadable } = storybookFor(configs, path.join(root, first))
    if (!loadedBy) {
      return unreadable.length > 0
        ? { ...base, status: 'skipped', cause: 'unreadable-storybook', reason: `Klaus cannot tell whether a Storybook loads stories from this folder: ${unreadable.map((c) => `${path.posix.relative(root, c.file)} (${c.unreadable})`).join('; ')}` }
        : { ...base, status: 'skipped', cause: 'no-storybook', reason: NO_STORYBOOK }
    }
    taken.add(first)
    const importPath = `./${stem}`
    // Storybook's `fn` when the story's package can import it, else a plain handler.
    const spy = spyModule({ ts, tsconfigs, file: path.join(root, first) })
    return { ...base, status: 'write', storyFile: first, importPath, isDefault: found.isDefault && !found.named, typed, args: spy ? storyArgs(entry, { spy: true }).args : args, spy, framework: loadedBy.framework ?? framework }
  })

  // Every story is compiled before any file exists. A plain JavaScript story has no types to check.
  const toCheck = items.filter((item) => item.status === 'write' && item.typed)
  const problems = toCheck.length === 0
    ? new Map()
    : checkStories({
        ts,
        root,
        tsconfigs,
        canFill: (name, type) => sampleValue(name, type) !== null,
        stories: toCheck.map((item) => ({
          id: item.id,
          file: item.storyFile,
          name: item.name,
          importPath: item.importPath,
          isDefault: item.isDefault,
          framework: item.framework,
          args: item.args,
          text: renderStory({ entry: entries.get(item.id), importPath: item.importPath, isDefault: item.isDefault, framework: item.framework, typed: item.typed, args: item.args, spy: item.spy }),
        })),
      })
  items = items.map((item) => {
    const problem = problems.get(item.id)
    if (!problem) return item
    const { storyFile, importPath, isDefault, typed, args, spy: _spy, framework: _framework, ...rest } = item
    return { ...rest, status: 'skipped', cause: problem.cause, reason: problem.reason }
  })

  const count = (cause) => items.filter((item) => item.cause === cause).length
  const check = { typeChecked: toCheck.length, noStorybook: count('no-storybook') + count('unreadable-storybook'), needsValue: count('needs-value'), storybookMissing: count('storybook-missing'), didNotCompile: count('does-not-compile') }
  return { framework, items, check }
}

const STORY_FILE_VARIANTS = ['.tsx', '.ts', '.jsx', '.js', '.mdx']
