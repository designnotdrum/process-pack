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
const ORIGIN = process.env.EVIDENCE_PROTECTED_ORIGIN ?? ''

const scenario: Scenario = {
  name: 'meridian-projects',
  url: `${ORIGIN}/projects`,

  ready: async page => {
    // Not sitting on the auth provider's form.
    if (new URL(page.url()).pathname.startsWith('/sign-in')) return false

    // Signed-in chrome. NECESSARY BUT NOT SUFFICIENT — this alone passes on a page whose
    // content never loaded. Measured: a session with no active organisation renders
    // "Sign out" while every panel stays a loading skeleton, and an earlier version of
    // this check happily recorded five seconds of grey rectangles.
    const signedIn = await page.getByText(/Sign out/i).isVisible().catch(() => false)
    if (!signedIn) return false

    // The actual gate: the loading skeletons must be gone. Anything less records
    // placeholders and calls it evidence.
    const skeletons = await page.evaluate(
      () => document.querySelectorAll('[class*="animate-pulse"],[data-slot="skeleton"],[class*="skeleton"]').length,
    )
    return skeletons === 0
  },

  steps: [
    {
      caption: 'The projects area, loaded as a signed-in user.',
      run: async page => {
        await page.waitForTimeout(2500)
      },
    },
    {
      caption: 'Opening the account menu to show which user this session belongs to.',
      run: async page => {
        await page.getByText(/Sign out/i).first().hover().catch(() => {})
        await page.waitForTimeout(2000)
      },
    },
  ],
}

export default scenario
