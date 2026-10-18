import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, mock, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { groupFamilies, ownProp, parsePurpose } from '../components.mjs'
import { readFolders } from '../config.mjs'
import { isInside, isRepoFile, toPosix } from '../files.mjs'
import { buildInventory } from '../inventory.mjs'
import { renderMarkdown } from '../markdown.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = path.join(here, 'fixtures', 'repo')
const cli = path.join(here, '..', 'inventory.mjs')

/**
 * The tests run on a copy of the fixture repo, so a killed run leaves nothing behind in the
 * checkout. The copy gets a test file and a story that import Button; they are not checked in
 * because a repo that copies this folder would run them as its own tests. It also gets a link to
 * this package's node_modules, which is where the repo's own `typescript` is found from.
 */
let fixture
let inventory
const entry = (name, folder) => inventory.entries.find((e) => e.name === name && (!folder || e.folder === folder))

before(() => {
  fixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'klaus-fixture-')), 'repo')
  fs.cpSync(source, fixture, { recursive: true })
  fs.symlinkSync(path.join(here, '..', '..', 'node_modules'), path.join(fixture, 'node_modules'))
  for (const file of ['packages/ui/src/button.test.tsx', 'packages/ui/src/button.stories.tsx']) {
    fs.writeFileSync(path.join(fixture, file), "import { Button } from './button'\nexport const x = Button\n")
  }
  inventory = buildInventory({ root: fixture, folders: readFolders(fixture) })
})

after(() => {
  fs.rmSync(path.dirname(fixture), { recursive: true, force: true })
})

describe('a family with parts', () => {
  test('is one entry named for the file, with the other components as parts', () => {
    const dialog = entry('Dialog')
    assert.equal(dialog.kind, 'shared')
    assert.equal(dialog.file, 'packages/ui/src/dialog.tsx')
    assert.deepEqual(dialog.parts.map((p) => p.name), ['DialogContent', 'DialogHeader'])
    assert.equal(entry('DialogContent'), undefined)
    assert.equal(entry('DialogHeader'), undefined)
  })

  test('lists props with their types and whether they are required', () => {
    const { props } = entry('Dialog')
    assert.deepEqual(props.map((p) => [p.name, p.required]), [
      ['children', false],
      ['onOpenChange', false],
      ['open', true],
    ])
    assert.equal(props.find((p) => p.name === 'open').type, 'boolean')
  })

  test('copies the purpose from the doc comment above the component, in two parts', () => {
    assert.deepEqual(entry('Dialog').purpose, {
      useWhen: "a task needs the user's full attention in a window over the page.",
      notFor: 'a short yes or no question, use a confirmation instead.',
      text: "Use when: a task needs the user's full attention in a window over the page. Not for: a short yes or no question, use a confirmation instead.",
    })
  })

  test('lists a component exported by name and as the default once', () => {
    assert.equal(inventory.entries.filter((e) => e.name === 'Combobox').length, 1)
  })

  test('does not list a lower case export as a component', () => {
    assert.ok(entry('Dialog'), 'the file is still read')
    assert.ok(!inventory.entries.some((e) => e.name === 'dialogClassName' || e.parts.some((p) => p.name === 'dialogClassName')))
  })
})

describe('a class-variance-authority variant', () => {
  test('is read as a literal union', () => {
    const button = entry('Button')
    assert.deepEqual(button.variants, { size: ['lg', 'sm'], variant: ['default', 'outline'] })
    assert.equal(button.props.find((p) => p.name === 'variant').type, '"default" | "outline" | null')
  })

  test('keeps plain props next to the variants', () => {
    assert.deepEqual(entry('Button').props.map((p) => p.name), ['disabled', 'size', 'variant'])
  })
})

describe('a local component', () => {
  test('is marked local with its route', () => {
    const header = entry('ProjectHeader')
    assert.equal(header.kind, 'local')
    assert.equal(header.route, '/projects')
    assert.equal(header.purpose.notFor, 'any other screen, it is built for this one.')
    assert.deepEqual(header.usedIn, ['/projects'])
  })

  test('is told apart from an app component that sits in the shared components folder', () => {
    assert.equal(entry('Banner').kind, 'app')
    assert.equal(entry('Banner').route, undefined)
  })
})

describe('a prop doc comment', () => {
  test('is not taken as the purpose of the component', () => {
    assert.equal(entry('Field').purpose, null)
    assert.equal(entry('Switch').purpose.useWhen, 'the user turns one setting on or off and sees it take effect at once.')
    assert.equal(entry('Switch').purpose.notFor, null)
  })
})

describe('an icon folder', () => {
  test('becomes one entry named Icon set, with every icon inside it', () => {
    const sets = inventory.entries.filter((e) => e.kind === 'icon-set')
    assert.equal(sets.length, 1)
    assert.equal(sets[0].name, 'Icon set')
    assert.equal(sets[0].file, 'apps/web/app/components/icons')
    assert.deepEqual(sets[0].icons, ['GithubIcon', 'MoonIcon', 'StarIcon'])
  })

  test('adds no separate entry for an icon', () => {
    for (const icon of ['StarIcon', 'MoonIcon', 'GithubIcon']) assert.equal(entry(icon), undefined)
  })
})

describe('where used', () => {
  test('lists the importing files for a shared component, through the package name and its barrel file', () => {
    assert.deepEqual(entry('Button').usedIn, ['apps/web/app/page.tsx'])
    assert.deepEqual(entry('Dialog').usedIn, ['apps/web/app/page.tsx'])
    assert.deepEqual(entry('Field').usedIn, ['apps/web/app/projects/page.tsx'])
  })

  test('counts a default import and a dynamic import', () => {
    assert.deepEqual(entry('Combobox').usedIn, ['apps/web/app/projects/page.tsx'])
    assert.deepEqual(entry('Lazy').usedIn, ['/'])
  })

  test('leaves out tests and stories', () => {
    const used = entry('Button').usedIn
    assert.deepEqual(used, ['apps/web/app/page.tsx'])
    assert.ok(!used.some((f) => /\.(test|stories)\./.test(f)))
  })

  test('lists screens for an app component, following imports through other components', () => {
    assert.deepEqual(entry('Banner').usedIn, ['/'])
    assert.deepEqual(entry('Greeting').usedIn, ['/'])
  })

  test('lists the screens an icon set reaches', () => {
    assert.deepEqual(inventory.entries.find((e) => e.kind === 'icon-set').usedIn, ['/'])
  })

  test('does not list a route file as a component', () => {
    assert.ok(entry('Banner'), 'the scan still finds the components beside the route files')
    assert.ok(!inventory.entries.some((e) => /\/(page|layout)\.tsx$/.test(e.file)))
  })
})

describe('the entry', () => {
  test('leaves version and screenshot present but empty', () => {
    for (const e of inventory.entries) {
      assert.equal(e.version, '')
      assert.equal(e.screenshot, '')
    }
  })

  test('comes out the same on a second run', () => {
    const again = buildInventory({ root: fixture, folders: readFolders(fixture) })
    assert.deepEqual(again, inventory)
  })
})

describe('purpose text', () => {
  test('splits the two parts whichever order they come in', () => {
    assert.deepEqual(parsePurpose('Not for: big forms.\nUse when: one field.'), {
      useWhen: 'one field.',
      notFor: 'big forms.',
      text: 'Not for: big forms. Use when: one field.',
    })
  })

  test('keeps a comment without the labels as written', () => {
    assert.deepEqual(parsePurpose('A small chip.'), { useWhen: null, notFor: null, text: 'A small chip.' })
  })

  test('is null when there is no comment', () => {
    assert.equal(parsePurpose(''), null)
  })
})

describe('families', () => {
  const component = (name, position) => ({ name, position, isDefault: false, props: [], variants: {}, purpose: null })

  test('a part starts with the family name at a word boundary', () => {
    const families = groupFamilies([component('Toast', 0), component('ToastAction', 1), component('Toaster', 2)], '/repo/src/other.tsx')
    assert.deepEqual(families.map((f) => [f.name, f.parts.map((p) => p.name)]), [['Toast', ['ToastAction']], ['Toaster', []]])
  })

  test('the component a file is named for takes the rest as parts', () => {
    const families = groupFamilies([component('FaqItem', 0), component('FAQsAccordion', 1)], '/repo/src/faqs-accordion.tsx')
    assert.deepEqual(families.map((f) => [f.name, f.parts.map((p) => p.name)]), [['FAQsAccordion', ['FaqItem']]])
  })

  test('an index file is named for its folder', () => {
    const families = groupFamilies([component('TreeNode', 0), component('Tree', 1)], '/repo/src/tree/index.tsx')
    assert.deepEqual(families.map((f) => f.name), ['Tree'])
  })
})

describe('paths', () => {
  const winRoot = 'C:\\repo'

  test('are put in POSIX form, including ones built for Windows', () => {
    assert.equal(toPosix(path.win32.join(winRoot, 'packages', 'ui', 'src', 'button.tsx')), 'C:/repo/packages/ui/src/button.tsx')
    assert.equal(toPosix('packages/ui/src'), 'packages/ui/src')
  })

  test('are inside a folder only when the folder is a whole path segment', () => {
    assert.ok(isInside(path.win32.join(winRoot, 'src', 'a.tsx'), winRoot))
    assert.ok(isInside('C:/repo/src/a.tsx', winRoot))
    assert.ok(!isInside(path.win32.join('C:\\repo-two', 'a.tsx'), winRoot))
  })

  test('tell the repo from its dependencies when the resolver answers with a Windows path', () => {
    assert.ok(isRepoFile(path.win32.join(winRoot, 'packages', 'ui', 'src', 'button.tsx'), winRoot))
    assert.ok(!isRepoFile(path.win32.join(winRoot, 'node_modules', 'react', 'index.d.ts'), winRoot))
    assert.ok(!isRepoFile(path.win32.join('D:\\other', 'a.tsx'), winRoot))
  })

  test('decide whether a prop is the repo\'s own from a Windows declaration path', () => {
    const declaredIn = (fileName) => ({ declarations: [{ getSourceFile: () => ({ fileName }) }] })
    assert.equal(ownProp(declaredIn(path.win32.join(winRoot, 'src', 'button.tsx')), winRoot), true)
    assert.equal(ownProp(declaredIn(path.win32.join(winRoot, 'node_modules', '@types', 'react', 'index.d.ts')), winRoot), false)
  })

  test('are repo-relative and POSIX in the inventory', () => {
    for (const e of inventory.entries) {
      assert.ok(!e.file.includes('\\') && !path.isAbsolute(e.file), e.file)
      // Shared entries list importing files; the rest list routes, which start with a slash by design.
      if (e.kind === 'shared') assert.ok(e.usedIn.every((u) => !u.includes('\\') && !path.isAbsolute(u)), e.name)
    }
  })
})

describe('a file that cannot be read', () => {
  // Permissions mean nothing to the superuser or on Windows, so the test cannot make a file unreadable there.
  const canLock = process.platform !== 'win32' && process.getuid?.() !== 0

  test('is skipped with a one-line warning, and the rest of the scan carries on', { skip: !canLock }, () => {
    const locked = path.join(fixture, 'apps/web/lib/locked.ts')
    fs.mkdirSync(path.dirname(locked), { recursive: true })
    fs.writeFileSync(locked, "import { Button } from '@fixture/ui'\nexport const x = Button\n")
    fs.chmodSync(locked, 0o000)
    const warn = mock.method(console, 'warn', () => {})
    try {
      const again = buildInventory({ root: fixture, folders: readFolders(fixture) })
      assert.equal(warn.mock.calls.length, 1)
      assert.equal(warn.mock.calls[0].arguments[0], 'Skipped apps/web/lib/locked.ts: EACCES')
      assert.deepEqual(again, inventory)
    } finally {
      warn.mock.restore()
      fs.rmSync(locked, { force: true })
    }
  })
})

describe('the folders', () => {
  test('come from klaus.config.json, and a folder under packages is shared', () => {
    assert.deepEqual(readFolders(fixture), [
      { path: 'packages/ui/src', role: 'shared' },
      { path: 'apps/web/app', role: 'app' },
    ])
  })

  test('can be given as arguments instead', () => {
    assert.deepEqual(readFolders(fixture, ['apps/web/app:shared']), [{ path: 'apps/web/app', role: 'shared' }])
  })

  test('must exist', () => {
    assert.throws(() => readFolders(fixture, ['nowhere']), /does not exist/)
  })

  test('cannot be listed twice', () => {
    assert.throws(() => readFolders(fixture, ['packages/ui/src', 'packages/ui/src:app']), /listed twice/)
  })

  test('must be inside the repo', () => {
    assert.throws(() => readFolders(fixture, ['packages/../../elsewhere']), /does not exist|outside the repo/)
    assert.throws(() => readFolders(fixture, ['..']), /outside the repo/)
  })

  test('need a repo that exists', () => {
    assert.throws(() => readFolders(path.join(os.tmpdir(), 'klaus-no-such-repo'), ['src']), /does not exist/)
  })

  test('are required', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'klaus-empty-'))
    assert.throws(() => readFolders(empty), /No folders to scan/)
    fs.rmSync(empty, { recursive: true })
  })
})

describe('the command', () => {
  test('writes inventory.json and INVENTORY.md to the output folder', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'klaus-out-'))
    try {
      const printed = execFileSync('node', [cli, '--root', fixture, '--out', out], { encoding: 'utf8' })
      assert.match(printed, /packages\/ui\/src \(shared\): \d+ entries/)
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'inventory.json'), 'utf8')), JSON.parse(JSON.stringify(inventory)))
      const markdown = fs.readFileSync(path.join(out, 'INVENTORY.md'), 'utf8')
      assert.equal(markdown, renderMarkdown(inventory))
      assert.match(markdown, /^### Dialog$/m)
      assert.match(markdown, /^- Use when: a task needs the user's full attention/m)
      assert.match(markdown, /^### ProjectHeader$/m)
      assert.match(markdown, /local to `\/projects`/)
      assert.match(markdown, /^### Icon set$/m)
    } finally {
      fs.rmSync(out, { recursive: true, force: true })
    }
  })

  test('takes the folders from arguments when there is no config', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'klaus-out-'))
    try {
      execFileSync('node', [cli, '--root', fixture, '--out', out, 'packages/ui/src'], { encoding: 'utf8' })
      const written = JSON.parse(fs.readFileSync(path.join(out, 'inventory.json'), 'utf8'))
      assert.deepEqual(written.folders, [{ path: 'packages/ui/src', role: 'shared' }])
      assert.ok(written.entries.every((e) => e.folder === 'packages/ui/src'))
    } finally {
      fs.rmSync(out, { recursive: true, force: true })
    }
  })
})
