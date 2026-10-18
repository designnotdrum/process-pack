import zlib from 'node:zlib'
import { UserError } from '../frame/errors.mjs'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Samples per pixel for each PNG colour type: grey, RGB, palette, grey with alpha, RGBA. */
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
const DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }

/** A screenshot larger than this is not a component capture, and decoding it could use gigabytes. */
const MAX_PIXELS = 50_000_000

function paeth(left, up, upLeft) {
  const p = left + up - upLeft
  const pa = Math.abs(p - left)
  const pb = Math.abs(p - up)
  const pc = Math.abs(p - upLeft)
  if (pa <= pb && pa <= pc) return left
  return pb <= pc ? up : upLeft
}

/** Undoes the per-row filters in place and returns the pixel bytes with the filter bytes removed. */
function unfilter(raw, rowBytes, height, step) {
  const out = Buffer.alloc(rowBytes * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (rowBytes + 1)]
    const from = y * (rowBytes + 1) + 1
    const to = y * rowBytes
    for (let i = 0; i < rowBytes; i++) {
      const left = i >= step ? out[to + i - step] : 0
      const up = y > 0 ? out[to - rowBytes + i] : 0
      const upLeft = y > 0 && i >= step ? out[to - rowBytes + i - step] : 0
      let add
      if (filter === 0) add = 0
      else if (filter === 1) add = left
      else if (filter === 2) add = up
      else if (filter === 3) add = (left + up) >> 1
      else if (filter === 4) add = paeth(left, up, upLeft)
      else throw new UserError(`The PNG uses an unknown row filter (${filter}).`)
      out[to + i] = (raw[from + i] + add) & 0xff
    }
  }
  return out
}

/** One row as one number per sample, scaled to 0..255 the way pngjs scales them, except palette indexes, which stay as they are. */
function rowSamples(row, count, depth, scale) {
  if (depth === 8) return row
  const out = new Uint8Array(count)
  if (depth === 16) {
    for (let i = 0; i < count; i++) out[i] = Math.round(((row[i * 2] << 8) | row[i * 2 + 1]) * (255 / 65535))
    return out
  }
  const perByte = 8 / depth
  const mask = (1 << depth) - 1
  for (let i = 0; i < count; i++) {
    const value = (row[Math.floor(i / perByte)] >> (8 - depth * ((i % perByte) + 1))) & mask
    out[i] = scale ? Math.round((value * 255) / mask) : value
  }
  return out
}

/**
 * Reads a PNG into 8-bit RGBA, the shape Dieter's diff reads from `pngjs`: `{ width, height, data }`.
 * It reads what browsers and screenshot tools write: every colour type and bit depth, one pass.
 * It does not read interlaced files, and it ignores a colour key in `tRNS`. This is only the
 * fallback for a repo that has no pixel diff of its own.
 *
 * @param {Buffer} buffer
 * @returns {{ width: number, height: number, data: Uint8Array }}
 */
export function readPng(buffer) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(SIGNATURE)) throw new UserError('The file is not a PNG.')
  let header
  let palette = null
  let alphaTable = null
  const parts = []
  for (let at = 8; at + 8 <= buffer.length; ) {
    const length = buffer.readUInt32BE(at)
    const type = buffer.toString('latin1', at + 4, at + 8)
    const body = buffer.subarray(at + 8, at + 8 + length)
    if (body.length !== length) throw new UserError('The PNG is cut short.')
    if (type === 'IHDR') header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], color: body[9], compression: body[10], filter: body[11], interlace: body[12] }
    else if (type === 'PLTE') palette = body
    else if (type === 'tRNS') alphaTable = body
    else if (type === 'IDAT') parts.push(body)
    else if (type === 'IEND') break
    at += 12 + length
  }
  if (!header) throw new UserError('The PNG has no header.')
  const { width, height, depth, color } = header
  if (!(color in CHANNELS) || !DEPTHS[color].includes(depth) || header.compression !== 0 || header.filter !== 0) throw new UserError('The PNG uses a colour type or bit depth this reader does not support.')
  if (header.interlace !== 0) throw new UserError('The PNG is interlaced, which the bundled diff does not read. Save it without interlacing.')
  if (!width || !height || width * height > MAX_PIXELS) throw new UserError(`The PNG is ${width}x${height}, which is not a size this reader will decode.`)
  if (color === 3 && !palette) throw new UserError('The PNG is missing its palette.')

  const channels = CHANNELS[color]
  const bitsPerPixel = channels * depth
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8)
  let raw
  try {
    raw = zlib.inflateSync(Buffer.concat(parts), { maxOutputLength: (rowBytes + 1) * height })
  } catch (error) {
    throw new UserError(`The PNG pixel data cannot be read: ${error.message}`)
  }
  if (raw.length !== (rowBytes + 1) * height) throw new UserError('The PNG pixel data is shorter than its header says.')

  const pixels = unfilter(raw, rowBytes, height, Math.max(1, bitsPerPixel >> 3))
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const v = rowSamples(pixels.subarray(y * rowBytes, (y + 1) * rowBytes), width * channels, depth, color !== 3)
    for (let x = 0; x < width; x++) {
      const out = (y * width + x) * 4
      if (color === 6) data.set(v.subarray(x * 4, x * 4 + 4), out)
      else if (color === 2) data.set([v[x * 3], v[x * 3 + 1], v[x * 3 + 2], 255], out)
      else if (color === 0) data.set([v[x], v[x], v[x], 255], out)
      else if (color === 4) data.set([v[x * 2], v[x * 2], v[x * 2], v[x * 2 + 1]], out)
      else data.set([palette[v[x] * 3], palette[v[x] * 3 + 1], palette[v[x] * 3 + 2], alphaTable && v[x] < alphaTable.length ? alphaTable[v[x]] : 255], out)
    }
  }
  return { width, height, data }
}
