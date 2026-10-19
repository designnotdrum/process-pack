import { createRequire } from 'node:module'
import path from 'node:path'
import { UserError } from '../frame/errors.mjs'
import { isRepoFile, pascalCase } from './files.mjs'

/**
 * TypeScript is the target repo's own copy, not one Klaus ships: the compiler has to read the
 * repo's code with the repo's version, and the copy in `scripts/klaus/` has no node_modules.
 */
export function loadTypeScript(root) {
  try {
    return createRequire(path.join(root, 'package.json'))('typescript')
  } catch {
    throw new UserError(`Cannot find the "typescript" package from ${root}. Install it in the repo, Klaus reads components with the repo's own copy.`)
  }
}

/**
 * A callable whose return type reads like a rendered element is a component, whatever wraps it.
 * One that only ever returns null is a component too: it runs an effect and renders nothing.
 * A bare `Element` has to count: some libraries' types print as `Element` and not `JSX.Element`.
 * It does not match `HTMLElement`. The check is a heuristic: a capitalized function typed
 * `() => ReactNode` that is not a component is matched too.
 */
const RENDERS = /\b(?:Element|ReactNode|ReactElement|ReactPortal)\b|^null$/

const TYPE_LIMIT = 200

/**
 * Reads the components a file exports. `checker` must belong to a program that contains the file.
 * Components are returned in source order.
 */
export function readComponents(ts, checker, sourceFile, root) {
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
  if (!moduleSymbol) return []
  const byDeclaration = new Map()

  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0]
    // A re-export from another file is that file's component, not this one's.
    if (!declaration || declaration.getSourceFile() !== sourceFile) continue
    if (!(symbol.flags & ts.SymbolFlags.Value)) continue

    const isDefault = exported.getName() === 'default'
    const name = isDefault ? defaultName(symbol, declaration, sourceFile) : exported.getName()
    if (!/^[A-Z]/.test(name) || !isComponent(ts, checker, symbol, declaration)) continue

    // `export function X` plus `export default X` is one component exported twice. Keep the named export.
    const twin = byDeclaration.get(declaration)
    if (twin) {
      twin.isDefault ||= isDefault
      if (!isDefault) twin.name = name
      continue
    }

    const { props, variants } = readProps(ts, checker, symbol, declaration, root)
    byDeclaration.set(declaration, {
      name,
      isDefault,
      position: declaration.getStart(sourceFile),
      props,
      variants,
      purpose: parsePurpose(docCommentAbove(ts, declaration)),
    })
  }
  return [...byDeclaration.values()].sort((a, b) => a.position - b.position)
}

function defaultName(symbol, declaration, sourceFile) {
  if (symbol.getName() !== 'default') return symbol.getName()
  return declaration.name?.text ?? pascalCase(path.basename(sourceFile.fileName))
}

function isComponent(ts, checker, symbol, declaration) {
  if (ts.isClassDeclaration(declaration)) {
    const extended = (declaration.heritageClauses ?? []).find((h) => h.token === ts.SyntaxKind.ExtendsKeyword)
    return /Component$/.test(extended?.types[0]?.expression.getText() ?? '')
  }
  const type = checker.getTypeOfSymbolAtLocation(symbol, declaration)
  if (type.getCallSignatures().some((s) => RENDERS.test(checker.typeToString(checker.getReturnTypeOfSignature(s))))) return true
  // Types do not always resolve (no React installed, a path alias that does not load), so fall back to the shape of the code.
  const fn = functionOf(ts, declaration)
  return fn ? containsJsx(ts, fn) : false
}

/** The function behind `function X`, `const X = () =>`, or a wrapper call such as `forwardRef(...)`. */
function functionOf(ts, declaration) {
  if (ts.isFunctionDeclaration(declaration)) return declaration
  let node = ts.isVariableDeclaration(declaration) ? declaration.initializer : ts.isExportAssignment(declaration) ? declaration.expression : undefined
  while (node && ts.isCallExpression(node)) {
    const inner = node.arguments.find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a) || ts.isCallExpression(a))
    node = inner
  }
  return node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) ? node : undefined
}

function containsJsx(ts, node) {
  let found = false
  const visit = (n) => {
    if (found) return
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) found = true
    else ts.forEachChild(n, visit)
  }
  visit(node)
  return found
}

/**
 * The doc comment directly above the exported component. A comment on a prop sits inside the
 * props type, so it is never picked up here: the statement is the only place that is read.
 */
function docCommentAbove(ts, declaration) {
  const statement = ts.isVariableDeclaration(declaration) ? declaration.parent.parent : declaration
  const docs = ts.getJSDocCommentsAndTags(statement).filter((d) => ts.isJSDoc(d))
  const doc = docs[docs.length - 1]
  return doc?.comment ? ts.getTextOfJSDocComment(doc.comment) ?? '' : ''
}

/**
 * A purpose has two parts, "Use when: ..." and "Not for: ...". A comment without those labels is
 * kept as written in `text` so a reader can see it exists and still needs rewriting.
 */
export function parsePurpose(raw) {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!text) return null
  const purpose = { useWhen: null, notFor: null, text }
  const labels = [...text.matchAll(/\b(use when|not for)\s*:\s*/gi)]
  labels.forEach((label, i) => {
    const end = i + 1 < labels.length ? labels[i + 1].index : text.length
    const value = text.slice(label.index + label[0].length, end).trim()
    const key = label[1].toLowerCase() === 'use when' ? 'useWhen' : 'notFor'
    if (value && purpose[key] === null) purpose[key] = value
  })
  return purpose
}

/** Props the repo declares itself. Everything inherited from React, the DOM or a library is left out. */
export function ownProp(prop, root) {
  const declarations = prop.declarations ?? []
  if (!declarations.length) return true
  return declarations.some((d) => isRepoFile(d.getSourceFile().fileName, root))
}

function propsTypeOf(ts, checker, symbol, declaration) {
  const type = checker.getTypeOfSymbolAtLocation(symbol, declaration)
  const call = type.getCallSignatures()[0]
  if (call) {
    const param = call.getParameters()[0]
    return param ? checker.getTypeOfSymbolAtLocation(param, declaration) : undefined
  }
  const construct = type.getConstructSignatures()[0]
  const propsSymbol = construct && checker.getPropertyOfType(construct.getReturnType(), 'props')
  return propsSymbol ? checker.getTypeOfSymbolAtLocation(propsSymbol, declaration) : undefined
}

function readProps(ts, checker, symbol, declaration, root) {
  const propsType = propsTypeOf(ts, checker, symbol, declaration)
  if (!propsType || propsType.flags & ts.TypeFlags.Any) return { props: [], variants: {} }

  // A props type that is a union of object types lists the props every member shares, which would
  // hide most of them. Merge the members instead. A prop is required only if every member has it and requires it.
  // `undefined` comes from an optional parameter and is not a member; any other non-object member is not read.
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

  const props = []
  const variants = {}
  for (const [name, { prop, count, required }] of [...merged].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!ownProp(prop, root)) continue
    const type = checker.getTypeOfSymbolAtLocation(prop, declaration)
    const isRequired = required && count === members.length
    props.push({ name, type: typeText(ts, checker, type, declaration, isRequired), required: isRequired })
    const options = literalOptions(ts, type)
    if (options) variants[name] = options
  }
  return { props, variants }
}

function typeText(ts, checker, type, location, required) {
  let text = checker.typeToString(type, location, ts.TypeFormatFlags.NoTruncation)
  // An optional prop always reads as `T | undefined`, which says nothing the `required` flag does not.
  if (!required) text = text.replace(/ \| undefined$/, '')
  return text.length > TYPE_LIMIT ? `${text.slice(0, TYPE_LIMIT - 3)}...` : text
}

/**
 * The options of a prop whose type is a closed set of strings or numbers, or null. This is how
 * `class-variance-authority` variants show up: `variant?: "default" | "outline" | null`.
 */
function literalOptions(ts, type) {
  const members = (type.isUnion() ? type.types : [type]).filter((t) => !(t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)))
  if (members.length < 2 || !members.every((t) => t.isStringLiteral() || t.isNumberLiteral())) return null
  const values = members.map((t) => t.value)
  // Union members come back in the order TypeScript created the types, which shifts when an
  // unrelated file changes. Sorted options keep a committed inventory from churning.
  const text = (v) => String(v)
  return values.sort((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : text(a) < text(b) ? -1 : text(a) > text(b) ? 1 : 0))
}

const squash = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Splits a file's components into families.
 *
 * A file named for one of its components is that component's family: `dialog.tsx` holds Dialog,
 * and every other component it exports is a part. When no export carries the file's name, a
 * part belongs to the shortest exported name it starts with at a word boundary, so DialogContent
 * is a part of Dialog while Toaster is not a part of Toast.
 */
export function groupFamilies(components, file) {
  const byPosition = (a, b) => a.position - b.position
  const stem = path.basename(file).replace(/\.[^.]+$/, '')
  const fileName = squash(stem === 'index' ? path.basename(path.dirname(file)) : stem)
  const named = components.find((c) => squash(c.name) === fileName)
  if (named) {
    return [{ ...named, parts: components.filter((c) => c !== named).sort(byPosition) }]
  }

  const roots = []
  const byLength = [...components].sort((a, b) => a.name.length - b.name.length || byPosition(a, b))
  for (const component of byLength) {
    const root = roots.find((r) => component.name.length > r.name.length && component.name.startsWith(r.name) && /[A-Z0-9]/.test(component.name[r.name.length]))
    if (root) root.parts.push(component)
    else roots.push({ ...component, parts: [] })
  }
  for (const root of roots) root.parts.sort(byPosition)
  return roots.sort(byPosition)
}

/**
 * Reads the components of many files. Files are grouped by the tsconfig they belong to and each
 * group gets one program, because path aliases and JSX settings differ per app.
 */
export function readAllComponents(ts, root, tsconfigs, files) {
  const groups = new Map()
  for (const file of files) {
    const key = tsconfigs.configFor(file) ?? ''
    groups.set(key, [...(groups.get(key) ?? []), file])
  }
  const components = new Map()
  for (const [configPath, group] of groups) {
    // Ambient declarations from the config are added so global types resolve as they do in the repo's own build.
    const rootNames = [...group, ...tsconfigs.ambientFilesFor(configPath || null)]
    const program = ts.createProgram({ rootNames, options: tsconfigs.optionsFor(group[0]) })
    const checker = program.getTypeChecker()
    for (const file of group) {
      const sourceFile = program.getSourceFile(file)
      components.set(file, sourceFile ? readComponents(ts, checker, sourceFile, root) : [])
    }
  }
  return components
}
