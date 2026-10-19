import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const KLAUS = path.join(here, '..', '..')
export const FIXTURE = path.join(here, 'fixtures', 'sample')
export const STUBS = path.join(here, 'stub')

/**
 * A copy of the sample fixture in a new folder, with a link to this package's node_modules so the
 * repo's own `typescript` is found. The copy is outside the checkout, so a killed run leaves nothing in it.
 */
export function makeSample() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'klaus-onboard-'))
  const repo = path.join(base, 'repo')
  fs.cpSync(FIXTURE, repo, { recursive: true })
  fs.symlinkSync(path.join(KLAUS, 'node_modules'), path.join(repo, 'node_modules'))
  return { base, repo, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) }
}

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/** The sample as a git repo on main with a bare repo as origin, ready for the run. */
export function makeGitSample() {
  const sample = makeSample()
  const origin = path.join(sample.base, 'origin.git')
  git(sample.base, 'init', '-q', '--bare', '-b', 'main', origin)
  fs.writeFileSync(path.join(sample.repo, '.gitignore'), 'node_modules\n')
  git(sample.repo, 'init', '-q', '-b', 'main')
  git(sample.repo, 'config', 'user.email', 'test@example.com')
  git(sample.repo, 'config', 'user.name', 'Test')
  git(sample.repo, 'remote', 'add', 'origin', origin)
  git(sample.repo, 'add', '-A')
  git(sample.repo, 'commit', '-q', '-m', 'sample')
  git(sample.repo, 'push', '-q', '-u', 'origin', 'main')
  return { ...sample, origin, git: (...args) => git(sample.repo, ...args) }
}
