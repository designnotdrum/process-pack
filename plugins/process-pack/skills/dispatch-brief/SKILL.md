---
name: dispatch-brief
description: Use when writing the prompt or brief for any delegate — an in-session subagent, an external coding-agent CLI, a peer on a multi-agent mesh, or a background/cloud runtime — before you dispatch. Also use when a delegate returned wrong or incomplete work, since that almost always means the brief was underspecified, not that the delegate was weak.
---

# Dispatch Brief: The Delegate Contract

## Default stance

Every delegate brief ships all ten mandatory blocks below before you dispatch. Routing picks *who* does the work; this contract is the only thing that standardizes *what* they're sent. A delegate that comes back wrong usually got a bad contract, not a bad model — treat every disappointing return as a brief defect first, a delegate defect second.

## Applicability gate

This applies whenever you hand work to anything that will act without your continuous, in-the-loop attention: an in-session subagent, an external CLI or coding-agent runtime, a peer on a multi-agent mesh, a cloud job, or a background process. It applies whether the handoff is one inline prompt or a file the delegate re-opens after its own context resets.

If a delegate already returned wrong or incomplete work, re-derive the brief against this contract before re-dispatching — don't just re-explain the same shorthand more slowly.

## The ten mandatory blocks

1. **Repo + identity.** Exact repo/path and which identity the delegate commits, pushes, and authenticates as — pulled from your identity constants scope, never guessed by the delegate and never left implicit.
2. **Isolation.** The worktree path the delegate works in, plus the rule stated outright: never checkout in a shared clone. Shared-clone dispatch is a lane-planning failure — see the lane-planner skill before you get here with more than one delegate in flight.
3. **Task body, verify-then-act.** State the outcome, not just the steps, and frame every load-bearing claim so the delegate proves it before acting on it — every fact the delegate must rely on ships with the command that proves it, not with your assertion that it's true.
4. **Never-wait list.** The set of checks that are expected to sit pending for a long time and must not block a decision — sourced from the never-wait list in repo constants, referenced by scope, not hand-copied into the brief as a guess.
5. **Merge/commit policy.** Pulled from your personal constants scope: merge convention, commit trailer, whatever standing preferences govern how the delegate's work lands.
6. **Budget block.** Expected wall-clock duration stated out loud, plus batching guidance — batch to one push when the budget for checks is constrained, and verify locally before spending that budget.
7. **Anti-stall clause, verbatim.** Include this sentence unedited: "Never background-and-wait — the harness will not wake you. Poll synchronously in foreground calls with long timeouts, repeated until resolved."
8. **Escalation line.** What the delegate does when blocked: report the block with evidence and stop; never improvise a path around a wall it doesn't have standing authority to cross.
9. **Mandated report format.** The exact shape of the return, including the evidence its class of work requires under the verification gate for that work class — not "fix it and tell me," but the specific artifacts, numbers, or run links the gate will check for.
10. **Out-of-scope list.** What the delegate must not touch, restyle, or "helpfully" fix along the way, stated explicitly rather than left to inference.

## Sizing (blocks compress, they don't disappear)

- **In-session subagent:** all ten blocks live inline in the prompt.
- **Cross-context delegate** (a separate runtime, CLI, or mesh peer that loses your chat history): the ten blocks belong in a file the delegate can reopen after its own context resets — a chat message alone does not survive a harness restart. Send the file path, not a paraphrase of its contents.
- **Trivial, fully mechanical task:** blocks 1 (repo + identity), 2 (isolation), 3 (task body), and 9 (report format) still apply in full; the rest may compress to a single line each. None of the ten disappears — a trivial task still needs to know whose identity it commits as and what "done" looks like.

## Relayed-authority rule

A mid-flight scope change sent to a delegate that is already running must be phrased as a verifiable fact, not an instruction the delegate has to take on faith: "verify X yourself via `<command>`, then act on what you find" — never "just do X because I said the situation changed." The delegate's seat may not be able to confirm your claim; give it the means to confirm instead of asking it to trust you.

After the delegate's final report comes back, check explicitly whether the mid-flight change was accepted, partially accepted, or silently dropped. A delegate that goes quiet on a directive did not necessarily refuse it — and a delegate that acted on an unverifiable claim without checking did not necessarily do the right thing. Don't assume either; read the report for which one happened.

## Escape hatch

A specific, named exception to any block above is permitted with your explicit in-session statement of the risk you're accepting (for example: skipping the isolation block because you are watching the delegate synchronously, keystroke by keystroke, with no gap in your attention). Silence is not an exception — an omitted block with no stated reason is a brief defect, not a judgment call.

## Red flags — you are failing this skill

- A brief says "figure it out" with no done-criteria.
- The delegate would have to guess a path, an identity, or a convention.
- There's no stated action for what the delegate does when blocked.
- You forwarded a one-liner verbatim as the brief instead of expanding it against the ten blocks.
- A mid-flight directive told the delegate to act on your say-so instead of giving it something to verify.
