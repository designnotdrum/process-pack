# Constants

Two layers:

- **`examples/`** — synthetic, fully anonymized worked examples showing every field in use. Safe to read, copy, and publish. Never put real identities here.
- **Your real constants** live OUTSIDE the repo:
  - personal + org scope: `~/.config/process-pack/personal.yaml` and `org.yaml` (created by `pp-init`, never committed anywhere)
  - repo scope: `.process/repo.yaml` inside each working repository (committed to THAT repo, since its contents describe the repo, not a person)

Skills reference constants by scope ("the never-wait list from repo constants"); resolution order is: `.process/repo.yaml` in the current repo, then `~/.config/process-pack/*.yaml`. Constants never contain secrets — names and labels only.
