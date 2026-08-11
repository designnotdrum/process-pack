import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

const run = promisify(execFile)

export type Voice = 'elevenlabs' | 'say'

export interface Clip {
  index: number
  caption: string
  audioPath: string
  durationSec: number
  voice: Voice
}

/**
 * Measure a rendered clip. Both providers go down this one path.
 *
 * WAV and MP3 only — never m4a. Measured: AAC adds ~106ms of encoder padding, so a clip
 * measured as m4a reports longer than it sounds. Narration placed from that number drifts
 * a tenth of a second per caption and accumulates across a recording, which presents as
 * "the voice slowly falls behind" and is miserable to debug after the fact.
 */
export async function probeDuration(file: string): Promise<number> {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file,
  ])
  const seconds = Number.parseFloat(stdout.trim())
  if (!Number.isFinite(seconds)) throw new Error(`could not read a duration from ${file}`)
  return seconds
}

/** macOS `say`. No credentials, no network, no cost. WAVE so the duration is exact. */
async function renderWithSay(text: string, outPath: string): Promise<void> {
  await run('/usr/bin/say', [
    '-v', 'Samantha',
    '--file-format=WAVE',
    '--data-format=LEI16@24000',
    '-o', outPath,
    text,
  ])
}

/**
 * ElevenLabs. Preferred when a key is present. `eleven_flash_v2_5` is the cheap, fast
 * model; a 15-caption run costs roughly $0.07. Output is mp3 so the duration is honest.
 */
async function renderWithElevenLabs(text: string, outPath: string, apiKey: string, voiceId: string): Promise<void> {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5' }),
    },
  )
  if (!response.ok) {
    throw new Error(`ElevenLabs returned ${response.status}: ${(await response.text()).slice(0, 200)}`)
  }
  await writeFile(outPath, Buffer.from(await response.arrayBuffer()))
}

export interface RenderOptions {
  outDir: string
  apiKey?: string
  voiceId?: string
  /** Force the free path even when a key exists. Useful for tests and dry runs. */
  forceSay?: boolean
}

/**
 * Render captions to audio, in parallel.
 *
 * Falls back to `say` when no key is present — and the caller is expected to state that in
 * the run output. A robot voice is acceptable evidence; a silent downgrade nobody noticed
 * is the failure this exists to avoid.
 */
export async function renderCaptions(
  captions: { index: number; caption: string }[],
  options: RenderOptions,
): Promise<Clip[]> {
  const apiKey = options.forceSay ? undefined : options.apiKey
  const voice: Voice = apiKey ? 'elevenlabs' : 'say'
  const voiceId = options.voiceId ?? 'JBFqnCBsd6RMkjVDRZzb'

  return Promise.all(
    captions.map(async ({ index, caption }) => {
      const ext = voice === 'elevenlabs' ? 'mp3' : 'wav'
      const audioPath = path.join(options.outDir, `caption-${String(index).padStart(2, '0')}.${ext}`)
      if (voice === 'elevenlabs') await renderWithElevenLabs(caption, audioPath, apiKey!, voiceId)
      else await renderWithSay(caption, audioPath)
      return { index, caption, audioPath, durationSec: await probeDuration(audioPath), voice }
    }),
  )
}
