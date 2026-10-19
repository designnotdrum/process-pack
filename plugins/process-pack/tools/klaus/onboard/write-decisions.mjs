#!/usr/bin/env node
/**
 * Writes the duplicate decisions and nothing else: `docs/klaus/decisions.md`, a ticket for each
 * pair the data settles, the pictures, and the list of every pair with what was set aside. It
 * finds the pairs with the run's own function and writes the files with the run's own renderers.
 * It makes no branch, commit or model call.
 *
 *   node onboard/write-decisions.mjs --repo <dir> [--storybook <dir>] [--out <dir>] [--ask-all]
 *
 * The pictures are drawn from a static Storybook build: --storybook names it, relative to the
 * repo, and without it the one in klaus.config.json, or the `storybook-static` folder next to a
 * `.storybook` folder, is used. With no build, each decision says so and has no picture.
 * With --out the files are written under that folder, in the same paths, and the repo is only read.
 * With --ask-all the pairs that are set aside as different components are asked about too.
 *
 * Exit 0 when done, 2 on an error the person running it can fix, 3 on any other error.
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { UserError } from '../frame/errors.mjs'
import { loadTypeScript } from '../inventory/components.mjs'
import { toPosix } from '../inventory/files.mjs'
import { buildInventory } from '../inventory/inventory.mjs'
import { createTsconfigLoader } from '../inventory/tsconfig.mjs'
import { readOnboardingConfig } from './config.mjs'
import { attachDecisionPictures, decisionFiles } from './decisions-pictures.mjs'
import { countDuplicates, findDuplicates, renderDuplicatesList } from './duplicates.mjs'
import { mkdirPlain, writePlainFile } from './plain-path.mjs'

const USAGE = 'Usage: write-decisions.mjs --repo <dir> [--storybook <dir>] [--out <dir>] [--ask-all]'

export async function writeDecisions({ repo: given, storybook, out, askAll = false, open, log = console.log }) {
  const repo = fs.realpathSync(path.resolve(given))
  const { onboarding, folders } = readOnboardingConfig(repo)
  const ts = loadTypeScript(repo)
  const inventory = buildInventory({ root: repo, folders })
  const duplicates = findDuplicates({ ts, root: repo, inventory, setAside: !askAll })
  const plan = { root: repo, ts, tsconfigs: createTsconfigLoader(ts, repo), duplicates }
  const pictures = await attachDecisionPictures({ plan, storybookDir: storybook, open, log })
  const docs = onboarding.docsDir
  const files = [...decisionFiles({ pairs: duplicates, pictures, docs }), { rel: `${docs}/duplicates.md`, text: renderDuplicatesList(duplicates) }, { rel: `${docs}/duplicates.json`, text: `${JSON.stringify(duplicates, null, 2)}\n` }]
  // Into the repo by default, with the same checks the run makes, or into a folder of the caller's choosing.
  const base = out ? path.resolve(out) : repo
  if (out) fs.mkdirSync(base, { recursive: true })
  const written = []
  for (const file of files) {
    if (out) {
      fs.mkdirSync(path.dirname(path.join(base, file.rel)), { recursive: true })
      fs.writeFileSync(path.join(base, file.rel), file.text)
    } else {
      mkdirPlain(repo, path.dirname(path.join(repo, file.rel)))
      writePlainFile(repo, path.join(repo, file.rel), file.text)
    }
    written.push(toPosix(file.rel))
  }
  const counts = countDuplicates(duplicates)
  const drawn = [...pictures.values()].filter((p) => p.file)
  log(`${counts.pairs} pairs: ${counts.removals} removal tickets, ${counts.merges} merge tickets, ${counts.decisions} questions (${drawn.filter((p) => p.drawn[0] && p.drawn[1]).length} with both sides drawn, ${drawn.filter((p) => p.drawn[0] !== p.drawn[1]).length} with one side drawn, ${counts.decisions - drawn.length} with no picture). ${duplicates.dismissed.length} set aside as different components. Wrote ${written.length} files under ${base}.`)
  return { duplicates, pictures, written, counts }
}

export async function main(argv) {
  try {
    const { values, positionals } = parseArgs({ args: argv, options: { repo: { type: 'string' }, storybook: { type: 'string' }, out: { type: 'string' }, 'ask-all': { type: 'boolean' } }, allowPositionals: true })
    if (positionals.length > 0 || !values.repo) throw new UserError(USAGE)
    await writeDecisions({ repo: values.repo, storybook: values.storybook, out: values.out, askAll: values['ask-all'] })
    return 0
  } catch (error) {
    if (error instanceof UserError || (typeof error?.code === 'string' && error.code.startsWith('ERR_PARSE_ARGS'))) {
      console.error(error.message)
      return 2
    }
    console.error(error?.stack ?? error)
    return 3
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) process.exitCode = await main(process.argv.slice(2))
