/**
 * Writes into the repo without following a symbolic link out of it.
 *
 * This is the same rule as install/safe-write.mjs. It is repeated here because `install/` is not
 * part of the copy that design-onboard puts in a repo, and the onboarding run has to work from
 * that copy too. Every folder from the repo root down to the file, and the file itself, must be a
 * real folder or file, or not exist yet, and whatever exists must resolve inside the repo.
 */
import fs from 'node:fs'
import path from 'node:path'
import { UserError } from '../frame/errors.mjs'

const inside = (root, target) => {
  const relative = path.relative(root, target)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

/** Throws unless target, a path below repo, is made of real folders and a real file, or of parts that do not exist yet. */
export function assertPlainPath(repo, target) {
  const given = path.resolve(repo)
  const wanted = path.resolve(target)
  if (!inside(given, wanted)) throw new UserError(`${target} is not inside the repo.`)
  const root = fs.realpathSync(given)
  let current = root
  for (const part of path.relative(given, wanted).split(path.sep)) {
    current = path.join(current, part)
    let stat
    try {
      stat = fs.lstatSync(current)
    } catch (error) {
      if (error.code === 'ENOENT') return wanted
      throw error
    }
    if (stat.isSymbolicLink()) throw new UserError(`${path.relative(root, current)} is a symbolic link. Klaus will not write through it. Remove the link and run again.`)
    if (!inside(root, fs.realpathSync(current))) throw new UserError(`${path.relative(root, current)} resolves outside the repo.`)
  }
  return wanted
}

/** Makes the folders on the way, after checking each. */
export function mkdirPlain(repo, directory) {
  const wanted = assertPlainPath(repo, directory)
  fs.mkdirSync(wanted, { recursive: true })
  assertPlainPath(repo, directory)
  return wanted
}

/** Writes a file to a temporary name in its folder, then renames it over the destination. */
export function writePlainFile(repo, file, data) {
  const wanted = assertPlainPath(repo, file)
  mkdirPlain(repo, path.dirname(wanted))
  const temporary = path.join(path.dirname(wanted), `.${path.basename(wanted)}.${process.pid}.${Date.now()}.tmp`)
  try {
    fs.writeFileSync(temporary, data, { flag: 'wx' })
    assertPlainPath(repo, wanted)
    fs.renameSync(temporary, wanted)
  } finally {
    fs.rmSync(temporary, { force: true })
  }
  return wanted
}

/** Removes a file the repo holds, after checking the path to it. */
export function removePlainFile(repo, file) {
  fs.rmSync(assertPlainPath(repo, file), { force: true })
}

/** Reads a file the repo holds, after checking the path to it. */
export function readPlainFile(repo, file) {
  return fs.readFileSync(assertPlainPath(repo, file), 'utf8')
}
