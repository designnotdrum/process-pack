/**
 * Runs one command and waits for it. This is the only place the Storybook
 * adapter starts a process, so tests replace it with a fake and never touch
 * git, Storybook or Vercel.
 *
 * @typedef {object} ExecOptions
 * @property {string} [cwd]
 * @property {Record<string, string | undefined>} [env]  The whole environment of the command.
 * @property {number} [timeoutMs]
 * @property {number} [maxBuffer]  The most output, in bytes, that is kept from stdout or stderr.
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
export function exec(file, args, { cwd, env, timeoutMs = TEN_MINUTES, maxBuffer = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      { cwd, env, timeout: timeoutMs, maxBuffer, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (!error) return resolve({ stdout, stderr });
        const output = tail(stderr) || tail(stdout) || error.message;
        // Node sets `killed` only when it ended the command itself, which here means the timeout.
        if (error.killed) return reject(new Error(`timed out after ${Math.round(timeoutMs / 1000)} s: ${output}`));
        if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
          return reject(new Error(`wrote more than ${Math.round(maxBuffer / 1e6)} MB of output, which Klaus does not keep: ${output}`));
        }
        reject(new Error(output));
      },
    );
    // Nothing is ever typed into these commands. Closing stdin stops one that waits for an answer.
    child.stdin?.end();
  });
}
