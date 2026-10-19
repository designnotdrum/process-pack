/**
 * Which stories a repo's Storybook loads. A story is only drawn if some Storybook config lists its
 * path, so a story written anywhere else is never seen. The configs are read as source, not run:
 * `stories` is read from the object the config exports, and the patterns are matched here.
 */
import fs from 'node:fs'
import path from 'node:path'
import { toPosix } from '../inventory/files.mjs'
import { parseSource } from './source.mjs'

/** Folders that never hold a config the repo uses. */
export const NOT_SEARCHED = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', 'storybook-static', '.next', '.turbo', '.klaus'])

const CONFIG_FILE = /^main\.[cm]?[jt]sx?$/
/** What Storybook matches when a `stories` entry names a directory and no files. */
const DEFAULT_FILES = '**/*.@(mdx|stories.@(mdx|js|jsx|mjs|ts|tsx))'

class UnsupportedPattern extends Error {}

/**
 * A glob as a regular expression over a whole path. It covers what Storybook configs use: `*`,
 * `**`, `?`, `{a,b}`, `[abc]` and the extended groups `@(a|b)`, `?(a|b)`, `+(a|b)` and `*(a|b)`.
 * A negated group, `!(a|b)`, is not covered and throws.
 */
export function globRegExp(glob) {
  let out = ''
  const groups = []
  const escape = (c) => c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    const next = glob[i + 1]
    if ('?+*@!'.includes(c) && next === '(') {
      if (c === '!') throw new UnsupportedPattern('a negated group')
      groups.push({ kind: 'extended', after: c === '?' || c === '+' || c === '*' ? c : '' })
      out += '(?:'
      i += 1
    } else if (c === '*' && next === '*') {
      if (glob[i + 2] === '/') {
        out += '(?:[^/]+/)*'
        i += 2
      } else {
        out += '.*'
        i += 1
      }
    } else if (c === '*') out += '[^/]*'
    else if (c === '?') out += '[^/]'
    else if (c === '{') {
      groups.push({ kind: 'brace', after: '' })
      out += '(?:'
    } else if (c === '}' && groups.at(-1)?.kind === 'brace') {
      groups.pop()
      out += ')'
    } else if (c === ')' && groups.at(-1)?.kind === 'extended') out += `)${groups.pop().after}`
    else if (c === ',' && groups.at(-1)?.kind === 'brace') out += '|'
    else if (c === '|' && groups.at(-1)?.kind === 'extended') out += '|'
    else if (c === '[') {
      const close = glob.indexOf(']', i + 2)
      if (close < 0) throw new UnsupportedPattern('an unclosed bracket')
      const body = glob.slice(i + 1, close)
      out += `[${body.startsWith('!') ? `^${body.slice(1)}` : body}]`
      i = close
    } else if (c === '\\' && next !== undefined) {
      out += escape(next)
      i += 1
    } else out += escape(c)
  }
  if (groups.length > 0) throw new UnsupportedPattern('an unclosed group')
  return new RegExp(`^${out}$`)
}

const unwrap = (ts, node) => {
  let current = node
  while (current && (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isNonNullExpression(current))) current = current.expression
  return current
}

/** The initializer of the first property with this name, searching the whole file. */
function propertyNamed(ts, sourceFile, name) {
  let found = null
  const visit = (node) => {
    if (found) return
    if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) && node.name.text === name) {
      found = ts.isShorthandPropertyAssignment(node) ? node.name : node.initializer
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

/** A value that is a name declared in the file is read as what it was declared with. */
function resolveLocal(ts, sourceFile, node) {
  const value = unwrap(ts, node)
  if (!value || !ts.isIdentifier(value)) return value
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    const declaration = statement.declarationList.declarations.find((d) => ts.isIdentifier(d.name) && d.name.text === value.text && d.initializer)
    if (declaration) return unwrap(ts, declaration.initializer)
  }
  return value
}

const propertyOf = (ts, object, name) => object.properties.find((p) => ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) && p.name.text === name)?.initializer

/** The Storybook framework package a config names: a string, `{ name }`, or a call such as `getAbsolutePath("...")`. */
function frameworkOf(ts, sourceFile, node) {
  let found = null
  const visit = (n) => {
    if (found) return
    if (ts.isStringLiteralLike(n) && /^(?:@storybook\/|storybook-)/.test(n.text)) found = n.text.replace(/\/package\.json$/, '')
    else ts.forEachChild(n, visit)
  }
  visit(resolveLocal(ts, sourceFile, node) ?? node)
  return found
}

/**
 * Reads one config. `globs` are the patterns as regular expressions over absolute paths. A config
 * whose `stories` cannot be read as plain patterns has `unreadable` set, with the reason.
 *
 * @returns {{ file: string, dir: string, framework: string | null, globs: RegExp[], unreadable: string | null }}
 */
export function readStorybookConfig(ts, file) {
  const dir = path.dirname(path.dirname(file))
  const config = { file: toPosix(file), dir: toPosix(dir), framework: null, globs: [], unreadable: null }
  let sourceFile
  try {
    sourceFile = parseSource(ts, file)
  } catch {
    return { ...config, unreadable: 'the file cannot be read' }
  }
  const framework = propertyNamed(ts, sourceFile, 'framework')
  if (framework) config.framework = frameworkOf(ts, sourceFile, framework)
  const stories = resolveLocal(ts, sourceFile, propertyNamed(ts, sourceFile, 'stories'))
  if (!stories || !ts.isArrayLiteralExpression(stories)) return { ...config, unreadable: 'it has no `stories` list that is written out in the file' }
  // Patterns are relative to the `.storybook` folder, where Storybook looks for the config.
  const base = path.dirname(file)
  try {
    for (const element of stories.elements) {
      const entry = resolveLocal(ts, sourceFile, element)
      let pattern
      if (entry && ts.isStringLiteralLike(entry)) pattern = entry.text
      else if (entry && ts.isObjectLiteralExpression(entry)) {
        const directory = propertyOf(ts, entry, 'directory')
        const files = propertyOf(ts, entry, 'files')
        if (!directory || !ts.isStringLiteralLike(directory) || (files && !ts.isStringLiteralLike(files))) return { ...config, globs: [], unreadable: 'an entry of `stories` is not a plain pattern' }
        pattern = `${directory.text.replace(/\/$/, '')}/${files ? files.text : DEFAULT_FILES}`
      } else return { ...config, globs: [], unreadable: 'an entry of `stories` is not a plain pattern' }
      if (pattern.startsWith('!')) return { ...config, globs: [], unreadable: 'it excludes files with a `!` pattern' }
      config.globs.push(globRegExp(toPosix(path.join(base, pattern))))
    }
  } catch (error) {
    if (error instanceof UnsupportedPattern) return { ...config, globs: [], unreadable: `a pattern in \`stories\` uses ${error.message}` }
    throw error
  }
  return config
}

/** Every Storybook config in the repo: `main.*` in a folder named `.storybook`. Links are not followed. */
export function findStorybookConfigs({ ts, root }) {
  const found = []
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!NOT_SEARCHED.has(entry.name)) visit(full)
      } else if (entry.isFile() && path.basename(dir) === '.storybook' && CONFIG_FILE.test(entry.name)) found.push(readStorybookConfig(ts, full))
    }
  }
  visit(root)
  return found.sort((a, b) => (a.file < b.file ? -1 : 1))
}

/**
 * Which config loads a story at this path, if any.
 *
 * @returns {{ loadedBy: object | null, unreadable: object[] }} `unreadable` lists the configs that might
 * load it but could not be read, which matters only when `loadedBy` is null.
 */
export function storybookFor(configs, absStoryPath) {
  const file = toPosix(absStoryPath)
  const loadedBy = configs.find((config) => config.globs.some((glob) => glob.test(file))) ?? null
  return { loadedBy, unreadable: configs.filter((config) => config.unreadable) }
}
