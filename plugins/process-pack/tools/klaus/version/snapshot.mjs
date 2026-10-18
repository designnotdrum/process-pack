import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { UserError } from '../frame/errors.mjs'

/**
 * Files the compiler may need to read a component the way it was at a release: source, and the
 * config files that say how to read it. Images, lockfiles and the rest are left out, so a repo
 * with large assets costs no more to read than one without.
 */
const NEEDED = /\.(?:[cm]?[jt]sx?|json)$/
const MAX_FILE_BYTES = 1_000_000

function git(root, args, options = {}) {
  try {
    return execFileSync('git', ['-C', root, ...args], { maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'], ...options })
  } catch (error) {
    const reason = String(error.stderr ?? error.message).trim().split('\n')[0]
    throw new UserError(`git ${args[0]} failed in ${root}: ${reason}`)
  }
}

/** The commit a ref names, or a UserError when the repo does not know it. */
export function resolveCommit(root, ref) {
  try {
    return execFileSync('git', ['-C', root, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    throw new UserError(`"${ref}" is not a commit in the git repo at ${root}. Fetch the tags, or name a commit that exists.`)
  }
}

/** The commit the checkout is on, or null when `root` is not inside a git repo. */
export function headCommit(root) {
  try {
    return execFileSync('git', ['-C', root, 'rev-parse', '--verify', '--quiet', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

/** Reads many blobs through one `git cat-file` process. Returns a Map from blob id to its bytes. */
function readBlobs(root, ids) {
  const out = new Map()
  if (!ids.length) return out
  const run = spawnSync('git', ['-C', root, 'cat-file', '--batch'], { input: `${ids.join('\n')}\n`, maxBuffer: 1 << 30 })
  if (run.status !== 0) throw new UserError(`git cat-file failed in ${root}.`)
  const data = run.stdout
  let at = 0
  while (at < data.length) {
    const eol = data.indexOf(0x0a, at)
    const [id, type, size] = data.toString('utf8', at, eol).split(' ')
    if (type === 'missing') throw new UserError(`git could not find the file ${id}.`)
    const length = Number(size)
    out.set(id, data.subarray(eol + 1, eol + 1 + length))
    at = eol + 1 + length + 1
  }
  return out
}

/**
 * Unpacks the source files of a commit into a new folder outside the repo, and links the repo's
 * own node_modules folders into it. The compiler then resolves React, Radix and the rest to the
 * same files on both sides of a comparison, so a prop type from a library is one type, not two.
 * A change in a prop therefore comes from the component, never from an upgrade of a library.
 *
 * `root` may be a folder inside the git repo. Paths in the folder are relative to it.
 *
 * @returns {{ dir: string, remove: () => void }}
 */
export function snapshotCommit(root, commit) {
  const listing = git(root, ['ls-tree', '-r', '-l', '-z', commit]).toString('utf8').split('\0').filter(Boolean)
  const wanted = []
  for (const record of listing) {
    const tab = record.indexOf('\t')
    const [mode, type, id, size] = record.slice(0, tab).split(/\s+/)
    const file = record.slice(tab + 1)
    if (type !== 'blob' || mode === '120000' || !NEEDED.test(file) || Number(size) > MAX_FILE_BYTES) continue
    if (file.split('/').includes('node_modules')) continue
    wanted.push({ id, file })
  }
  const blobs = readBlobs(root, [...new Set(wanted.map((w) => w.id))])

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klaus-version-'))
  const links = []
  const remove = () => {
    // The links go first so removing the folder can never reach into the repo's node_modules.
    for (const link of links) fs.rmSync(link, { force: true })
    fs.rmSync(dir, { recursive: true, force: true })
  }
  try {
    for (const { id, file } of wanted) {
      const target = path.join(dir, file)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, blobs.get(id))
    }
    const packageDirs = new Set([''])
    for (const { file } of wanted) if (path.posix.basename(file) === 'package.json') packageDirs.add(path.posix.dirname(file) === '.' ? '' : path.posix.dirname(file))
    for (const rel of packageDirs) {
      const modules = path.join(root, rel, 'node_modules')
      if (!fs.existsSync(modules)) continue
      fs.mkdirSync(path.join(dir, rel), { recursive: true })
      const link = path.join(dir, rel, 'node_modules')
      fs.symlinkSync(modules, link, 'junction')
      links.push(link)
    }
  } catch (error) {
    remove()
    throw error
  }
  return { dir, remove }
}
