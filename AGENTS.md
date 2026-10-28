# AGENTS.md

## Agent skills

### Issue tracker

Issues live as GitHub issues on `designnotdrum/process-pack`, operated via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Docs voice

Write and update docs by `docs/agents/docs-voice.md`. Before `gh pr create`, `scripts/docs_refresh_gate.py` blocks it in Claude Code, Codex and OpenCode until you have checked the docs against the branch and run it with `--record`.

Codex runs `.codex/hooks.json` only in a trusted project, and only after a person approves the hook. Open `codex` once in the repo's main checkout and approve it when asked. A change to the hook needs approving again. In a git worktree, Codex uses the trust of the main checkout.
