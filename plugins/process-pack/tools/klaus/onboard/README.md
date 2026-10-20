# Klaus onboarding run

Builds a repo's baseline in three pull requests, in order, each on a branch stacked on the one before. Nothing is merged and nothing is filed in a tracker. It is plain ESM that runs with `node`, needs no build step, and uses the repo's own `typescript` package.

| Pull request | What it holds | Model |
| --- | --- | --- |
| 1. The list | `inventory.json` and `INVENTORY.md` with every entry at 1.0.0, and the duplicates: a list, a ticket for each pair the data settles, and a decisions list of the questions it does not | none |
| 2. The purposes | A purpose comment above each component that has none, then the inventory rebuilt from them | a writer and a checker |
| 3. The stories | A story for each component that has none and shows no live data, and a view of the data-bound components with the screens they appear on | none |

The decisions behind it are in NJM-1779 on the Klaus map (NJM-1767). The Linear build ticket is process-pack issue #30.

## Running it

```sh
node onboard/onboard.mjs estimate --repo <dir> [--captures <file>]
node onboard/onboard.mjs run --repo <dir> --approve <plan id> [--refresh]
```

Run from the repo's default branch, with a clean tree, after the Klaus install commit is on `origin`. The pull requests are based on `origin/<default branch>`, so a commit that is only on the machine would be inside the first one, and the run refuses in that case.

`estimate` reads the repo and the settings, calls no model, writes nothing to the working tree and prints the estimate with a plan id. It keeps the estimate in the repo's git folder (`.git/klaus-onboarding/`). `run` refuses without `--approve` and the plan id, and refuses again if the repo no longer gives that plan, so the numbers a person read are the numbers the run was held to.

| Option of `run` | Meaning |
| --- | --- |
| `--captures <file>` | Dieter's captures for the baseline, as `version/version.mjs` reads them. Without it, no entry has a screenshot. |
| `--codex <path>` | The Codex executable. Default: `codex` on the path. |
| `--writer-branch <ref>` | With an external writer: the branch that holds its edits. |
| `--checks-file <file>` | With an external checker: its verdicts. |
| `--refresh` | When the first pull request is merged with files this plan no longer writes, make it again as a refresh instead of refusing (below). |
| `--commit-trailer <line>` | A line to end each commit message with. May be repeated. |
| `--body-footer <text>` | Text to end each pull request body with. |

The checker's key is read from the environment variable the settings name (`OPENROUTER_API_KEY`). Start the command through the secret store so the variable exists for that command only, for example `2password run --env "OPENROUTER_API_KEY=op://..." -- node onboard/onboard.mjs run ...`. The key is sent in one header, appears in no log and no file, and is removed from the environment of the writer's process.

### After a stop: run it again

A run that stops names the branches and pull requests it made, and puts back any file of the commit that failed. To go on, run `run` again with the same plan. It continues from the first pull request that is not merged (`stages.mjs`):

- **The first pull request counts as merged** when the default branch holds each of its files with the same content as the plan writes, apart from the formatting a commit hook may have done: a JSON file is compared as parsed JSON, and a Markdown file with its whitespace collapsed. The list records the commit it was made at, and a list made at an earlier commit of this branch is the same list. None of its files is a component file, so the plan can always write them again.
- **The second and third count as merged** when their own record is on the default branch: `docs/klaus/purposes.md` for the second and `docs/klaus/stories.json` for the third. Once either merges, its files are the plan's input (the components hold their purposes, or have stories), so a later plan cannot write it again. Run `estimate` again first: the plan changes.
- **From the first that is not merged, every pull request is made again.** Its branch is cut again from the plan with `git checkout -B`, so a branch an earlier run made, with or without a pull request, is moved and its old commits stay in its reflog. An open pull request for that branch is closed with a comment, the branch is pushed over origin's only if origin still has the commit the run saw (`--force-with-lease`), and a new pull request is opened that says which one it replaces. The first one made is based on the default branch.
- **The model's saved results are used again** (below), so a run that stopped after the model work makes no model call when it continues. When the purposes are merged there is no model work at all, and the key is not needed.
- **Merged content that is not what the plan writes stops the run** before anything is spent, with each file that differs and the place: the JSON path, with the component's name, or the first Markdown line. The run does not overwrite a merged file. The same holds when `inventory.json` is there without the run's other files: that repo already has a baseline.

`estimate` shows the same answer before a run: which pull requests are merged, where the run would continue, how many writer calls and checks are saved for this plan, and which results were saved for another plan and so are not used.

### Refreshing a merged first pull request: `--refresh`

Klaus can change between stages. On Meridian the first pull request merged, and then Klaus changed how prop types print and which duplicates it lists, so the merged files were no longer what the plan writes and every continue run refused. `--refresh` is the way forward that a person can review:

- **Without `--refresh` nothing changes.** The run refuses as above, and the refusal names the flag.
- **With `--refresh`, the first pull request is made again as a refresh.** Its branch is `klaus/onboarding-1-list-refresh`, cut from the default branch, so the merged pull request's own branch is never pushed over. The title ends in "(refresh)". It holds only the files that change: each of the first pull request's files that is not there or differs (formatting aside, as above), as the plan writes it now, and the removal of each numbered ticket or picture that the plan no longer writes. A file someone else put in those folders is not removed. The second and third pull requests are stacked on it as in any run, and an open one is closed and replaced.
- **The commit hook is tried on the refresh's files**, removals included, before any model call, as for every other commit.
- **`estimate` lists what a refresh would change**, file by file, and prints the command with `--refresh`. The pictures are drawn only by the run, so when the decisions list has questions the estimate says the list and its pictures are drawn again, and leaves them out of the list. A picture that the run does not draw again is removed, because the decisions list the run writes no longer shows it.
- **The plan id approves the refresh too**, and the estimate says so. The plan id does not cover what is on the default branch, so a run with `--refresh` also checks that the estimate it approves listed a refresh with the same files and the same kind of change for each (the decisions list and pictures aside). The first place a file differs is not held to the estimate: what the refresh writes is the plan's text, which the plan id approves. If the files a refresh would change are different by then, the run refuses until the estimate is made again.
- **A merged first pull request whose files already match is skipped as before**, with or without the flag. Only the first can be refreshed: the second and third change the files the plan is made from.

The report lists the refresh under `refreshed`, with the merged pull request it brings up to date and each file it changes.

### Before any model call: the commit hook

The run commits three times, after the model work. On Meridian the first commit was refused by the repo's pre-commit hook after 3,583,498 writer tokens and 235 checks had been spent. So before any model call the run tries each commit first. It writes that commit's files, stages them, and runs the hook on them, in the order it commits: the list and the duplicates, then the purpose comments, then the stories. The files of the commits before stay on disk, unstaged, as they would be in the branch. The purpose comments cannot exist yet, so each file the writer is given gets a placeholder purpose that passes the same text checks a real one must. A hook that refuses stops the run with its message, before anything is spent. Either way the index is put back to `HEAD`, every file the check wrote or the hook changed is restored, and the run checks that `HEAD` and the branch did not move.

The stories are type-checked at the same point, before the hook is tried, because the plan that the run checks against the estimate holds the result (see Stories).

The hook is run with `git hook run pre-commit`, which finds it the way a commit does (`core.hooksPath`, as husky sets it, then `.git/hooks`). That needs git 2.36 or later. With an older git the run takes the path `git rev-parse --git-path hooks/pre-commit` gives, which also follows `core.hooksPath`, and runs that file from the repo root when it is executable. Only the pre-commit hook is tried: a `commit-msg` hook and the `pre-push` hook run at the real commit and push, and are not tried first.

### Lines the commit hook rewrites

A hook that fixes what it finds (a linter with an autofix, a formatter) changes the staged files and stages them again, so a commit can hold text the run did not write. On Meridian's purposes pull request (issue 73) the hook's autofix changed four lines of code in three files, next to the purpose comments. The pull request said it only added comments.

After each commit, the refresh's included, the run compares every text file in it with the text the run wrote. The run wrote each whole file, so every line that differs was added, changed or removed by the hook. The run does not undo these changes and does not skip the hook. A line the hook changed has a before and an after. A line it added has no before, and a line it removed has no after. Where the hook replaced some lines with a different number of lines, the old and new lines are paired in order and the rest count as added or removed.

The pull request body gets a section, "Lines the repo's commit hook rewrote", placed after the first paragraph. It gives the count and, for each line, the file, the line number in the committed file, and the two texts as code. A removed line is not in the committed file, so it is placed by the line it followed. It lists the first 40 and says how many more are not listed. A hook that rewrote nothing adds no section. The run prints the count after the commit, and the summary repeats it for each pull request.

The report records `hookRewrites`: for each pull request the run made, its `step`, the `count` of lines, and the count for each of its `files`. The count is 0 when the hook rewrote nothing.

The search for the smallest set of edits in a file stops at 400 edits. Past that, the lines between the first and last ones that agree count as one block, so a file the hook rewrote throughout is counted by its lines and not by a smaller set of edits. A picture is not compared, and neither is a file the hook added to the commit that the run did not write.

### A stop after the model work keeps it

Each writer call that finishes and each check that answers pass or fail is saved under `.git/klaus-onboarding/results/<plan id>/` as soon as it arrives, written to a temporary file and renamed. A later `run` with the same plan uses a saved result instead of calling the model (a result saved for another plan id is not read), when the file it is about hashes the same as now and the prompt would be the same (the prompt holds the usage lines, which come from files the plan id does not cover). A saved writer result is judged again by `verify.mjs`, the same as a new one. A writer call that failed and a check that could not answer are made again. The report counts the reused calls separately and at no cost.

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

- **Counts are exact.** Entries, components needing a purpose, writer calls, checker calls, stories, duplicate pairs, tickets and decisions must match. Every call the estimate counted is accounted for. A writer call is made or reused. A check is made, reused, or not reached: the estimate counts a check for every component used somewhere or named by a comment, and a component whose written purpose was rejected before the check (or never written) gets none. The estimate cannot know beforehand which text will be rejected, so the report counts those and says how many under the table. On Meridian that was 13 of 248: the run made 235 checks, and every one of its 55 writer calls had finished.
- **Tokens must land within 30%.** They are compared for the calls made in that run, against the estimate's figure for each of those calls.
- **Dollars must land within 100% or USD 0.001, whichever is more.** The checker's cost is a few hundredths of a cent for a handful of components, so the floor is what applies to a small repo.

The rates behind the token predictions are in `estimate.mjs`, each with the calls it was fitted on:

- The writer made two requests in every call, one that patches and one that says done. A request carries about 16,900 tokens before the prompt, and each component costs about 270. It was fitted on two real calls (35,239 tokens for a 1,070 character prompt with one component, and 37,198 and 37,236 for a 3,232 character prompt with two). The prompts were small, so a Meridian-sized prompt is an extrapolation and its report may land outside the margin. The first run on a large repo is the real test.
- The checker's reply is mostly reasoning, which `z-ai/glm-5.3-flash` cannot switch off: 37 to 72 tokens over four calls. OpenRouter charged 1.7 times the price on its models list for the same tokens, because it routes to providers that charge more. The estimate reads the list price on the day and applies that factor.
- A writer that has used more than twice its estimate stops the run before the next call. The first try, with no file in the prompt, ran 16 failed patches and used 515,484 tokens in one call.

The estimate says plainly that the code leaves the machine: the files of each folder go to OpenAI through the Codex CLI, and each component's props and a few places it is used go to OpenRouter.

## What the writer and the checker may do

Text from the repo (component names, doc comments, usage lines) is untrusted input to both models. It is passed as data between two lines that carry a random token for each call, and the instructions come first.

- **The checker has no tools.** It gets the purpose, the props, up to five places the component is used, the comment directly above the component (which the purpose is added to) and up to four other comments that name it, in its own file and the files that use it, and replies with a verdict. A purpose that contradicts one of those comments fails. Its reply is read as `pass` or `fail` and a reason. It names no file, no path and no command. The reason is cleaned (addresses, markdown and anything outside plain ASCII are removed) before it reaches a pull request.
- **The writer has one tool.** `codex exec` runs with the folder as its working root, `--sandbox workspace-write`, no shell (`features.shell_tool=false`), no web search, no hooks, none of the user's Codex settings and no `AGENTS.md`. The files of the folder are in the prompt, so it has nothing to read. It has `apply_patch` to write. A shell would let a comment in a file steer a command.
- **Nothing the writer wrote is trusted as it stands.** After each call `verify.mjs` compares each file with the plan. A file passes only if, once the doc comments of the listed components are cut out, it is the same as before (line breaks and indentation aside). A file outside the plan, a new file or a changed line of code rejects the call. For a passing file, the run reads the two sentences out of the comment and writes the two lines itself in one fixed form. A doc comment the component had before is kept: the writer is shown it and told to add the two lines after its text, an edit that removes or rewords any of its text is rejected, and the run writes the two lines into the old comment, before its first tag (the inventory reads only the text before the tags), without removing a byte of it. Sentences with a link, an `@` tag, a pipe, a comment marker, markup or a non-ASCII character are refused, and so is one over 200 characters.
- **A plain comment is left where it is.** A `//` comment above a component is not a doc comment. The new doc comment goes above it, so a lint directive keeps its target. (The first real call replaced it, which this check rejected, and the prompt now says so.)
- **No link is followed when writing.** Every write goes through `plain-path.mjs`, which refuses a symbolic link on the way to a file or in the file itself, and a path that resolves outside the repo. It repeats `install/safe-write.mjs` because `install/` is not part of the copy that design-onboard puts in a repo.
- **Only named paths are committed.** The run adds the files it wrote by name, never everything.

## Purposes

A component needs a purpose when it has no doc comment, or its comment lacks "Use when:" or "Not for:". A doc comment that is there keeps all of its text, and the two lines are added to it, so the reason a comment gives for the code stays with the code. (The first Meridian run replaced 153 such comments and lost that text.) A comment that already has one of the two labels is left for a person, since a second label would make the inventory read the first. Components are grouped by folder, with at most `maxComponentsPerCall` in one call and about 120,000 characters of source. A file over 60,000 characters is left for a person.

Each written purpose is then checked once, against up to five places the component is used, found from the inventory's own import graph (so barrels and path aliases count), and against its own comment and the comments that name it. The outcomes:

- **Written and passed.** In the pull request.
- **Written and not checked.** In the pull request, and listed as such. This is a component used nowhere and named by no comment, or one whose check could not be answered.
- **Failed the check.** Not in the pull request. Its proposed text and the checker's reason are in `docs/klaus/purposes.md`, so a person can edit it and add it.
- **Rejected.** The writer changed more than the comment, removed text from a comment that was there, or wrote text that was not acceptable. Nothing is written.

## Duplicates

Two components are a likely pair when they do the same job: the same name in two files, or the same kind of name (the last word: `Button` and `PrimaryButton`) with at least half their prop names in common. Props that nearly every component takes (`children`, `className`, `style`, `id`, `key`, `ref`, `asChild`) do not count, so two context providers that take only `children` are not a pair. A pair is set aside, and listed with the reason at the end of `duplicates.md`, when one component is built on the other (its file imports the other by name) or when the names differ, neither name holds all the words of the other (`InsightCard` and `HypothesisCard`, but not `Button` and `PrimaryButton`) and either the look differs or it could not be compared (a side writes no class names, as a component styled another way does). Nothing is asked about those: a question about two differently named components whose look cannot be shown is not one the owner can judge. Pairs with the same name, or a name inside the other's, are still asked about. A same-looking pair where one is built on the other is set aside too, not made a merge ticket. The look is the share of class names the two write (in `className` and in `cva`, `cn`, `clsx` and the like), because the run has no screenshots. At three quarters or more in common the pair looks the same.

The data settles what it can, without asking:

- **One copy is used in no place:** a removal ticket in `docs/klaus/tickets/` that deletes it. The copy that is used stays, even when it is the app's and the unused one is the shared package's. When both are unused, the first stays and the second goes, and the ticket says the first is unused too. One ticket for each unused copy: a second pair against the same copy is folded into the first one's ticket.
- **Same look, both used:** a merge-into-one ticket, with a goal, what Klaus found, a done check, proof wanted and a size. The entry to keep is the shared one, then the more used, then the first by name.

Everything else is a question in `docs/klaus/decisions.md`: both copies are used and the look differs, or a component styles itself another way (CSS modules, styled-components), so its look cannot be compared. Each question is written to be read cold:

- The heading is the question: "Replace the web app's own Switch with the shared UI package's Switch?". Each side is named by where it lives and how many places use it ("the shared UI package's Switch (3 places)"), taken from its folder: `packages/<name>` is "the shared <name> package" and `apps/<name>` is "the <name> app".
- The default is stated, with its reason: yes when the names match (or one holds the other's words, `PrimaryButton` and `Button`) and the kept one is used in more places or is the shared one, otherwise no, keep both.
- A picture of the two side by side, with one sentence on the visible difference measured from what was drawn. A side with no story is a labelled gap in the picture, and the item says so. Without a built Storybook, the item says that instead and gives a sentence read from the class names, marked as not from a picture.
- Class names and file paths are in a collapsed block for whoever does the merge.

Nothing in the lists makes a statement about accessibility: Klaus does not judge it.

### The pictures

`decisions-pictures.mjs` draws them from a static Storybook build, with the browser reader the Figma adapter uses. The build is the one `outputs.figma.options.storybookDir` names in `klaus.config.json`, else the `storybook-static` folder next to a `.storybook` folder. Build it first with `storybook build`; Klaus does not. A component's story is the one named for it (by the end of its title, or by its stories file) in a story file that imports the component, directly or through a barrel file, found with the repo's own TypeScript. A story that only imports the component, such as one that draws a whole screen, is not its story. The first such story (`Default`, `Primary`) is drawn in its default state.

The left side of each picture is the one a "yes" would replace, the right side the one that stays. Each image is a PNG under `docs/klaus/decisions/`, written into the repo and linked by a relative path, so it shows on GitHub with no upload. The sentence under it is measured from what was drawn: colour, corners, border, shadow, text, and the height of a control. A tall box is as tall as its content, so its height is not compared.

`onboard/write-decisions.mjs --repo <dir> [--storybook <dir>] [--out <dir>] [--ask-all]` writes the decisions list, the tickets, the pictures and `duplicates.md`, with the run's own functions and no model. With `--out` the repo is only read. With `--ask-all` the pairs that are set aside are asked about too.

The run draws the pictures after it has the plan and before it makes the first pull request, and commits them in it, with the decisions list and the tickets (`onboard.mjs run --storybook <dir>` names the build). With no build, or no browser, the first pull request is still made, and each decision says why it has no picture. A later run that continues past a merged first pull request only needs `decisions.md` and the pictures to be there: they depend on a browser and a build, so they are not compared.

The cut-offs (50% and 75%) are choices, not measurements, and every percentage is printed so a person can overrule them. Pixel comparison of real screenshots is a later improvement once the repo's visual check captures components.

## Stories

A story is written for a component that has none, shows no live data, and has every required prop fillable from its type (a string, a number, a boolean, a closed set of literals, a node, a function, an array, a date). Each required prop gets one sample value. A function prop gets a handler that returns what its type says, and never an empty function or an async function with nothing to await, since lint flags both (`no-empty-function`, `require-await`). When the repo's own TypeScript resolves `storybook/test` (Storybook 9 and later) or `@storybook/test` (Storybook 8) from the story's folder, a function that returns nothing is Storybook's `fn()`, and one that returns `Promise<void>` is `fn(() => Promise.resolve())`; the story imports `fn` from that module, and the Actions panel shows the calls. Otherwise a function that returns nothing is `() => { /* Nothing happens in a story. */ }`, and one that returns `Promise<void>` is `() => Promise.resolve()`. A function that returns a value is a plain function in both cases, `() => 'Sample'` or `() => Promise.resolve([])`. A variant prop gets one story for each value, up to eight. The story sits beside the component, imports it by name, and takes `Meta` and `StoryObj` from the package the repo's existing stories use, else the one in `package.json`, else `@storybook/react`. A repo's existing story is found by what it imports, so a story with another name still counts. An import through a barrel file counts for the file that declares the name, followed as the decisions pictures follow it: a folder import resolves to its index file, and `export *` is followed through nested index files. A namespace import of a barrel counts only for the component the story file is named for. No story is overwritten.

A story is written only where a Storybook loads it. The run reads each `.storybook/main.*` in the repo as source (it does not run it), takes the `stories` patterns relative to that `.storybook` folder, and writes a story only if one of them matches the story's path. The Storybook package in the story's import comes from that config's `framework`, else from the rule above. A component whose story no config loads is left for a person with the reason "no Storybook in this repo loads stories from this folder". A config whose `stories` is not a plain list of patterns (a spread, a computed value, a `!` pattern, a negated group) is left for a person with the reason it could not be read.

Every story is then type-checked, before any file, branch or model call. The story text is held in memory and compiled with the repo's own TypeScript and the tsconfig nearest the story, so each package is checked with its own settings and nothing is written. Two things move a story to "left for a person", with the reason in `docs/klaus/stories.md`: a required prop that the compiler sees on the component and the inventory does not (a prop a library declares, such as a flow node's `data`), and any error the compiler reports in the story, with its code and message. A story whose package cannot find the Storybook package it imports is one of those. The estimate and the report count these as left for a person, so the stories written in the estimate and in the run agree.

`onboard/write-stories.mjs --repo <dir> [--approve <plan id>] [--captures <file>]` writes only the third pull request's files into a working tree, from the same plan and with the run's own function for the files. It makes no branch, commit or model call.

A component shows live data when its own file imports a data or auth package (`@clerk/`, `@tanstack/react-query`, `swr`, `@supabase/` and the others in `config.mjs`, plus the repo's `dataBoundImports`), calls a `use...` hook from a local `hooks`, `data`, `queries`, `api`, `services` or `store` folder, or calls `fetch`. It is listed in `docs/klaus/stories.md` with the screens it appears on and a capture for each, when the baseline has one.

## Limits

- Data-bound is read from the component's own file. A component that renders a data-bound child is not marked.
- A story is type-checked but not rendered by the run, so a story that compiles can still fail to draw.
- Only a glob that Storybook configs usually hold is matched: `*`, `**`, `?`, `{a,b}`, `[abc]` and `@(a|b)`, `?(a|b)`, `+(a|b)`, `*(a|b)`. A config that needs anything else is left for a person.
- A required prop typed as an object, a generic or a type from another file cannot be given a sample value, so that component is listed for a person to write.
- Existing `.mdx` stories are not read.
- The writer's coverage is the files of a folder. A component declared in a way `source.mjs` cannot place (a re-export from another file) is left for a person with the reason.
- A purpose is checked against how the component is used and what comments say about it, not against what it does. A purpose the usage and the comments cannot contradict passes. A comment that describes the component without naming it, such as "this component" inside another file, is not found.

## Tests

```sh
node --test "plugins/process-pack/tools/klaus/onboard/**/*.test.mjs"
```

The tests run on a copy of a small sample repo in `tests/fixtures/sample` (the same five components as the real sample, `designnotdrum/klaus-onboarding-sample`, with a stub for React's types), a local bare repository as `origin`, a stub `gh` and a stub `codex` in `tests/stub/`, and a fake `fetch` for the checker. They call no model and no network. The quoted glob is needed on Node 22, where a bare directory argument is not expanded. `hook-rewrites.test.mjs` installs a hook that rewrites a line, and one that rewrites many, and reads the pull request bodies and the report. `hook-rewrites-lines.test.mjs` tests the line comparison alone, and `hook-rewrites-render.test.mjs` the code span a line is shown in. `refresh.test.mjs` has a hook add a line to the refresh's commit. `hooks-and-resume.test.mjs` installs a pre-commit hook in the copy, a shell script that reads what is staged, to show a refusal before the writer and a run that reuses what a stopped run saved. `keep-comments.test.mjs` gives a component a comment with its reason in it. `continue.test.mjs` merges pull requests into the copy's `main`, with the formatting a hook would add, and runs again.
