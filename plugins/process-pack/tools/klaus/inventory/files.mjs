import fs from 'node:fs'
import path from 'node:path'

/** Directories that never hold shipped components. Hidden directories are skipped too. */
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'storybook-static', 'stories'])

/** Declaration files, tests and stories are not part of what a repo ships. */
const NOT_SHIPPED = /(?:\.d\.[cm]?ts|\.(?:test|spec|stories|story)\.[cm]?[jt]sx?)$/

const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/
const JSX_FILE = /\.[jt]sx$/

/** Next.js app router files that render a screen. `route.ts` handlers render nothing. */
const SCREEN_FILE = /^(page|layout|template|loading|error|global-error|not-found|default)\.[jt]sx?$/

/** Folder names that hold one icon set, whatever the repo calls the icons inside. */
const ICON_DIR = /^icons?$/i

export const toPosix = (p) => p.split(path.sep).join('/')

const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

function skippedDir(name) {
  return SKIPPED_DIRS.has(name) || name.startsWith('.') || /^__.+__$/.test(name)
}

/** Shipped source files, the default for `walk`. */
const isShippedSource = (name) => SOURCE.test(name) && !NOT_SHIPPED.test(name)

/** Every file under `dir` that `accept` takes, in a stable order so the output does not churn. */
export function walk(dir, accept = isShippedSource) {
  const found = []
  const visit = (current) => {
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (!skippedDir(entry.name)) visit(full)
      } else if (entry.isFile() && accept(entry.name)) {
        found.push(full)
      }
    }
  }
  visit(dir)
  return found
}

export const isJsxFile = (file) => JSX_FILE.test(file)

const packageRoots = new Map()

/** The nearest directory at or above `file` that holds a package.json, else the repo root. */
export function packageRootOf(file, root) {
  let dir = path.dirname(file)
  const visited = []
  for (;;) {
    if (packageRoots.has(dir)) {
      const known = packageRoots.get(dir)
      for (const v of visited) packageRoots.set(v, known)
      return known
    }
    visited.push(dir)
    if (fs.existsSync(path.join(dir, 'package.json')) || dir === root || dir === path.dirname(dir)) {
      for (const v of visited) packageRoots.set(v, dir)
      return dir
    }
    dir = path.dirname(dir)
  }
}

/** The app router directory this file sits in, or null. Only `app` and `src/app` at a package root count. */
export function appDirOf(file, root) {
  const pkg = packageRootOf(file, root)
  for (const candidate of ['app', path.join('src', 'app')]) {
    const dir = path.join(pkg, candidate)
    if (file.startsWith(dir + path.sep) && isDir(dir)) return dir
  }
  return null
}

/** `/admin/ai` for `app/(dashboard)/admin/ai`: route groups are not part of the URL. */
export function routeOf(appDir, dir) {
  const segments = toPosix(path.relative(appDir, dir))
    .split('/')
    .filter((s) => s && !/^\(.*\)$/.test(s))
  return `/${segments.join('/')}`
}

export function isScreenFile(file, root) {
  return SCREEN_FILE.test(path.basename(file)) && appDirOf(file, root) !== null
}

/** A screen's name in "where used": its route, with the file kind when it is not the page itself. */
export function screenLabel(file, root) {
  const appDir = appDirOf(file, root)
  const route = routeOf(appDir, path.dirname(file))
  const kind = path.basename(file).replace(/\.[jt]sx?$/, '')
  return kind === 'page' ? route : `${route} (${kind})`
}

const dirHasScreen = new Map()

function hasScreenFile(dir) {
  if (!dirHasScreen.has(dir)) {
    dirHasScreen.set(dir, fs.readdirSync(dir).some((name) => SCREEN_FILE.test(name)))
  }
  return dirHasScreen.get(dir)
}

/**
 * The route a component is local to, or null. A component is local when some folder between it
 * and the app directory (not the app directory itself) holds a screen file: the piece lives
 * beside the screen it serves. Files at the app root, and in folders like `components` or
 * `contexts` that no screen sits in, belong to the whole app.
 */
export function localRouteOf(file, root) {
  const appDir = appDirOf(file, root)
  if (!appDir) return null
  for (let dir = path.dirname(file); dir !== appDir && dir.startsWith(appDir + path.sep); dir = path.dirname(dir)) {
    if (hasScreenFile(dir)) return routeOf(appDir, dir)
  }
  return null
}

/** The nearest folder at or below `stop` that is named like an icon folder, or null. */
export function iconDirOf(file, stop) {
  for (let dir = path.dirname(file); dir.startsWith(stop); dir = path.dirname(dir)) {
    if (ICON_DIR.test(path.basename(dir))) return dir
    if (dir === stop) break
  }
  return null
}

/** `alert-triangle-icon.tsx` becomes `AlertTriangleIcon`. */
export function pascalCase(basename) {
  return basename
    .replace(/\.[^.]+$/, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('')
}
