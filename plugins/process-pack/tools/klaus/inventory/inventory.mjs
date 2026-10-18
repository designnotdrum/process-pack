#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadTypeScript, groupFamilies, readAllComponents } from './components.mjs'
import { readFolders } from './config.mjs'
import { iconDirOf, isJsxFile, isScreenFile, localRouteOf, pascalCase, resetCaches, toPosix, walk } from './files.mjs'
import { plural, renderMarkdown } from './markdown.mjs'
import { createTsconfigLoader } from './tsconfig.mjs'
import { readUsage } from './usage.mjs'

/**
 * @typedef {{ name: string, type: string, required: boolean }} Prop
 * @typedef {{ name: string, props: Prop[], variants: Record<string, (string|number)[]> }} Part
 * @typedef {{ useWhen: string|null, notFor: string|null, text: string }} Purpose
 * @typedef {object} Entry
 * @property {string} name The family name, or "Icon set".
 * @property {'shared'|'app'|'local'|'icon-set'} kind
 * @property {string} folder The configured folder the entry came from.
 * @property {string} file The component file, or the icon folder.
 * @property {string} [route] The route a local component belongs to.
 * @property {Purpose|null} purpose
 * @property {Prop[]} props Props of the family's main component.
 * @property {Record<string, (string|number)[]>} variants Props of the main component that take a closed set of values.
 * @property {Part[]} parts The other components in the family, such as DialogContent.
 * @property {string[]} [icons] The icons inside an icon set.
 * @property {string} version Filled in by the versioning step; empty here.
 * @property {string} screenshot Filled in by the screenshot step; empty here.
 * @property {string[]} usedIn Importing files for shared entries, screens for the rest.
 */

function componentEntry({ root, folder, file, family, usage }) {
  const rel = toPosix(path.relative(root, file))
  const route = folder.role === 'app' ? localRouteOf(file, root) : null
  const kind = folder.role === 'shared' ? 'shared' : route ? 'local' : 'app'
  const members = [family, ...family.parts]
  const users = usage.importersOf(file, members.map((m) => m.name), members.some((m) => m.isDefault)).filter((u) => u !== file)
  return {
    name: family.name,
    kind,
    folder: folder.path,
    file: rel,
    ...(route && { route }),
    purpose: family.purpose,
    props: family.props,
    variants: family.variants,
    parts: family.parts.map(({ name, props, variants }) => ({ name, props, variants })),
    version: '',
    screenshot: '',
    usedIn: kind === 'shared' ? users.map((u) => toPosix(path.relative(root, u))).sort() : usage.screensFrom(users),
  }
}

function iconSetEntry({ root, folder, dir, files, components, usage }) {
  const inside = new Set(files)
  const icons = files.flatMap((file) => {
    const found = components.get(file) ?? []
    // An icon file whose export the compiler cannot place still holds an icon, named after the file.
    return found.length ? found.map((c) => c.name) : [pascalCase(path.basename(file))]
  })
  const users = [...new Set(files.flatMap((file) => usage.allImportersOf(file)))].filter((u) => !inside.has(u))
  return {
    name: 'Icon set',
    kind: 'icon-set',
    folder: folder.path,
    file: toPosix(path.relative(root, dir)),
    purpose: null,
    props: [],
    variants: {},
    parts: [],
    icons: icons.sort(),
    version: '',
    screenshot: '',
    usedIn: folder.role === 'shared' ? users.map((u) => toPosix(path.relative(root, u))).sort() : usage.screensFrom(users),
  }
}

/**
 * Walks the folders and returns the inventory. Nothing is written, so the caller decides where
 * the files go.
 *
 * @param {{ root: string, folders: { path: string, role: 'shared'|'app' }[] }} options
 * @returns {{ schemaVersion: 1, folders: object[], entries: Entry[] }}
 */
export function buildInventory({ root: given, folders }) {
  const root = toPosix(fs.realpathSync(given))
  resetCaches()
  const ts = loadTypeScript(root)
  const tsconfigs = createTsconfigLoader(ts, root)

  // A file belongs to the first configured folder that holds it, so overlapping folders do not list it twice.
  const claimed = new Set()
  const scanned = folders.map((folder) => {
    const abs = toPosix(path.join(root, folder.path))
    const files = walk(abs).filter((f) => isJsxFile(f) && !isScreenFile(f, root) && !claimed.has(f))
    for (const f of files) claimed.add(f)
    return { folder, abs, files }
  })

  const components = readAllComponents(ts, root, tsconfigs, scanned.flatMap((s) => s.files))
  const usage = readUsage({ ts, root, tsconfigs })

  const entries = []
  for (const { folder, abs, files } of scanned) {
    const iconSets = new Map()
    for (const file of files) {
      const iconDir = iconDirOf(file, abs)
      if (iconDir) iconSets.set(iconDir, [...(iconSets.get(iconDir) ?? []), file])
      else for (const family of groupFamilies(components.get(file) ?? [], file)) entries.push(componentEntry({ root, folder, file, family, usage }))
    }
    for (const [dir, iconFiles] of iconSets) entries.push(iconSetEntry({ root, folder, dir, files: iconFiles, components, usage }))
  }

  const order = (e) => folders.findIndex((f) => f.path === e.folder)
  entries.sort((a, b) => order(a) - order(b) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || (a.name < b.name ? -1 : 1))
  return { schemaVersion: 1, folders, entries }
}

/** One line per folder, for the end of a run. */
export function summarize(inventory) {
  return inventory.folders.map((folder) => {
    const here = inventory.entries.filter((e) => e.folder === folder.path)
    const count = (kind) => here.filter((e) => e.kind === kind).length
    const icons = here.filter((e) => e.kind === 'icon-set').reduce((n, e) => n + e.icons.length, 0)
    const families = count('shared') + count('app')
    const sets = plural(count('icon-set'), 'icon set')
    return `${folder.path} (${folder.role}): ${plural(here.length, 'entry', 'entries')}, ${plural(families, 'family', 'families')}, ${count('local')} local, ${sets} with ${plural(icons, 'icon')}`
  })
}

function usage(message) {
  if (message) console.error(`${message}\n`)
  console.error(
    `
inventory.mjs [--root <dir>] [--out <dir>] [folder[:shared|:app] ...]

  --root     The repo to read. Defaults to the current directory.
  --out      Where inventory.json and INVENTORY.md are written. Defaults to the repo root.
  folder     A component folder, relative to the repo. Without any, the folders come from
             "inventory.folders" in the repo's klaus.config.json. A folder under packages/ is
             shared by default, anything else is app; add :shared or :app to say otherwise.

Writes inventory.json and INVENTORY.md. Needs the repo's own typescript package.
`.trim(),
  )
  process.exit(2)
}

function flagValue(args, flag) {
  const i = args.indexOf(flag)
  if (i < 0) return undefined
  const value = args[i + 1]
  if (value === undefined || value.startsWith('-')) usage(`${flag} needs a value.`)
  args.splice(i, 2)
  return value
}

function main(args) {
  const root = path.resolve(flagValue(args, '--root') ?? process.cwd())
  const out = path.resolve(flagValue(args, '--out') ?? root)
  if (args.some((a) => a.startsWith('-'))) usage(`Unknown option ${args.find((a) => a.startsWith('-'))}.`)

  let folders
  try {
    folders = readFolders(root, args)
  } catch (error) {
    return usage(error.message)
  }
  let inventory
  try {
    inventory = buildInventory({ root, folders })
  } catch (error) {
    return usage(error.message)
  }
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(path.join(out, 'inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`)
  fs.writeFileSync(path.join(out, 'INVENTORY.md'), renderMarkdown(inventory))
  console.log(summarize(inventory).join('\n'))
  console.log(`Wrote inventory.json and INVENTORY.md to ${out}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) main(process.argv.slice(2))
