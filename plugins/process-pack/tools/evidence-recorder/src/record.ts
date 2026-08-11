import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { RecordingResult, Scenario, StepStamp } from './types.js'
import {
  SIZE_CEILING_BYTES,
  RecordingTooLargeError,
  fileSize,
  ffmpegAvailable,
  reencode,
} from './encode.js'

export interface RecordOptions {
  outDir: string
  /** Saved signed-in session, produced by the auth capture step. */
  storageStatePath?: string
  /**
   * Origin that requires the deployment-protection bypass header, and the secret itself.
   * The secret comes from the environment; never from a file in the repo.
   */
  protectedOrigin?: string
  bypassSecret?: string
  headless?: boolean
  /** How long to wait for `scenario.ready` before refusing to record. */
  readyTimeoutMs?: number
}

const VIEWPORT = { width: 1280, height: 720 }
const DEFAULT_READY_TIMEOUT = 30_000

/**
 * Apply the deployment-protection header to the protected origin ONLY.
 *
 * Playwright's `extraHTTPHeaders` is context-wide, which sends the header cross-origin to
 * the auth provider too. A custom header forces a CORS preflight the provider does not
 * allow, so its script fails to load and the app renders a blank page — while cookies and
 * the URL path still look correct. Routing per-origin also stops the secret being
 * transmitted to a third party on every request.
 */
async function applyBypassRoute(ctx: BrowserContext, origin: string, secret: string) {
  await ctx.route('**/*', route => {
    const url = route.request().url()
    if (url.startsWith(origin)) {
      route.continue({ headers: { ...route.request().headers(), 'x-vercel-protection-bypass': secret } })
    } else {
      route.continue()
    }
  })
}

async function waitForReady(page: Page, scenario: Scenario, timeoutMs: number): Promise<void> {
  const start = Date.now()
  let last: unknown
  while (Date.now() - start < timeoutMs) {
    try {
      if (await scenario.ready(page)) return
    } catch (error) {
      last = error
    }
    await page.waitForTimeout(500)
  }
  throw new Error(
    `Scenario "${scenario.name}" was not ready within ${Math.round(timeoutMs / 1000)}s, so nothing was recorded.\n` +
    `The page may be signed out, or waiting on data that never arrived. Both states render ` +
    `without error and would have produced a recording that proves nothing.` +
    (last ? `\nLast ready() error: ${String(last).slice(0, 200)}` : ''),
  )
}

export async function record(scenario: Scenario, options: RecordOptions): Promise<RecordingResult> {
  if (!(await ffmpegAvailable())) {
    // Only fatal if we end up needing it; warn early so it is not a surprise at the end.
    console.warn('[recorder] ffmpeg not found — re-encoding will be unavailable if the recording is oversized')
  }

  await mkdir(options.outDir, { recursive: true })
  const videoPath = path.join(options.outDir, `${scenario.name}.webm`)

  const browser: Browser = await chromium.launch({ headless: options.headless ?? true })
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    ...(options.storageStatePath ? { storageState: options.storageStatePath } : {}),
  })

  if (options.protectedOrigin && options.bypassSecret) {
    await applyBypassRoute(ctx, options.protectedOrigin, options.bypassSecret)
  }

  const page = await ctx.newPage()
  const stamps: StepStamp[] = []

  try {
    await page.goto(scenario.url, { waitUntil: 'domcontentloaded', timeout: 60_000 })

    // Readiness is asserted BEFORE recording starts. Recording a page that never became
    // ready produces a video of skeletons or a sign-in form, which reads as evidence and
    // is not.
    await waitForReady(page, scenario, options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT)

    // `page.screencast` only. It provides both the overlays and controllable start/stop;
    // `recordVideo` would add a redundant second file and force start at context creation.
    // Do NOT pass `quality` — measured, it makes files larger, not smaller.
    await page.screencast.start({ path: videoPath, size: VIEWPORT })
    await page.screencast.showActions({ position: 'top-right' })

    const t0 = Date.now()
    for (const [index, step] of scenario.steps.entries()) {
      const startMs = Date.now() - t0
      await step.run(page)
      stamps.push({ index, caption: step.caption, startMs, endMs: Date.now() - t0 })
    }
    const durationMs = Date.now() - t0

    await page.screencast.stop()
    await ctx.close()
    await browser.close()

    let finalPath = videoPath
    let container: 'webm' | 'mp4' = 'webm'
    let reencoded = false
    let bytes = await fileSize(finalPath)

    if (bytes > SIZE_CEILING_BYTES) {
      finalPath = await reencode(videoPath)
      container = 'mp4'
      reencoded = true
      bytes = await fileSize(finalPath)
      if (bytes > SIZE_CEILING_BYTES) throw new RecordingTooLargeError(bytes, durationMs)
    }

    return { scenario: scenario.name, videoPath: finalPath, container, bytes, durationMs, steps: stamps, reencoded }
  } catch (error) {
    // Save a frame at the point of failure. A failed run with no artifact tells the next
    // session nothing about why.
    await page.screenshot({ path: path.join(options.outDir, `${scenario.name}-FAILED.png`) }).catch(() => {})
    await browser.close().catch(() => {})
    throw error
  }
}
