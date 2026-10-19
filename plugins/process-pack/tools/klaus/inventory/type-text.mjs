import path from 'node:path'
import { BUILD_OUTPUT_DIRS, isInside, toPosix } from './files.mjs'

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
 * - a file inside a build folder (`dist`, `build`, `out`, `.next` and the other folders in
 *   `BUILD_OUTPUT_DIRS`) is named by the folder that holds the build folder, and the folders and
 *   file name inside it are dropped: `packages/ui/dist/alignment-utils-N1JdL0Og` becomes
 *   `packages/ui`. A bundler puts a hash of the content in such a file name, so the name changes
 *   on every rebuild with no change in the source. This rule is applied after the ones above, so
 *   a dependency's `foo/dist/index` becomes `foo`, and a file outside every root and outside
 *   `node_modules` is named by the folder above its nearest build folder. It reads no file, so two
 *   checkouts and a rebuild give the same text.
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
  if (at >= 0) {
    const specifier = file.slice(at + NODE_MODULES.length)
    // The package name is one folder, or two for a scoped package, and a package can be called `build` or `out`.
    return folderAboveBuildOutput(specifier, specifier.startsWith('@') ? 2 : 1) ?? specifier
  }
  const base = bases.find((b) => isInside(file, b))
  if (base) {
    const relative = path.posix.relative(base, file)
    return folderAboveBuildOutput(relative, 0) ?? relative
  }
  // Without a root there is no telling the checkout's own folders from build folders, so the nearest build folder wins.
  const folders = file.split('/').slice(0, -1)
  const nearest = folders.findLastIndex((name) => BUILD_OUTPUT_DIRS.has(name))
  return (nearest > 0 && folders[nearest - 1]) || path.posix.basename(file)
}

/**
 * The folders above the first build folder in `specifier`, which is a path without the extension
 * the compiler leaves off, or `.` when that is the root itself. Only folders count, because
 * `src/build` is a file, and the first `firstFolder` folders are skipped. Null when there is no build folder.
 */
function folderAboveBuildOutput(specifier, firstFolder) {
  const folders = specifier.split('/').slice(0, -1)
  const at = folders.findIndex((name, i) => i >= firstFolder && BUILD_OUTPUT_DIRS.has(name))
  return at < 0 ? null : folders.slice(0, at).join('/') || '.'
}
