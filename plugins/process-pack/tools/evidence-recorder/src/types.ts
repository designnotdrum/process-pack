import type { Page } from 'playwright'

/**
 * One step of a scenario. `run` is arbitrary Playwright, so nothing about the page has to
 * be expressed in an invented mini-language. The array of steps is what supplies the step
 * boundaries the recorder stamps, which is what makes narration timing bookkeeping rather
 * than audio alignment.
 */
export interface Step {
  /** What this step demonstrates, in a sentence a reviewer would understand. Becomes narration. */
  caption: string
  run: (page: Page) => Promise<void>
}

export interface Scenario {
  /** Short name; used for the output filename. */
  name: string
  /** Absolute URL the recording starts at. */
  url: string
  steps: Step[]
  /**
   * Proof that the page under test is actually ready — not that it rendered, and not that
   * the network went quiet. Both of those are satisfied by pages that are wrong: a
   * signed-out sign-in page, or an app whose org context never resolved and which shows
   * loading skeletons indefinitely. Assert something only the working feature renders.
   *
   * Return true when ready. The recorder polls this and refuses to record without it.
   */
  ready: (page: Page) => Promise<boolean>
}

export interface StepStamp {
  index: number
  caption: string
  /** Milliseconds from the start of the recording. Consumed by the narration muxer. */
  startMs: number
  endMs: number
}

export interface RecordingResult {
  scenario: string
  videoPath: string
  container: 'webm' | 'mp4'
  bytes: number
  durationMs: number
  steps: StepStamp[]
  /** True when the recording was re-encoded to get under the size ceiling. */
  reencoded: boolean
}
