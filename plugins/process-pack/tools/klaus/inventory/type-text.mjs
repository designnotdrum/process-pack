import path from 'node:path'
import { isInside, toPosix } from './files.mjs'

/**
 * A type as TypeScript prints it, with no absolute path in it.
 *
 * The compiler writes a type that is not in scope where it is printed as `import("<file>").Name`,
 * and `<file>` is the absolute path it loaded the file from, such as
 * `import("/Users/me/repo/node_modules/.pnpm/@types+react@19.2.17/node_modules/@types/react/index").ReactNode`.
 * That path would put the checkout's place on disk, often a home folder, into the inventory, and
 * two checkouts of one commit would print different types. Each such path is rewritten:
 *
 * - a file under a `node_modules` folder becomes the path below the last one, which is the
 *   package specifier: `@types/react/index`. A pnpm store folder sits before that last
 *   `node_modules`, so it goes with the rest.
 * - a file inside one of `roots` becomes relative to that root: `packages/ui/src/types`.
 * - any other file keeps only its name.
 *
 * A specifier that is not an absolute path, such as `import("react")` for a module declared with
 * `declare module`, is left as it is. Everything else in the text is left as it is too.
 *
 * The printer's own options cannot do this. The one flag that stops it naming the module,
 * `UseAliasDefinedOutsideCurrentScope`, also prints a type alias from another file by its name
 * instead of its members, which changes every such prop in the inventory. Without a module
 * resolver host, which the public `typeToString` does not take, the compiler has no other name
 * for the file than its path.
 *
 * @param {string} text
 * @param {string[]} roots Absolute folders a repo file may sit in, such as the repo root.
 */
export function relativeTypeText(text, roots) {
  if (!text.includes('import("')) return text
  const bases = [...new Set(roots.map((root) => toPosix(root).replace(/\/$/, '')))].sort((a, b) => b.length - a.length)
  return text.replace(IMPORT_TYPE, (whole, specifier) => {
    const file = specifier.replace(/\\\\/g, '\\')
    if (!ABSOLUTE.test(toPosix(file))) return whole
    return `import(${JSON.stringify(portableSpecifier(toPosix(file), bases))})`
  })
}

const IMPORT_TYPE = /import\("((?:[^"\\]|\\.)*)"\)/g
const ABSOLUTE = /^(?:\/|[A-Za-z]:\/)/
const NODE_MODULES = '/node_modules/'

function portableSpecifier(file, bases) {
  const at = file.lastIndexOf(NODE_MODULES)
  if (at >= 0) return file.slice(at + NODE_MODULES.length)
  const base = bases.find((b) => isInside(file, b))
  return base ? path.posix.relative(base, file) : path.posix.basename(file)
}
