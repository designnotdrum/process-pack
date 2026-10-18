import fs from 'node:fs'
import path from 'node:path'
import { toPosix } from './files.mjs'

const ROLES = ['shared', 'app']

/**
 * `packages/ui/src` or `apps/web/app:app`. A folder under `packages/` is shared across apps unless
 * the role says otherwise, and anything else belongs to one app.
 */
function parseFolder(value) {
  const spec = typeof value === 'string' ? { path: value.replace(/:(shared|app)$/, ''), role: value.match(/:(shared|app)$/)?.[1] } : value
  if (!spec || typeof spec.path !== 'string' || !spec.path.trim()) throw new Error(`A folder needs a path, got ${JSON.stringify(value)}.`)
  const folder = toPosix(path.normalize(spec.path)).replace(/\/$/, '')
  const role = spec.role ?? (folder.split('/').includes('packages') ? 'shared' : 'app')
  if (!ROLES.includes(role)) throw new Error(`Folder ${folder}: role must be one of ${ROLES.join(', ')}, got ${JSON.stringify(role)}.`)
  return { path: folder, role }
}

/**
 * The folders to scan: the ones given on the command line, else `inventory.folders` in the
 * repo's klaus.config.json. The config key is namespaced because the same file holds the settings
 * for Klaus's other steps.
 */
export function readFolders(root, cliFolders = []) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`The repo ${root} does not exist.`)
  let listed = cliFolders
  if (!listed.length) {
    const configPath = path.join(root, 'klaus.config.json')
    if (!fs.existsSync(configPath)) throw new Error('No folders to scan. Pass them as arguments, or list them under "inventory.folders" in klaus.config.json.')
    let config
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    } catch (error) {
      throw new Error(`klaus.config.json in ${root} is not valid JSON: ${error.message}`)
    }
    listed = config.inventory?.folders
    if (!Array.isArray(listed) || !listed.length) throw new Error('klaus.config.json has no "inventory.folders" list, so there is nothing to scan.')
  }

  const folders = listed.map(parseFolder)
  const duplicate = folders.find((f, i) => folders.findIndex((other) => other.path === f.path) !== i)
  if (duplicate) throw new Error(`Folder ${duplicate.path} is listed twice.`)
  const realRoot = fs.realpathSync(root)
  for (const folder of folders) {
    const abs = path.resolve(root, folder.path)
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error(`Folder ${folder.path} does not exist in ${root}.`)
    // Compared as real paths, so neither `a/../../b` nor a link pointing out of the repo can step outside it.
    const fromRoot = path.relative(realRoot, fs.realpathSync(abs))
    if (fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) throw new Error(`Folder ${folder.path} is outside the repo.`)
  }
  return folders
}
