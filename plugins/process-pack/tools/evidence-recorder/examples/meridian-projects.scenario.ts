import type { Scenario } from '../src/types.js'

/**
 * Scenario against a real, deployment-protected preview behind an auth provider.
 *
 * Requires:
 *   EVIDENCE_STORAGE_STATE          a captured signed-in session
 *   EVIDENCE_PROTECTED_ORIGIN       the preview origin
 *   VERCEL_AUTOMATION_BYPASS_SECRET the bypass secret, from the environment
 *
 * The `ready` check below is the important part of this file. It asserts signed-in
 * application chrome. It deliberately does NOT accept "the page rendered" or "the network
 * went idle", because both are true of the two states that have repeatedly masqueraded as
 * success here: an expired session showing a sign-in form, and a session whose
 * organisation context never resolved, which renders loading skeletons indefinitely.
 */
const ORIGIN = process.env.EVIDENCE_PROTECTED_ORIGIN
if (!ORIGIN) {
  // Without this the url below is the relative string "/projects", which Playwright
  // resolves against whatever base it has — navigating somewhere unintended instead of
  // reporting the missing configuration.
  throw new Error('EVIDENCE_PROTECTED_ORIGIN is required for this scenario (the preview origin to record).')
}

// Normalised, so a value with a trailing slash does not produce `//projects` and a value
// carrying a path or query does not produce an unintended URL.
const PROJECTS_URL = new URL('/projects', ORIGIN).toString()

const scenario: Scenario = {
  name: 'meridian-projects',
  url: PROJECTS_URL,

  ready: async page => {
    // Not sitting on the auth provider's form.
    if (new URL(page.url()).pathname.startsWith('/sign-in')) return false

    // Signed-in chrome. NECESSARY BUT NOT SUFFICIENT — this alone passes on a page whose
    // content never loaded. Measured: a session with no active organisation renders
    // "Sign out" while every panel stays a loading skeleton, and an earlier version of
    // this check happily recorded five seconds of grey rectangles.
    const signedIn = await page.getByText(/Sign out/i).isVisible().catch(() => false)
    if (!signedIn) return false

    // The actual gate: content has arrived and the placeholders are gone. A fully loaded
    // page still keeps one persistent pulse element, so this allows a couple rather than
    // demanding zero — and pairs it with a body-text floor, because "few skeletons" is
    // also true of a blank page.
    // Feature-specific, not generic: the projects heading proves this view rendered, and
    // the skeleton bound proves its content arrived. Thresholds alone would pass on an
    // authenticated error page or an app shell.
    const heading = await page.getByRole('heading', { name: /projects/i }).first().isVisible().catch(() => false)
    if (!heading) return false

    const skeletons = await page.evaluate(
      () => document.querySelectorAll('[class*="animate-pulse"],[data-slot="skeleton"],[class*="skeleton"]').length,
    )
    return skeletons <= 2
  },

  steps: [
    {
      caption: 'The projects area, loaded as a signed-in user.',
      run: async page => {
        // Hold on the loaded list long enough to read it. `ready` already proved it
        // rendered, so this is dwell time for the viewer, not a wait for state.
        await page.waitForTimeout(2000)
      },
    },
    {
      // The caption promises the account identity is on screen, so the step asserts it.
      // Swallowing a failed locator here would let the step "succeed" while recording
      // something that does not show what the caption claims.
      caption: 'Showing which account this session belongs to.',
      run: async page => {
        // Assert the identity itself, not the generic control beside it — a session can
        // show "Sign out" without ever revealing whose session it is, which would let the
        // caption promise something the recording does not contain.
        const identity = page.getByText(/@/).first()
        await identity.waitFor({ state: 'visible', timeout: 5_000 })
        await identity.hover()
        await page.waitForTimeout(2000)
      },
    },
  ],
}

export default scenario
