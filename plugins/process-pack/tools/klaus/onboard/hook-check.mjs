/**
 * Tries the repo's pre-commit hook on what each pull request will commit, before any model is called.
 *
 * The run commits three times, after the model work. A hook that refuses one of those commits
 * stops the run when the writer and the checker have already been paid for, and with the branches
 * before it already pushed. So each commit is tried first, in the order the run makes them: its
 * files are written and staged, and the hook is run on them. The files of the commits before stay
 * on disk, unstaged, as they would be in the branch. A commit whose files need the model (the
 * purpose comments) is tried with a placeholder purpose in each file the writer is given, which
 * passes the same text checks a real one has to pass.
 *
 * Nothing is committed. Afterwards, whether the hook passed or refused, the index is put back to
 * HEAD and every file this wrote or the hook changed is restored, and HEAD and the branch are
 * checked to be where they were. The run starts from a clean tree, so all of that is its own. The
 * folders this made are removed. A folder the hook made is left, empty, as a commit would leave it.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { UserError } from '../frame/errors.mjs'
import { changedFiles, currentBranch, git, resetPaths } from './git.mjs'
import { removePlainFile, writePlainFile } from './plain-path.mjs'

/** `git hook run` is in git from 2.36. With an older git, the hook file git would run is run the same way. */
export const HOOK_RUN_SINCE = Object.freeze([2, 36])

/** How much of a refusing hook's output the error shows. All of it goes to the output file. */
const OUTPUT_LINES = 40

export function gitHasHookRun(repo) {
  const found = /(\d+)\.(\d+)/.exec(git(repo, ['version'], { allowFail: true }) ?? '')
  if (!found) return false
  const [major, minor] = [Number(found[1]), Number(found[2])]
  return major > HOOK_RUN_SINCE[0] || (major === HOOK_RUN_SINCE[0] && minor >= HOOK_RUN_SINCE[1])
}

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK)
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

/**
 * Runs the pre-commit hook on what is staged, as `git commit` would before it writes the commit.
 *
 * @param {string} repo The repo's top folder. A hook runs from there.
 * @param {{ hookRun?: boolean }} [options] Whether git has `git hook run`. Found from `git version` when not given.
 * @returns {{ ok: boolean, output: string, how: string }}
 */
export function runPreCommitHook(repo, { hookRun = gitHasHookRun(repo) } = {}) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' }
  const options = { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }
  let result
  let how
  if (hookRun) {
    how = 'git hook run pre-commit'
    // git finds the hook as a commit would: core.hooksPath, then the git folder's hooks.
    result = spawnSync('git', ['hook', 'run', '--ignore-missing', 'pre-commit'], options)
  } else {
    // The path git uses for the hook, which follows core.hooksPath. git runs it only when it is executable.
    const file = path.resolve(repo, git(repo, ['rev-parse', '--git-path', 'hooks/pre-commit']).trim())
    how = `${path.relative(repo, file) || file}, run directly (this git has no git hook run)`
    if (!isExecutable(file)) return { ok: true, output: '', how: `${how}: there is no executable hook` }
    result = spawnSync(file, [], options)
  }
  if (result.error) return { ok: false, output: `The hook could not be started: ${result.error.code ?? result.error.message}`, how }
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(), how }
}

/** The folders that writing `file` would create, from the outermost down. */
function foldersMadeFor(repo, file) {
  const made = []
  for (let dir = path.dirname(file); dir !== repo && dir.startsWith(`${repo}${path.sep}`) && !fs.existsSync(dir); dir = path.dirname(dir)) made.unshift(dir)
  return made
}

/**
 * Puts the index and the tree back as they were at `start`. `created` lists the files this wrote
 * that did not exist, which are removed even when git ignores them and so does not list them.
 */
function restore(repo, start, created, made) {
  git(repo, ['reset', '-q'])
  resetPaths(repo, changedFiles(repo), (p) => removePlainFile(repo, path.join(repo, p)))
  for (const file of created) removePlainFile(repo, file)
  for (const dir of [...made].sort((a, b) => b.length - a.length)) {
    try {
      fs.rmdirSync(dir)
    } catch {
      // Not empty, or already gone: either way it is not ours to remove.
    }
  }
  const problems = []
  if (changedFiles(repo).length > 0) problems.push('the working tree has changes')
  if (git(repo, ['diff', '--cached', '--quiet'], { allowFail: true }) === null) problems.push('the index has staged changes')
  if (git(repo, ['rev-parse', 'HEAD']).trim() !== start.head) problems.push('HEAD moved')
  if (currentBranch(repo) !== start.branch) problems.push(`the branch is no longer ${start.branch}`)
  if (problems.length > 0) throw new Error(`The commit hook check did not put the repo back as it was: ${problems.join(', ')}.`)
}

const tail = (text) => {
  const lines = text.split('\n')
  return (lines.length > OUTPUT_LINES ? [`(the last ${OUTPUT_LINES} lines)`, ...lines.slice(-OUTPUT_LINES)] : lines).join('\n')
}

/**
 * @param {object} options
 * @param {string} options.repo The repo's top folder, as a real path, with a clean tree.
 * @param {{ label: string, files: { rel: string, text: string }[] }[]} options.steps One for each commit, in order.
 * @param {(message: string) => void} options.log
 * @param {boolean} [options.hookRun] See runPreCommitHook.
 * @param {string} [options.outputFile] Where a refusing hook's whole output is written, outside the working tree.
 */
export function checkCommitHooks({ repo, steps, log, hookRun, outputFile }) {
  const start = { head: git(repo, ['rev-parse', 'HEAD']).trim(), branch: currentBranch(repo) }
  const created = new Set()
  const made = new Set()
  let refused = null
  let how = null
  try {
    for (const step of steps) {
      for (const { rel, text } of step.files) {
        const file = path.join(repo, rel)
        for (const dir of foldersMadeFor(repo, file)) made.add(dir)
        if (!fs.existsSync(file)) created.add(file)
        writePlainFile(repo, file, text)
      }
      // The commit before is unstaged and its files stay, as they would be in the branch this commit goes on.
      git(repo, ['reset', '-q'])
      try {
        git(repo, ['add', '--', ...step.files.map((f) => f.rel)])
      } catch (error) {
        refused = { step, output: error.message, how: 'git add' }
        break
      }
      const result = runPreCommitHook(repo, { hookRun })
      how = result.how
      if (!result.ok) {
        refused = { step, output: result.output, how: result.how }
        break
      }
      log(`  The pre-commit hook passed the files of ${step.label}.`)
    }
  } finally {
    restore(repo, start, created, made)
  }
  if (refused) {
    const output = refused.output || '(the hook printed nothing)'
    let kept = ''
    if (outputFile) {
      fs.writeFileSync(outputFile, `${output}\n`)
      kept = ` All of the output is in ${outputFile}.`
    }
    const what = refused.how === 'git add'
      ? `Before any model call, git could not stage the files of ${refused.step.label}, so it could not commit them either.`
      : `Before any model call, the repo's commit hook was tried on the files of ${refused.step.label} (${refused.how}), and it refused them.`
    throw new UserError(`${what} The run stopped: nothing was committed, no model was called and nothing was spent, and the tree is as it was. Fix what ${refused.how === 'git add' ? 'git' : 'the hook'} names and run again.${kept}\n${tail(output)}`)
  }
  return { how }
}
