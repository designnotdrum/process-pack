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
 * Scenario modules are arbitrary code, so their `name` is untrusted input as far as the
 * filesystem is concerned. A name of `../../etc/thing` would otherwise write the video,
 * the steps file and the failure screenshot outside `outDir`.
 */
export function safeName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^[.-]+/, '').slice(0, 80)
  if (!cleaned) throw new Error(`scenario name ${JSON.stringify(name)} contains no usable characters`)
  return cleaned
}

/**
 * Apply the deployment-protection header to the protected origin ONLY.
 *
 * Playwright's `extraHTTPHeaders` is context-wide, which sends the header cross-origin to
 * the auth provider too. A custom header forces a CORS preflight the provider does not
 * allow, so its script fails to load and the app renders a blank page — while cookies and
 * the URL path still look correct. Routing per-origin also stops the secret being
 * transmitted to a third party.
 *
 * Match on parsed origin, never `startsWith`: a prefix test on `https://example.com` also
 * matches `https://example.com.evil.test`, which would hand the bypass secret to whoever
 * owns that domain.
 */
async function applyBypassRoute(ctx: BrowserContext, origin: string, secret: string) {
  let target: URL
  try {
    target = new URL(origin)
  } catch {
    throw new Error(`protectedOrigin ${JSON.stringify(origin)} is not a valid URL`)
  }

  await ctx.route('**/*', route => {
    let url: URL | null = null
    try {
      url = new URL(route.request().url())
    } catch {
      url = null
    }
    const sameOrigin =
      url !== null &&
      url.protocol === target.protocol &&
      url.hostname === target.hostname &&
      url.port === target.port

    if (sameOrigin) {
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
    console.warn('[recorder] ffmpeg not found — re-encoding will be unavailable if the recording is oversized')
  }

  const name = safeName(scenario.name)
  await mkdir(options.outDir, { recursive: true })
  const videoPath = path.join(options.outDir, `${name}.webm`)

  // Handles are declared out here so the finally block can close whatever was created.
  // Previously a throw from newContext() or newPage() left an orphaned browser process.
  let browser: Browser | null = null
  let ctx: BrowserContext | null = null
  let page: Page | null = null
  const stamps: StepStamp[] = []

  try {
    browser = await chromium.launch({ headless: options.headless ?? true })
    ctx = await browser.newContext({
      viewport: VIEWPORT,
      ...(options.storageStatePath ? { storageState: options.storageStatePath } : {}),
    })

    if (options.protectedOrigin && options.bypassSecret) {
      await applyBypassRoute(ctx, options.protectedOrigin, options.bypassSecret)
    }

    page = await ctx.newPage()
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
    ctx = null
    await browser.close()
    browser = null

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

    return { scenario: name, videoPath: finalPath, container, bytes, durationMs, steps: stamps, reencoded }
  } catch (error) {
    // Save a frame at the point of failure. A failed run with no artifact tells the next
    // session nothing about why.
    if (page) {
      await page.screenshot({ path: path.join(options.outDir, `${name}-FAILED.png`) }).catch(() => {})
    }
    throw error
  } finally {
    if (ctx) await ctx.close().catch(() => {})
    if (browser) await browser.close().catch(() => {})
  }
}
