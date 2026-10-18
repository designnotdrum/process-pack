#!/usr/bin/env node
/**
 * klaus find: before writing a new UI component, ask what the repo already has for the purpose.
 *
 *   node scripts/klaus/find/find.mjs "<purpose>"
 *   node scripts/klaus/find/find.mjs --case "<purpose>"
 *
 * Prints the five components in inventory.json that fit the purpose best, each with its Use when /
 * Not for text, or says nothing fits. With --case it prints a "New component case" section for the
 * PR body instead. It matches words and uses no model.
 *
 * Options:
 *   --root <dir>         The repo. Defaults to the current directory.
 *   --inventory <file>   Default <root>/inventory.json, written by inventory/inventory.mjs.
 *   --vocabulary <file>  Default <root>/klaus.find.json, which is optional: product nouns and synonyms for this repo.
 *   --case               Print the "New component case" section for the PR body.
 *
 * Exit 0 when it printed an answer, "nothing fits" included. Exit 2 when the person running it has
 * something to fix (no inventory, a wrong option).
 *
 * No dependencies. Copied into a consuming repo by the design-onboard skill.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { rank } from './rank.mjs'
import { renderCase, renderFind } from './render.mjs'
import { readVocabulary, UserError } from './vocabulary.mjs'

const OPTIONS = {
  root: { type: 'string' },
  inventory: { type: 'string' },
  vocabulary: { type: 'string' },
  case: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
}

const USAGE = 'Usage: find.mjs [--case] [--root <dir>] [--inventory <file>] [--vocabulary <file>] "<what the new component is for>"'

/** The command that writes inventory.json, as it can be typed from where the person is. */
function inventoryCommand() {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'inventory', 'inventory.mjs')
  return `node ${path.relative(process.cwd(), script) || script}`
}

/**
 * Reads inventory.json and fills in anything an older or partial file leaves out.
 *
 * @param {string} file
 */
export function readInventory(file) {
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') throw new UserError(`There is no inventory at ${file}. Write one with: ${inventoryCommand()}`)
    throw new UserError(`The inventory ${file} is not valid JSON: ${error.message}`)
  }
  if (raw?.schemaVersion !== 1 || !Array.isArray(raw.entries)) {
    throw new UserError(`${file} is not an inventory this version of Klaus can read (schemaVersion 1 with a list of entries). Write a new one with: ${inventoryCommand()}`)
  }
  return {
    folders: Array.isArray(raw.folders) ? raw.folders : [],
    entries: raw.entries
      .filter((entry) => entry && typeof entry.name === 'string')
      .map((entry) => ({ kind: 'app', file: '', purpose: null, ...entry, props: entry.props ?? [], variants: entry.variants ?? {}, parts: entry.parts ?? [], usedIn: entry.usedIn ?? [] })),
  }
}

/**
 * Runs the command. Returns the exit code, so a test does not need a process.
 *
 * @param {string[]} argv The arguments after the script name.
 * @param {{ out?: (text: string) => void, err?: (text: string) => void, cwd?: string }} [io]
 */
export function main(argv, { out = (text) => process.stdout.write(text), err = (text) => process.stderr.write(text), cwd = process.cwd() } = {}) {
  try {
    let parsed
    try {
      parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true })
    } catch (error) {
      throw new UserError(`${error.message}\n${USAGE}`)
    }
    const { values, positionals } = parsed
    if (values.help) {
      out(`${USAGE}\n`)
      return 0
    }
    const purpose = positionals.join(' ').trim()
    if (!purpose) throw new UserError(`Say what the new component is for, in a few words.\n${USAGE}`)

    const root = path.resolve(cwd, values.root ?? '.')
    const inventory = readInventory(path.resolve(cwd, values.inventory ?? path.join(root, 'inventory.json')))
    const vocabularyFile = values.vocabulary ? path.resolve(cwd, values.vocabulary) : path.join(root, 'klaus.find.json')
    const vocabulary = values.vocabulary || fs.existsSync(vocabularyFile) ? readVocabulary(vocabularyFile) : {}

    const ranking = rank(inventory, purpose, { vocabulary })
    if (!ranking.asked.length) throw new UserError(`Nothing in "${purpose}" can be matched. Say what the new component is for, in a few words.`)
    out(values.case ? renderCase(purpose, ranking, inventory.folders) : renderFind(purpose, ranking))
    return 0
  } catch (error) {
    if (!(error instanceof UserError)) throw error
    err(`${error.message}\n`)
    return 2
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) process.exitCode = main(process.argv.slice(2))
