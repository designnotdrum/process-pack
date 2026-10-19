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
import { resetCaches, toPosix, walk } from '../inventory/files.mjs'
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
    // Half a purpose is a person's to finish: a second label would make the comment read as the first.
    // Only the text before the first tag counts, as that is all the inventory reads.
    if (doc && PURPOSE_LABEL.test(ts.getTextOfJSDocComment(doc.node.comment) ?? '')) {
      skipped.push({ id, name: entry.name, file: entry.file, reason: 'its doc comment already has a Use when or a Not for line, but not both where the inventory reads them' })
      continue
    }
    // The two lines go before the first tag, the only place the inventory reads them. A tag after
    // text on its line, such as `@repo/ui` in a sentence, would put them in the middle of that line.
    if (doc && tagAfterText(sourceFile.text, doc)) {
      skipped.push({ id, name: entry.name, file: entry.file, reason: 'its doc comment has an @ after text on a line, which TypeScript reads as the start of a tag, so the two lines could only go in the middle of that line' })
      continue
    }
    // A doc comment with only tags gives the inventory no purpose text, and it is kept all the same.
    components.push({ id, name: entry.name, file: entry.file, dir: path.posix.dirname(entry.file), kind: doc ? 'unformatted' : 'missing', existing: doc?.text ?? null, entry })
  }
  return { components, skipped }
}

const PURPOSE_LABEL = /\b(use when|not for)\s*:/i

/** Whether a doc comment's first tag starts after text on its line, as `@repo/ui` does in `Lives in @repo/ui`. */
function tagAfterText(text, doc) {
  const tag = doc.node.tags?.[0]
  if (!tag) return false
  const lineStart = Math.max(text.lastIndexOf('\n', tag.pos - 1) + 1, doc.start)
  return /[^\s*]/.test(text.slice(lineStart, tag.pos).replace(/^\s*\/\*\*/, ''))
}

const hashText = (text) => crypto.createHash('sha256').update(text).digest('hex')

/**
 * What the plan id holds for one inventory `file`. The file of an icon set is its folder, so the
 * folder is read as every file inside it, by path below the folder and by contents. A link inside
 * the folder is not followed, and a hidden file or folder is left out, as the inventory does.
 */
function fingerprintOf({ root, file, kind }) {
  const abs = path.join(root, file)
  if (kind !== 'icon-set') return hashText(fs.readFileSync(abs, 'utf8'))
  const folder = toPosix(abs)
  const names = walk(folder, (name) => !name.startsWith('.')).map((inside) => path.posix.relative(folder, inside))
  // The contents are read as bytes, not as text, so an icon that is not valid UTF-8 still changes the hash when it changes.
  return names.sort().map((name) => [name, hashText(fs.readFileSync(path.join(folder, name)))])
}

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

  const kinds = new Map(inventory.entries.map((e) => [e.file, e.kind]))
  const files = [...kinds.keys()].sort()
  const id = hashText(JSON.stringify({ onboarding, files: files.map((f) => [f, fingerprintOf({ root, file: f, kind: kinds.get(f) })]), calls: calls.map((c) => c.id), stories: stories.items.map((s) => [s.id, s.status]), pairs: duplicates.map((d) => d.id) })).slice(0, 12)
  return { id, root, ts, tsconfigs, usage, inventory, purposes, calls, stories, duplicates, folders }
}
