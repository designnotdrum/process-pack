import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile, mkdir, rm } from 'node:fs/promises'
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

/** ElevenLabs' documented concurrency is 10 on Creator, 20 on Pro. Stay under the floor. */
const MAX_CONCURRENT = 5
const REQUEST_TIMEOUT_MS = 30_000

async function assertExecutable(command: string, args: string[], hint: string): Promise<void> {
  try {
    await run(command, args)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') throw new Error(`${command} is not installed or not on PATH. ${hint}`)
    throw error
  }
}

/** Checked once before a batch, so a missing prerequisite is named rather than surfacing
 *  as a raw execFile error from inside one of N parallel renders. */
export async function assertPrerequisites(voice: Voice): Promise<void> {
  await assertExecutable('ffprobe', ['-version'], 'Install ffmpeg (which provides ffprobe) to measure clip durations.')
  if (voice === 'say') {
    if (process.platform !== 'darwin') {
      throw new Error(
        `The local voice fallback uses macOS \`say\`, and this is ${process.platform}. ` +
        `Set ELEVENLABS_API_KEY to narrate on this platform.`,
      )
    }
    await assertExecutable('/usr/bin/say', ['-v', '?'], 'Expected macOS `say` at /usr/bin/say.')
  }
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
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`could not read a usable duration from ${file}`)
  }
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
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(
      // Encoded: a caller-supplied id containing `/`, `?` or `#` would otherwise retarget
      // the request.
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5' }),
        signal: controller.signal,
      },
    )
    if (!response.ok) {
      throw new Error(`ElevenLabs returned ${response.status}: ${(await response.text()).slice(0, 200)}`)
    }
    await writeFile(outPath, Buffer.from(await response.arrayBuffer()))
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`ElevenLabs did not respond within ${REQUEST_TIMEOUT_MS / 1000}s for caption: "${text.slice(0, 60)}"`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export interface RenderOptions {
  outDir: string
  apiKey?: string
  voiceId?: string
  /** Force the free path even when a key exists. Useful for tests and dry runs. */
  forceSay?: boolean
}

/** Bounded parallelism. Unbounded `Promise.all` over a long scenario bursts a paid API
 *  past its concurrency limit, and one rejection abandons clips already written. */
async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i]!)
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * Render captions to audio.
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

  // Exported, so it must not assume narrate() already made the directory.
  await mkdir(options.outDir, { recursive: true })

  // Indexes become filenames. Duplicates would have two concurrent renders writing the
  // same file while both Clips claim it.
  const seen = new Set<number>()
  for (const c of captions) {
    if (!Number.isInteger(c.index) || c.index < 0) throw new Error(`caption index must be a non-negative integer, got ${c.index}`)
    if (seen.has(c.index)) throw new Error(`duplicate caption index ${c.index}`)
    seen.add(c.index)
  }

  await assertPrerequisites(voice)

  const written: string[] = []
  try {
    return await mapWithLimit(captions, MAX_CONCURRENT, async ({ index, caption }) => {
      const ext = voice === 'elevenlabs' ? 'mp3' : 'wav'
      const audioPath = path.join(options.outDir, `caption-${String(index).padStart(2, '0')}.${ext}`)
      if (voice === 'elevenlabs') await renderWithElevenLabs(caption, audioPath, apiKey!, voiceId)
      else await renderWithSay(caption, audioPath)
      written.push(audioPath)
      return { index, caption, audioPath, durationSec: await probeDuration(audioPath), voice }
    })
  } catch (error) {
    // In-flight workers keep writing after the first rejection. Without this, a failed
    // batch leaves a mix of complete and partial clips that a retry could mistake for a
    // finished render.
    await Promise.all(written.map(f => rm(f, { force: true }).catch(() => {})))
    throw error
  }
}
