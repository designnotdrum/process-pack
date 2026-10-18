import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import ts from 'typescript'
import { compareTrees } from '../props.mjs'
import { cleanup, makeTree, typeScriptBefore54, writeFiles } from './helpers.mjs'

after(cleanup)

const COMPONENTS = 'packages/ui/src/components'

/** Compares one file across two trees and returns the result for each job key. */
function compare(base, head, jobs) {
  return compareTrees({
    ts,
    base,
    head,
    jobs: jobs.map((job) => ({ key: job.primary, primary: job.primary, names: job.names ?? [job.primary], baseFile: path.join(base, job.file), headFile: path.join(head, job.file) })),
  })
}

const find = (result, kind, where) => result.changes.find((c) => c.kind === kind && c.where === where)

describe('the three examples from the research on NJM-1771', () => {
  // The component files are the real ones from component-monkey-app, read with
  // `git show <sha>:<path>` (the commit's parent for before). Third-party imports are stubs.

  test('Button at 52d8d2fc3 gained two cva size values: minor', () => {
    const base = makeTree(['common', 'research/button/before'])
    const head = makeTree(['common', 'research/button/after'])
    const result = compare(base, head, [{ primary: 'Button', file: `${COMPONENTS}/ui/button.tsx` }]).get('Button')

    assert.equal(result.level, 'minor')
    const size = find(result, 'type widened', 'size')
    assert.equal(size.level, 'minor')
    assert.equal(size.detail, '+ "compact", + "compact-sm"')
    assert.deepEqual(result.changes.filter((c) => c.level !== 'minor'), [])
  })

  test('AnswerNudgeCard at bdcf7cc0f lost its copy prop: major', () => {
    const base = makeTree(['common', 'research/answer-nudge-card/before'])
    const head = makeTree(['common', 'research/answer-nudge-card/after'])
    const result = compare(base, head, [{ primary: 'AnswerNudgeCard', file: `${COMPONENTS}/AnswerNudgeCard.tsx` }]).get('AnswerNudgeCard')

    assert.equal(result.level, 'major')
    assert.equal(find(result, 'prop removed', 'copy').level, 'major')
    // The same commit added two optional fields to the question type the card takes. Those are
    // minor, and the removed prop is what makes the release major.
    assert.equal(find(result, 'optional prop added', 'question.waitingOn.imageUrl').level, 'minor')
    assert.equal(find(result, 'optional prop added', 'question.raisedByImageUrl').level, 'minor')
  })

  test('DialogContent at 9c4c91b7d changed class names only: no prop change', () => {
    const base = makeTree(['common', 'research/dialog/before'])
    const head = makeTree(['common', 'research/dialog/after'])
    const names = ['Dialog', 'DialogPortal', 'DialogOverlay', 'DialogTrigger', 'DialogClose', 'DialogContent', 'DialogHeader', 'DialogFooter', 'DialogTitle', 'DialogDescription']
    const result = compare(base, head, [{ primary: 'Dialog', names, file: `${COMPONENTS}/ui/dialog.tsx` }]).get('Dialog')

    assert.equal(result.level, 'none')
    assert.deepEqual(result.changes, [])
  })

  test('the Dialog check can see props: a wrapper that starts omitting a Radix prop is major', () => {
    // Without this, "no change" above would also be the answer if the reader saw no props at all.
    const base = makeTree(['common', 'research/dialog/after'])
    const head = makeTree(['common', 'research/dialog/after'])
    const file = path.join(head, COMPONENTS, 'ui/dialog.tsx')
    const wrapped = 'const DialogContent = React.forwardRef<\n  React.ElementRef<typeof DialogPrimitive.Content>,\n  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>\n>'
    const source = fs.readFileSync(file, 'utf8')
    assert.ok(source.includes(wrapped), 'the fixture no longer holds the DialogContent declaration this test edits')
    fs.writeFileSync(file, source.replace(wrapped, wrapped.replace('React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>', 'Omit<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, "onEscapeKeyDown">')))

    const result = compare(base, head, [{ primary: 'Dialog', names: ['Dialog', 'DialogContent'], file: `${COMPONENTS}/ui/dialog.tsx` }]).get('Dialog')
    assert.equal(result.level, 'major')
    assert.equal(find(result, 'prop removed', 'DialogContent.onEscapeKeyDown').level, 'major')
  })
})

describe('one component changing between two releases', () => {
  const cva = 'import { cva, type VariantProps } from "class-variance-authority";\n'
  const widget = (props, params = '_props: WidgetProps') => `export interface WidgetProps { ${props} }\nexport function Widget(${params}) { return null; }\n`

  /** Each case: the file before and after, the level it must come to, and changes it must report. */
  const cases = {
    'new-required-prop': {
      before: widget('size?: "sm";'),
      after: widget('size?: "sm"; label: string;'),
      level: 'major',
      has: [['major', 'required prop added', 'label']],
    },
    'new-prop-with-a-default': {
      before: widget('size?: "sm";', '{ size }: WidgetProps'),
      after: widget('size?: "sm"; tone?: "info" | "warn";', '{ size, tone = "info" }: WidgetProps'),
      level: 'minor',
      has: [['minor', 'optional prop added', 'tone']],
    },
    'new-optional-prop': {
      before: widget('size?: "sm";'),
      after: widget('size?: "sm"; hint?: string;'),
      level: 'minor',
      has: [['minor', 'optional prop added', 'hint']],
    },
    'prop-removed': {
      before: widget('size?: "sm"; hint?: string;'),
      after: widget('size?: "sm";'),
      level: 'major',
      has: [['major', 'prop removed', 'hint']],
    },
    'prop-renamed': {
      before: widget('isOpen?: boolean;'),
      after: widget('open?: boolean;'),
      level: 'major',
      has: [
        ['major', 'prop removed', 'isOpen'],
        ['minor', 'optional prop added', 'open'],
      ],
    },
    'union-narrowed': {
      before: widget('size?: "sm" | "md" | "lg";'),
      after: widget('size?: "sm" | "md";'),
      level: 'major',
      has: [['major', 'type narrowed', 'size']],
    },
    'union-widened': {
      before: widget('size?: "sm";'),
      after: widget('size?: "sm" | "md";'),
      level: 'minor',
      has: [['minor', 'type widened', 'size']],
    },
    'type-changed-both-ways': {
      before: widget('value?: string;'),
      after: widget('value?: number;'),
      level: 'major',
      has: [['major', 'type changed incompatibly', 'value']],
    },
    'optional-made-required': {
      before: widget('size?: "sm";'),
      after: widget('size: "sm";'),
      level: 'major',
      has: [['major', 'optional prop made required', 'size']],
    },
    'required-made-optional': {
      before: widget('size: "sm";'),
      after: widget('size?: "sm";'),
      level: 'minor',
      has: [['minor', 'required prop made optional', 'size']],
    },
    'cva-value-removed': {
      before: `${cva}const v = cva("chip", { variants: { tone: { info: "a", warn: "b", error: "c" } } });\nexport interface WidgetProps extends VariantProps<typeof v> {}\nexport function Widget(_props: WidgetProps) { return null; }\n`,
      after: `${cva}const v = cva("chip", { variants: { tone: { info: "a", error: "c" } } });\nexport interface WidgetProps extends VariantProps<typeof v> {}\nexport function Widget(_props: WidgetProps) { return null; }\n`,
      level: 'major',
      has: [['major', 'type narrowed', 'tone']],
    },
    'cva-value-added': {
      before: `${cva}const v = cva("chip", { variants: { tone: { info: "a", error: "c" } } });\nexport interface WidgetProps extends VariantProps<typeof v> {}\nexport function Widget(_props: WidgetProps) { return null; }\n`,
      after: `${cva}const v = cva("chip", { variants: { tone: { info: "a", warn: "b", error: "c" } } });\nexport interface WidgetProps extends VariantProps<typeof v> {}\nexport function Widget(_props: WidgetProps) { return null; }\n`,
      level: 'minor',
      has: [['minor', 'type widened', 'tone']],
    },
    'cva-classes-only': {
      before: `${cva}const v = cva("chip", { variants: { tone: { info: "a", error: "c" } } });\nexport interface WidgetProps extends VariantProps<typeof v> {}\nexport function Widget(_props: WidgetProps) { return null; }\n`,
      after: `${cva}const v = cva("chip chip-rounded", { variants: { tone: { info: "x", error: "y" } } });\nexport interface WidgetProps extends VariantProps<typeof v> {}\nexport function Widget(_props: WidgetProps) { return null; }\n`,
      level: 'none',
      has: [],
    },
    'type-rewritten-same-meaning': {
      before: widget('onChange?: (value: Date | undefined) => void;'),
      after: widget('onChange?: (value?: Date) => void;'),
      level: 'none',
      has: [['none', 'type rewritten, same meaning', 'onChange']],
    },
    'alias-keeps-its-name-but-gains-a-member': {
      before: `type Status = "idle" | "busy";\n${widget('status?: Status;')}`,
      after: `type Status = "idle" | "busy" | "done";\n${widget('status?: Status;')}`,
      level: 'minor',
      has: [['minor', 'type widened', 'status']],
    },
    'field-removed-inside-a-list-prop': {
      before: `interface Row { id: string; note: string }\n${widget('rows: Row[];')}`,
      after: `interface Row { id: string }\n${widget('rows: Row[];')}`,
      level: 'major',
      has: [['major', 'prop removed', 'rows[].note']],
    },
    'optional-field-added-inside-a-list-prop': {
      before: `interface Row { id: string }\n${widget('rows: Row[];')}`,
      after: `interface Row { id: string; note?: string }\n${widget('rows: Row[];')}`,
      level: 'minor',
      has: [['minor', 'optional prop added', 'rows[].note']],
    },
    'generic-component': {
      before: 'export function List<T>(_props: { items: T[]; label?: string }) { return null; }\n',
      after: 'export function List<T>(_props: { items: T[]; label?: string; empty?: string }) { return null; }\n',
      names: ['List'],
      level: 'minor',
      has: [['minor', 'optional prop added', 'empty']],
    },
    'default-export': {
      before: 'export default function Panel(_props: { title?: string }) { return null; }\n',
      after: 'export default function Panel(_props: { title?: string; footer?: string }) { return null; }\n',
      names: ['Panel'],
      level: 'minor',
      has: [['minor', 'optional prop added', 'footer']],
    },
    'family-part-removed': {
      before: `${widget('size?: "sm";')}export function WidgetHeader(_props: { title: string }) { return null; }\n`,
      after: widget('size?: "sm";'),
      names: ['Widget', 'WidgetHeader'],
      level: 'major',
      has: [['major', 'component removed', 'WidgetHeader']],
    },
    'family-part-added': {
      before: widget('size?: "sm";'),
      after: `${widget('size?: "sm";')}export function WidgetHeader(_props: { title: string }) { return null; }\n`,
      names: ['Widget', 'WidgetHeader'],
      level: 'minor',
      has: [['minor', 'component added', 'WidgetHeader']],
    },
    'family-part-prop-removed': {
      before: `${widget('size?: "sm";')}export function WidgetHeader(_props: { title: string; sub?: string }) { return null; }\n`,
      after: `${widget('size?: "sm";')}export function WidgetHeader(_props: { title: string }) { return null; }\n`,
      names: ['Widget', 'WidgetHeader'],
      level: 'major',
      has: [['major', 'prop removed', 'WidgetHeader.sub']],
    },
    // A prop declared by a library, here the DOM's own types, counts as one of the component's props.
    'inherited-prop-removed': {
      before: 'export function Widget(_props: Pick<Event, "type" | "timeStamp">) { return null; }\n',
      after: 'export function Widget(_props: Pick<Event, "type">) { return null; }\n',
      level: 'major',
      has: [['major', 'prop removed', 'timeStamp']],
      inherited: true,
    },
    // An import the compiler cannot find reads as `any`, so a prop typed with it cannot be compared.
    'unresolved-import': {
      before: `import type { Gone } from "@/nowhere";\n${widget('gone?: Gone;')}`,
      after: `import type { Gone } from "@/nowhere";\n${widget('gone?: Gone;')}`,
      level: 'none',
      has: [],
    },
    'nothing-changed': {
      before: widget('size?: "sm";'),
      after: widget('size?: "sm";'),
      level: 'none',
      has: [],
    },
    'highest-level-wins': {
      before: widget('size?: "sm"; hint?: string;'),
      after: widget('size?: "sm" | "md"; extra?: string;'),
      level: 'major',
      has: [
        ['major', 'prop removed', 'hint'],
        ['minor', 'type widened', 'size'],
        ['minor', 'optional prop added', 'extra'],
      ],
    },
    // The type behind the prop lives in another file, and that file changed between the releases.
    // The old side must read the old file through the same "@/" alias.
    'type-from-another-file': {
      before: `import type { Shape } from "@/types/shape";\n${widget('shape: Shape;')}`,
      after: `import type { Shape } from "@/types/shape";\n${widget('shape: Shape;')}`,
      beforeFiles: { 'packages/ui/src/types/shape.ts': 'export interface Shape { id: string }\n' },
      afterFiles: { 'packages/ui/src/types/shape.ts': 'export interface Shape { id: string; label: string }\n' },
      level: 'major',
      has: [['major', 'required prop added', 'shape.label']],
    },
  }

  let results

  before(() => {
    const base = makeTree(['common'])
    const head = makeTree(['common'])
    const jobs = []
    for (const [id, c] of Object.entries(cases)) {
      const file = `${COMPONENTS}/synthetic/${id}.tsx`
      writeFiles(base, { [file]: c.before, ...c.beforeFiles })
      writeFiles(head, { [file]: c.after, ...c.afterFiles })
      jobs.push({ key: id, primary: c.names?.[0] ?? 'Widget', names: c.names ?? ['Widget'], baseFile: path.join(base, file), headFile: path.join(head, file) })
    }
    results = compareTrees({ ts, base, head, jobs })
  })

  for (const [id, c] of Object.entries(cases)) {
    test(`${id}: ${c.level}`, () => {
      const result = results.get(id)
      assert.equal(result.note, undefined)
      assert.equal(result.level, c.level)
      for (const [level, kind, where] of c.has) {
        const change = find(result, kind, where)
        assert.ok(change, `expected "${kind}: ${where}" among ${JSON.stringify(result.changes)}`)
        assert.equal(change.level, level)
        assert.equal(change.inherited, c.inherited)
      }
      assert.equal(result.changes.length, c.has.length, `unexpected extra changes: ${JSON.stringify(result.changes)}`)
    })
  }

  test('an import the compiler cannot resolve is listed, and one declared by a stub or an asset is not', () => {
    assert.deepEqual(results.get('unresolved-import').unresolved, ['@/nowhere'])
    assert.equal(results.get('cva-value-added').unresolved, undefined)
    assert.equal(results.get('nothing-changed').unresolved, undefined)
  })

  test('a type widened by a new member names the member', () => {
    assert.equal(find(results.get('union-widened'), 'type widened', 'size').detail, '+ "md"')
    assert.equal(find(results.get('union-narrowed'), 'type narrowed', 'size').detail, '- "lg"')
  })
})

describe('when the compiler cannot load a file', () => {
  test('the comparison says so and reports no change', () => {
    const base = makeTree(['common'])
    const head = makeTree(['common'], { [`${COMPONENTS}/Widget.tsx`]: 'export function Widget() { return null; }\n' })
    const result = compare(base, head, [{ primary: 'Widget', file: `${COMPONENTS}/Widget.tsx` }]).get('Widget')
    assert.equal(result.level, 'none')
    assert.match(result.note, /could not load .*\/Widget\.tsx\.$/)
  })
})

describe('with a TypeScript that cannot say which way a type changed', () => {
  test('any difference in a prop type is major, and the result says it compared text only', () => {
    const file = `${COMPONENTS}/Widget.tsx`
    const component = (size) => `export function Widget(_props: { size?: ${size} }) { return null; }\n`
    const base = makeTree(['common'], { [file]: component('"sm"') })
    const head = makeTree(['common'], { [file]: component('"sm" | "md"') })
    const job = { key: 'Widget', primary: 'Widget', names: ['Widget'], baseFile: path.join(base, file), headFile: path.join(head, file) }

    const modern = compareTrees({ ts, base, head, jobs: [job] }).get('Widget')
    assert.equal(modern.level, 'minor')
    assert.equal(modern.textOnly, undefined)

    const old = compareTrees({ ts: typeScriptBefore54(ts), base, head, jobs: [job] }).get('Widget')
    assert.equal(old.level, 'major')
    assert.equal(old.textOnly, true)
    assert.equal(find(old, 'type changed incompatibly', 'size').level, 'major')
  })
})
