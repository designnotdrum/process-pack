import type { Scenario } from '../src/types.js'

/**
 * Reference scenario against a public app. Deterministic, no auth, no secrets — use it to
 * check the recorder itself works before blaming a scenario or an environment.
 */
const scenario: Scenario = {
  name: 'todomvc-add-and-complete',
  url: 'https://demo.playwright.dev/todomvc',

  // Asserts something only the working page renders. Not "did it render", not "is the
  // network quiet" — both of those are true of pages that are broken or signed out.
  ready: async page => page.getByPlaceholder('What needs to be done?').isVisible(),

  steps: [
    {
      caption: 'Adding a task called buy milk.',
      run: async page => {
        const box = page.getByPlaceholder('What needs to be done?')
        await box.click()
        await box.fill('buy milk')
        await box.press('Enter')
        await page.waitForTimeout(1200)
      },
    },
    {
      caption: 'Adding a second task, so the list has more than one row.',
      run: async page => {
        const box = page.getByPlaceholder('What needs to be done?')
        await box.fill('walk the dog')
        await box.press('Enter')
        await page.waitForTimeout(1200)
      },
    },
    {
      caption: 'Marking the first task complete. The row is struck through and the counter drops.',
      run: async page => {
        await page.getByRole('listitem').first().getByRole('checkbox').check()
        await page.waitForTimeout(1800)
      },
    },
  ],
}

export default scenario
