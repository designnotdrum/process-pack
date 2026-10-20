import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadTypeScript } from '../../inventory/components.mjs'
import { buildInventory } from '../../inventory/inventory.mjs'
import { createTsconfigLoader } from '../../inventory/tsconfig.mjs'
import { readOnboardingConfig } from '../config.mjs'
import { findDuplicates } from '../duplicates.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const KLAUS = path.join(here, '..', '..')
export const DECISIONS_FIXTURE = path.join(here, 'fixtures', 'decisions')

/**
 * A copy of the decisions fixture in a new folder: a shared package and a web app that each write
 * a Tooltip, a Switch, a Badge, a Table and a Card, and two providers that take only children.
 * Tooltip is unused in the app, Table in both, Card in the package. Switch and Badge are used in
 * both and look different, and Badge has a story on both sides.
 */
export function makeDecisionsSample() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'klaus-decisions-'))
  const repo = path.join(base, 'repo')
  fs.cpSync(DECISIONS_FIXTURE, repo, { recursive: true })
  fs.symlinkSync(path.join(KLAUS, 'node_modules'), path.join(repo, 'node_modules'))
  return { base, repo, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) }
}

/** What the run holds after planning that the decisions need: the pairs, and the compiler and tsconfigs behind them. */
export function planOf(repo, options = {}) {
  const root = fs.realpathSync(repo)
  const { folders } = readOnboardingConfig(root)
  const ts = loadTypeScript(root)
  const inventory = buildInventory({ root, folders })
  return { root, ts, inventory, tsconfigs: createTsconfigLoader(ts, root), duplicates: findDuplicates({ ts, root, inventory, ...options }) }
}
