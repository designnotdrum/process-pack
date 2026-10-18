import fs from 'node:fs'
import path from 'node:path'
import { isScreenFile, screenLabel, toPosix, walk } from './files.mjs'

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs']

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

const isFile = (p) => {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

/** The source file behind a path written without its extension, or `dir/index`. */
function withExtension(base) {
  for (const ext of ['', ...EXTENSIONS]) if (isFile(base + ext) && /\.[cm]?[jt]sx?$/.test(base + ext) && !(base + ext).endsWith('.d.ts')) return base + ext
  for (const ext of EXTENSIONS) if (isFile(path.join(base, `index${ext}`))) return path.join(base, `index${ext}`)
  return null
}

/** Every string target an `exports` entry can point at, whatever conditions it nests them under. */
function targetsOf(entry) {
  if (typeof entry === 'string') return [entry]
  if (entry && typeof entry === 'object') return Object.values(entry).flatMap(targetsOf)
  return []
}

/**
 * Where a workspace package's source lives. The package.json points at the built files in
 * `dist`, which a fresh checkout does not have, so each target is mapped back to `src`.
 */
function workspaceSource(dir, subpath) {
  const pkg = readJson(path.join(dir, 'package.json'))
  const targets = subpath === '.' ? [...targetsOf(pkg.exports?.['.']), pkg.module, pkg.main, pkg.types] : [...targetsOf(pkg.exports?.[subpath]), subpath]
  for (const target of targets.filter((t) => typeof t === 'string')) {
    const stripped = target.replace(/\.d\.[cm]?ts$|\.[cm]?[jt]sx?$/, '')
    // Built output is never the answer: it is not what the repo's own code is written against.
    const candidates = [stripped.replace(/^\.\/dist\//, './src/'), `./src/${path.basename(stripped)}`, stripped].filter((c) => !c.startsWith('./dist/'))
    for (const candidate of candidates) {
      const found = withExtension(path.join(dir, candidate))
      if (found) return found
    }
  }
  return withExtension(path.join(dir, 'src', subpath === '.' ? 'index' : subpath)) ?? withExtension(path.join(dir, subpath === '.' ? 'index' : subpath))
}

/** Workspace packages by name, so `@repo/ui` resolves to its source instead of its build output. */
function findPackages(root) {
  const packages = new Map()
  for (const file of walk(root, (name) => name === 'package.json')) {
    const name = readJson(file).name
    if (typeof name === 'string') packages.set(name, path.dirname(file))
  }
  return packages
}

const hasModifier = (ts, node, kind) => (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some((m) => m.kind === kind) ?? false

/**
 * What a file imports and exports, from its syntax alone. Type-only imports are left out: a
 * type does not put a component on a screen.
 */
function readFacts(ts, file) {
  const text = fs.readFileSync(file, 'utf8')
  const kind = /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : /\.[cm]?ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JSX
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, kind)
  const facts = { imports: [], reExports: [], localExports: new Set(), dynamic: [] }
  const bindings = new Map()

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const spec = statement.moduleSpecifier.text
      const clause = statement.importClause
      if (!clause) {
        facts.imports.push({ spec, names: ['*'] })
        continue
      }
      if (clause.isTypeOnly) continue
      const names = []
      if (clause.name) {
        names.push('default')
        bindings.set(clause.name.text, { spec, imported: 'default' })
      }
      const named = clause.namedBindings
      if (named && ts.isNamespaceImport(named)) {
        names.push('*')
        bindings.set(named.name.text, { spec, imported: '*' })
      } else if (named) {
        for (const element of named.elements.filter((e) => !e.isTypeOnly)) {
          const imported = (element.propertyName ?? element.name).text
          names.push(imported)
          bindings.set(element.name.text, { spec, imported })
        }
      }
      facts.imports.push({ spec, names })
    } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      const spec = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : null
      const clause = statement.exportClause
      if (spec && !clause) facts.reExports.push({ spec, star: true, names: [] })
      else if (spec && ts.isNamespaceExport(clause)) facts.reExports.push({ spec, names: [{ imported: '*', exported: clause.name.text }] })
      else if (clause && ts.isNamedExports(clause)) {
        for (const element of clause.elements.filter((e) => !e.isTypeOnly)) {
          const local = (element.propertyName ?? element.name).text
          const exported = element.name.text
          // `import { X } from 'a'; export { X }` re-exports a's X, and a barrel is often written this way.
          const bound = spec ? { spec, imported: local } : bindings.get(local)
          if (bound) facts.reExports.push({ spec: bound.spec, names: [{ imported: bound.imported, exported }] })
          else facts.localExports.add(exported)
        }
      }
    } else if (ts.isExportAssignment(statement)) {
      const bound = ts.isIdentifier(statement.expression) ? bindings.get(statement.expression.text) : undefined
      if (bound) facts.reExports.push({ spec: bound.spec, names: [{ imported: bound.imported, exported: 'default' }] })
      else facts.localExports.add('default')
    } else if (hasModifier(ts, statement, ts.SyntaxKind.ExportKeyword)) {
      if (hasModifier(ts, statement, ts.SyntaxKind.DefaultKeyword)) facts.localExports.add('default')
      else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) facts.localExports.add(declaration.name.text)
      } else if (statement.name) facts.localExports.add(statement.name.text)
    }
  }

  if (/\bimport\s*\(/.test(text)) {
    const visit = (node) => {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
        facts.dynamic.push(node.arguments[0].text)
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  return facts
}

/**
 * Reads the import graph of the whole repo and answers where a file is used. Every shipped
 * source file in the repo is read, not only the scanned folders, because an app importing a
 * shared component sits outside the folder that component is in.
 */
export function readUsage({ ts, root, tsconfigs }) {
  const packages = findPackages(root)
  const packageNames = [...packages.keys()].sort((a, b) => b.length - a.length)
  const resolutionCaches = new Map()
  const facts = new Map(walk(root).map((file) => [file, readFacts(ts, file)]))

  function resolveImport(spec, from) {
    const name = packageNames.find((n) => spec === n || spec.startsWith(`${n}/`))
    if (name) return workspaceSource(packages.get(name), spec === name ? '.' : `./${spec.slice(name.length + 1)}`)
    const options = tsconfigs.optionsFor(from)
    if (!resolutionCaches.has(options)) resolutionCaches.set(options, ts.createModuleResolutionCache(root, (f) => f, options))
    const resolved = ts.resolveModuleName(spec, from, options, ts.sys, resolutionCaches.get(options)).resolvedModule
    if (!resolved || resolved.isExternalLibraryImport) return null
    const file = resolved.resolvedFileName
    return file.startsWith(`${toPosix(root)}/`) && !file.includes('/node_modules/') && !file.endsWith('.d.ts') ? file : null
  }

  /** Follows barrel files and renames to the file that declares an export. */
  function resolveExport(file, name, seen = new Set()) {
    const key = `${file}#${name}`
    const known = facts.get(file)
    if (seen.has(key) || !known) return null
    seen.add(key)
    for (const reExport of known.reExports) {
      for (const named of reExport.names) {
        if (named.exported !== name) continue
        const target = resolveImport(reExport.spec, file)
        if (target) return resolveExport(target, named.imported, seen) ?? { file: target, name: named.imported }
      }
    }
    if (known.localExports.has(name)) return { file, name }
    if (name !== 'default') {
      for (const reExport of known.reExports.filter((r) => r.star)) {
        const target = resolveImport(reExport.spec, file)
        const found = target && resolveExport(target, name, seen)
        if (found) return found
      }
    }
    return null
  }

  // importers.get(file) maps each file importing it to the export names it takes ('*' for all of them).
  const importers = new Map()
  const record = (from, file, name) => {
    if (!importers.has(file)) importers.set(file, new Map())
    const names = importers.get(file).get(from) ?? new Set()
    names.add(name)
    importers.get(file).set(from, names)
  }
  for (const [from, known] of facts) {
    for (const { spec, names } of known.imports) {
      const target = resolveImport(spec, from)
      if (!target) continue
      for (const name of names) {
        const declared = name === '*' ? null : resolveExport(target, name)
        record(from, declared?.file ?? target, declared?.name ?? name)
      }
    }
    for (const spec of known.dynamic) {
      const target = resolveImport(spec, from)
      if (target) record(from, target, '*')
    }
  }

  const screenCache = new Map()
  const isScreen = (file) => {
    if (!screenCache.has(file)) screenCache.set(file, isScreenFile(file, root))
    return screenCache.get(file)
  }

  return {
    /** Files that import any of `names` from `file`; `hasDefault` says whether a default import counts. */
    importersOf(file, names, hasDefault) {
      const users = []
      for (const [from, taken] of importers.get(file) ?? []) {
        if (taken.has('*') || (hasDefault && taken.has('default')) || names.some((n) => taken.has(n))) users.push(from)
      }
      return users
    },
    /** Every file that imports anything from `file`. */
    allImportersOf: (file) => [...(importers.get(file)?.keys() ?? [])],
    /** Every screen that reaches one of `files` through imports, as route labels. */
    screensFrom(files) {
      const labels = new Set()
      const seen = new Set(files)
      const queue = [...files]
      while (queue.length) {
        const file = queue.pop()
        if (isScreen(file)) labels.add(screenLabel(file, root))
        for (const from of importers.get(file)?.keys() ?? []) {
          if (!seen.has(from)) {
            seen.add(from)
            queue.push(from)
          }
        }
      }
      return [...labels].sort()
    },
  }
}
