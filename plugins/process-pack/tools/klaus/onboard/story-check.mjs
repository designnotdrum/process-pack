/**
 * Type-checks the stories the plan would write, before any file, branch or model call exists.
 *
 * A repo often type-checks only at push, and a story is code like any other: a callback prop that
 * returns a promise, or a required prop the list of props does not show, makes a story that does
 * not compile. So each story is compiled here with the repo's own TypeScript and the tsconfig of
 * the package it sits in. The story text is held in memory and given to the compiler through a
 * host that answers for that path, so nothing is written and the working tree and index stay as
 * they were.
 *
 * A story is found wanting for one of three reasons, which a person reads in docs/klaus/stories.md:
 *   - a required prop of the component has no sample value (the check reads the component's real
 *     props, which include the ones a library declares and the inventory leaves out),
 *   - the package the story sits in cannot find the Storybook package its types come from,
 *   - the compiler reports another error in the story.
 */
import path from 'node:path'
import { propsTypeOf } from '../inventory/components.mjs'
import { toPosix } from '../inventory/files.mjs'
import { relativeTypeText } from '../inventory/type-text.mjs'

const MAX_SHOWN = 2
const MAX_LENGTH = 320

/** Compiler text with no absolute path in it and nothing a markdown cell would read as markup. */
export function portableText(text, root) {
  const base = `${toPosix(root).replace(/\/$/, '')}/`
  return relativeTypeText(text, [root])
    .split(base)
    .join('')
    .replace(/(?<![\w.])\/(?:[^\s'"`/]+\/){2,}([^\s'"`/]*)/g, '$1')
    .replace(/`/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** A compiler host that also serves the story files, which are not on disk. */
function hostWith(ts, options, files) {
  const host = ts.createCompilerHost(options, true)
  const { fileExists, readFile, getSourceFile } = host
  host.fileExists = (name) => files.has(toPosix(name)) || fileExists.call(host, name)
  host.readFile = (name) => files.get(toPosix(name)) ?? readFile.call(host, name)
  host.getSourceFile = (name, languageVersion, ...rest) => (files.has(toPosix(name)) ? ts.createSourceFile(name, files.get(toPosix(name)), languageVersion, true, ts.ScriptKind.TSX) : getSourceFile.call(host, name, languageVersion, ...rest))
  return host
}

/** The identifier in the story that stands for the component, from the import line the story is written with. */
function componentIdentifier(ts, sourceFile, story) {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== story.importPath) continue
    const clause = statement.importClause
    if (!clause || clause.isTypeOnly) continue
    if (story.isDefault) return clause.name
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) return clause.namedBindings.elements.find((element) => element.name.text === story.name)?.name
  }
  return undefined
}

/** The package or file a prop is declared in, for the person who reads why the component was left. */
function declaredIn(prop, root) {
  const file = prop.declarations?.[0]?.getSourceFile().fileName
  if (!file) return null
  const posix = toPosix(file)
  const inPackage = /.*\/node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(posix)
  return inPackage ? inPackage[1] : path.posix.relative(toPosix(root), posix)
}

/**
 * The first required prop, by name, that the story gives no value to. The props come from the
 * compiler and not from the inventory: the inventory lists only props the repo declares, and a
 * required prop that a library declares (a flow node's `id` and `data`, a form's `control`) is not
 * in it. A prop is required only if every member of a union of props requires it, as in the inventory.
 */
function missingRequiredProp({ ts, checker, sourceFile, story, root, canFill }) {
  const local = componentIdentifier(ts, sourceFile, story)
  let symbol = local && checker.getSymbolAtLocation(local)
  if (!symbol) return null
  if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
  const propsType = propsTypeOf(ts, checker, symbol, local)
  if (!propsType || propsType.flags & ts.TypeFlags.Any) return null

  const members = (propsType.isUnion() ? propsType.types : [propsType]).filter((t) => t.flags & ts.TypeFlags.Object || t.isIntersection())
  const merged = new Map()
  for (const member of members) {
    for (const prop of checker.getPropertiesOfType(member)) {
      const seen = merged.get(prop.getName()) ?? { prop, count: 0, required: true }
      seen.count += 1
      seen.required = seen.required && !(prop.flags & ts.SymbolFlags.Optional)
      merged.set(prop.getName(), seen)
    }
  }
  const given = new Set(story.args.map(([name]) => name))
  const missing = [...merged].filter(([name, { required, count }]) => required && count === members.length && !given.has(name)).sort(([a], [b]) => (a < b ? -1 : 1))
  if (missing.length === 0) return null
  const printed = (prop) => portableText(checker.typeToString(checker.getTypeOfSymbolAtLocation(prop, local), local, ts.TypeFormatFlags.NoTruncation), root)
  // The prop named is one Klaus has no value for, if there is one, so the reason reads true.
  const [name, { prop }] = missing.find(([propName, { prop: candidate }]) => !canFill(propName, printed(candidate))) ?? missing[0]
  const type = printed(prop)
  const shown = type.length > 60 ? `${type.slice(0, 57)}...` : type
  const where = declaredIn(prop, root)
  return `the required prop ${name} has the type \`${shown}\`, and Klaus will not invent a value for it${where ? ` (it is declared in ${where}, so the component's list of props does not show it)` : ''}`
}

/** The compiler's errors in one story file, as short plain text. */
function compilerErrors(ts, program, sourceFile, root) {
  const errors = [...program.getSyntacticDiagnostics(sourceFile), ...program.getSemanticDiagnostics(sourceFile)].filter((d) => d.category === ts.DiagnosticCategory.Error)
  const line = (d) => `TS${d.code}: ${portableText(ts.flattenDiagnosticMessageText(d.messageText, ' '), root)}`
  const shown = errors.slice(0, MAX_SHOWN).map(line).join('; ')
  const text = errors.length > MAX_SHOWN ? `${shown}; and ${errors.length - MAX_SHOWN} more` : shown
  return { count: errors.length, text: text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 3)}...` : text, missingFramework: errors.some((d) => d.code === 2307 || d.code === 7016) }
}

/**
 * Compiles each story and says which ones are not fit to write.
 *
 * @param {object} options
 * @param {object} options.ts The repo's own TypeScript.
 * @param {string} options.root The repo, as a real path.
 * @param {object} options.tsconfigs From createTsconfigLoader.
 * @param {(name: string, type: string) => boolean} options.canFill Whether a prop of this printed type can be given a sample value.
 * @param {{ id: string, file: string, text: string, name: string, importPath: string, isDefault: boolean, framework: string, args: [string, string][] }[]} options.stories
 *   The stories as the run would write them: `file` is relative to the repo.
 * @returns {Map<string, { cause: 'needs-value' | 'storybook-missing' | 'does-not-compile', reason: string }>} Only the stories with a problem.
 */
export function checkStories({ ts, root, tsconfigs, stories, canFill }) {
  const problems = new Map()
  const groups = new Map()
  for (const story of stories) {
    const key = tsconfigs.configFor(path.join(root, story.file)) ?? ''
    groups.set(key, [...(groups.get(key) ?? []), story])
  }
  for (const [configPath, group] of groups) {
    const files = new Map(group.map((story) => [toPosix(path.join(root, story.file)), story.text]))
    try {
      const options = tsconfigs.optionsFor(path.join(root, group[0].file))
      const program = ts.createProgram({ rootNames: [...files.keys(), ...tsconfigs.ambientFilesFor(configPath || null)], options, host: hostWith(ts, options, files) })
      const checker = program.getTypeChecker()
      for (const story of group) {
        const sourceFile = program.getSourceFile(toPosix(path.join(root, story.file)))
        if (!sourceFile) {
          problems.set(story.id, { cause: 'does-not-compile', reason: 'the compiler could not load the story Klaus would write, so it was not written' })
          continue
        }
        const missing = missingRequiredProp({ ts, checker, sourceFile, story, root, canFill })
        if (missing) {
          problems.set(story.id, { cause: 'needs-value', reason: missing })
          continue
        }
        const errors = compilerErrors(ts, program, sourceFile, root)
        if (errors.count === 0) continue
        const where = configPath ? `the tsconfig at ${path.posix.relative(toPosix(root), toPosix(configPath))}` : "the repo's TypeScript"
        problems.set(story.id, errors.missingFramework
          ? { cause: 'storybook-missing', reason: `the package this story sits in cannot find \`${story.framework}\`, so the story cannot compile (\`${errors.text}\`, checked with ${where}); no Storybook is installed for it` }
          : { cause: 'does-not-compile', reason: `the story Klaus would write does not type-check (\`${errors.text}\`, checked with ${where}), so it was not written` })
      }
    } catch (error) {
      for (const story of group) problems.set(story.id, { cause: 'does-not-compile', reason: `Klaus could not type-check the story it would write (${portableText(String(error?.message ?? error), root).slice(0, 200)}), so it was not written` })
    }
  }
  return problems
}
