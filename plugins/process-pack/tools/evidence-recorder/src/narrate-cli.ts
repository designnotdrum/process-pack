#!/usr/bin/env node
import path from 'node:path'
import { narrate } from './narrate.js'
import { listVoices, DEFAULT_VOICE_NAME } from './tts.js'

function usage(): never {
  console.error(`
narrate-evidence <video> [steps.json] [--out <file>] [--say] [--voice <name|id>]
narrate-evidence --list-voices

  <video>         A recording produced by record-evidence
  [steps.json]    Defaults to <video-basename>.steps.json alongside it
  --say           Force the free local voice even if a key is present
  --voice <v>     Voice name or id (default: ELEVENLABS_VOICE_ID, else the API default)
  --list-voices   Print the voices available to this key, then exit

Environment:
  ELEVENLABS_API_KEY   Preferred voice. Without it the local voice is used and
                       the fallback is stated in the output — never silently.
  ELEVENLABS_VOICE_ID  Default voice, overridden by --voice.
`.trim())
  process.exit(2)
}

const args = process.argv.slice(2)

if (args.includes('--list-voices')) {
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) {
    console.error('ELEVENLABS_API_KEY is not set, so there are no account voices to list.')
    process.exit(2)
  }
  const voices = await listVoices(key)
  console.log(`${voices.length} voice(s) available:\n`)
  for (const v of voices) {
    const meta = [v.category, v.description].filter(Boolean).join(' — ')
    console.log(`  ${v.name.padEnd(22)} ${v.id}${meta ? `\n  ${' '.repeat(22)} ${meta.slice(0, 90)}` : ''}`)
  }
  console.log('\nUse:  narrate-evidence <video> --voice "<name>"')
  process.exit(0)
}

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
const outFlag = flagValue(args, '--out')
const outPath = outFlag ? path.resolve(outFlag) : undefined

// Collect positionals WITHOUT the values that belong to flags — otherwise `--out <dir>`
// donates its value to the steps-file slot and narration parses the wrong file.
const flagsWithValues = ['--out', '--voice']
const knownFlags = ['--say', '--list-voices']
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
// Fallback must not equal the video path for an unusual extension, or narration would
// try to parse the recording as its own steps file.
const stepsPath = positional[0]
  ? path.resolve(positional[0])
  : (/\.(webm|mp4)$/i.test(videoPath)
      ? videoPath.replace(/\.(webm|mp4)$/i, '.steps.json')
      : `${videoPath}.steps.json`)

try {
  const result = await narrate({
    videoPath,
    stepsPath,
    outPath,
    apiKey: process.env.ELEVENLABS_API_KEY,
    forceSay: args.includes('--say'),
    voice: flagValue(args, '--voice') ?? process.env.ELEVENLABS_VOICE_ID,
  })

  console.log(`narrated ${result.outPath}`)
  if (result.usedFallback) {
    // Stated, never silent. A downgrade nobody noticed is the failure mode this avoids.
    // Distinguish "asked for it" from "had to" — claiming the key is missing when the
    // user passed --say sends them debugging a key that is present and fine.
    const reason = args.includes('--say')
      ? '--say was passed'
      : 'no ELEVENLABS_API_KEY present'
    console.log(`  VOICE: local fallback (${reason})`)
  } else {
    // Name the voice actually used. "account default" would be a lie here — the tool has
    // its own default, and the log has to agree with what a reviewer hears.
    const named = flagValue(args, '--voice') ?? process.env.ELEVENLABS_VOICE_ID
    console.log(`  voice: elevenlabs (${named ?? `${DEFAULT_VOICE_NAME}, default`})`)
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
