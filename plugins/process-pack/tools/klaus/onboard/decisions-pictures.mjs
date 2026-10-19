/**
 * A picture for each decision: the two components drawn from their stories, side by side in one
 * image, and the difference between them measured from what was drawn.
 *
 * The stories come from a static Storybook build, drawn with the same browser reader the Figma
 * adapter uses (adapters/figma/capture.mjs). A component's story is the one whose file imports the
 * component's file, found with the repo's own TypeScript. A component with no story is not drawn:
 * its side of the picture is a labelled gap, and the item says so in plain words. Nothing here
 * calls a model, and nothing is uploaded: the images are files for the repo.
 */
import fs from 'node:fs'
import path from 'node:path'
import { openStorybook } from '../adapters/figma/capture.mjs'
import { toPosix } from '../inventory/files.mjs'
import { describeMeasuredDifference } from './decisions-look.mjs'
import { decisionPairs, decisionPictureName, renderDecisions, sidesOf } from './decisions.mjs'
import { renderTicket, ticketFileName } from './duplicates.mjs'
import { importsOf, parseSource } from './source.mjs'
import { findStoryFiles } from './stories.mjs'
import { NOT_SEARCHED } from './storybook.mjs'

// ---- the static build

const isBuild = (dir) => fs.existsSync(path.join(dir, 'iframe.html')) && (fs.existsSync(path.join(dir, 'index.json')) || fs.existsSync(path.join(dir, 'stories.json')))

/** Folders that hold a `.storybook` configuration folder, links not followed. */
function storybookFolders(root) {
  const found = []
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || !entry.isDirectory()) continue
      if (entry.name === '.storybook') found.push(dir)
      else if (!NOT_SEARCHED.has(entry.name)) visit(path.join(dir, entry.name))
    }
  }
  visit(root)
  return found.sort()
}

/** The Storybook build to draw from named in klaus.config.json, for the Figma output. */
function configuredBuild(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'klaus.config.json'), 'utf8')).outputs?.figma?.options?.storybookDir ?? null
  } catch {
    return null
  }
}

/**
 * The folder of a static Storybook build, or null. The configured folder is the only one looked at
 * when it is given. Otherwise the build is the `storybook-static` folder next to a `.storybook`
 * configuration, which is where `storybook build` writes it.
 */
export function findStorybookBuild({ root, configured }) {
  const base = fs.realpathSync(root)
  if (configured) {
    const dir = path.resolve(base, configured)
    return fs.existsSync(dir) && isBuild(dir) ? fs.realpathSync(dir) : null
  }
  for (const folder of storybookFolders(base)) {
    const dir = path.join(folder, 'storybook-static')
    if (fs.existsSync(dir) && isBuild(dir)) return fs.realpathSync(dir)
  }
  return null
}

// ---- which story draws which component

/** True when a top-level statement declares `name`: a function, class, variable or enum. */
function declares(ts, statement, name) {
  if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === name)
  return (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name?.text === name
}

/**
 * The file that declares an export, followed through barrel files: `export { A } from './a'`,
 * `export { A as B } from './a'` and `export * from './a'`. Null when it is not found. `seen` stops a cycle.
 */
function declaringFile({ ts, tsconfigs, file, name, seen = new Set() }) {
  const key = `${file}#${name}`
  if (seen.has(key)) return null
  seen.add(key)
  let sourceFile
  try {
    sourceFile = parseSource(ts, file)
  } catch {
    return null
  }
  const resolve = (spec) => {
    const target = ts.resolveModuleName(spec, file, tsconfigs.optionsFor(file), ts.sys).resolvedModule?.resolvedFileName
    return target && !target.endsWith('.d.ts') ? toPosix(target) : null
  }
  const stars = []
  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      const spec = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : null
      const clause = statement.exportClause
      if (!clause) {
        if (spec) stars.push(spec)
        continue
      }
      if (!ts.isNamedExports(clause)) continue
      for (const element of clause.elements.filter((e) => e.name.text === name)) {
        if (!spec) return file
        const target = resolve(spec)
        return target ? (declaringFile({ ts, tsconfigs, file: target, name: (element.propertyName ?? element.name).text, seen }) ?? target) : null
      }
    } else if (declares(ts, statement, name)) return file
  }
  for (const spec of stars) {
    const target = resolve(spec)
    const found = target && declaringFile({ ts, tsconfigs, file: target, name, seen })
    if (found) return found
  }
  return null
}

/** The story files that import each component file, directly or through a barrel file, resolved with the repo's own TypeScript. */
function storyImports({ ts, root, tsconfigs }) {
  const byComponent = new Map()
  const record = (file, story) => byComponent.set(file, [...new Set([...(byComponent.get(file) ?? []), story])])
  for (const story of findStoryFiles(root)) {
    let sourceFile
    try {
      sourceFile = parseSource(ts, story)
    } catch {
      continue
    }
    for (const item of importsOf(ts, sourceFile)) {
      const resolved = ts.resolveModuleName(item.module, story, tsconfigs.optionsFor(story), ts.sys).resolvedModule?.resolvedFileName
      if (!resolved || resolved.endsWith('.d.ts')) continue
      const module = toPosix(resolved)
      record(module, story)
      for (const { imported } of item.names) {
        const declared = declaringFile({ ts, tsconfigs, file: module, name: imported })
        if (declared && declared !== module) record(declared, story)
      }
    }
  }
  return byComponent
}

const simple = (text) => String(text).toLowerCase().replace(/[^a-z0-9]/g, '')
const FIRST = /^(primary|default|playground|base)$/i

/**
 * The index entries that come from these story files and are the component's own: named for it by
 * the end of their title or by their file name. A story in a file that merely imports the
 * component, such as one that draws a whole screen, is not its story. A plain default comes first.
 */
function candidatesFor({ entries, files, buildDir, root, name }) {
  const wanted = simple(name)
  const workingDir = path.dirname(buildDir)
  const own = entries.filter((entry) => {
    const importPath = String(entry.importPath ?? '').replace(/^\.\//, '')
    const direct = toPosix(path.join(workingDir, importPath))
    const fromFile = files.some((f) => f === direct || f.endsWith(`/${importPath}`) || toPosix(path.relative(root, f)) === importPath)
    const named = simple(String(entry.title ?? '').split('/').at(-1)) === wanted || simple(path.basename(String(entry.importPath ?? '')).replace(/\.(?:stories|story)\.[a-z]+$/i, '')) === wanted
    return fromFile && named
  })
  return [...own.filter((e) => FIRST.test(e.name)), ...own.filter((e) => !FIRST.test(e.name))]
}

// ---- drawing

/**
 * Runs inside the browser page, so it uses nothing from this file. Returns the box to photograph
 * and the computed look of the component the story drew, or null when the story drew nothing.
 * The component is found by looking through what draws nothing itself, such as a padding wrapper,
 * into its only child, or into the child that holds most of the room, until something is painted:
 * a background, a border or a shadow.
 */
export function readStory() {
  const host = document.querySelector('#storybook-root')
  let element = host?.firstElementChild
  if (!element) return null
  const clear = (colour) => colour === 'rgba(0, 0, 0, 0)' || colour === 'transparent'
  const ownText = (node) => [...node.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.data.trim() !== '')
  const area = (node) => {
    const box = node.getBoundingClientRect()
    return box.width * box.height
  }
  const painted = (node) => {
    const style = getComputedStyle(node)
    return !clear(style.backgroundColor) || ['Top', 'Right', 'Bottom', 'Left'].some((side) => parseFloat(style[`border${side}Width`]) > 0) || style.boxShadow !== 'none'
  }
  while (!painted(element) && !ownText(element)) {
    const shown = [...element.children].filter((child) => area(child) > 0 && getComputedStyle(child).display !== 'none')
    const main = shown.reduce((best, child) => (best && area(best) >= area(child) ? best : child), null)
    if (!main || (shown.length > 1 && area(main) < 0.7 * area(element))) break
    element = main
  }
  const style = getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  const rgba = (colour) => {
    const found = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/.exec(colour)
    return found ? [Math.round(found[1]), Math.round(found[2]), Math.round(found[3]), found[4] === undefined ? 1 : Number(found[4])] : [0, 0, 0, 0]
  }
  const border = Math.max(...['Top', 'Right', 'Bottom', 'Left'].map((side) => parseFloat(style[`border${side}Width`]) || 0))
  const pad = 16
  const x = Math.max(0, Math.floor(rect.x - pad))
  const y = Math.max(0, Math.floor(rect.y - pad))
  return {
    look: {
      w: Math.round(rect.width * 100) / 100,
      h: Math.round(rect.height * 100) / 100,
      bg: rgba(style.backgroundColor),
      color: rgba(style.color),
      radius: parseFloat(style.borderTopLeftRadius) || 0,
      borderWidth: border,
      shadow: style.boxShadow !== 'none',
      fontSize: parseFloat(style.fontSize) || 0,
      fontWeight: Number(style.fontWeight) || 400,
    },
    box: { x, y, width: Math.max(40, Math.min(Math.ceil(rect.right + pad) - x, window.innerWidth - x)), height: Math.max(40, Math.min(Math.ceil(rect.bottom + pad) - y, window.innerHeight - y)) },
  }
}

const FREEZE = '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}'

/** Draws one story: its photograph and its computed look. */
async function drawStory(storybook, id) {
  const { page } = storybook
  await storybook.show(id)
  await page.addStyleTag({ content: FREEZE })
  const read = await page.evaluate(readStory)
  if (!read) throw new Error('nothing was drawn')
  const png = await page.screenshot({ clip: read.box, type: 'png' })
  return { png, look: read.look, story: id }
}

const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The page that holds the two photographs, with a caption over each. */
function sheetHtml(columns) {
  const column = ({ caption, png }) => `<figure><figcaption>${escapeHtml(caption)}</figcaption><div class="panel">${png ? `<img src="data:image/png;base64,${Buffer.from(png).toString('base64')}">` : '<p>No story, so not drawn</p>'}</div></figure>`
  return `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#fff;font:15px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:#18181b}
#sheet{display:flex;width:1120px;box-sizing:border-box}
figure{margin:0;flex:1 1 0;min-width:0;padding:20px;box-sizing:border-box}
figure+figure{border-left:1px solid #d4d4d8}
figcaption{font-weight:600;margin-bottom:12px}
.panel{background:#f4f4f5;border-radius:8px;min-height:120px;display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box}
.panel img{max-width:100%;max-height:420px;display:block}
.panel p{margin:0;color:#71717a}
</style><div id="sheet">${columns.map(column).join('')}</div>`
}

/** Puts the two photographs side by side in one image. The browser page that drew them holds the sheet; the next story replaces it. */
async function composeSheet(storybook, columns) {
  const { page } = storybook
  await page.setContent(sheetHtml(columns))
  return page.locator('#sheet').screenshot({ type: 'png' })
}

/** A picture entry for a pair that could not be drawn at all, with the plain reason. */
const undrawn = (reason, notDrawn = [null, null]) => ({ file: null, bytes: null, drawn: [false, false], notDrawn, difference: null, reason })

const firstLine = (error) => String(error?.message ?? error).split('\n')[0].replace(/\.$/, '')

/** Draws one decision: each side from its story, then both in one image. Left is the side that would be replaced, right the side that would stay. */
async function drawPair({ storybook, pair, number, imports, build, root }) {
  const sides = sidesOf(pair)
  const drawn = []
  for (const side of [sides.drop, sides.keep]) {
    const files = imports.get(toPosix(path.join(root, side.entry.file))) ?? []
    const candidates = candidatesFor({ entries: storybook.entries, files, buildDir: build, root, name: side.entry.name })
    if (candidates.length === 0) {
      drawn.push({ reason: `${side.text} has no story` })
      continue
    }
    let result = null
    let failure = ''
    for (const candidate of candidates.slice(0, 3)) {
      try {
        result = await drawStory(storybook, candidate.id)
        break
      } catch (error) {
        failure = firstLine(error)
      }
    }
    drawn.push(result ?? { reason: `${side.text} has a story that did not draw (${failure})` })
  }
  // One story that draws both sides cannot tell them apart.
  if (drawn[0].story && drawn[0].story === drawn[1].story) return undrawn(null, [`${sides.drop.text} and ${sides.keep.text} are drawn only together, by the one story ${drawn[0].story}`, null])
  const [left, right] = drawn
  const notDrawn = [left.reason ?? null, right.reason ?? null]
  if (!left.png && !right.png) return undrawn(null, notDrawn)
  const bytes = await composeSheet(storybook, [
    { caption: `Left, would be replaced: ${sides.drop.label}`, png: left.png },
    { caption: `Right, would stay: ${sides.keep.label}`, png: right.png },
  ])
  return {
    file: `decisions/${decisionPictureName(pair, number)}`,
    bytes,
    drawn: [Boolean(left.png), Boolean(right.png)],
    notDrawn,
    difference: left.png && right.png ? describeMeasuredDifference(left.look, right.look, sides.drop.text, sides.keep.text) : null,
    reason: null,
  }
}

/**
 * Draws a picture for each decision and returns them by pair id.
 *
 * Each picture is { file, bytes, drawn: [left, right], notDrawn: [reason | null, reason | null],
 * difference, reason }. `file` is a path relative to the decisions list, `bytes` the PNG, and
 * `difference` one sentence measured from what was drawn, null unless both sides were. When
 * nothing could be drawn, `file` is null and `reason` or `notDrawn` says why in plain words.
 *
 * @param {object} options
 * @param {{ root: string, ts: object, tsconfigs: object, duplicates: object[] }} options.plan
 * @param {string} [options.storybookDir] The static build, relative to the repo. Found when not given.
 * @param {Function} [options.open] Opens the build in a browser; the Figma adapter's reader by default.
 * @param {(line: string) => void} [options.log]
 * @returns {Promise<Map<string, object>>}
 */
export async function attachDecisionPictures({ plan, storybookDir, open = openStorybook, log = () => {} }) {
  const pairs = decisionPairs(plan.duplicates)
  const pictures = new Map()
  const none = (reason) => {
    for (const pair of pairs) pictures.set(pair.id, undrawn(reason))
    return pictures
  }
  if (pairs.length === 0) return pictures
  const root = fs.realpathSync(plan.root)
  const build = findStorybookBuild({ root, configured: storybookDir ?? configuredBuild(root) })
  if (!build) return none('no built Storybook was found, so nothing was drawn. Build it with "storybook build" and run again')
  let storybook
  try {
    storybook = await open({ root, directory: build, globals: '' })
  } catch (error) {
    return none(`the browser could not be started: ${firstLine(error)}`)
  }
  try {
    let imports
    try {
      imports = storyImports({ ts: plan.ts, root, tsconfigs: plan.tsconfigs })
    } catch (error) {
      return none(`the stories could not be read (${firstLine(error)})`)
    }
    for (const [index, pair] of pairs.entries()) {
      try {
        const picture = await drawPair({ storybook, pair, number: index + 1, imports, build, root })
        pictures.set(pair.id, picture)
        if (picture.file) log(`Picture ${index + 1} of ${pairs.length}: ${sidesOf(pair).drop.text} and ${sidesOf(pair).keep.text}.`)
      } catch (error) {
        // One picture that cannot be made must not stop the run or the other pictures.
        pictures.set(pair.id, undrawn(`the picture could not be made (${firstLine(error)})`))
      }
    }
  } finally {
    await storybook.close()
  }
  return pictures
}

/**
 * Every file the decisions add to the first pull request, besides the list of all pairs: the
 * decisions list, a ticket for each pair the data settled, and the pictures. A picture's `text` is
 * the PNG as a Buffer, which the run writes as it writes any file.
 *
 * @param {{ pairs: object[], pictures?: Map<string, object>, docs: string }} options
 * @returns {{ rel: string, text: string | Buffer }[]}
 */
export function decisionFiles({ pairs, pictures = new Map(), docs }) {
  const files = [{ rel: `${docs}/decisions.md`, text: renderDecisions(pairs, pictures) }]
  pairs.filter((p) => p.verdict === 'merge').forEach((pair, index) => files.push({ rel: `${docs}/tickets/${ticketFileName(pair, index + 1)}`, text: renderTicket(pair) }))
  for (const pair of decisionPairs(pairs)) {
    const picture = pictures.get(pair.id)
    if (picture?.file && picture.bytes) files.push({ rel: `${docs}/${picture.file}`, text: picture.bytes })
  }
  return files
}
