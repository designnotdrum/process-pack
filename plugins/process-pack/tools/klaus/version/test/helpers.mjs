import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const here = path.dirname(fileURLToPath(import.meta.url))
export const fixtures = path.join(here, 'fixtures')

/** This package's node_modules, which holds the `typescript` the fixture repos are read with. */
export const klausModules = path.join(here, '..', '..', 'node_modules')

const made = []

/** A new empty folder, removed by `cleanup`. The path is resolved, because macOS reports /tmp through a link. */
export function tmpDir(label = 'klaus-version-test') {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`)))
  made.push(dir)
  return dir
}

export function cleanup() {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
}

/**
 * A folder holding copies of fixture folders, one over the next, then the given files.
 * `files` maps a path inside the tree to its text.
 */
export function makeTree(layers, files = {}) {
  const dir = tmpDir('klaus-tree')
  for (const layer of layers) fs.cpSync(path.join(fixtures, layer), dir, { recursive: true })
  writeFiles(dir, files)
  return dir
}

export function writeFiles(dir, files) {
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), text)
  }
}

export function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, '-c', 'user.name=Klaus Test', '-c', 'user.email=klaus@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** Starts a git repo in `dir` with a .gitignore that keeps the node_modules link and Klaus's own folder out of commits. */
export function initRepo(dir) {
  git(dir, 'init', '--quiet', '--initial-branch=main')
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n.klaus\n')
}

/** Commits everything and tags it. Returns the commit. */
export function commitAll(dir, message, tag) {
  git(dir, 'add', '-A')
  git(dir, 'commit', '--quiet', '-m', message)
  if (tag) git(dir, 'tag', tag)
  return git(dir, 'rev-parse', 'HEAD')
}

// A small PNG writer, so the tests need no image files and no image library.

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

const paeth = (a, b, c) => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** Applies PNG row filter `type` (0 none, 1 sub, 2 up, 3 average, 4 paeth) to a row. */
function filterRow(type, row, previous, step) {
  const out = Buffer.alloc(row.length)
  for (let i = 0; i < row.length; i++) {
    const left = i >= step ? row[i - step] : 0
    const up = previous ? previous[i] : 0
    const upLeft = previous && i >= step ? previous[i - step] : 0
    const predicted = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][type]
    out[i] = (row[i] - predicted) & 0xff
  }
  return out
}

/**
 * Writes a PNG from rows that are already packed for the given colour type and bit depth.
 * `filters` lists the row filter to use for each row, repeating from the start.
 */
export function encodeRawPng({ width, height, depth = 8, color = 6, rows, palette, transparency, filters = [0], interlace = 0 }) {
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color]
  const step = Math.max(1, Math.ceil((channels * depth) / 8))
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([depth, color, 0, 0, interlace], 8)
  const scanlines = rows.map((row, y) => {
    const type = filters[y % filters.length]
    return Buffer.concat([Buffer.from([type]), filterRow(type, row, y > 0 ? rows[y - 1] : null, step)])
  })
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    ...(palette ? [chunk('PLTE', Buffer.from(palette))] : []),
    ...(transparency ? [chunk('tRNS', Buffer.from(transparency))] : []),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(scanlines))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** An 8-bit RGBA PNG. `pixel(x, y)` returns `[r, g, b, a]`. */
export function rgbaPng(width, height, pixel, filters) {
  const rows = []
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(width * 4)
    for (let x = 0; x < width; x++) row.set(pixel(x, y), x * 4)
    rows.push(row)
  }
  return encodeRawPng({ width, height, rows, filters })
}

export const WHITE = [255, 255, 255, 255]
export const BLACK = [0, 0, 0, 255]

/** A white image with a black rectangle. Against a plain white one, `w * h` pixels differ. */
export function rectPng(width, height, { x = 0, y = 0, w = 0, h = 0 } = {}) {
  return rgbaPng(width, height, (px, py) => (px >= x && px < x + w && py >= y && py < y + h ? BLACK : WHITE))
}

/** A white image with a black square of `size` pixels at (x, y). */
export function squarePng(width, height, { x = 0, y = 0, size = 0 } = {}) {
  return rectPng(width, height, { x, y, w: size, h: size })
}
