/**
 * Following a name through barrel files, with the repo's own TypeScript: which file declares what a
 * barrel re-exports, and which files a barrel reaches. A barrel is a file such as `index.ts` that
 * only re-exports. Used to tell which story draws a component, and whether one component is built
 * on another, when the import goes through a barrel.
 */
import { toPosix } from '../inventory/files.mjs'
import { parseSource } from './source.mjs'

/** True when a top-level statement declares `name`: a function, class, variable or enum. */
function declares(ts, statement, name) {
  if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === name)
  return (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name?.text === name
}

/** The module a file's own import brings each local name from, and the name it had there: `import { A as B } from './a'` gives B from './a' as A. */
function importBindings(ts, sourceFile) {
  const bindings = new Map()
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.importClause?.isTypeOnly) continue
    const { importClause } = statement
    if (importClause?.name) bindings.set(importClause.name.text, { spec: statement.moduleSpecifier.text, imported: 'default' })
    const named = importClause?.namedBindings
    if (named && ts.isNamedImports(named)) for (const element of named.elements.filter((e) => !e.isTypeOnly)) bindings.set(element.name.text, { spec: statement.moduleSpecifier.text, imported: (element.propertyName ?? element.name).text })
  }
  return bindings
}

const resolveFrom = (ts, tsconfigs, file, spec) => {
  const target = ts.resolveModuleName(spec, file, tsconfigs.optionsFor(file), ts.sys).resolvedModule?.resolvedFileName
  return target && !target.endsWith('.d.ts') ? toPosix(target) : null
}

/**
 * The file that declares an export, followed through barrel files: `export { A } from './a'`,
 * `export { A as B } from './a'`, `export * from './a'`, and `import { A } from './a'; export { A }`.
 * Null when it is not found. `seen` stops a cycle.
 */
export function declaringFile({ ts, tsconfigs, file, name, seen = new Set() }) {
  const key = `${file}#${name}`
  if (seen.has(key)) return null
  seen.add(key)
  let sourceFile
  try {
    sourceFile = parseSource(ts, file)
  } catch {
    return null
  }
  const stars = []
  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      const spec = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : null
      const clause = statement.exportClause
      if (!clause) {
        if (spec) stars.push(spec)
        continue
      }
      if (!ts.isNamedExports(clause)) continue
      for (const element of clause.elements.filter((e) => e.name.text === name)) {
        const original = (element.propertyName ?? element.name).text
        if (spec) {
          const target = resolveFrom(ts, tsconfigs, file, spec)
          return target ? (declaringFile({ ts, tsconfigs, file: target, name: original, seen }) ?? target) : null
        }
        // `export { A }` on its own: A is declared here, or imported here from another file.
        const imported = importBindings(ts, sourceFile).get(original)
        const target = imported && resolveFrom(ts, tsconfigs, file, imported.spec)
        return target ? (declaringFile({ ts, tsconfigs, file: target, name: imported.imported, seen }) ?? target) : file
      }
    } else if (declares(ts, statement, name)) return file
  }
  for (const spec of stars) {
    const target = resolveFrom(ts, tsconfigs, file, spec)
    const found = target && declaringFile({ ts, tsconfigs, file: target, name, seen })
    if (found) return found
  }
  return null
}

/** Every file a barrel file re-exports, through other barrel files too. A namespace import reaches all of them. */
export function reExportedFiles({ ts, tsconfigs, file, seen = new Set() }) {
  if (seen.has(file) || seen.size > 500) return []
  seen.add(file)
  let sourceFile
  try {
    sourceFile = parseSource(ts, file)
  } catch {
    return []
  }
  const found = []
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const target = resolveFrom(ts, tsconfigs, file, statement.moduleSpecifier.text)
    if (target) found.push(target, ...reExportedFiles({ ts, tsconfigs, file: target, seen }))
  }
  return found
}
