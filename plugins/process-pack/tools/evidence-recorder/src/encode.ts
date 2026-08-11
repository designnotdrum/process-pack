import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { stat, rm } from 'node:fs/promises'

const run = promisify(execFile)

/**
 * Ceiling is 9 MB, not GitHub's limit. GitHub accepts at least 60 MB, but the agent
 * tooling that attaches the file caps a single upload at 10 MB — and a recording an agent
 * cannot attach is not evidence. 9 leaves margin.
 */
export const SIZE_CEILING_BYTES = 9 * 1024 * 1024

/**
 * CRF 32 is the quality floor, established by re-encoding a worst-case recording and
 * reading the small text in extracted frames. It halves the file and stays legible.
 * Below it text stops being readable, at which point the artifact stops being evidence,
 * so the recorder fails instead of degrading further.
 */
const CRF = 32

export async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size
}

export async function ffmpegAvailable(): Promise<boolean> {
  try {
    await run('ffmpeg', ['-version'])
    return true
  } catch {
    return false
  }
}

/**
 * Re-encode to H264/MP4 to get under the ceiling. Measured: 52% reduction on a
 * scroll-heavy worst case. VP9 is not an option — re-encoding the already-VP8 source to
 * VP9 produced a *larger* file. Lowering resolution saves only ~12% and costs legibility
 * on small UI text, so it is not used either.
 */
export async function reencode(input: string): Promise<string> {
  const output = input.replace(/\.webm$/, '.mp4')
  try {
    await run('ffmpeg', [
      '-y',
      '-loglevel', 'error',
      '-i', input,
      '-c:v', 'libx264',
      '-crf', String(CRF),
      '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p',
      output,
    ])
  } catch (error) {
    // ffmpeg may have created the destination before failing. Leaving a partial file
    // behind lets a retry or an artifact scan mistake it for a finished recording.
    await rm(output, { force: true }).catch(() => {})
    throw error
  }
  return output
}

export class RecordingTooLargeError extends Error {
  constructor(bytes: number, durationMs: number) {
    const mb = (bytes / 1048576).toFixed(1)
    const secs = Math.round(durationMs / 1000)
    super(
      `Recording is ${mb} MB after re-encoding at the quality floor (CRF ${CRF}), ` +
      `over the ${(SIZE_CEILING_BYTES / 1048576).toFixed(0)} MB ceiling. ` +
      `The recording ran ${secs}s. Split the scenario into shorter ones rather than ` +
      `lowering quality further — past this point the text is not readable and the ` +
      `recording is not evidence.`,
    )
    this.name = 'RecordingTooLargeError'
  }
}
