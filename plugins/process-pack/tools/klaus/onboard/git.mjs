/**
 * The git and gh calls the run makes. Every call passes its arguments as a list, so text from the
 * repo never reaches a shell. Only named paths are added to a commit, never "everything".
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { UserError } from '../frame/errors.mjs'

const environment = () => ({ ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' })

/** Runs a program in the repo and returns its output. A failure becomes a UserError that says what was run, without its output. */
export function run(program, repo, args, { input, allowFail = false } = {}) {
  try {
    return execFileSync(program, args, { cwd: repo, encoding: 'utf8', input, env: environment(), stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
  } catch (error) {
    if (allowFail) return null
    const detail = String(error.stderr ?? '').trim().split('\n').slice(-3).join(' ')
    throw new UserError(`${program} ${args.slice(0, 3).join(' ')} failed${detail ? `: ${detail}` : ''}`)
  }
}

export const git = (repo, args, options) => run('git', repo, args, options)

/** Every changed file, including untracked ones: [{ status, path }], paths relative to the repo root. */
export function changedFiles(repo) {
  const out = git(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const parts = out.split('\0').filter(Boolean)
  const changed = []
  for (let i = 0; i < parts.length; i++) {
    const status = parts[i].slice(0, 2)
    changed.push({ status, path: parts[i].slice(3) })
    // A rename lists the old path as a second entry, and that path has to be restored too.
    if (status[0] === 'R' || status[0] === 'C') {
      i += 1
      if (parts[i]) changed.push({ status: ' D', path: parts[i] })
    }
  }
  return changed
}

export const currentBranch = (repo) => git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()

/** The path to the repo's git folder, where the run keeps its own files so the working tree stays clean. */
export function gitDir(repo) {
  return path.resolve(repo, git(repo, ['rev-parse', '--git-dir']).trim())
}

export function topLevel(repo) {
  return git(repo, ['rev-parse', '--show-toplevel']).trim()
}

/** Restores tracked files to HEAD and removes untracked ones, for exactly these paths. */
export function resetPaths(repo, changed, remove) {
  const tracked = changed.filter((c) => c.status !== '??').map((c) => c.path)
  if (tracked.length > 0) git(repo, ['checkout', 'HEAD', '--', ...tracked])
  for (const c of changed.filter((x) => x.status === '??')) remove(c.path)
}

export function commit(repo, { message, paths, trailers = [] }) {
  git(repo, ['add', '--', ...paths])
  const body = [message, '', ...trailers].join('\n')
  git(repo, ['commit', '-q', '-m', body])
  return git(repo, ['rev-parse', 'HEAD']).trim()
}

export function createPullRequest(repo, { base, head, title, bodyFile }) {
  const out = run('gh', repo, ['pr', 'create', '--base', base, '--head', head, '--title', title, '--body-file', bodyFile]).trim()
  const url = out.split('\n').at(-1)
  const number = Number(/\/pull\/(\d+)/.exec(url)?.[1])
  if (!number) throw new UserError('gh did not print a pull request address.')
  return { url, number }
}

export const editPullRequest = (repo, number, bodyFile) => run('gh', repo, ['pr', 'edit', String(number), '--body-file', bodyFile])

/**
 * The pull requests whose head is `head`, in one state (`open` or `merged`): [{ number, url }].
 * An answer gh cannot give, or that is not a list, is an error, so a pull request is never missed.
 */
export function listPullRequests(repo, head, state) {
  const out = run('gh', repo, ['pr', 'list', '--head', head, '--state', state, '--json', 'number,url', '--limit', '20'])
  let list
  try {
    list = JSON.parse(out)
  } catch {
    list = null
  }
  if (!Array.isArray(list)) throw new UserError(`gh pr list --head ${head} did not answer with a list.`)
  return list.filter((pr) => Number.isInteger(pr?.number)).map((pr) => ({ number: pr.number, url: String(pr.url ?? '') }))
}

export const closePullRequest = (repo, number, comment) => run('gh', repo, ['pr', 'close', String(number), '--comment', comment])

/** The commit a branch is at on origin, or '' when origin has no such branch. */
export function remoteTip(repo, branch) {
  const out = git(repo, ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`])
  return out.trim().split(/\s+/)[0] ?? ''
}

/**
 * Pushes a branch that may replace one origin already has. The push overwrites origin's branch only
 * if it is still at `expected` (or absent, when `expected` is ''), so it never drops a commit that
 * someone pushed after the run looked.
 */
export function pushBranch(repo, branch, expected) {
  git(repo, ['push', '-q', '-u', `--force-with-lease=refs/heads/${branch}:${expected}`, 'origin', `refs/heads/${branch}:refs/heads/${branch}`])
}
