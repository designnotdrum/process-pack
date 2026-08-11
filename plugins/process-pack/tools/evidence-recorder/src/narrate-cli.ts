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

const videoPath = path.resolve(args[0]!)
const positional = args.slice(1).filter(a => !a.startsWith('--'))
const stepsPath = positional[0]
  ? path.resolve(positional[0])
  : videoPath.replace(/\.(webm|mp4)$/, '.steps.json')
const outIndex = args.indexOf('--out')
const outPath = outIndex >= 0 ? path.resolve(args[outIndex + 1]!) : undefined

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
