/**
 * A pixel diff for a repo that has none of its own. It follows Dieter's, the pixel diff in
 * Meridian at `scripts/dieter/regression/diff.mjs`, and has the same exports and settings, so
 * Klaus reads "this capture changed" the same way with either:
 *
 *   `diffMask` marks the pixels that differ, with pixelmatch's rules: a colour distance over a
 *   threshold, with anti-aliased edges not counted.
 *   `findRegions` groups those pixels on a grid and drops a group of fewer than ten pixels, which
 *   is the noise threshold. A capture changed when one group is left.
 *
 * The comparison in `diffMask` is a port of pixelmatch 8.0.0 (https://github.com/mapbox/pixelmatch,
 * ISC licence, copyright 2025 Mapbox), the version Meridian pins and Dieter calls. The colour
 * distance is the OKLab HyAB distance and the numbers are the library's. It is written out here so
 * the copy of Klaus in a repo needs no install. What it leaves out is the drawing of a diff image,
 * the ignore mask and the window size, none of which a "did it change" question uses. Dieter's
 * settings come from its NJM-1726 trial, and its crop-and-merge steps do not change whether a
 * region is left.
 *
 * Another pixelmatch version measures colour differently, so a repo whose Dieter uses another
 * version should pass its own diff with `--diff` and not rely on this one agreeing with it.
 */
import { readPng } from './png.mjs'

export { readPng }

// Dieter's settings. Its `maxRegions` is left out because regions are not capped here.
export const PIXEL = {
  threshold: 0.1,
  includeAA: false,
  minRegionPixels: 10,
  cell: 8,
  gapCells: 2,
}

// sRGB [0..255] to linear [0..1].
const LIN = new Float64Array(257)
for (let i = 0; i < 256; i++) {
  const c = i / 255
  LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
LIN[256] = LIN[255]

// The matrix that takes linear RGB to LMS, applied one channel at a time for each byte value.
const channel = (k) => Float64Array.from({ length: 256 }, (_, i) => k * LIN[i])
const L_R = channel(0.4122214708)
const M_R = channel(0.2119034982)
const S_R = channel(0.0883024619)
const L_G = channel(0.5363325363)
const M_G = channel(0.6806995451)
const S_G = channel(0.2817188376)
const L_B = channel(0.0514459929)
const M_B = channel(0.1073969566)
const S_B = channel(0.6299787005)

function linLUT(x) {
  const i = x | 0
  return LIN[i] + (LIN[i + 1] - LIN[i]) * (x - i)
}

// Cube root over [0..1] from a table with linear interpolation. Near zero, where the curve is
// steepest, the exact root is used.
const CBRT_N = 4096
const CBRT = new Float64Array(CBRT_N + 2)
for (let i = 0; i <= CBRT_N + 1; i++) CBRT[i] = Math.cbrt(i / CBRT_N)
const CBRT_EXACT = 8
function cbrtLUT(x) {
  const t = x * CBRT_N
  const i = t | 0
  if (i < CBRT_EXACT) return Math.cbrt(x)
  return CBRT[i] + (CBRT[i + 1] - CBRT[i]) * (t - i)
}

const TOE_K1 = 0.206
const TOE_K2 = 0.03
const TOE_K3 = (1 + TOE_K1) / (1 + TOE_K2)

/** OKLab lightness with Ottosson's toe correction, from cube-rooted LMS values. */
function lightness(l, m, s) {
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const x = TOE_K3 * L - TOE_K1
  return 0.5 * (x + Math.sqrt(x * x + 4 * TOE_K2 * TOE_K3 * L))
}

/** 0 when the HyAB distance is within `maxDelta`, else 1, or -1 when the second pixel is darker. */
function hyabDelta(dLr, dl, dm, ds, maxDelta) {
  const rest = maxDelta - Math.abs(dLr)
  if (rest >= 0) {
    const da = 1.9779984951 * dl - 2.428592205 * dm + 0.4505937099 * ds
    const db = 0.0259040371 * dl + 0.7827717662 * dm - 0.808675766 * ds
    if (da * da + db * db <= rest * rest) return 0
  }
  return dLr > 0 ? -1 : 1
}

function colorDeltaOpaque(r1, g1, b1, r2, g2, b2, maxDelta) {
  const l1 = cbrtLUT(L_R[r1] + L_G[g1] + L_B[b1])
  const m1 = cbrtLUT(M_R[r1] + M_G[g1] + M_B[b1])
  const s1 = cbrtLUT(S_R[r1] + S_G[g1] + S_B[b1])
  const l2 = cbrtLUT(L_R[r2] + L_G[g2] + L_B[b2])
  const m2 = cbrtLUT(M_R[r2] + M_G[g2] + M_B[b2])
  const s2 = cbrtLUT(S_R[r2] + S_G[g2] + S_B[b2])
  return hyabDelta(lightness(l1, m1, s1) - lightness(l2, m2, s2), l1 - l2, m1 - m2, s1 - s2, maxDelta)
}

/** Pixels with transparency are blended over a checkerboard of dark and light backgrounds, chosen by a hash of the position. */
function colorDeltaTransparent(r1, g1, b1, a1, r2, g2, b2, a2, k, maxDelta) {
  const h = Math.imul(k >> 2, 0x9e3779b1)
  const rb = 48 + 159 * (h >>> 31)
  const gb = 48 + 159 * ((h >>> 30) & 1)
  const bb = 48 + 159 * ((h >>> 29) & 1)
  r1 = (r1 * a1 + rb * (255 - a1)) / 255
  g1 = (g1 * a1 + gb * (255 - a1)) / 255
  b1 = (b1 * a1 + bb * (255 - a1)) / 255
  r2 = (r2 * a2 + rb * (255 - a2)) / 255
  g2 = (g2 * a2 + gb * (255 - a2)) / 255
  b2 = (b2 * a2 + bb * (255 - a2)) / 255
  const lr1 = linLUT(r1)
  const lg1 = linLUT(g1)
  const lb1 = linLUT(b1)
  const lr2 = linLUT(r2)
  const lg2 = linLUT(g2)
  const lb2 = linLUT(b2)
  const l1 = cbrtLUT(0.4122214708 * lr1 + 0.5363325363 * lg1 + 0.0514459929 * lb1)
  const m1 = cbrtLUT(0.2119034982 * lr1 + 0.6806995451 * lg1 + 0.1073969566 * lb1)
  const s1 = cbrtLUT(0.0883024619 * lr1 + 0.2817188376 * lg1 + 0.6299787005 * lb1)
  const l2 = cbrtLUT(0.4122214708 * lr2 + 0.5363325363 * lg2 + 0.0514459929 * lb2)
  const m2 = cbrtLUT(0.2119034982 * lr2 + 0.6806995451 * lg2 + 0.1073969566 * lb2)
  const s2 = cbrtLUT(0.0883024619 * lr2 + 0.2817188376 * lg2 + 0.6299787005 * lb2)
  return hyabDelta(lightness(l1, m1, s1) - lightness(l2, m2, s2), l1 - l2, m1 - m2, s1 - s2, maxDelta)
}

function colorDelta(img1, img2, k, maxDelta) {
  const a1 = img1[k + 3]
  const a2 = img2[k + 3]
  if (a1 === 255 && a2 === 255) return colorDeltaOpaque(img1[k], img1[k + 1], img1[k + 2], img2[k], img2[k + 1], img2[k + 2], maxDelta)
  return colorDeltaTransparent(img1[k], img1[k + 1], img1[k + 2], a1, img2[k], img2[k + 1], img2[k + 2], a2, k, maxDelta)
}

/**
 * Brightness difference between the pixel at (r1, g1, b1, a1) and the one at offset `m`, for the
 * anti-aliasing check. It only needs the direction of a ramp, so it uses plain luma, and blends
 * transparent pixels over white.
 */
function brightnessDelta(img, m, r1, g1, b1, a1) {
  const r2 = img[m]
  const g2 = img[m + 1]
  const b2 = img[m + 2]
  const a2 = img[m + 3]
  let dr = r1 - r2
  let dg = g1 - g2
  let db = b1 - b2
  const da = a1 - a2
  if (!dr && !dg && !db && !da) return 0
  if (a1 < 255 || a2 < 255) {
    dr = (r1 * a1 - r2 * a2 - 255 * da) / 255
    dg = (g1 * a1 - g2 * a2 - 255 * da) / 255
    db = (b1 * a1 - b2 * a2 - 255 * da) / 255
    const d = dr * 0.29889531 + dg * 0.58662247 + db * 0.11448223
    return d === 0 && da ? da / 2 : d
  }
  return dr * 0.29889531 + dg * 0.58662247 + db * 0.11448223
}

/** Whether the pixel has three or more neighbours of exactly its own colour. */
function hasManySiblings(img, x1, y1, width, height) {
  const pos1 = y1 * width + x1
  const val = img[pos1]
  if (x1 > 0 && x1 < width - 1 && y1 > 0 && y1 < height - 1) {
    return (
      +(val === img[pos1 - width - 1]) +
        +(val === img[pos1 - 1]) +
        +(val === img[pos1 + width - 1]) +
        +(val === img[pos1 - width]) +
        +(val === img[pos1 + width]) +
        +(val === img[pos1 - width + 1]) +
        +(val === img[pos1 + 1]) +
        +(val === img[pos1 + width + 1]) >
      2
    )
  }
  const x0 = x1 > 0 ? x1 - 1 : 0
  const y0 = y1 > 0 ? y1 - 1 : 0
  const x2 = x1 < width - 1 ? x1 + 1 : width - 1
  const y2 = y1 < height - 1 ? y1 + 1 : height - 1
  let zeroes = x1 === x0 || x1 === x2 || y1 === y0 || y1 === y2 ? 1 : 0
  for (let x = x0; x <= x2; x++) {
    let pos = y0 * width + x
    for (let y = y0; y <= y2; y++, pos += width) {
      if (x === x1 && y === y1) continue
      zeroes += +(val === img[pos])
      if (zeroes > 2) return true
    }
  }
  return false
}

/** Whether the pixel looks like the soft edge of a shape, which is not a change. */
function antialiased(img, x1, y1, width, height, a32, b32) {
  const x0 = x1 > 0 ? x1 - 1 : 0
  const y0 = y1 > 0 ? y1 - 1 : 0
  const x2 = x1 < width - 1 ? x1 + 1 : width - 1
  const y2 = y1 < height - 1 ? y1 + 1 : height - 1
  const pos4 = (y1 * width + x1) * 4
  const cr = img[pos4]
  const cg = img[pos4 + 1]
  const cb = img[pos4 + 2]
  const ca = img[pos4 + 3]
  let zeroes = x1 === x0 || x1 === x2 || y1 === y0 || y1 === y2 ? 1 : 0
  let min = 0
  let max = 0
  let minX = 0
  let minY = 0
  let maxX = 0
  let maxY = 0
  for (let x = x0; x <= x2; x++) {
    for (let y = y0; y <= y2; y++) {
      if (x === x1 && y === y1) continue
      const delta = brightnessDelta(img, (y * width + x) * 4, cr, cg, cb, ca)
      if (delta === 0) {
        zeroes++
        if (zeroes > 2) return false
      } else if (delta < min) {
        min = delta
        minX = x
        minY = y
      } else if (delta > max) {
        max = delta
        maxX = x
        maxY = y
      }
    }
  }
  if (min === 0 || max === 0) return false
  return (hasManySiblings(a32, minX, minY, width, height) && hasManySiblings(b32, minX, minY, width, height)) || (hasManySiblings(a32, maxX, maxY, width, height) && hasManySiblings(b32, maxX, maxY, width, height))
}

/** The bytes, copied if they do not start on a four-byte boundary, which a 32-bit view needs. */
const aligned = (data) => (data.byteOffset % 4 === 0 ? data : Uint8Array.from(data))

/**
 * @returns {{ count: number, mask: Uint8Array }} `mask[y * w + x]` is 1 for a changed pixel.
 *   `ref` and `after` must be the same size.
 */
export function diffMask(ref, after, { threshold, includeAA } = PIXEL) {
  const { width: w, height: h } = ref
  if (after.width !== w || after.height !== h) throw new Error(`diffMask: size mismatch (reference ${w}x${h}, after ${after.width}x${after.height})`)
  const img1 = aligned(ref.data)
  const img2 = aligned(after.data)
  const len = w * h
  const a32 = new Uint32Array(img1.buffer, img1.byteOffset, len)
  const b32 = new Uint32Array(img2.buffer, img2.byteOffset, len)
  const mask = new Uint8Array(len)
  let count = 0
  for (let i = 0, pos = 0; i < len; i++, pos += 4) {
    if (a32[i] === b32[i] || !colorDelta(img1, img2, pos, threshold)) continue
    const x = i % w
    const y = (i / w) | 0
    if (!includeAA && (antialiased(img1, x, y, w, h, a32, b32) || antialiased(img2, x, y, w, h, b32, a32))) continue
    mask[i] = 1
    count++
  }
  return { count, mask }
}

/**
 * Groups changed pixels into regions on a grid of `cell` pixels, joining groups up to `gapCells`
 * cells apart, and drops a group of fewer than `minRegionPixels`. Dieter's version goes on to
 * merge overlapping crops and cap the count, which does not change whether a region is left.
 *
 * @returns {{ regions: Array<{ pixels: number, box: { x0: number, y0: number, x1: number, y1: number } }>, droppedGroups: number, droppedPixels: number, cappedFrom: null }}
 */
export function findRegions(mask, w, h, { minRegionPixels, cell, gapCells } = PIXEL) {
  const cw = Math.ceil(w / cell)
  const ch = Math.ceil(h / cell)
  const n = cw * ch
  const cnt = new Uint32Array(n)
  const bx0 = new Int32Array(n).fill(w)
  const by0 = new Int32Array(n).fill(h)
  const bx1 = new Int32Array(n).fill(-1)
  const by1 = new Int32Array(n).fill(-1)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue
      const c = Math.floor(y / cell) * cw + Math.floor(x / cell)
      cnt[c]++
      bx0[c] = Math.min(bx0[c], x)
      by0[c] = Math.min(by0[c], y)
      bx1[c] = Math.max(bx1[c], x)
      by1[c] = Math.max(by1[c], y)
    }
  }
  const seen = new Uint8Array(n)
  const groups = []
  for (let start = 0; start < n; start++) {
    if (!cnt[start] || seen[start]) continue
    const group = { pixels: 0, box: { x0: w, y0: h, x1: -1, y1: -1 } }
    const stack = [start]
    seen[start] = 1
    while (stack.length) {
      const c = stack.pop()
      group.pixels += cnt[c]
      group.box = { x0: Math.min(group.box.x0, bx0[c]), y0: Math.min(group.box.y0, by0[c]), x1: Math.max(group.box.x1, bx1[c]), y1: Math.max(group.box.y1, by1[c]) }
      const cx = c % cw
      const cy = Math.floor(c / cw)
      for (let dy = -gapCells; dy <= gapCells; dy++) {
        for (let dx = -gapCells; dx <= gapCells; dx++) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue
          const next = ny * cw + nx
          if (cnt[next] && !seen[next]) {
            seen[next] = 1
            stack.push(next)
          }
        }
      }
    }
    groups.push(group)
  }
  const dropped = groups.filter((g) => g.pixels < minRegionPixels)
  return {
    regions: groups.filter((g) => g.pixels >= minRegionPixels).sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0),
    droppedGroups: dropped.length,
    droppedPixels: dropped.reduce((sum, g) => sum + g.pixels, 0),
    cappedFrom: null,
  }
}
