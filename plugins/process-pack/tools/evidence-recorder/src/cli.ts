#!/usr/bin/env node
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { record } from './record.js'
import type { Scenario } from './types.js'

function usage(): never {
  console.error(`
record-evidence <scenario-file> [--out <dir>] [--headed]

  <scenario-file>   Module with a default export of { name, url, steps, ready }

Environment:
  EVIDENCE_STORAGE_STATE   Path to a saved signed-in session (optional)
  EVIDENCE_PROTECTED_ORIGIN  Origin requiring a deployment-protection bypass (optional)
  VERCEL_AUTOMATION_BYPASS_SECRET  The bypass secret. Read from the environment only —
                                   never commit it, never read it from a repo file.

Writes <name>.webm (or .mp4 if it had to be re-encoded) plus <name>.steps.json,
which carries per-step timestamps for the narration muxer.
`.trim())
  process.exit(2)
}

const args = process.argv.slice(2)
if (args.length === 0 || args[0]?.startsWith('-')) usage()

const scenarioPath = path.resolve(args[0]!)
const outIndex = args.indexOf('--out')
const outDir = outIndex >= 0 ? path.resolve(args[outIndex + 1]!) : path.resolve('out')
const headless = !args.includes('--headed')

const mod = await import(pathToFileURL(scenarioPath).href)
const scenario: Scenario = mod.default ?? mod.scenario
if (!scenario?.steps?.length || typeof scenario.ready !== 'function') {
  console.error(`${scenarioPath} must default-export { name, url, steps, ready }.`)
  console.error('`ready` is required: without it the recorder cannot tell a working page from a signed-out one.')
  process.exit(2)
}

const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
const protectedOrigin = process.env.EVIDENCE_PROTECTED_ORIGIN

if (protectedOrigin && !bypassSecret) {
  console.error('EVIDENCE_PROTECTED_ORIGIN is set but VERCEL_AUTOMATION_BYPASS_SECRET is not.')
  console.error('Requests to that origin would be blocked before the app is reached.')
  process.exit(2)
}

try {
  const result = await record(scenario, {
    outDir,
    storageStatePath: process.env.EVIDENCE_STORAGE_STATE,
    protectedOrigin,
    bypassSecret,
    headless,
  })

  const stepsPath = path.join(outDir, `${scenario.name}.steps.json`)
  await writeFile(stepsPath, JSON.stringify({ scenario: result.scenario, durationMs: result.durationMs, steps: result.steps }, null, 2))

  const mb = (result.bytes / 1048576).toFixed(2)
  console.log(`recorded ${result.videoPath}`)
  console.log(`  ${mb} MB ${result.container}${result.reencoded ? ' (re-encoded to fit the size ceiling)' : ''}`)
  console.log(`  ${Math.round(result.durationMs / 1000)}s, ${result.steps.length} steps`)
  console.log(`  step timings: ${stepsPath}`)
} catch (error) {
  console.error(`\nRECORDING FAILED: ${error instanceof Error ? error.message : String(error)}`)
  console.error('\nNo recording was produced. Do not report this change as verified.')
  process.exit(1)
}
