/**
 * Reads a component file's syntax: where a component is declared, where its doc comment sits,
 * what it imports, which class names it uses, and where it is used. The repo's own TypeScript
 * package does the parsing, the same one the inventory uses.
 */
import fs from 'node:fs'
import path from 'node:path'
import { pascalCase } from '../inventory/files.mjs'
import { DATA_BOUND_PACKAGES } from './config.mjs'

const hasModifier = (ts, node, kind) => (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some((m) => m.kind === kind) ?? false

/** Parses a file. The nodes know their parents, so `getText()` and positions work. */
export function parseSource(ts, file, text = fs.readFileSync(file, 'utf8')) {
  const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX : /\.jsx$/.test(file) ? ts.ScriptKind.JSX : /\.[cm]?ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
}

/**
 * The statement that declares the component an inventory entry names, and how the file exports it.
 * Returns null when the name is not declared in this file by syntax (a re-export, or a pattern the
 * compiler resolves but this reader does not), so the caller skips it and says so.
 *
 * @returns {{ statement: object, named: boolean, isDefault: boolean, localName: string } | null}
 */
export function findComponent(ts, sourceFile, name) {
  const base = pascalCase(path.basename(sourceFile.fileName))
  const exportedAs = new Map() // exported name -> local name, from `export { A as B }` lists
  let defaultLocal = null // `export default X`
  let anonymousDefault = null // `export default () => ...`
  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      if (ts.isIdentifier(statement.expression)) defaultLocal = statement.expression.text
      else anonymousDefault = statement
    } else if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause) && !statement.isTypeOnly) {
      for (const element of statement.exportClause.elements.filter((e) => !e.isTypeOnly)) {
        const local = (element.propertyName ?? element.name).text
        if (element.name.text === 'default') defaultLocal = local
        else exportedAs.set(element.name.text, local)
      }
    }
  }
  const localName = exportedAs.get(name) ?? name

  const declared = (statement) => {
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (statement.name) return [statement.name.text]
      return hasModifier(ts, statement, ts.SyntaxKind.DefaultKeyword) ? [base] : []
    }
    if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.filter((d) => ts.isIdentifier(d.name)).map((d) => d.name.text)
    return []
  }

  for (const statement of sourceFile.statements) {
    if (!declared(statement).includes(localName)) continue
    const exported = hasModifier(ts, statement, ts.SyntaxKind.ExportKeyword)
    const defaulted = exported && hasModifier(ts, statement, ts.SyntaxKind.DefaultKeyword)
    const isDefault = defaulted || defaultLocal === localName
    const named = (exported && !defaulted) || exportedAs.get(name) === localName || [...exportedAs.values()].includes(localName)
    if (!named && !isDefault) continue
    return { statement, named, isDefault, localName }
  }
  if (anonymousDefault && name === base) return { statement: anonymousDefault, named: false, isDefault: true, localName: base }
  return null
}

/**
 * The doc comment directly above a statement, as its start and end in the file's text. This is the
 * comment the inventory reads as the component's purpose.
 *
 * @returns {{ start: number, end: number, text: string } | null}
 */
export function docCommentOf(ts, sourceFile, statement) {
  const docs = ts.getJSDocCommentsAndTags(statement).filter((d) => ts.isJSDoc(d))
  const doc = docs[docs.length - 1]
  if (!doc) return null
  return { start: doc.pos, end: doc.end, text: sourceFile.text.slice(doc.pos, doc.end) }
}

/** What a file imports, without type-only imports: the module, the default name and the named bindings. */
export function importsOf(ts, sourceFile) {
  const found = []
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const clause = statement.importClause
    const entry = { module: statement.moduleSpecifier.text, defaultName: null, names: [], namespace: null }
    if (clause && !clause.isTypeOnly) {
      if (clause.name) entry.defaultName = clause.name.text
      const named = clause.namedBindings
      if (named && ts.isNamespaceImport(named)) entry.namespace = named.name.text
      else if (named) for (const element of named.elements.filter((e) => !e.isTypeOnly)) entry.names.push({ imported: (element.propertyName ?? element.name).text, local: element.name.text })
    }
    found.push(entry)
  }
  return found
}

const CLASS_CALLS = new Set(['cva', 'cn', 'clsx', 'twMerge', 'twJoin', 'classNames', 'cx', 'tv'])
const MAX_TOKEN = 80

/**
 * The class names a component file writes: the strings in `className` attributes and in the
 * arguments of cva, cn, clsx and the like. This is how Klaus tells whether two components look
 * alike without drawing them. A component that styles itself another way (CSS modules, inline
 * style, styled-components) has none, and its look is "not comparable".
 *
 * @returns {Set<string>}
 */
export function classTokens(ts, sourceFile) {
  const tokens = new Set()
  const addText = (text) => {
    for (const token of text.split(/\s+/)) if (token && token.length <= MAX_TOKEN) tokens.add(token)
  }
  const collect = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) addText(node.text)
    else if (ts.isTemplateExpression(node)) {
      addText(node.head.text)
      for (const span of node.templateSpans) addText(span.literal.text)
    }
    ts.forEachChild(node, collect)
  }
  const visit = (node) => {
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && (node.name.text === 'className' || node.name.text === 'class') && node.initializer) collect(node.initializer)
    else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && CLASS_CALLS.has(node.expression.text)) for (const argument of node.arguments) collect(argument)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return tokens
}

const LOCAL_DATA_HOOK_FOLDER = /(^|\/)(hooks?|data|queries|api|services|stores?)(\/|$)/
const isLocalSpecifier = (spec) => spec.startsWith('.') || spec.startsWith('@/') || spec.startsWith('~/') || spec.startsWith('#')

/**
 * Why a file counts as showing live data, or an empty list. It looks at this file only: a component
 * that renders a data-bound child is not marked. The reasons are plain strings for the report.
 */
export function dataBoundReasons(ts, sourceFile, extraPackages = []) {
  const packages = [...DATA_BOUND_PACKAGES, ...extraPackages]
  const reasons = []
  for (const item of importsOf(ts, sourceFile)) {
    const match = packages.find((p) => (p.endsWith('/') ? item.module.startsWith(p) : item.module === p || item.module.startsWith(`${p}/`)))
    if (match) reasons.push(`imports ${item.module}`)
    else if (isLocalSpecifier(item.module) && LOCAL_DATA_HOOK_FOLDER.test(item.module)) {
      const hook = item.names.find((n) => /^use[A-Z]/.test(n.imported))
      if (hook) reasons.push(`calls ${hook.imported} from ${item.module}`)
    }
  }
  let fetches = false
  const visit = (node) => {
    if (fetches) return
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'fetch') fetches = true
    else ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  if (fetches) reasons.push('calls fetch')
  return [...new Set(reasons)]
}

const SNIPPET_CHARS = 320

/**
 * Where components are used: for each importer file, the JSX elements whose tag is the component
 * or one of its parts, or the import line when none is found. At most `limit` snippets, one file
 * at a time before a second from the same file, so the checker sees different places.
 *
 * @param {object} options
 * @param {object} options.ts
 * @param {string} options.root The repo, as a real path.
 * @param {string[]} options.importers Absolute paths of the files that import the component.
 * @param {string[]} options.names The component and its parts.
 * @returns {{ file: string, line: number, text: string }[]}
 */
export function usageSnippets({ ts, root, importers, names, limit }) {
  const perFile = importers.slice().sort().map((file) => {
    let sourceFile
    try {
      sourceFile = parseSource(ts, file)
    } catch {
      return []
    }
    const rel = path.relative(root, file).split(path.sep).join('/')
    const hits = []
    const visit = (node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(sourceFile)
        if (names.includes(tag) || names.includes(tag.split('.')[0])) {
          hits.push({ file: rel, line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1, text: node.getText(sourceFile).slice(0, SNIPPET_CHARS) })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    if (hits.length === 0) {
      const line = sourceFile.text.split('\n').findIndex((l) => /^\s*import\b/.test(l) && names.some((n) => new RegExp(`\\b${n}\\b`).test(l)))
      if (line >= 0) hits.push({ file: rel, line: line + 1, text: sourceFile.text.split('\n')[line].trim().slice(0, SNIPPET_CHARS), importOnly: true })
    }
    return hits
  })
  const chosen = []
  for (let round = 0; chosen.length < limit && perFile.some((hits) => hits.length > round); round++) {
    for (const hits of perFile) if (hits[round] && chosen.length < limit) chosen.push(hits[round])
  }
  return chosen
}

/** The places a component and its parts are used, as snippets. Uses the inventory's import graph, so barrels and aliases count. */
export function snippetsFor({ ts, root, usage, entry, limit }) {
  const file = path.join(root, entry.file)
  const names = [entry.name, ...entry.parts.map((p) => p.name)]
  const importers = usage.importersOf(file, names, true).filter((f) => f !== file)
  return usageSnippets({ ts, root, importers, names, limit })
}
