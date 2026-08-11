#!/usr/bin/env node
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { record, safeName } from './record.js'
import type { Scenario } from './types.js'

function usage(message?: string): never {
  if (message) console.error(`${message}\n`)
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

/** Reads a flag's value, rejecting a missing one or the next flag masquerading as it. */
function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  if (i < 0) return undefined
  const value = args[i + 1]
  if (value === undefined || value.startsWith('-')) usage(`${flag} needs a value.`)
  return value
}

/** The scenario module is arbitrary imported code; its shape is not guaranteed by a type
 *  annotation. Validate at this boundary so a malformed scenario fails here with a useful
 *  message rather than deep inside navigation or path construction. */
function validateScenario(value: unknown, from: string): Scenario {
  const s = value as Partial<Scenario> | undefined
  if (!s || typeof s !== 'object') usage(`${from} does not export a scenario object.`)
  if (typeof s.name !== 'string' || !s.name.trim()) usage(`${from}: scenario needs a non-empty \`name\`.`)
  safeName(s.name)
  if (typeof s.url !== 'string' || !/^https?:\/\//i.test(s.url)) {
    usage(`${from}: scenario \`url\` must be an absolute http(s) URL, got ${JSON.stringify(s.url)}.`)
  }
  if (typeof s.ready !== 'function') {
    usage(`${from}: scenario needs a \`ready\` function. Without it the recorder cannot tell a working page from a signed-out one.`)
  }
  if (!Array.isArray(s.steps) || s.steps.length === 0) usage(`${from}: scenario needs at least one step.`)
  s.steps.forEach((step, i) => {
    if (typeof step?.caption !== 'string' || !step.caption.trim()) usage(`${from}: step ${i} needs a non-empty caption.`)
    if (typeof step?.run !== 'function') usage(`${from}: step ${i} needs a \`run\` function.`)
  })
  return s as Scenario
}

const args = process.argv.slice(2)
if (args.length === 0 || args[0]!.startsWith('-')) usage()

const scenarioPath = path.resolve(args[0]!)
const outDir = path.resolve(flagValue(args, '--out') ?? 'out')
const headless = !args.includes('--headed')

const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
const protectedOrigin = process.env.EVIDENCE_PROTECTED_ORIGIN

if (protectedOrigin && !bypassSecret) {
  console.error('EVIDENCE_PROTECTED_ORIGIN is set but VERCEL_AUTOMATION_BYPASS_SECRET is not.')
  console.error('Requests to that origin would be blocked before the app is reached.')
  process.exit(2)
}

try {
  // Inside the handler: a missing file, a syntax error, or a throw during module
  // initialisation should report through the same path as any other failure.
  const mod = await import(pathToFileURL(scenarioPath).href)
  const scenario = validateScenario(mod.default ?? mod.scenario, scenarioPath)

  const result = await record(scenario, {
    outDir,
    storageStatePath: process.env.EVIDENCE_STORAGE_STATE,
    protectedOrigin,
    bypassSecret,
    headless,
  })

  const stepsPath = path.join(outDir, `${result.scenario}.steps.json`)
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
