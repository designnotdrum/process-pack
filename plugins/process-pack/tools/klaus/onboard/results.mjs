/**
 * What the model work produced, kept in the run's work folder as soon as each answer arrives. A run
 * that stops after the model work (a commit hook that refuses, a push that fails, a crash) then
 * does not pay for that work again: a later run with the same plan reads it back.
 *
 *   results/<plan id>/writer/<call>.json     one writer call: what it left in each file it was given
 *   results/<plan id>/checker/<component>.json  one check: the verdict and the reason
 *
 * A saved result is used only when the plan id is the same, the file it is about hashes the same
 * as now, and the prompt the model was given would be the same. The plan id already covers the
 * component files, but not the files that use them, and their lines are in both prompts. A check
 * also covers the two sentences it judged, so a purpose that is written again is checked again.
 *
 * A writer call is saved with the text it left in each file, and it is judged again when it is
 * read back, by the same code that judges a new call. Only a call that finished is saved, and only
 * a verdict of pass or fail: a call that failed and a check that could not answer are made again.
 * Each file is written to a temporary name and then renamed, so a run killed while it writes
 * leaves the old file or none, never part of one.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { writeJsonFile } from '../frame/json-file.mjs'
import { checkerPrompt, cleanReason } from './checker.mjs'
import { mkdirPlain } from './plain-path.mjs'
import { writerPrompt } from './writer.mjs'

export const RESULTS_SCHEMA = 1

/** The prompts are hashed with this in place of their random boundary, so the same input hashes the same. */
const FIXED_BOUNDARY = 'DATA-0000000000000000'

export const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex')
const fileName = (id) => `${sha256(id).slice(0, 32)}.json`

/** What a check was asked, without the boundary. */
export const checkInput = (item) => sha256(checkerPrompt({ name: item.component.name, entry: item.component.entry, useWhen: item.useWhen, notFor: item.notFor, snippets: item.snippets }, FIXED_BOUNDARY))

/**
 * @param {object} options
 * @param {string} options.repo The repo, as a real path. The work folder is inside its git folder.
 * @param {string} options.work The run's work folder.
 * @param {string} options.planId
 */
export function createResultStore({ repo, work, planId }) {
  const dir = path.join(work, 'results', planId)
  const where = (part, id) => path.join(dir, part, fileName(id))
  const save = (part, id, value) => {
    const file = where(part, id)
    mkdirPlain(repo, path.dirname(file))
    writeJsonFile(file, { schemaVersion: RESULTS_SCHEMA, planId, savedAt: new Date().toISOString(), ...value })
  }
  const load = (part, id) => {
    let value
    try {
      value = JSON.parse(fs.readFileSync(where(part, id), 'utf8'))
    } catch {
      return null
    }
    return value?.schemaVersion === RESULTS_SCHEMA && value.planId === planId ? value : null
  }

  return {
    dir,

    /**
     * Saves one finished writer call.
     *
     * @param {object} call From the plan.
     * @param {{ after: Map<string, string>, outside: string[], tokens: number, items: Map<string, object> }} result
     *   `after` holds the text of each planned file the writer changed. `items` is read for the
     *   sentences, so a person can see them in the file.
     */
    saveWriterCall(call, { after, outside, tokens, items }) {
      save('writer', call.id, {
        callId: call.id,
        prompt: sha256(writerPrompt(call, FIXED_BOUNDARY)),
        tokens,
        outside,
        files: call.files.map((f) => ({ file: f.file, sha256: sha256(f.source), after: after.get(f.file) ?? null })),
        components: call.files.flatMap((f) => f.components.map((c) => {
          const item = items.get(c.id) ?? {}
          return { id: c.id, status: item.status ?? null, useWhen: item.useWhen ?? null, notFor: item.notFor ?? null, reason: item.reason ?? null }
        })),
      })
    },

    /**
     * A saved call for exactly this call, or null.
     * @returns {{ after: Map<string, string>, outside: string[], tokens: number } | null}
     */
    loadWriterCall(call) {
      const saved = load('writer', call.id)
      if (!saved || saved.callId !== call.id || saved.prompt !== sha256(writerPrompt(call, FIXED_BOUNDARY))) return null
      if (!Array.isArray(saved.files) || saved.files.length !== call.files.length || !Array.isArray(saved.outside)) return null
      const after = new Map()
      for (const file of call.files) {
        const kept = saved.files.find((f) => f?.file === file.file)
        if (!kept || kept.sha256 !== sha256(file.source)) return null
        if (typeof kept.after === 'string') after.set(file.file, kept.after)
      }
      return { after, outside: saved.outside.map(String), tokens: Number(saved.tokens) || 0 }
    },

    /** Saves a verdict of pass or fail for one component. `source` is the text of its file. */
    saveCheck(item, source, { verdict, reason, tokens, usd }) {
      if (verdict !== 'pass' && verdict !== 'fail') return
      save('checker', item.component.id, { id: item.component.id, file: item.file, sha256: sha256(source), prompt: checkInput(item), verdict, reason, tokens, usd })
    },

    /** A saved verdict for exactly this check, or null. */
    loadCheck(item, source) {
      const saved = load('checker', item.component.id)
      if (!saved || saved.id !== item.component.id || saved.sha256 !== sha256(source) || saved.prompt !== checkInput(item)) return null
      if (saved.verdict !== 'pass' && saved.verdict !== 'fail') return null
      // The reason reaches a markdown file, so it is cleaned again: the saved file is not trusted more than a reply.
      return { verdict: saved.verdict, reason: cleanReason(saved.reason) }
    },
  }
}
