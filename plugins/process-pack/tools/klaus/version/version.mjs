#!/usr/bin/env node
/**
 * Picks each component's version from what changed. Model-free. Run once for each release.
 *
 *   node scripts/klaus/version/version.mjs --release v1.5.0 [--from v1.4.0] [options]
 *   node scripts/klaus/version/version.mjs --baseline [--release v1.0.0]
 *
 * See README.md in this folder for the rules, the options and the files it reads and writes.
 *
 * Exit 0 when the versions were picked, 2 on an error the person running it can fix, 3 on any
 * other error, with a stack trace.
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { UserError } from '../frame/errors.mjs'
import { readJsonFile, writeJsonFile } from '../frame/json-file.mjs'
import { loadTypeScript } from '../inventory/components.mjs'
import { toPosix } from '../inventory/files.mjs'
import { BASELINE, bumpVersion, higher, isVersion, LEVELS } from './bump.mjs'
import { capturesDiffer, loadPixelDiff } from './pixels.mjs'
import { compareTrees } from './props.mjs'
import { headCommit, resolveCommit, snapshotCommit } from './snapshot.mjs'

/**
 * @typedef {{ components: Record<string, string>, screens: Record<string, string> }} Captures
 *   This release's captures as absolute file paths: components by inventory name, screens by route.
 */

const NO_CAPTURES = Object.freeze({ components: {}, screens: {} })
const SHOWN_REASONS = 5

const slug = (text) => text.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'x'

function listEntries(inventory, what) {
  if (!inventory || !Array.isArray(inventory.entries)) throw new UserError(`${what} must be an object with an entries array.`)
  for (const entry of inventory.entries) {
    if (!entry || typeof entry.name !== 'string' || typeof entry.file !== 'string') throw new UserError(`${what} has an entry without a name and a file.`)
  }
  return inventory.entries
}

/** Reads a captures file: `{ "components": { "Button": "shots/Button.png" }, "screens": { "/settings": "shots/settings.png" } }`. */
export function readCaptures(file) {
  const dir = path.dirname(path.resolve(file))
  const manifest = readJsonFile(file, 'Captures file')
  const section = (name) => {
    const listed = manifest[name] ?? {}
    if (typeof listed !== 'object' || listed === null || Array.isArray(listed)) throw new UserError(`Captures file ${file}: "${name}" must be an object.`)
    return Object.fromEntries(
      Object.entries(listed).map(([key, value]) => {
        if (typeof value !== 'string' || !value) throw new UserError(`Captures file ${file}: the path for ${name} "${key}" must be a string.`)
        const resolved = path.resolve(dir, value)
        if (!fs.existsSync(resolved)) throw new UserError(`Captures file ${file}: the capture for ${name} "${key}" does not exist: ${resolved}`)
        return [key, resolved]
      }),
    )
  }
  return { components: section('components'), screens: section('screens') }
}

/**
 * Pairs each entry with the entry it was in the previous inventory: the same name in the same
 * file, else the only unclaimed entry of that name. A component that moved keeps its version.
 * An entry that matches several candidates is left unpaired, with a note saying why.
 */
function matchPrevious(entries, previousEntries, notes) {
  const claimed = new Set()
  const matches = new Map()
  const unmatched = []
  for (const entry of entries) {
    const exact = previousEntries.find((p) => p.name === entry.name && p.file === entry.file && !claimed.has(p))
    if (exact) {
      claimed.add(exact)
      matches.set(entry, exact)
    } else unmatched.push(entry)
  }
  for (const entry of unmatched) {
    const same = previousEntries.filter((p) => p.name === entry.name && !claimed.has(p))
    if (same.length === 1) {
      claimed.add(same[0])
      matches.set(entry, same[0])
    } else if (same.length > 1) {
      notes.push(`${entry.name}: ${same.length} entries with this name were in the previous inventory (${same.map((p) => p.file).join(', ')}), so it was treated as new.`)
    }
  }
  return matches
}

const describeChange = (c) => `${c.kind}: ${c.where}${c.detail ? ` (${c.detail})` : ''}`

function summarizeChanges(changes) {
  const live = changes.filter((c) => c.level !== 'none').sort((a, b) => LEVELS.indexOf(b.level) - LEVELS.indexOf(a.level))
  const shown = live.slice(0, SHOWN_REASONS).map(describeChange)
  return live.length > SHOWN_REASONS ? [...shown, `and ${live.length - SHOWN_REASONS} more`] : shown
}

/**
 * One folder per entry under the screenshot store. Two entries with the same name are told apart by
 * their file, and a key that still repeats (`a b.tsx` and `a-b.tsx` both slug to `a-b.tsx`) gets a number.
 */
function storeKeys(entries) {
  const counts = new Map()
  for (const entry of entries) counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1)
  const used = new Set()
  return new Map(
    entries.map((entry) => {
      const base = counts.get(entry.name) > 1 ? `${slug(entry.file)}--${slug(entry.name)}` : slug(entry.name)
      let key = base
      for (let n = 2; used.has(key); n++) key = `${base}-${n}`
      used.add(key)
      return [entry, key]
    }),
  )
}

/** The version an entry carries, or the baseline when it carries none. */
const versionOf = (entry) => (isVersion(entry.version) ? entry.version : BASELINE)

function entryLevel({ baseline, old, level }) {
  if (baseline) return 'baseline'
  return old ? level : 'new'
}

function screenReason({ baseline, old, visual }) {
  if (baseline) return 'baseline'
  if (!old) return 'new in this release'
  return visual?.changed ? `capture changed (${visual.detail})` : null
}

/**
 * Picks the version of every entry and screen for one release.
 *
 * @param {object} options
 * @param {string} options.root The repo. Component files are read from here as they are now.
 * @param {object} options.inventory The inventory built for this release. Its versions are ignored.
 * @param {object} [options.previous] The inventory the last run wrote, with the versions to bump.
 *   Needed unless `baseline` is set.
 * @param {string} [options.from] The git ref of the release `previous` belongs to. Its component
 *   files are the old side of the prop comparison. Falls back to the commit `previous` records.
 * @param {string} [options.release] The release name. A screen whose capture changed is named for it.
 * @param {boolean} [options.baseline] Start every entry and screen at 1.0.0, ignoring `previous`.
 * @param {Captures} [options.captures]
 * @param {string} [options.screenshots] Where captures are kept. Default `.klaus/screenshots` in the repo.
 * @param {string} [options.diff] `auto`, `bundled`, or the path to a pixel diff module.
 * @param {boolean} [options.dryRun] Pick the versions and copy no screenshot.
 * @param {object} [options.ts] The TypeScript package. Default: the repo's own.
 * @returns {Promise<{ inventory: object, report: object }>}
 */
export async function pickVersions({ root: given, inventory, previous, from, release, baseline = false, captures = NO_CAPTURES, screenshots, diff = 'auto', dryRun = false, ts }) {
  const root = fs.realpathSync(given)
  const entries = listEntries(inventory, 'The inventory')
  const store = path.resolve(root, screenshots ?? path.join('.klaus', 'screenshots'))
  const notes = []

  let previousEntries = []
  if (!baseline) {
    if (!previous) throw new UserError('There is no previous inventory to bump from. Onboard the repo first with --baseline.')
    if (!release) throw new UserError('Name the release with --release. A screen whose capture changed is named for it.')
    if (previous.versioned?.release === release) throw new UserError(`The previous inventory already holds the versions for ${release}. Running it again would bump them twice.`)
    previousEntries = listEntries(previous, 'The previous inventory')
    if (previousEntries.length && !previousEntries.some((e) => isVersion(e.version))) {
      throw new UserError('The previous inventory holds no versions to bump. It looks freshly built. Pass the inventory the last run wrote.')
    }
  }
  const matches = matchPrevious(entries, previousEntries, notes)
  // The diff is loaded only when there is a capture to compare. A baseline compares nothing.
  const hasCaptures = Object.keys(captures.components).length + Object.keys(captures.screens).length > 0
  const pixelDiff = !baseline && hasCaptures ? await loadPixelDiff(root, diff) : null
  // A capture is keyed by the entry's name, or by `file#name` when two entries share a name.
  const nameCounts = new Map()
  for (const entry of entries) nameCounts.set(entry.name, (nameCounts.get(entry.name) ?? 0) + 1)
  const captureKey = (entry) => `${entry.file}#${entry.name}`
  const captureFor = (entry) => captures.components[captureKey(entry)] ?? (nameCounts.get(entry.name) === 1 ? captures.components[entry.name] : undefined)
  const known = new Set(entries.flatMap((e) => [e.name, captureKey(e)]))
  for (const key of Object.keys(captures.components)) {
    if (!known.has(key)) notes.push(`The capture for "${key}" matches no entry in the inventory.`)
  }
  for (const [name, count] of nameCounts) {
    const qualified = entries.filter((e) => e.name === name).every((e) => captures.components[captureKey(e)])
    if (count > 1 && captures.components[name] && !qualified) notes.push(`${count} entries are named "${name}", so the capture for "${name}" was not used. Name each as file#${name}.`)
  }
  const compareCapture = (storedFile, capture) => {
    if (!pixelDiff) throw new Error('A capture was compared before a pixel diff was loaded.')
    return capturesDiffer(pixelDiff.lib, storedFile, capture)
  }

  // Props: the old side is the previous release's files, the new side is the checkout.
  const candidates = entries.filter((e) => matches.has(e) && e.kind !== 'icon-set')
  const comparisons = new Map()
  let fromCommit = null
  if (candidates.length) {
    const ref = from ?? previous.versioned?.commit
    if (!ref) throw new UserError('Say which release the previous versions belong to with --from <tag or commit>. The previous inventory does not record one.')
    fromCommit = resolveCommit(root, ref)
    const snapshot = snapshotCommit(root, fromCommit)
    try {
      const jobs = []
      for (const entry of candidates) {
        const old = matches.get(entry)
        const baseFile = path.join(snapshot.dir, old.file)
        const headFile = path.join(root, entry.file)
        if (!fs.existsSync(baseFile)) {
          notes.push(`${entry.name}: ${old.file} does not exist at ${ref}, so its props were not compared.`)
          continue
        }
        if (!fs.existsSync(headFile)) continue
        const names = [...new Set([entry.name, ...(entry.parts ?? []).map((p) => p.name), ...(old.parts ?? []).map((p) => p.name)])]
        jobs.push({ key: entry.name + '\0' + entry.file, baseFile, headFile, primary: entry.name, names })
      }
      if (jobs.length) {
        const results = compareTrees({ ts: ts ?? loadTypeScript(root), base: snapshot.dir, head: root, jobs })
        if ([...results.values()].some((r) => r.textOnly)) notes.push('The repo\'s TypeScript is older than 5.4 and cannot say which way a prop type changed, so any difference in a prop type counts as major.')
        for (const entry of candidates) {
          const result = results.get(entry.name + '\0' + entry.file)
          if (result) comparisons.set(entry, result)
          if (result?.note) notes.push(`${entry.name}: ${result.note}`)
          if (result?.unresolved) notes.push(`${entry.name}: the compiler could not resolve ${result.unresolved.slice(0, 5).map((n) => JSON.stringify(n)).join(', ')} imported by ${entry.file}, so props typed with ${result.unresolved.length === 1 ? 'it were' : 'them were'} not compared.`)
        }
      }
    } finally {
      snapshot.remove()
    }
  }

  const keys = storeKeys(entries)
  const copies = []
  const keep = (source, to) => {
    copies.push({ from: source, to })
    return toPosix(path.relative(root, to))
  }

  const reportEntries = []
  const versioned = entries.map((entry) => {
    const old = matches.get(entry)
    const capture = captureFor(entry)
    const changes = comparisons.get(entry)?.changes ?? []
    const reasons = []
    let level = 'none'

    const propLevel = comparisons.get(entry)?.level ?? 'none'
    if (propLevel !== 'none') {
      level = higher(level, propLevel)
      reasons.push(...summarizeChanges(changes))
    }

    // The old screenshot is the capture stored with the entry's current version. Comparing against it,
    // and not against last release's capture, stops small shifts adding up unseen.
    const storedFile = old?.screenshot ? path.resolve(root, old.screenshot) : null
    const comparable = Boolean(capture && storedFile && fs.existsSync(storedFile))
    if (capture && old?.screenshot && !comparable) notes.push(`${entry.name}: the stored screenshot ${old.screenshot} is missing, so the capture was not compared.`)
    if (comparable) {
      const visual = compareCapture(storedFile, capture)
      if (visual.changed) {
        level = higher(level, 'patch')
        reasons.push(`capture changed (${visual.detail})`)
      }
    }

    if (old?.version && !isVersion(old.version)) notes.push(`${entry.name}: the version "${old.version}" is not x.y.z, so it was counted as ${BASELINE}.`)

    let version
    if (baseline || !old) version = BASELINE
    else version = bumpVersion(old.version, level)

    // A new version keeps the capture it was made with. Without a change, the stored screenshot stays.
    const bumped = baseline || !old || version !== old.version
    let screenshot = baseline ? '' : (old?.screenshot ?? '')
    if (capture && (bumped || !comparable)) screenshot = keep(capture, path.join(store, 'components', keys.get(entry), `${version}.png`))

    reportEntries.push({ name: entry.name, file: entry.file, previous: old ? versionOf(old) : null, version, level: entryLevel({ baseline, old, level }), reasons, changes })
    return { ...entry, version, screenshot }
  })

  // Screens have no props. Each is versioned only by its own capture, and named for the release.
  const oldScreens = new Map(baseline ? [] : (previous.screens ?? []).map((s) => [s.route, s]))
  const reportScreens = []
  const screens = []
  for (const route of [...new Set([...oldScreens.keys(), ...Object.keys(captures.screens)])].sort()) {
    const old = oldScreens.get(route)
    const capture = captures.screens[route]
    if (!capture) {
      screens.push(old)
      continue
    }
    const storedFile = old?.screenshot ? path.resolve(root, old.screenshot) : null
    const comparable = Boolean(storedFile && fs.existsSync(storedFile))
    if (old?.screenshot && !comparable) notes.push(`Screen ${route}: the stored screenshot ${old.screenshot} is missing, so the capture was not compared.`)
    const visual = comparable ? compareCapture(storedFile, capture) : null
    const named = baseline ? BASELINE : release
    const changed = baseline || !old || Boolean(visual?.changed)
    const version = changed ? named : old.version
    let screenshot = old?.screenshot ?? ''
    if (changed || !comparable) screenshot = keep(capture, path.join(store, 'screens', encodeURIComponent(route), `${slug(version)}.png`))
    screens.push({ route, version, screenshot })
    reportScreens.push({ route, previous: old?.version ?? null, version, changed, reason: screenReason({ baseline, old, visual }) })
  }

  if (!dryRun) {
    for (const { from: source, to } of copies) {
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.copyFileSync(source, to)
    }
  }

  return {
    inventory: { ...inventory, entries: versioned, screens, versioned: { release: release ?? 'baseline', commit: headCommit(root) } },
    report: { release: release ?? 'baseline', baseline, from: fromCommit, pixelDiff: pixelDiff?.name ?? null, entries: reportEntries, screens: reportScreens, notes },
  }
}

const OPTIONS = {
  root: { type: 'string' },
  inventory: { type: 'string' },
  previous: { type: 'string' },
  out: { type: 'string' },
  from: { type: 'string' },
  release: { type: 'string' },
  captures: { type: 'string' },
  screenshots: { type: 'string' },
  diff: { type: 'string', default: 'auto' },
  baseline: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  json: { type: 'boolean' },
}

const USAGE = `
version.mjs --release <name> [--from <tag or commit>] [options]
version.mjs --baseline [--release <name>] [options]

  --release <name>      The release being versioned, such as v1.5.0. Screens that changed are named for it.
  --from <ref>          The release the previous versions belong to. Default: the commit the previous inventory records.
  --baseline            Onboarding: start every entry and screen at 1.0.0 and compare nothing.
  --root <dir>          The repo. Default: the current directory.
  --inventory <file>    The inventory built for this release. Default: inventory.json in the repo.
  --previous <file>     The inventory the last run wrote. Default: the inventory file itself, if it holds versions.
  --out <file>          Where to write the result. Default: the inventory file.
  --captures <file>     A JSON file naming this release's captures: { "components": { name: png }, "screens": { route: png } }.
  --screenshots <dir>   Where screenshots are kept. Default: .klaus/screenshots in the repo.
  --diff <choice>       auto (the repo's Dieter diff if present, else bundled), bundled, or the path to a module.
  --dry-run             Pick the versions and write nothing.
  --json                Print the report instead of a summary.
`.trim()

const carriesVersions = (inventory) => Array.isArray(inventory?.entries) && inventory.entries.some((e) => isVersion(e.version))

function summary(report) {
  const lines = []
  for (const e of report.entries) {
    if (e.level === 'none') continue
    lines.push(`${e.name}: ${e.previous ?? 'none'} -> ${e.version} (${e.level}${e.reasons.length ? `: ${e.reasons.join('; ')}` : ''})`)
  }
  for (const s of report.screens) if (s.changed) lines.push(`Screen ${s.route}: ${s.previous ?? 'none'} -> ${s.version} (${s.reason})`)
  const count = (level) => report.entries.filter((e) => e.level === level).length
  lines.push(report.baseline ? `Baseline: ${report.entries.length} entries and ${report.screens.length} screens at ${BASELINE}.` : `${report.entries.length} entries: ${count('major')} major, ${count('minor')} minor, ${count('patch')} patch, ${count('new')} new, ${count('none')} unchanged. ${report.screens.filter((s) => s.changed).length} of ${report.screens.length} screens changed.`)
  for (const note of report.notes) lines.push(`Note: ${note}`)
  return lines.join('\n')
}

export async function main(argv) {
  let values
  try {
    values = parseArgs({ args: argv, options: OPTIONS, allowPositionals: false }).values
  } catch (error) {
    throw new UserError(`${error.message}\n\n${USAGE}`)
  }
  const root = path.resolve(values.root ?? process.cwd())
  if (!fs.existsSync(root)) throw new UserError(`The repo ${root} does not exist.`)
  const inventoryFile = path.resolve(root, values.inventory ?? 'inventory.json')
  const inventory = readJsonFile(inventoryFile, 'Inventory')

  let previous = null
  if (!values.baseline) {
    const previousFile = values.previous ? path.resolve(root, values.previous) : inventoryFile
    previous = readJsonFile(previousFile, 'Previous inventory')
    if (!values.previous && !carriesVersions(previous)) {
      throw new UserError(`${inventoryFile} holds no versions to bump. If it was just rebuilt, pass the inventory from the last run with --previous <file>. For a first run, use --baseline.`)
    }
  }
  const captures = values.captures ? readCaptures(path.resolve(root, values.captures)) : NO_CAPTURES
  const dryRun = Boolean(values['dry-run'])

  const { inventory: result, report } = await pickVersions({ root, inventory, previous, from: values.from, release: values.release, baseline: values.baseline, captures, screenshots: values.screenshots, diff: values.diff, dryRun })
  if (!dryRun) writeJsonFile(path.resolve(root, values.out ?? inventoryFile), result)
  console.log(values.json ? JSON.stringify(report, null, 2) : summary(report))
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    if (error instanceof UserError) {
      console.error(error.message)
      process.exit(2)
    }
    console.error(error.stack ?? error)
    process.exit(3)
  })
}
