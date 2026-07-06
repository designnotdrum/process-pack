---
name: resource-wall-preflight
description: Use before any dispatch or command that touches an external runtime, an account, an org-scoped tool, or a billing surface — including invoking another agent runtime headlessly. Answers which wallet, which org, and which identity before the command runs, and stops at a wall instead of working around it.
---

# Resource Wall Preflight

## When this applies

Anything that reaches outside the current task's own sandbox: calling another
agent runtime headlessly, hitting an API scoped to an org or project, pushing
to a remote, spending against a budget, or touching a credential that isn't
unambiguously yours in this context. If you can't immediately name who pays
for it, whose org it runs inside, and which identity is acting, stop here
before the command runs.

## The three questions

Answer all three from your constants before proceeding:

1. **Which wallet pays for this runtime?** Some runtimes bill whoever owns the
   config directory that launched them, regardless of who is sitting at the
   keyboard. Running a job through the wrong context's runtime charges the
   wrong wallet even if the output looks identical.
2. **Which org or project does this tool hit?** A tool can be wired to talk to
   more than one org or project depending on which credentials it picks up.
   The tool working is not proof it's pointed at the right one — check that
   the org/project it will actually touch matches the side the current task
   belongs to.
3. **Which identity commits or pushes?** Each context you operate under has
   its own git identity. Using the wrong one attributes work to the wrong
   person or account, and can silently push to a namespace that isn't the
   intended one.

## Enumerated walls

Your constants enumerate the specific walls that apply to you: which runtimes
bill which wallet, which analytics or product orgs must match which side of a
project, and which git identity belongs to which context. Treat every wall
named there as absolute until a human tells you otherwise in this session —
walls are not a default to negotiate around when they're inconvenient.

## Access path ≠ authorization

A command succeeding, a credential being cached, or a tool happening to be
reachable from where you're sitting is not permission to use it. Wiring that
lets you reach across a wall is usually an accident of environment, not a
decision that the wall doesn't apply to you. Before using an available path,
confirm the three questions above actually clear — not just that the path
exists.

## Copy the config, never bridge the runtime

When a capability you need is wired up on the other side of a wall, the fix
is to copy the configuration you need into your own context — not to route
your work through the other context's runtime. Bridging the runtime means
the wrong wallet pays, the wrong org gets the traffic, or the wrong identity
acts, even though the task "worked." Copying the config keeps the wall
intact while still getting the capability.

## Stop and present options

When a wall blocks the only path you can see forward, stop before working
around it. Present the real options rather than picking one silently:

- Use different credentials that belong to the correct side, if they exist.
- Use a free or self-funded alternative that doesn't need to cross the wall.
- Ask explicitly for approval to cross this specific wall, this one time,
  and wait for an answer.

Do not retry through a different door hoping it clears the same check by
accident. A wall that blocks the only path is information, not an obstacle
to route around.

## Hook companion

A companion hook blocks Bash commands that reference a config or runtime
directory belonging to a different identity context than the one the current
session is running under, with an override variable for genuinely intended
cross-context calls. Passing that hook is necessary, not sufficient: it can
only catch path-shaped violations. The three questions above also cover
things the hook cannot see — for example, an API call scoped to the wrong
org even though no local path was ever touched.
