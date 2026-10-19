# Klaus onboarding run

Builds a repo's baseline in three pull requests, in order, each on a branch stacked on the one before. Nothing is merged and nothing is filed in a tracker. It is plain ESM that runs with `node`, needs no build step, and uses the repo's own `typescript` package.

| Pull request | What it holds | Model |
| --- | --- | --- |
| 1. The list | `inventory.json` and `INVENTORY.md` with every entry at 1.0.0, and the duplicates: a list, a merge ticket for each same-looking pair, and a decisions list | none |
| 2. The purposes | A purpose comment above each component that has none, then the inventory rebuilt from them | a writer and a checker |
| 3. The stories | A story for each component that has none and shows no live data, and a view of the data-bound components with the screens they appear on | none |

The decisions behind it are in NJM-1779 on the Klaus map (NJM-1767). The Linear build ticket is process-pack issue #30.

## Running it

```sh
node onboard/onboard.mjs estimate --repo <dir>
node onboard/onboard.mjs run --repo <dir> --approve <plan id>
```

Run from the repo's default branch, with a clean tree, after the Klaus install commit is on `origin`. The pull requests are based on `origin/<default branch>`, so a commit that is only on the machine would be inside the first one, and the run refuses in that case.

`estimate` reads the repo and the settings, calls no model, writes nothing to the working tree and prints the estimate with a plan id. It keeps the estimate in the repo's git folder (`.git/klaus-onboarding/`). `run` refuses without `--approve` and the plan id, and refuses again if the repo no longer gives that plan, so the numbers a person read are the numbers the run was held to.

| Option of `run` | Meaning |
| --- | --- |
| `--captures <file>` | Dieter's captures for the baseline, as `version/version.mjs` reads them. Without it, no entry has a screenshot. |
| `--codex <path>` | The Codex executable. Default: `codex` on the path. |
| `--writer-branch <ref>` | With an external writer: the branch that holds its edits. |
| `--checks-file <file>` | With an external checker: its verdicts. |
| `--commit-trailer <line>` | A line to end each commit message with. May be repeated. |
| `--body-footer <text>` | Text to end each pull request body with. |

The checker's key is read from the environment variable the settings name (`OPENROUTER_API_KEY`). Start the command through the secret store so the variable exists for that command only, for example `2password run --env "OPENROUTER_API_KEY=op://..." -- node onboard/onboard.mjs run ...`. The key is sent in one header, appears in no log and no file, and is removed from the environment of the writer's process.

To start over after a failure, delete the three branches (`klaus/onboarding-1-list`, `-2-purposes`, `-3-stories`) and close their pull requests. The run refuses to start while one exists.

## Settings

The `onboarding` section of `klaus.config.json`, checked by `klaus.config.schema.json`. Every part is optional.

```json
{
  "onboarding": {
    "writer": { "route": "codex-cli", "model": "gpt-5.6-terra", "effort": "low", "maxComponentsPerCall": 12 },
    "checker": { "route": "openrouter", "model": "z-ai/glm-5.3-flash", "secrets": ["OPENROUTER_API_KEY"], "usageSnippets": 5 },
    "dataBoundImports": ["my-data-lib"],
    "docsDir": "docs/klaus"
  }
}
```

The writer and the checker are two different model families on purpose, so the check is not the writer agreeing with itself.

| Part | Default | Cost | Works on |
| --- | --- | --- | --- |
| Writer, `codex-cli` | The local Codex CLI, `gpt-5.6-terra` at low effort, one call for each folder | The ChatGPT plan's Codex quota, no price for each token | any machine where `codex login` has been done |
| Checker, `openrouter` | One OpenRouter call for each component on `z-ai/glm-5.3-flash` | Billed for each token, at the price on OpenRouter's models list times 1.7 (see the estimate) | any machine that has the key |
| Either, `external` | Another agent, named in `agent`, such as Codex cloud for writing or a Cyrus session on GLM for checking | Billed on that agent's own plan, so there is no estimate | a repo that agent is already connected to |

The two defaults work in any repo. NJM-1779 named Codex cloud on Terra to write and Cyrus on GLM to check. Both only work on repos already connected to them, so a repo that has them, such as Meridian, sets that part to `external`.

### The external routes

With `"route": "external"` the run does not call that agent. It writes briefs and stops before it makes any branch, so nothing is left behind, and a later run carries on.

1. `run` writes `writer-NN.md`, one for each folder, and `index.md` to `.git/klaus-onboarding/briefs/`. Give each to the agent as a task on one branch cut from the default branch. All the edits go on that branch.
2. `run --writer-branch <branch>` reads that branch and judges every file the way it judges a local writer's. With an external checker it then writes `checker-NN.md` and `checks.template.json` to the same folder and stops again.
3. Give each checker brief to the checking agent, put its verdicts in a file shaped like `checks.template.json` (`verdict` is `pass` or `fail`), and run `run --writer-branch <branch> --checks-file <file>`. A component with no verdict is kept and listed as unchecked.

## The estimate

`estimate` prints what each part will do and cost, and `run` ends by setting the same numbers beside what happened (a table in the third pull request and in `.git/klaus-onboarding/report.json`).

- **Counts are exact.** Entries, components needing a purpose, writer calls, checker calls, stories, duplicate pairs, tickets and decisions must match.
- **Tokens must land within 30%.**
- **Dollars must land within 100% or USD 0.001, whichever is more.** The checker's cost is a few hundredths of a cent for a handful of components, so the floor is what applies to a small repo.

The rates behind the token predictions are in `estimate.mjs`, each with the calls it was fitted on:

- The writer made two requests in every call, one that patches and one that says done. A request carries about 16,900 tokens before the prompt, and each component costs about 270. It was fitted on two real calls (35,239 tokens for a 1,070 character prompt with one component, and 37,198 and 37,236 for a 3,232 character prompt with two). The prompts were small, so a Meridian-sized prompt is an extrapolation and its report may land outside the margin. The first run on a large repo is the real test.
- The checker's reply is mostly reasoning, which `z-ai/glm-5.3-flash` cannot switch off: 37 to 72 tokens over four calls. OpenRouter charged 1.7 times the price on its models list for the same tokens, because it routes to providers that charge more. The estimate reads the list price on the day and applies that factor.
- A writer that has used more than twice its estimate stops the run before the next call. The first try, with no file in the prompt, ran 16 failed patches and used 515,484 tokens in one call.

The estimate says plainly that the code leaves the machine: the files of each folder go to OpenAI through the Codex CLI, and each component's props and a few places it is used go to OpenRouter.

## What the writer and the checker may do

Text from the repo (component names, doc comments, usage lines) is untrusted input to both models. It is passed as data between two lines that carry a random token for each call, and the instructions come first.

- **The checker has no tools.** It gets the purpose, the props and up to five places the component is used, and replies with a verdict. Its reply is read as `pass` or `fail` and a reason. It names no file, no path and no command. The reason is cleaned (addresses, markdown and anything outside plain ASCII are removed) before it reaches a pull request.
- **The writer has one tool.** `codex exec` runs with the folder as its working root, `--sandbox workspace-write`, no shell (`features.shell_tool=false`), no web search, no hooks, none of the user's Codex settings and no `AGENTS.md`. The files of the folder are in the prompt, so it has nothing to read. It has `apply_patch` to write. A shell would let a comment in a file steer a command.
- **Nothing the writer wrote is trusted as it stands.** After each call `verify.mjs` compares each file with the plan. A file passes only if, once the doc comments of the listed components are cut out, it is the same as before (line breaks and indentation aside). A file outside the plan, a new file or a changed line of code rejects the call. For a passing file, the run reads the two sentences out of the comment and writes the comment itself in one fixed form. Sentences with a link, an `@` tag, a pipe, a comment marker, markup or a non-ASCII character are refused, and so is one over 200 characters.
- **A plain comment is left where it is.** A `//` comment above a component is not a doc comment. The new doc comment goes above it, so a lint directive keeps its target. (The first real call replaced it, which this check rejected, and the prompt now says so.)
- **No link is followed when writing.** Every write goes through `plain-path.mjs`, which refuses a symbolic link on the way to a file or in the file itself, and a path that resolves outside the repo. It repeats `install/safe-write.mjs` because `install/` is not part of the copy that design-onboard puts in a repo.
- **Only named paths are committed.** The run adds the files it wrote by name, never everything.

## Purposes

A component needs a purpose when it has no doc comment, or its comment lacks "Use when:" or "Not for:". Components are grouped by folder, with at most `maxComponentsPerCall` in one call and about 120,000 characters of source. A file over 60,000 characters is left for a person.

Each written purpose is then checked once, against up to five places the component is used, found from the inventory's own import graph (so barrels and path aliases count). The outcomes:

- **Written and passed.** In the pull request.
- **Written and not checked.** In the pull request, and listed as such. This is a component used nowhere, or one whose check could not be answered.
- **Failed the check.** Not in the pull request. Its proposed text and the checker's reason are in `docs/klaus/purposes.md`, so a person can edit it and add it.
- **Rejected.** The writer changed more than the comment, or the text was not acceptable. Nothing is written.

## Duplicates

Two components are a likely pair when they do the same job: the same name in two files, or the same kind of name (the last word: `Button` and `PrimaryButton`) with at least half their prop names in common. The look is the share of class names the two write (in `className` and in `cva`, `cn`, `clsx` and the like), because the run has no screenshots. At three quarters or more in common the pair looks the same.

- **Same look:** a merge-into-one ticket in `docs/klaus/tickets/`, with a goal, what Klaus found, a done check, proof wanted and a size. The entry to keep is the shared one, then the more used, then the first by name.
- **Different look, or a component that styles itself another way** (CSS modules, styled-components): on `docs/klaus/decisions.md` as "which one wins", with a box to tick for each choice and a default. DESIGN.md is changed first.

The cut-offs (50% and 75%) are choices, not measurements, and every percentage is printed so a person can overrule them. Pixel comparison of real screenshots is a later improvement once the repo's visual check captures components.

## Stories

A story is written for a component that has none, shows no live data, and has every required prop fillable from its type (a string, a number, a boolean, a closed set of literals, a node, a function, an array, a date). Each required prop gets one sample value. A variant prop gets one story for each value, up to eight. The story sits beside the component, imports it by name, and takes `Meta` and `StoryObj` from the package the repo's existing stories use, else the one in `package.json`, else `@storybook/react`. A repo's existing story is found by what it imports, so a story with another name still counts. No story is overwritten.

A component shows live data when its own file imports a data or auth package (`@clerk/`, `@tanstack/react-query`, `swr`, `@supabase/` and the others in `config.mjs`, plus the repo's `dataBoundImports`), calls a `use...` hook from a local `hooks`, `data`, `queries`, `api`, `services` or `store` folder, or calls `fetch`. It is listed in `docs/klaus/stories.md` with the screens it appears on and a capture for each, when the baseline has one.

## Limits

- Data-bound is read from the component's own file. A component that renders a data-bound child is not marked.
- A story is not rendered by the run. In a repo with Storybook's types installed, `tsc --noEmit` shows whether they compile.
- A required prop typed as an object, a generic or a type from another file cannot be given a sample value, so that component is listed for a person to write.
- Existing `.mdx` stories are not read.
- The writer's coverage is the files of a folder. A component declared in a way `source.mjs` cannot place (a re-export from another file) is left for a person with the reason.
- A purpose is checked against how the component is used, not against what it does. A purpose the usage cannot contradict passes.

## Tests

```sh
node --test "plugins/process-pack/tools/klaus/onboard/**/*.test.mjs"
```

The tests run on a copy of a small sample repo in `tests/fixtures/sample` (the same five components as the real sample, `designnotdrum/klaus-onboarding-sample`, with a stub for React's types), a local bare repository as `origin`, a stub `gh` and a stub `codex` in `tests/stub/`, and a fake `fetch` for the checker. They call no model and no network. The quoted glob is needed on Node 22, where a bare directory argument is not expanded.
