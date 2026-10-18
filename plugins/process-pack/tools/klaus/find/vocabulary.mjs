import fs from 'node:fs'

/** A problem the person running Klaus can fix, such as a missing file or a wrong option. */
export class UserError extends Error {}

/**
 * The words this repo adds to the reuse check, from `klaus.find.json` at the repo root:
 *
 *   { "productNouns": ["loop", "canvas"], "synonyms": [["toggle", "segmented"]] }
 *
 * Both lists are optional. A product noun names the product, not a part of the interface, so a
 * question that mentions it matches on the other words first. A synonym row is a group of words
 * that stand for one another in this repo.
 *
 * @param {string} file
 * @returns {import('./rank.mjs').Vocabulary}
 */
export function readVocabulary(file) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') throw new UserError(`The vocabulary file ${file} does not exist.`)
    throw new UserError(`Could not read the vocabulary file ${file}: ${error.message}`)
  }
  let raw
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new UserError(`The vocabulary file ${file} is not valid JSON: ${error.message}`)
  }
  const isWords = (list) => Array.isArray(list) && list.every((word) => typeof word === 'string' && word.trim())
  const { productNouns, synonyms, ...unknown } = raw ?? {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new UserError(`${file} must hold an object with "productNouns" and "synonyms".`)
  if (Object.keys(unknown).length) throw new UserError(`${file} has an unknown setting "${Object.keys(unknown)[0]}". It takes "productNouns" and "synonyms".`)
  if (productNouns !== undefined && !isWords(productNouns)) throw new UserError(`"productNouns" in ${file} must be a list of words.`)
  if (synonyms !== undefined && !(Array.isArray(synonyms) && synonyms.every((row) => isWords(row) && row.length >= 2))) {
    throw new UserError(`"synonyms" in ${file} must be a list of rows, each a list of two or more words.`)
  }
  return { ...(productNouns && { productNouns }), ...(synonyms && { synonyms }) }
}
