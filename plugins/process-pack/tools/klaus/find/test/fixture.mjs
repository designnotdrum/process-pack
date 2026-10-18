/**
 * A small inventory in the shape inventory.mjs writes, for the find tests. The components are the
 * ordinary parts of a UI library, and their purposes are written in the Use when / Not for form
 * except where a test needs them not to be.
 */

export const purpose = (useWhen, notFor) => ({ useWhen, notFor, text: `Use when: ${useWhen} Not for: ${notFor}` })
export const unlabelled = (text) => ({ useWhen: null, notFor: null, text })

/** One inventory entry, with the fields a test does not care about filled in. */
export function entry(name, overrides = {}) {
  return {
    name,
    kind: 'shared',
    folder: 'packages/ui/src',
    file: `packages/ui/src/components/${name}.tsx`,
    purpose: null,
    props: [],
    variants: {},
    parts: [],
    version: '',
    screenshot: '',
    usedIn: [],
    ...overrides,
  }
}

export const folders = [
  { path: 'packages/ui/src', role: 'shared' },
  { path: 'apps/web/app', role: 'app' },
]

export const entries = [
  entry('SegmentedControl', {
    purpose: purpose('switching a view, layout or filter between two to four options in place, for example in a header row.', 'moving between pages, or an on or off setting.'),
    parts: [{ name: 'SegmentedControlItem', props: [], variants: {} }],
    usedIn: ['a.tsx', 'b.tsx'],
  }),
  entry('Tabs', {
    purpose: purpose('several large panels of content share one place and only one shows at a time.', 'a compact view switch inside a header row.'),
    parts: ['TabsList', 'TabsTrigger', 'TabsContent'].map((name) => ({ name, props: [], variants: {} })),
  }),
  entry('Switch', { purpose: purpose('a setting that is on or off and applies at once.', 'choosing between views or options.') }),
  entry('ToggleGroup', {
    purpose: purpose('a toolbar of formatting or alignment buttons that stay pressed.', 'switching a view or layout.'),
    variants: { size: ['default', 'sm', 'lg'] },
  }),
  entry('Badge', { purpose: purpose('a short status, count or category beside a title.', 'marking content written by the assistant.') }),
  entry('AIChip', { purpose: purpose('marking text, a value or a summary as written by the assistant, including a count of what it used.', 'plain status labels.') }),
  entry('Skeleton', {
    purpose: purpose("content is loading and its shape is known, from a page's first load to a single card.", 'an action in progress.'),
    usedIn: ['page.tsx', 'list.tsx', 'card.tsx'],
  }),
  entry('Skeleton', {
    kind: 'app',
    folder: 'apps/web/app',
    file: 'apps/web/app/components/ui/skeleton.tsx',
    purpose: purpose("content is loading and its shape is known, from a page's first load to a single card.", 'an action in progress.'),
  }),
  entry('Spinner', { purpose: purpose('a button or region is busy with an action the person started.', "a page's first load.") }),
  entry('Dialog', {
    purpose: purpose('a short decision or form that must be finished or cancelled.', 'browsing a list of detail.'),
    parts: ['DialogContent', 'DialogHeader', 'DialogFooter'].map((name) => ({ name, props: [], variants: {} })),
  }),
  entry('Tooltip', { purpose: purpose('explaining an icon or a control in a few words on hover.', 'anything a person must act on.') }),
  entry('Button', { purpose: purpose('any action a person clicks.', 'navigation that should be a link.'), variants: { variant: ['default', 'outline'] } }),
  entry('Avatar', { purpose: unlabelled("A person's avatar with an initials fallback. Used in the presence cluster and the member list.") }),
  entry('OrdersTable', {
    kind: 'local',
    folder: 'apps/web/app',
    file: 'apps/web/app/orders/OrdersTable.tsx',
    route: '/orders',
    purpose: unlabelled('The table of orders on the orders screen.'),
  }),
  entry('Divider'),
  entry('Icon set', { kind: 'icon-set', file: 'packages/ui/src/icons', icons: ['ArrowLeft', 'Moon', 'Star'] }),
]

export const inventory = { schemaVersion: 1, folders, entries }
