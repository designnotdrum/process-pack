import path from 'node:path'
import { isInside, pascalCase } from '../inventory/files.mjs'
import { createTsconfigLoader } from '../inventory/tsconfig.mjs'
import { higher } from './bump.mjs'

/**
 * Reads the props of a component at two releases and says which kind of change separates them.
 *
 * Both releases are loaded into one TypeScript program, so one type checker can ask whether a prop
 * type from the old release is assignable to the type from the new one. That question gives the
 * direction of a change: a type that grew accepts everything the old one did (minor), and a type
 * that shrank rejects something it used to accept (major).
 *
 * | Change                                                       | Level |
 * | ------------------------------------------------------------ | ----- |
 * | prop removed or renamed                                      | major |
 * | type narrowed, which includes a removed cva variant value    | major |
 * | type changed in neither direction                            | major |
 * | new required prop, or an optional prop made required         | major |
 * | new optional prop, which includes one with a default         | minor |
 * | type widened, which includes a new cva variant value         | minor |
 * | required prop made optional                                  | minor |
 * | type text rewritten, each side assignable to the other       | none  |
 *
 * @typedef {{ level: 'none'|'minor'|'major', kind: string, where: string, detail?: string, inherited?: boolean }} Change
 * @typedef {{ key: string, baseFile: string, headFile: string, primary: string, names: string[] }} Job
 *   One component family. `baseFile` and `headFile` are absolute paths to the file at each release,
 *   `primary` is the family's main component and `names` lists every component to compare.
 * @typedef {{ level: 'none'|'minor'|'major', changes: Change[], note?: string, unresolved?: string[], textOnly?: true }} Comparison
 *   `unresolved` lists imports in the component's file that the compiler could not resolve. A prop
 *   typed with one reads as `any` on both sides, so a change to it cannot be seen. `textOnly` is set
 *   when the repo's TypeScript is older than 5.4 and cannot say which way a type changed.
 */

/** How far a comparison follows object types a prop is made of, such as the rows of a list prop. */
const MAX_DEPTH = 3

/**
 * Compares every job. Jobs are grouped by the tsconfig of the app they belong to and each group is
 * one program, because path aliases and JSX settings differ per app.
 *
 * Imports inside the old release resolve against the old release's own tsconfig and files, so a
 * prop typed with a type from another file reflects that type as it was.
 *
 * @param {{ ts: object, base: string, head: string, jobs: Job[] }} args `base` and `head` are the
 *   folders holding the old and the new release.
 * @returns {Map<string, Comparison>} Keyed by `job.key`.
 */
export function compareTrees({ ts, base, head, jobs }) {
  const trees = [
    { root: base, loader: createTsconfigLoader(ts, base) },
    { root: head, loader: createTsconfigLoader(ts, head) },
  ]
  const headLoader = trees[1].loader
  const groups = new Map()
  for (const job of jobs) {
    const key = headLoader.configFor(job.headFile) ?? ''
    groups.set(key, [...(groups.get(key) ?? []), job])
  }

  const results = new Map()
  for (const [configPath, group] of groups) {
    // Ambient declarations come from the new release only. They are global, so they apply to both sides.
    const rootNames = [...new Set([...group.flatMap((j) => [j.baseFile, j.headFile]), ...headLoader.ambientFilesFor(configPath || null)])]
    const failed = []
    const program = createCombinedProgram(ts, trees, headLoader.optionsFor(group[0].headFile), rootNames, failed)
    const checker = program.getTypeChecker()
    const differ = createDiffer(ts, checker)
    const isAmbient = ambientMatcher(checker)
    for (const job of group) {
      const result = compareJob(ts, checker, differ, program, job)
      const unresolved = [...new Set(failed.filter((f) => (f.file === job.baseFile || f.file === job.headFile) && !isAmbient(f.name)).map((f) => f.name))]
      results.set(job.key, { ...result, ...(unresolved.length && { unresolved }), ...(!differ.canCompareTypes && { textOnly: true }) })
    }
  }
  return results
}

/** Imports of files that are not code, such as a stylesheet or an image, have no types to lose. */
const ASSET = /\.(?:css|scss|sass|less|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|mp[34]|webm|mdx?|txt)$/i

/** Whether a module name is declared in an ambient `declare module`, which the module resolver does not see. */
function ambientMatcher(checker) {
  const names = checker.getAmbientModules().map((m) => m.name.replace(/^["']|["']$/g, ''))
  const exact = new Set(names.filter((n) => !n.includes('*')))
  const patterns = names.filter((n) => n.includes('*')).map((n) => new RegExp(`^${n.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`))
  return (name) => exact.has(name) || patterns.some((pattern) => pattern.test(name))
}

function createCombinedProgram(ts, trees, options, rootNames, failed) {
  const host = ts.createCompilerHost(options)
  const memo = new Map()
  host.resolveModuleNames = (names, containingFile) => {
    const tree = trees.find((t) => isInside(containingFile, t.root)) ?? trees[trees.length - 1]
    const directory = path.dirname(containingFile)
    return names.map((name) => {
      const key = `${tree.root}\0${directory}\0${name}`
      if (!memo.has(key)) memo.set(key, ts.resolveModuleName(name, containingFile, tree.loader.optionsFor(containingFile), host).resolvedModule)
      const resolved = memo.get(key)
      if (!resolved && !ASSET.test(name) && !containingFile.includes('/node_modules/')) failed.push({ file: containingFile, name })
      return resolved
    })
  }
  return ts.createProgram({ rootNames, options, host })
}

function compareJob(ts, checker, differ, program, job) {
  const baseSource = program.getSourceFile(job.baseFile)
  const headSource = program.getSourceFile(job.headFile)
  if (!baseSource || !headSource) {
    const missing = [!baseSource && job.baseFile, !headSource && job.headFile].filter(Boolean)
    return { level: 'none', changes: [], note: `The compiler could not load ${missing.join(' or ')}.` }
  }

  const before = exportedValues(ts, checker, baseSource)
  const after = exportedValues(ts, checker, headSource)
  const changes = []
  for (const name of job.names) {
    const prefix = name === job.primary ? '' : `${name}.`
    const b = before.get(name)
    const a = after.get(name)
    if (!b && !a) continue
    if (!b) changes.push({ level: 'minor', kind: 'component added', where: name })
    else if (!a) changes.push({ level: 'major', kind: 'component removed', where: name })
    else {
      const x = readProps(ts, checker, b, baseSource)
      const y = readProps(ts, checker, a, headSource)
      differ.diffProps({ before: x.props, after: y.props, prefix, depth: 0, out: changes, textOnly: x.generic || y.generic, sources: [baseSource, headSource] })
    }
  }
  return { level: changes.reduce((level, change) => higher(level, change.level), 'none'), changes }
}

/**
 * The values a file exports, by component name. A default export is named the way the inventory
 * names it, and a re-export from another file is that file's, not this one's.
 */
function exportedValues(ts, checker, sourceFile) {
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
  const found = new Map()
  if (!moduleSymbol) return found
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0]
    if (!declaration || declaration.getSourceFile() !== sourceFile || !(symbol.flags & ts.SymbolFlags.Value)) continue
    const isDefault = exported.getName() === 'default'
    const name = isDefault ? defaultName(symbol, declaration, sourceFile) : exported.getName()
    // `export function X` plus `export default X` is one component. The named export wins.
    if (!isDefault || !found.has(name)) found.set(name, { symbol, declaration })
  }
  return found
}

/** A default export is named for its declaration, else for its file, the way the inventory names it. */
function defaultName(symbol, declaration, sourceFile) {
  if (symbol.getName() !== 'default') return symbol.getName()
  return declaration.name?.text ?? pascalCase(path.basename(sourceFile.fileName))
}

/** The type of the first parameter, or of `props` on a class instance. */
function propsTypeOf(checker, { symbol, declaration }) {
  const type = checker.getTypeOfSymbolAtLocation(symbol, declaration)
  const call = type.getCallSignatures()[0]
  if (call) {
    const param = call.getParameters()[0]
    return { type: param && checker.getTypeOfSymbolAtLocation(param, declaration), generic: Boolean(call.typeParameters?.length) }
  }
  const construct = type.getConstructSignatures()[0]
  const propsSymbol = construct && checker.getPropertyOfType(construct.getReturnType(), 'props')
  return { type: propsSymbol && checker.getTypeOfSymbolAtLocation(propsSymbol, declaration), generic: Boolean(construct?.typeParameters?.length) }
}

function isLocalDeclaration(symbol) {
  const declaration = symbol?.declarations?.[0]
  if (!declaration) return false
  const file = declaration.getSourceFile().fileName
  return !file.includes('/node_modules/') && !/\/lib\.[^/]*\.d\.ts$/.test(file)
}

/**
 * Every prop of a component, with the ones it inherits from React, the DOM or a library. A change
 * to those can come only from the wrapper, for example an `Omit`, and that is a change to the
 * component's interface. A props type that is a union of object types is merged the way the
 * inventory merges it: a prop is required only if every member requires it.
 */
function readProps(ts, checker, exported, location) {
  const { type, generic } = propsTypeOf(checker, exported)
  const props = new Map()
  if (!type || type.flags & ts.TypeFlags.Any) return { props, generic }
  const members = (type.isUnion() ? type.types : [type]).filter((t) => t.flags & ts.TypeFlags.Object || t.isIntersection())
  const merged = new Map()
  for (const member of members) {
    for (const prop of checker.getPropertiesOfType(member)) {
      const seen = merged.get(prop.getName()) ?? { prop, count: 0, required: true }
      seen.count += 1
      seen.required &&= !(prop.flags & ts.SymbolFlags.Optional)
      merged.set(prop.getName(), seen)
    }
  }
  for (const [name, { prop, count, required }] of merged) {
    props.set(name, { optional: !(required && count === members.length), type: checker.getTypeOfSymbolAtLocation(prop, location), local: isLocalDeclaration(prop) })
  }
  return { props, generic }
}

function createDiffer(ts, checker) {
  const PRINT = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope
  const print = (type) => checker.typeToString(type, undefined, PRINT)
  const isUndefined = (type) => Boolean(type.flags & ts.TypeFlags.Undefined)
  const unionMembers = (type, dropUndefined) => (type.isUnion() ? type.types : [type]).filter((t) => !(dropUndefined && isUndefined(t))).map(print).sort()
  // `isTypeAssignableTo` is public from TypeScript 5.4. Before that, any difference in the printed type
  // counts as a change in neither direction, which is the safe answer: major.
  const assignable = typeof checker.isTypeAssignableTo === 'function' ? (a, b) => checker.isTypeAssignableTo(a, b) : null
  /** Whether everything `from` can be, other than `undefined`, is accepted by `to`. */
  const acceptsAllButUndefined = (from, to) => (from.isUnion() ? from.types : [from]).every((member) => isUndefined(member) || assignable(member, to))

  /**
   * A local object type, or an array of one: the shapes where a removed field can hide behind an
   * unchanged type name, as in `rows: Row[]`.
   */
  function nestedProps(type, location) {
    let current = type
    let suffix = ''
    if (current.isUnion()) {
      const live = current.types.filter((member) => !(member.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)))
      if (live.length !== 1) return null
      current = live[0]
    }
    if (checker.isArrayType(current)) {
      current = checker.getTypeArguments(current)[0]
      suffix = '[]'
    }
    if (!current || !(current.flags & ts.TypeFlags.Object) || current.getCallSignatures().length > 0 || !isLocalDeclaration(current.symbol)) return null
    const props = new Map()
    for (const prop of checker.getPropertiesOfType(current)) {
      props.set(prop.name, { optional: Boolean(prop.flags & ts.SymbolFlags.Optional), type: checker.getTypeOfSymbolAtLocation(prop, location), local: true })
    }
    return { props, suffix }
  }

  function diffProps({ before, after, prefix, depth, out, textOnly, sources }) {
    const add = (level, kind, where, local, detail) => out.push({ level, kind, where, ...(detail && { detail }), ...(local === false && { inherited: true }) })
    for (const [name, b] of before) {
      const where = `${prefix}${name}`
      const a = after.get(name)
      if (!a) {
        add('major', 'prop removed', where, b.local)
        continue
      }
      if (b.optional && !a.optional) add('major', 'optional prop made required', where, b.local)
      else if (!b.optional && a.optional) add('minor', 'required prop made optional', where, b.local)

      let nestedChanges = 0
      if (depth < MAX_DEPTH) {
        const nb = nestedProps(b.type, sources[0])
        const na = nestedProps(a.type, sources[1])
        if (nb && na) {
          const nested = []
          diffProps({ before: nb.props, after: na.props, prefix: `${where}${nb.suffix}.`, depth: depth + 1, out: nested, textOnly, sources })
          // A nested change that only rewrites a type the same way does not stand in for the prop's own check.
          nestedChanges = nested.filter((c) => c.level !== 'none').length
          out.push(...nested)
        }
      }
      // Always asked, even when the printed types match: an alias keeps its name when its members
      // change, so `status: RowStatus` reads the same before and after a new member.
      if (nestedChanges === 0) {
        // An optional prop reads as `T | undefined`. When only one side is optional, that `undefined`
        // belongs to the optional flag, which is already reported, so it is left out of the type check.
        const flagChanged = b.optional !== a.optional
        const was = unionMembers(b.type, flagChanged)
        const now = unionMembers(a.type, flagChanged)
        const printedBefore = print(b.type)
        const printedAfter = print(a.type)
        const same = flagChanged ? was.join('|') === now.join('|') : printedBefore === printedAfter
        const accepts = (from, to) => {
          if (textOnly || !assignable) return same
          return flagChanged ? acceptsAllButUndefined(from, to) : assignable(from, to)
        }
        const forward = accepts(b.type, a.type)
        const backward = accepts(a.type, b.type)
        const delta = [...was.filter((m) => !now.includes(m)).map((m) => `- ${m}`), ...now.filter((m) => !was.includes(m)).map((m) => `+ ${m}`)].join(', ')
        if (forward && backward) {
          if (!same && !flagChanged) add('none', 'type rewritten, same meaning', where, b.local, delta || `${printedBefore} -> ${printedAfter}`)
        } else if (forward) add('minor', 'type widened', where, b.local, delta)
        else if (backward) add('major', 'type narrowed', where, b.local, delta)
        else add('major', 'type changed incompatibly', where, b.local, delta || `${printedBefore} -> ${printedAfter}`)
      }
    }
    for (const [name, a] of after) {
      if (before.has(name)) continue
      if (a.optional) add('minor', 'optional prop added', `${prefix}${name}`, a.local)
      else add('major', 'required prop added', `${prefix}${name}`, a.local)
    }
  }

  return { diffProps, canCompareTypes: Boolean(assignable) }
}
