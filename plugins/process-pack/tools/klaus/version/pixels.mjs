import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { UserError } from '../frame/errors.mjs'
import * as bundled from './bundled-diff.mjs'

/** Where Dieter keeps its pixel diff in Meridian. A repo that has a file here uses it. */
export const DIETER_DIFF = 'scripts/dieter/regression/diff.mjs'

/**
 * Picks the pixel diff. `auto` uses the repo's own Dieter diff when the file is there and the
 * bundled one when it is not. `bundled` forces the bundled one. Anything else is a path to a
 * module that exports `diffMask` and `findRegions` the way Dieter's does.
 *
 * Using the repo's diff means a capture counts as changed under the same noise threshold the
 * repo's own regression check uses.
 *
 * @returns {Promise<{ name: string, lib: typeof bundled }>}
 */
export async function loadPixelDiff(root, choice = 'auto') {
  if (choice === 'bundled') return { name: 'bundled', lib: bundled }
  const dieter = path.join(root, DIETER_DIFF)
  const file = choice === 'auto' ? (fs.existsSync(dieter) ? dieter : null) : path.resolve(root, choice)
  if (!file) return { name: 'bundled', lib: bundled }
  if (!fs.existsSync(file)) throw new UserError(`The pixel diff module ${file} does not exist.`)
  let loaded
  try {
    loaded = await import(pathToFileURL(file).href)
  } catch (error) {
    throw new UserError(`Could not load the pixel diff ${file}: ${error.message.split('\n')[0]} Run Klaus with --diff bundled to use the bundled diff instead.`)
  }
  if (typeof loaded.diffMask !== 'function' || typeof loaded.findRegions !== 'function') throw new UserError(`${file} must export diffMask and findRegions.`)
  // A module that does not export `readPng` has its PNGs read by the bundled reader.
  return { name: choice === 'auto' ? 'dieter' : file, lib: { ...bundled, ...loaded } }
}

function readImage(lib, file) {
  try {
    return lib.readPng(fs.readFileSync(file))
  } catch (error) {
    throw new UserError(`Cannot read ${file}: ${error.message}`)
  }
}

/**
 * Whether the capture shows something different from the stored screenshot. A capture of another
 * size is different. Otherwise it is different when at least one group of changed pixels is left
 * after the diff drops its noise.
 *
 * @returns {{ changed: boolean, detail: string }}
 */
export function capturesDiffer(lib, storedFile, captureFile) {
  const stored = readImage(lib, storedFile)
  const next = readImage(lib, captureFile)
  if (stored.width !== next.width || stored.height !== next.height) {
    return { changed: true, detail: `size ${stored.width}x${stored.height} to ${next.width}x${next.height}` }
  }
  let count
  let regions
  try {
    // The diff runs with its own defaults, so a repo's diff decides what counts as noise.
    const found = lib.diffMask(stored, next)
    count = found.count
    if (count > 0) regions = lib.findRegions(found.mask, stored.width, stored.height).regions
  } catch (error) {
    throw new UserError(`The pixel diff failed on ${captureFile}: ${error.message}`)
  }
  if (count === 0) return { changed: false, detail: 'identical' }
  const pixels = regions.reduce((sum, region) => sum + region.pixels, 0)
  return regions.length
    ? { changed: true, detail: `${regions.length} changed ${regions.length === 1 ? 'region' : 'regions'}, ${pixels} pixels` }
    : { changed: false, detail: `${count} pixels differ, all under the noise threshold` }
}
