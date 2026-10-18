/**
 * Runs one command and waits for it. This is the only place the Storybook
 * adapter starts a process, so tests replace it with a fake and never touch
 * git, Storybook or Vercel.
 *
 * @typedef {object} ExecOptions
 * @property {string} [cwd]
 * @property {Record<string, string | undefined>} [env]  The whole environment of the command.
 * @property {number} [timeoutMs]
 *
 * @typedef {(file: string, args: string[], options?: ExecOptions) => Promise<{ stdout: string, stderr: string }>} Exec
 */
import { execFile } from "node:child_process";

const TEN_MINUTES = 10 * 60 * 1000;

/** The last part of a command's output, which is where its error is. */
function tail(text, length = 800) {
  const trimmed = String(text ?? "").trim();
  return trimmed.length > length ? `...${trimmed.slice(-length)}` : trimmed;
}

/** @type {Exec} */
export function exec(file, args, { cwd, env, timeoutMs = TEN_MINUTES } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      { cwd, env, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (!error) return resolve({ stdout, stderr });
        const output = tail(stderr) || tail(stdout) || error.message;
        if (error.killed) return reject(new Error(`timed out after ${Math.round(timeoutMs / 1000)} s: ${output}`));
        if (error.code === "ENOBUFS") return reject(new Error(`the command wrote more output than Klaus keeps: ${output}`));
        reject(new Error(output));
      },
    );
    // Nothing is ever typed into these commands. Closing stdin stops one that waits for an answer.
    child.stdin?.end();
  });
}
