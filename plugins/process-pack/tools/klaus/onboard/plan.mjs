/**
 * What the onboarding run will do, worked out from the repo with no model and no write.
 *
 * The plan holds the inventory as it is now, the components that need a purpose and the calls that
 * will write them, the stories to write, and the likely duplicates. The estimate is computed from
 * it, and the run refuses to start if the repo no longer gives the same plan.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { loadTypeScript } from '../inventory/components.mjs'
import { resetCaches, toPosix } from '../inventory/files.mjs'
import { buildInventory } from '../inventory/inventory.mjs'
import { createTsconfigLoader } from '../inventory/tsconfig.mjs'
import { readUsage } from '../inventory/usage.mjs'
import { findDuplicates } from './duplicates.mjs'
import { docCommentOf, findComponent, parseSource } from './source.mjs'
import { planStories } from './stories.mjs'
import { groupIntoCalls } from './writer.mjs'

/** An entry needs a purpose unless it has both halves, "Use when" and "Not for". An icon set has none to write. */
export const needsPurpose = (entry) => entry.kind !== 'icon-set' && !(entry.purpose?.useWhen && entry.purpose?.notFor)

/**
 * The components whose purpose will be written, and the ones that cannot be.
 *
 * @returns {{ components: object[], skipped: { id: string, name: string, file: string, reason: string }[] }}
 */
export function planPurposes({ root, ts, inventory }) {
  const components = []
  const skipped = []
  for (const entry of inventory.entries.filter(needsPurpose)) {
    const id = `${entry.file}#${entry.name}`
    const sourceFile = parseSource(ts, path.join(root, entry.file))
    const found = findComponent(ts, sourceFile, entry.name)
    if (!found) {
      skipped.push({ id, name: entry.name, file: entry.file, reason: 'Klaus cannot tell where this component is declared in its file' })
      continue
    }
    const doc = docCommentOf(ts, sourceFile, found.statement)
    components.push({ id, name: entry.name, file: entry.file, dir: path.posix.dirname(entry.file), kind: entry.purpose ? 'unformatted' : 'missing', existing: doc?.text ?? null, entry })
  }
  return { components, skipped }
}

const hashText = (text) => crypto.createHash('sha256').update(text).digest('hex')

/**
 * Builds the plan for a repo.
 *
 * @param {object} options
 * @param {string} options.root The repo.
 * @param {{ path: string, role: 'shared' | 'app' }[]} options.folders Inventory folders.
 * @param {object} options.onboarding Resolved onboarding settings.
 */
export function buildPlan({ root: given, folders, onboarding }) {
  const root = toPosix(fs.realpathSync(given))
  const ts = loadTypeScript(root)
  const inventory = buildInventory({ root, folders })
  // buildInventory resets the file caches, and the usage reader below shares them.
  resetCaches()
  const tsconfigs = createTsconfigLoader(ts, root)
  const usage = readUsage({ ts, root, tsconfigs })

  const purposes = planPurposes({ root, ts, inventory })
  const tooLarge = []
  const calls = groupIntoCalls({ root, components: purposes.components, maxPerCall: onboarding.writer.maxComponentsPerCall, ts, usage, tooLarge })
  for (const id of tooLarge) {
    const component = purposes.components.find((c) => c.id === id)
    purposes.skipped.push({ id, name: component.name, file: component.file, reason: 'the file is too long to give a writer whole' })
  }
  purposes.components = purposes.components.filter((c) => !tooLarge.includes(c.id))

  const stories = planStories({ ts, root, tsconfigs, inventory, dataBoundImports: onboarding.dataBoundImports })
  const duplicates = findDuplicates({ ts, root, inventory })

  const files = [...new Set(inventory.entries.map((e) => e.file))].sort()
  const id = hashText(JSON.stringify({ onboarding, files: files.map((f) => [f, hashText(fs.readFileSync(path.join(root, f), 'utf8'))]), calls: calls.map((c) => c.id), stories: stories.items.map((s) => [s.id, s.status]), pairs: duplicates.map((d) => d.id) })).slice(0, 12)
  return { id, root, ts, tsconfigs, usage, inventory, purposes, calls, stories, duplicates, folders }
}
