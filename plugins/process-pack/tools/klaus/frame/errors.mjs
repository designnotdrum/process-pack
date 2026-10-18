/**
 * An error the person running Klaus can fix: a bad config, state file, tag or
 * option. The command line prints its message and exits 2. Any other error is
 * a bug, so the command line prints its stack and exits 3.
 */
export class UserError extends Error {}
