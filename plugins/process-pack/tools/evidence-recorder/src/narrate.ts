import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { renderCaptions, probeDuration, type Clip } from './tts.js'
import type { StepStamp } from './types.js'

const run = promisify(execFile)

export interface NarrateOptions {
  videoPath: string
  stepsPath: string
  outPath?: string
  apiKey?: string
  forceSay?: boolean
}

export interface Placement extends Clip {
  startSec: number
  /** True when the clip could not start at its step because the previous one was still speaking. */
  delayed: boolean
}

export interface NarrateResult {
  outPath: string
  voice: 'elevenlabs' | 'say'
  usedFallback: boolean
  placements: Placement[]
  videoDurationSec: number
  audioEndSec: number
  /** Seconds of still frame appended so the final caption is not cut off. */
  paddedSec: number
}

/**
 * Place each clip at its step's recorded start time.
 *
 * When a caption runs longer than its step, the next clip starts when this one finishes
 * rather than at its own step time. Overlapping narration is unintelligible, and the
 * alternatives are worse: truncating drops the words that explain the step, and slowing
 * the video desynchronises every later stamp. Late-but-complete is the least-bad failure,
 * and the delay is reported so a scenario with chronically long captions is visible rather
 * than silently drifting.
 */
export function placeClips(clips: Clip[], steps: StepStamp[]): Placement[] {
  const byIndex = new Map(steps.map(s => [s.index, s]))
  const ordered = [...clips].sort((a, b) => a.index - b.index)
  const placements: Placement[] = []
  let cursor = 0

  for (const clip of ordered) {
    const step = byIndex.get(clip.index)
    if (!step) throw new Error(`no step stamp for caption ${clip.index}; the steps file does not match this recording`)
    const wanted = step.startMs / 1000
    const startSec = Math.max(wanted, cursor)
    placements.push({ ...clip, startSec, delayed: startSec > wanted + 0.001 })
    cursor = startSec + clip.durationSec
  }
  return placements
}

export async function narrate(options: NarrateOptions): Promise<NarrateResult> {
  const parsed: unknown = JSON.parse(await readFile(options.stepsPath, 'utf8'))
  if (!parsed || typeof parsed !== 'object' || !('steps' in parsed)) {
    throw new Error(`${options.stepsPath} is not a steps file (expected an object with a "steps" array)`)
  }
  const steps = (parsed as { steps: StepStamp[] }).steps
  if (!Array.isArray(steps) || steps.length === 0) throw new Error(`${options.stepsPath} contains no steps`)

  // The steps file is JSON on disk and may be hand-edited. A NaN or negative startMs
  // becomes a nonsense `adelay` argument, and duplicate indexes silently attach a caption
  // to the wrong timestamp via the lookup map.
  const seen = new Set<number>()
  for (const s of steps) {
    if (!Number.isInteger(s?.index) || s.index < 0) throw new Error(`${options.stepsPath}: step index must be a non-negative integer`)
    if (seen.has(s.index)) throw new Error(`${options.stepsPath}: duplicate step index ${s.index}`)
    seen.add(s.index)
    if (!Number.isFinite(s.startMs) || s.startMs < 0) throw new Error(`${options.stepsPath}: step ${s.index} has a non-finite or negative startMs`)
    if (typeof s.caption !== 'string' || !s.caption.trim()) throw new Error(`${options.stepsPath}: step ${s.index} has an empty caption`)
  }

  const workDir = path.join(path.dirname(options.videoPath), 'narration')
  await mkdir(workDir, { recursive: true })

  const clips = await renderCaptions(
    steps.map(s => ({ index: s.index, caption: s.caption })),
    { outDir: workDir, apiKey: options.apiKey, forceSay: options.forceSay },
  )

  const placements = placeClips(clips, steps)
  const videoDurationSec = await probeDuration(options.videoPath)
  const audioEndSec = Math.max(...placements.map(p => p.startSec + p.durationSec))

  // If the narration outlasts the footage, hold the final frame rather than cutting the
  // last caption off mid-sentence. A truncated explanation is worse than a still frame.
  const paddedSec = Math.max(0, audioEndSec - videoDurationSec)

  // ffmpeg cannot read and write the same file. Without this, an input whose extension is
  // not lowercase .webm/.mp4 leaves outPath === videoPath and corrupts the source.
  const derived = /\.(webm|mp4)$/i.test(options.videoPath)
    ? options.videoPath.replace(/\.(webm|mp4)$/i, '-narrated.mp4')
    : `${options.videoPath}-narrated.mp4`
  const outPath = options.outPath ?? derived
  if (path.resolve(outPath) === path.resolve(options.videoPath)) {
    throw new Error(`the narrated output would overwrite the source recording (${options.videoPath}); choose a different --out`)
  }

  // The CLI accepts an arbitrary output path, whose directory may not exist yet.
  await mkdir(path.dirname(outPath), { recursive: true })

  const inputs = ['-i', options.videoPath, ...placements.flatMap(p => ['-i', p.audioPath])]
  const delays = placements
    .map((p, i) => `[${i + 1}:a]adelay=${Math.round(p.startSec * 1000)}|${Math.round(p.startSec * 1000)}[a${i}]`)
    .join(';')
  const mixInputs = placements.map((_, i) => `[a${i}]`).join('')
  const videoFilter = paddedSec > 0
    ? `[0:v]tpad=stop_mode=clone:stop_duration=${paddedSec.toFixed(2)}[v]`
    : `[0:v]null[v]`
  const filter = `${videoFilter};${delays};${mixInputs}amix=inputs=${placements.length}:normalize=0[a]`

  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    ...inputs,
    '-filter_complex', filter,
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-crf', '28', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    outPath,
  ])

  const voice = clips[0]?.voice ?? 'say'
  return {
    outPath,
    voice,
    usedFallback: voice === 'say',
    placements,
    videoDurationSec,
    audioEndSec,
    paddedSec,
  }
}
