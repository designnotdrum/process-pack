import type { Scenario } from '../src/types.js'

/**
 * Self-contained demo. No auth, no secrets, no network beyond a local static server:
 *
 *   npx serve examples/demo-app -l 5099     (or any static server)
 *   bun src/cli.ts examples/demo.scenario.ts --out out
 *   bun src/narrate-cli.ts out/demo-modal-and-sidebar.webm
 *
 * Use it to see what a finished recording looks like, and to check the recorder itself
 * works before blaming a scenario or an environment.
 */
const BASE = process.env.DEMO_BASE_URL ?? 'http://localhost:5099'

const scenario: Scenario = {
  name: 'demo-modal-and-sidebar',
  url: `${BASE}/index.html`,

  // Both controls present. Asserts the thing the scenario is about, rather than that a
  // document rendered.
  ready: async page =>
    (await page.getByRole('button', { name: 'Open modal' }).isVisible()) &&
    (await page.getByRole('button', { name: 'Open sidebar' }).isVisible()),

  steps: [
    {
      caption: 'The demo page, with two buttons.',
      run: async page => {
        await page.waitForTimeout(2600)
      },
    },
    {
      caption: 'The red button opens a modal.',
      run: async page => {
        await page.getByRole('button', { name: 'Open modal' }).click()
        // Assert the outcome the caption promises, rather than assuming the click worked.
        await page.getByRole('dialog').waitFor({ state: 'visible' })
        await page.waitForTimeout(2400)
      },
    },
    {
      caption: 'Closing it returns to the page.',
      run: async page => {
        await page.getByRole('button', { name: 'Close' }).first().click()
        await page.getByRole('dialog').waitFor({ state: 'hidden' })
        await page.waitForTimeout(2200)
      },
    },
    {
      caption: 'The green button slides in a sidebar.',
      run: async page => {
        await page.getByRole('button', { name: 'Open sidebar' }).click()
        await page.getByRole('complementary').getByText('Sidebar opened').waitFor({ state: 'visible' })
        await page.waitForTimeout(2200)
      },
    },
  ],
}

export default scenario
