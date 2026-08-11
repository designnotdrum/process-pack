#!/usr/bin/env node
import path from 'node:path'
import { narrate } from './narrate.js'

function usage(): never {
  console.error(`
narrate-evidence <video> [steps.json] [--out <file>] [--say]

  <video>       A recording produced by record-evidence
  [steps.json]  Defaults to <video-basename>.steps.json alongside it
  --say         Force the free local voice even if a key is present

Environment:
  ELEVENLABS_API_KEY   Preferred voice. Without it the local voice is used and
                       the fallback is stated in the output — never silently.
`.trim())
  process.exit(2)
}

const args = process.argv.slice(2)
if (!args.length || args[0]!.startsWith('-')) usage()

/** Reads a flag's value, rejecting a missing one or the next flag masquerading as it. */
function flagValue(list: string[], flag: string): string | undefined {
  const i = list.indexOf(flag)
  if (i < 0) return undefined
  const value = list[i + 1]
  if (value === undefined || value.startsWith('-')) usage()
  return value
}

const videoPath = path.resolve(args[0]!)
const outPath = flagValue(args, '--out') ? path.resolve(flagValue(args, '--out')!) : undefined

// Collect positionals WITHOUT the values that belong to flags — otherwise `--out <dir>`
// donates its value to the steps-file slot and narration parses the wrong file.
const flagsWithValues = ['--out']
const knownFlags = ['--say']
const positional: string[] = []
for (let i = 1; i < args.length; i++) {
  const a = args[i]!
  if (a.startsWith('-')) {
    if (flagsWithValues.includes(a)) { i++; continue }
    // Unrecognised options are rejected, not ignored: `--sya` would otherwise silently
    // narrate with the paid voice, and `--outx foo` would donate `foo` to the steps slot.
    if (!knownFlags.includes(a)) usage()
    continue
  }
  positional.push(a)
}
if (positional.length > 1) usage()
const stepsPath = positional[0]
  ? path.resolve(positional[0])
  : videoPath.replace(/\.(webm|mp4)$/i, '.steps.json')

try {
  const result = await narrate({
    videoPath,
    stepsPath,
    outPath,
    apiKey: process.env.ELEVENLABS_API_KEY,
    forceSay: args.includes('--say'),
  })

  console.log(`narrated ${result.outPath}`)
  if (result.usedFallback) {
    // Stated, never silent. A downgrade nobody noticed is the failure mode this avoids.
    console.log('  VOICE: local fallback (no ELEVENLABS_API_KEY present)')
  } else {
    console.log('  voice: elevenlabs')
  }
  for (const p of result.placements) {
    const flag = p.delayed ? '  [delayed: previous caption was still speaking]' : ''
    console.log(`  ${p.startSec.toFixed(1)}s +${p.durationSec.toFixed(1)}s  "${p.caption.slice(0, 52)}"${flag}`)
  }
  if (result.paddedSec > 0) {
    console.log(`  held the final frame for ${result.paddedSec.toFixed(1)}s so the last caption finishes`)
  }
  const delayed = result.placements.filter(p => p.delayed).length
  if (delayed > 0) {
    console.log(`\n  ${delayed} caption(s) ran past their step. Shorten the captions or lengthen the steps,`)
    console.log('  or the narration will drift further behind the action as the recording goes on.')
  }
} catch (error) {
  console.error(`\nNARRATION FAILED: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
