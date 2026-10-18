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
 *
 * A path given with --inventory or --vocabulary is relative to the current directory, as in
 * the other Klaus commands. Only the defaults are under --root.
 *   --case               Print the "New component case" section for the PR body.
 *
 * Exit 0 when it printed an answer, "nothing fits" included. Exit 2 when it could not answer and the
 * message says why: no inventory, a file it cannot read, a wrong option. Anything else is a bug and
 * exits 1 with a stack trace.
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
function inventoryCommand(cwd) {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'inventory', 'inventory.mjs')
  return `node ${path.relative(cwd, script).split(path.sep).join('/')}`
}

const isText = (value) => typeof value === 'string'
const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value)

/** One entry with every field the matcher reads in the shape it expects, so an older or hand-edited file cannot crash it. */
function normalizeEntry(entry) {
  const purpose = isObject(entry.purpose)
    ? { useWhen: isText(entry.purpose.useWhen) ? entry.purpose.useWhen : null, notFor: isText(entry.purpose.notFor) ? entry.purpose.notFor : null, text: isText(entry.purpose.text) ? entry.purpose.text : '' }
    : null
  const named = (list) => (Array.isArray(list) ? list.filter((item) => isObject(item) && isText(item.name)) : [])
  return {
    ...entry,
    kind: isText(entry.kind) ? entry.kind : 'app',
    file: isText(entry.file) ? entry.file : '',
    purpose,
    props: named(entry.props),
    parts: named(entry.parts),
    variants: isObject(entry.variants) ? Object.fromEntries(Object.entries(entry.variants).map(([key, options]) => [key, Array.isArray(options) ? options : []])) : {},
    usedIn: Array.isArray(entry.usedIn) ? entry.usedIn : [],
    ...(Array.isArray(entry.icons) && { icons: entry.icons.filter(isText) }),
  }
}

/**
 * Reads inventory.json and fills in anything an older or partial file leaves out. `skipped` counts
 * the entries that have no name and so cannot be matched.
 *
 * @param {string} file
 * @param {string} [cwd] Where the person is, so the command it suggests can be typed from there.
 */
export function readInventory(file, cwd = process.cwd()) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') throw new UserError(`There is no inventory at ${file}. Write one with: ${inventoryCommand(cwd)}`)
    throw new UserError(`Could not read the inventory ${file}: ${error.message}`)
  }
  let raw
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new UserError(`The inventory ${file} is not valid JSON: ${error.message}`)
  }
  if (raw?.schemaVersion !== 1 || !Array.isArray(raw.entries)) {
    throw new UserError(`${file} is not an inventory this version of Klaus can read (schemaVersion 1 with a list of entries). Write a new one with: ${inventoryCommand(cwd)}`)
  }
  const named = raw.entries.filter((entry) => isObject(entry) && isText(entry.name))
  return {
    folders: Array.isArray(raw.folders) ? raw.folders : [],
    skipped: raw.entries.length - named.length,
    entries: named.map(normalizeEntry),
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
    const inventory = readInventory(path.resolve(cwd, values.inventory ?? path.join(root, 'inventory.json')), cwd)
    const vocabularyFile = values.vocabulary ? path.resolve(cwd, values.vocabulary) : path.join(root, 'klaus.find.json')
    const vocabulary = (values.vocabulary || fs.existsSync(vocabularyFile)) ? readVocabulary(vocabularyFile) : {}
    if (inventory.skipped) err(`Skipped ${inventory.skipped} inventory ${inventory.skipped === 1 ? 'entry' : 'entries'} with no name. Write the inventory again if that is not expected.\n`)

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

/** True when this file is the script being run, also when it is run through a link. */
function isMain() {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href
  } catch {
    return false
  }
}

if (isMain()) process.exitCode = main(process.argv.slice(2))
