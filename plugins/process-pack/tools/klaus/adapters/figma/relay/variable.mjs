/**
 * Reads and writes the KLAUS_FIGMA_LEDGER repository variable with gh, for the relay.
 *
 * The relay reads it before it plans, so any machine that relays (the home server, a laptop)
 * knows what the others sent. After a run that changed the ledger (a send or --reconcile) it
 * writes the ledger's sent and changed marks back with `gh variable set`, and the Klaus workflow
 * passes the variable to the generator in CI (../shared-ledger.mjs).
 *
 * Nothing here stops a run. No gh, no permission, a missing or malformed variable: each is a
 * warning, and the relay keeps its own ledger. When the variable could not be read, or is the
 * record of another Figma file, the relay does not write it, so marks it could not see are kept.
 */
import { execFileSync } from "node:child_process";
import { MAX_SHARED_LEDGER_BYTES, parseSharedLedger, SHARED_LEDGER_VARIABLE, sharedLedgerText } from "../shared-ledger.mjs";

const GH_TIMEOUT_MS = 30000;
const NAME = SHARED_LEDGER_VARIABLE;

function runGh(gh, args, { repo, cwd }) {
  const full = repo ? [...args, "--repo", repo] : args;
  return execFileSync(gh, full, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: GH_TIMEOUT_MS });
}

/** What gh said, on one line. */
function saidBy(error) {
  if (error?.code === "ENOENT") return "gh is not installed or not on the PATH";
  return String(error?.stderr || error?.message || error).trim().split("\n")[0].slice(0, 300);
}

/**
 * Reads the variable.
 * @param {{ gh: string, repo?: string, cwd: string, fileKey: string }} options
 * @returns {{ status: "read" | "absent" | "malformed" | "other-file" | "unreadable", ledger: object | null, warning: string | null }}
 */
export function readVariable({ gh, repo, cwd, fileKey }) {
  let text;
  try {
    text = runGh(gh, ["variable", "get", NAME], { repo, cwd });
  } catch (error) {
    const said = saidBy(error);
    // gh's words for a variable that is not set (gh 2.102.0, pkg/cmd/variable/get/get.go).
    if (/was not found/.test(said)) return parseSharedLedger(undefined, fileKey);
    return {
      status: "unreadable",
      ledger: null,
      warning: `${NAME} could not be read (${said}), so this run knows only the marks in its own ledger. It will not write the variable either, so marks another machine published are not lost.`,
    };
  }
  return parseSharedLedger(text, fileKey);
}

/**
 * Writes the ledger's sent and changed marks to the variable.
 * @param {{ gh: string, repo?: string, cwd: string, fileKey: string, ledger: object, read: { status: string } }} options
 *   read is what readVariable returned at the start of the run.
 * @returns {{ published: boolean, bytes: number | null, warning: string | null }}
 *   The warning is null when the variable was written, or when the read's own warning already says why not.
 */
export function publishVariable({ gh, repo, cwd, fileKey, ledger, read }) {
  if (read.status === "unreadable" || read.status === "other-file") return { published: false, bytes: null, warning: null };
  const text = sharedLedgerText(ledger, fileKey);
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_SHARED_LEDGER_BYTES) {
    return {
      published: false,
      bytes,
      warning: `${NAME} was not published: the record would be ${bytes} bytes, and GitHub holds at most 48 KB in one variable (counted here as 48,000 bytes). This machine's ledger keeps the marks, but CI will plan these units again until the record fits.`,
    };
  }
  try {
    runGh(gh, ["variable", "set", NAME, "--body", text], { repo, cwd });
  } catch (error) {
    return {
      published: false,
      bytes,
      warning: `${NAME} could not be published (${saidBy(error)}). This machine's ledger keeps the marks, and CI will plan these units again until a relay run publishes them. Writing a repository variable needs write access to the repository (a collaborator, for a personal account's repository).`,
    };
  }
  return { published: true, bytes, warning: null };
}
