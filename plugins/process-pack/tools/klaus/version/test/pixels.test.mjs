import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import { UserError } from '../../frame/errors.mjs'
import * as bundled from '../bundled-diff.mjs'
import { readPng } from '../png.mjs'
import { capturesDiffer, DIETER_DIFF, loadPixelDiff } from '../pixels.mjs'
import { BLACK, cleanup, encodeRawPng, pngChunk, rgbaPng, squarePng, tmpDir, WHITE, writeFiles } from './helpers.mjs'

after(cleanup)

const pixelAt = (png, x, y) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4)]

describe('the bundled PNG reader', () => {
  test('reads RGBA data back exactly, whichever row filter the file uses', () => {
    const pixel = (x, y) => [(x * 37 + y * 11) % 256, (x * 5 + y * 91) % 256, (x * 13 + y * 3) % 256, 255 - ((x + y) % 40)]
    for (const filter of [0, 1, 2, 3, 4]) {
      const png = readPng(rgbaPng(9, 7, pixel, [filter]))
      assert.equal(png.width, 9)
      assert.equal(png.height, 7)
      for (let y = 0; y < 7; y++) for (let x = 0; x < 9; x++) assert.deepEqual(pixelAt(png, x, y), pixel(x, y), `filter ${filter} at ${x},${y}`)
    }
  })

  test('reads a file that uses a different filter on every row', () => {
    const pixel = (x, y) => [x * 20, y * 20, (x + y) * 9, 255]
    const png = readPng(rgbaPng(8, 10, pixel, [0, 1, 2, 3, 4]))
    for (let y = 0; y < 10; y++) for (let x = 0; x < 8; x++) assert.deepEqual(pixelAt(png, x, y), pixel(x, y))
  })

  test('reads RGB, grey, grey with alpha and palette images', () => {
    const rgb = readPng(encodeRawPng({ width: 2, height: 1, color: 2, rows: [Buffer.from([10, 20, 30, 40, 50, 60])] }))
    assert.deepEqual([pixelAt(rgb, 0, 0), pixelAt(rgb, 1, 0)], [[10, 20, 30, 255], [40, 50, 60, 255]])

    const grey = readPng(encodeRawPng({ width: 2, height: 1, color: 0, rows: [Buffer.from([7, 200])] }))
    assert.deepEqual([pixelAt(grey, 0, 0), pixelAt(grey, 1, 0)], [[7, 7, 7, 255], [200, 200, 200, 255]])

    const greyAlpha = readPng(encodeRawPng({ width: 1, height: 1, color: 4, rows: [Buffer.from([90, 128])] }))
    assert.deepEqual(pixelAt(greyAlpha, 0, 0), [90, 90, 90, 128])

    const palette = readPng(encodeRawPng({ width: 2, height: 1, color: 3, rows: [Buffer.from([1, 0])], palette: [255, 0, 0, 0, 0, 255], transparency: [255, 100] }))
    assert.deepEqual([pixelAt(palette, 0, 0), pixelAt(palette, 1, 0)], [[0, 0, 255, 100], [255, 0, 0, 255]])
  })

  test('reads bit depths under 8 and over 8', () => {
    // Two-bit palette, four pixels in one byte: indexes 0, 1, 2, 3.
    const palette = readPng(encodeRawPng({ width: 4, height: 1, depth: 2, color: 3, rows: [Buffer.from([0b00011011])], palette: [0, 0, 0, 10, 10, 10, 20, 20, 20, 30, 30, 30] }))
    assert.deepEqual([0, 1, 2, 3].map((x) => pixelAt(palette, x, 0)[0]), [0, 10, 20, 30])

    // One-bit grey is scaled up to black and white.
    const bilevel = readPng(encodeRawPng({ width: 3, height: 1, depth: 1, color: 0, rows: [Buffer.from([0b10100000])] }))
    assert.deepEqual([0, 1, 2].map((x) => pixelAt(bilevel, x, 0)[0]), [255, 0, 255])

    // Sixteen-bit samples are scaled to eight bits, as pngjs does: 0x1234 is 18, and 0xfe80 is 254.
    const deep = readPng(encodeRawPng({ width: 1, height: 1, depth: 16, color: 6, rows: [Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xff, 0xff])] }))
    assert.deepEqual(pixelAt(deep, 0, 0), [0x12, 0x56, 0x9a, 0xff])
    const nearly = readPng(encodeRawPng({ width: 2, height: 1, depth: 16, color: 0, rows: [Buffer.from([0x01, 0xff, 0xfe, 0x80])] }))
    assert.deepEqual([pixelAt(nearly, 0, 0)[0], pixelAt(nearly, 1, 0)[0]], [2, 254])
  })

  test('refuses what it cannot read, with a message', () => {
    assert.throws(() => readPng(Buffer.from('not a png at all')), (e) => e instanceof UserError && /not a PNG/.test(e.message))
    const interlaced = encodeRawPng({ width: 1, height: 1, rows: [Buffer.from([1, 2, 3, 4])], interlace: 1 })
    assert.throws(() => readPng(interlaced), (e) => e instanceof UserError && /interlaced/.test(e.message))
    const whole = squarePng(4, 4)
    assert.throws(() => readPng(whole.subarray(0, whole.length - 30)), (e) => e instanceof UserError && /cut short/.test(e.message))
  })

  test('refuses pixel data that is far larger than the header describes', () => {
    const header = Buffer.alloc(13)
    header.writeUInt32BE(1, 0)
    header.writeUInt32BE(1, 4)
    header.set([8, 6, 0, 0, 0], 8)
    const bomb = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', header), pngChunk('IDAT', Buffer.alloc(100_000)), pngChunk('IEND', Buffer.alloc(0))])
    assert.throws(() => readPng(bomb), (e) => e instanceof UserError && /more pixel data than its header allows/.test(e.message))
  })

  test('refuses a header of the wrong size and a pixel that names a colour the palette does not have', () => {
    const png = squarePng(2, 2)
    const header = Buffer.from(png)
    header.writeUInt32BE(12, 8) // the IHDR chunk now claims 12 bytes instead of 13
    assert.throws(() => readPng(header), (e) => e instanceof UserError && /header is the wrong size/.test(e.message))

    const outOfRange = encodeRawPng({ width: 2, height: 1, color: 3, rows: [Buffer.from([0, 2])], palette: [0, 0, 0, 255, 255, 255] })
    assert.throws(() => readPng(outOfRange), (e) => e instanceof UserError && /palette index/.test(e.message))
  })
})

describe('the bundled pixel diff', () => {
  const white = (w = 40, h = 40) => readPng(squarePng(w, h))

  test('finds nothing in two identical captures', () => {
    const { count } = bundled.diffMask(white(), white())
    assert.equal(count, 0)
  })

  test('marks the pixels that changed and groups them into one region', () => {
    const before = white()
    const after = readPng(squarePng(40, 40, { x: 10, y: 12, size: 6 }))
    const { count, mask } = bundled.diffMask(before, after)
    assert.equal(count, 36)
    assert.equal(mask[12 * 40 + 10], 1)
    assert.equal(mask[0], 0)
    const { regions } = bundled.findRegions(mask, 40, 40)
    assert.equal(regions.length, 1)
    assert.equal(regions[0].pixels, 36)
    assert.deepEqual(regions[0].box, { x0: 10, y0: 12, x1: 15, y1: 17 })
  })

  test('drops a group of fewer than ten pixels as noise', () => {
    const after = readPng(squarePng(40, 40, { x: 10, y: 12, size: 3 }))
    const { count, mask } = bundled.diffMask(white(), after)
    assert.equal(count, 9)
    const found = bundled.findRegions(mask, 40, 40)
    assert.equal(found.regions.length, 0)
    assert.equal(found.droppedGroups, 1)
  })

  test('keeps two groups apart when they are more than two grid cells from each other', () => {
    const after = rgbaPng(80, 20, (x, y) => ((x >= 2 && x < 6 && y >= 2 && y < 6) || (x >= 60 && x < 64 && y >= 2 && y < 6) ? BLACK : WHITE))
    const { mask } = bundled.diffMask(readPng(squarePng(80, 20)), readPng(after))
    assert.equal(bundled.findRegions(mask, 80, 20).regions.length, 2)
  })

  test('does not count a colour shift under the threshold', () => {
    const slightly = rgbaPng(40, 40, () => [250, 250, 250, 255])
    assert.equal(bundled.diffMask(white(), readPng(slightly)).count, 0)
  })

  test('does not count a change to the soft pixels on the edge of a shape', () => {
    // Black on the left, white on the right, and a column of grey between them. The grey column
    // moves from one shade to another: that is the anti-aliasing of an edge, not a new shape.
    const column = (x, grey) => {
      if (x < 20) return BLACK
      return x === 20 ? [grey, grey, grey, 255] : WHITE
    }
    const edge = (grey) => readPng(rgbaPng(40, 40, (x) => column(x, grey)))
    assert.equal(bundled.diffMask(edge(128), edge(90)).count, 0)
    assert.equal(bundled.diffMask(edge(128), edge(90), { threshold: 0.1, includeAA: true }).count, 40)
  })

  test('refuses two captures of different sizes', () => {
    assert.throws(() => bundled.diffMask(white(40, 40), white(41, 40)), /size mismatch/)
  })
})

describe('whether a capture changed', () => {
  function files(...pngs) {
    const dir = tmpDir()
    return pngs.map((png, i) => {
      const file = path.join(dir, `${i}.png`)
      fs.writeFileSync(file, png)
      return file
    })
  }

  test('is no for identical captures', () => {
    const [a, b] = files(squarePng(40, 40), squarePng(40, 40))
    assert.deepEqual(capturesDiffer(bundled, a, b), { changed: false, detail: 'identical' })
  })

  test('is no when the difference is noise', () => {
    const [a, b] = files(squarePng(40, 40), squarePng(40, 40, { x: 5, y: 5, size: 3 }))
    const result = capturesDiffer(bundled, a, b)
    assert.equal(result.changed, false)
    assert.match(result.detail, /9 pixels differ, all under the noise threshold/)
  })

  test('is yes when a region of ten or more pixels differs', () => {
    const [a, b] = files(squarePng(40, 40), squarePng(40, 40, { x: 5, y: 5, size: 4 }))
    const result = capturesDiffer(bundled, a, b)
    assert.equal(result.changed, true)
    assert.match(result.detail, /1 changed region, 16 pixels/)
  })

  test('is yes when the capture has a different size', () => {
    const [a, b] = files(squarePng(40, 40), squarePng(40, 50))
    assert.deepEqual(capturesDiffer(bundled, a, b), { changed: true, detail: 'size 40x40 to 40x50' })
  })

  test('names the capture when the pixel diff itself throws', () => {
    const [a, b] = files(squarePng(10, 10), squarePng(10, 10))
    const broken = { ...bundled, diffMask: () => { throw new Error('boom') } }
    assert.throws(() => capturesDiffer(broken, a, b), (e) => e instanceof UserError && e.message.includes(b) && /boom/.test(e.message))
  })

  test('names the file when it is not a readable PNG', () => {
    const [a, b] = files(squarePng(10, 10), Buffer.from('nope'))
    assert.throws(() => capturesDiffer(bundled, a, b), (e) => e instanceof UserError && e.message.includes(b) && /not a PNG/.test(e.message))
  })
})

describe('choosing the pixel diff', () => {
  const fakeDiff = (marker) => `import { PIXEL, readPng } from ${JSON.stringify(new URL('../bundled-diff.mjs', import.meta.url).href)}
export { PIXEL, readPng }
export const marker = ${JSON.stringify(marker)}
export function diffMask() { return { count: 1, mask: new Uint8Array(1) } }
export function findRegions() { return { regions: [{ pixels: 99, box: { x0: 0, y0: 0, x1: 0, y1: 0 } }] } }
`

  test('uses the bundled diff when the repo has no Dieter', async () => {
    const choice = await loadPixelDiff(tmpDir(), 'auto')
    assert.equal(choice.name, 'bundled')
    assert.equal(choice.lib, bundled)
  })

  test('uses the diff the repo already has at scripts/dieter/regression/diff.mjs', async () => {
    const root = tmpDir()
    writeFiles(root, { [DIETER_DIFF]: fakeDiff('dieter') })
    const choice = await loadPixelDiff(root, 'auto')
    assert.equal(choice.name, 'dieter')
    assert.equal(choice.lib.marker, 'dieter')
    const [a, b] = [squarePng(10, 10), squarePng(10, 10)].map((png, i) => {
      const file = path.join(root, `${i}.png`)
      fs.writeFileSync(file, png)
      return file
    })
    // The fake always reports one region of 99 pixels, so a capture is "changed" only through the repo's diff.
    assert.deepEqual(capturesDiffer(choice.lib, a, b), { changed: true, detail: '1 changed region, 99 pixels' })
  })

  test('uses the bundled diff when asked to, even where Dieter exists', async () => {
    const root = tmpDir()
    writeFiles(root, { [DIETER_DIFF]: fakeDiff('dieter') })
    assert.equal((await loadPixelDiff(root, 'bundled')).name, 'bundled')
  })

  test('uses a module named by path', async () => {
    const root = tmpDir()
    writeFiles(root, { 'tools/mine.mjs': fakeDiff('mine') })
    const choice = await loadPixelDiff(root, 'tools/mine.mjs')
    assert.equal(choice.lib.marker, 'mine')
    const [a, b] = [squarePng(10, 10), squarePng(10, 10)].map((png, i) => {
      const file = path.join(root, `${i}.png`)
      fs.writeFileSync(file, png)
      return file
    })
    // The module's diff reports a change in identical captures, so it is the one deciding.
    assert.deepEqual(capturesDiffer(choice.lib, a, b), { changed: true, detail: '1 changed region, 99 pixels' })
  })

  test('says what is wrong when the module is missing or incomplete, or cannot load', async () => {
    const root = tmpDir()
    await assert.rejects(loadPixelDiff(root, 'nope.mjs'), /does not exist/)
    writeFiles(root, { 'half.mjs': 'export function diffMask() {}\n', [DIETER_DIFF]: "import 'not-installed-anywhere'\n" })
    await assert.rejects(loadPixelDiff(root, 'half.mjs'), /must export diffMask and findRegions/)
    await assert.rejects(loadPixelDiff(root, 'auto'), /--diff bundled/)
  })
})
