# Klaus version

Picks a version for every entry in `inventory.json` from what changed in a release. It uses no model. It is plain ESM and runs with `node`, with no build step.

Run it once for each release, oldest first. It needs `git`, the repo's own `typescript` package (the same one the inventory uses), and the inventory built for this release.

## Usage

```sh
node version/version.mjs --release v1.5.0 [--from v1.4.0] [--captures captures.json] [options]
node version/version.mjs --baseline [--release v1.0.0] [--captures captures.json]
```

Relative paths in the options are taken from the repo.

| Option | Meaning |
| --- | --- |
| `--release <name>` | The release being versioned. Required except with `--baseline`. A screen whose capture changed is named for it. |
| `--from <ref>` | The release the previous versions belong to, as a tag or commit. Default: the commit the previous inventory records. |
| `--baseline` | Onboarding. Every entry and screen starts at 1.0.0 and nothing is compared. |
| `--root <dir>` | The repo. Default: the current directory. |
| `--inventory <file>` | The inventory built for this release. Default: `inventory.json` in the repo. |
| `--previous <file>` | The inventory the last run wrote. Default: the inventory file itself, if it holds versions. |
| `--out <file>` | Where the result goes. Default: the inventory file. |
| `--captures <file>` | This release's captures. See below. |
| `--screenshots <dir>` | Where screenshots are kept. Default: `.klaus/screenshots` in the repo. |
| `--diff <choice>` | `auto`, `bundled`, or the path to a module. See "The pixel diff". |
| `--dry-run` | Pick the versions and write nothing. |
| `--json` | Print the report as JSON instead of a summary. |

Exit 0 when the versions were picked, 2 when the person running it can fix the problem, 3 on any other error.

## The rules

Each entry gets one bump per release. When several things changed, the highest kind wins.

| Kind | What changed |
| --- | --- |
| major | A prop was removed or renamed. A prop type got narrower, which includes a removed `cva` variant value. A prop type changed in neither direction. A new required prop. An optional prop made required. A component of the family was removed. |
| minor | A new optional prop, which includes one with a default. A prop type got wider, which includes a new `cva` variant value. A required prop made optional. A component was added to the family. |
| patch | The props are unchanged in meaning, and the entry's capture for this release differs from the screenshot stored with its current version. |
| none | Anything else, including a prop type written another way that accepts the same values. |

"Narrower" and "wider" come from the compiler: the old release and the new one are loaded into one TypeScript program, and `checker.isTypeAssignableTo` says whether the old prop type fits in the new one. Props inherited from React, the DOM or a library count, because a wrapper that starts omitting one has changed its interface. A prop typed with an object type, or a list of one, declared in the repo is compared field by field to three levels (`rows[].note`).

A new component starts at 1.0.0. An entry that moved to another file keeps its version: it is matched by name, and its old file is read from where it was.

An entry with no capture bumps on props alone. A prop change and a changed capture in one release is still one bump, not two.

### Screens

A screen has no props. It is versioned by its own capture only, and its version is the name of the release in which that capture last changed (`v1.5.0`, not `1.5.0`). A screen seen for the first time is named for the release it first appeared in. At the baseline, screens start at `1.0.0` like everything else. Screens are listed in `screens` in `inventory.json` and are not entries.

## What it reads and writes

### Captures

`--captures` names a JSON file. Paths in it are relative to the file. The capture step that makes the PNGs, Dieter in Meridian, is not part of this folder.

```json
{
  "components": { "Button": "shots/Button.png" },
  "screens": { "/settings": "shots/settings.png" }
}
```

Components are matched to entries by inventory `name`. When two entries share a name, name each capture as `file#name`, for example `packages/ui/src/button.tsx#Button`: a capture named only `Button` is then not used, and the run says so. Screens are listed by route. An entry or screen with no capture this release is left as it was.

### Screenshots

The capture is compared against the screenshot stored with the entry's current version, not against last release's capture. A slow drift that stays under the noise threshold each release is therefore caught once it adds up. A capture is stored, under `.klaus/screenshots/`, only when the entry moves to a new version (or has no screenshot yet). The entry's `screenshot` field holds the path relative to the repo:

```
.klaus/screenshots/components/<name>/<version>.png
.klaus/screenshots/screens/<encoded route>/<version>.png
```

### Inventory

The result is the inventory with these changed:

| Field | Meaning |
| --- | --- |
| `entries[].version` | `x.y.z`. |
| `entries[].screenshot` | The stored screenshot of that version, or `""`. |
| `screens` | `[{ route, version, screenshot }]`. |
| `versioned` | `{ release, commit }`: the release these versions are for, and the commit the checkout was on. The next run uses `commit` as its `--from`. |

Running it again for a release the previous inventory already holds is refused, so a repeat cannot bump the same release twice.

### What has to survive between runs

The inventory script rebuilds `inventory.json` from scratch and writes empty versions. So a run needs the inventory the last run wrote (`--previous`) and the screenshots folder it points into. In CI these have to be kept between runs the way `.klaus/state.json` is, for example in the Actions cache.

## How the old release is read

`--from` names a commit. Its source and config files (`.ts`, `.tsx`, `.js`, `.json` and the like, not images or lockfiles) are unpacked into a temporary folder outside the repo, and the repo's `node_modules` folders are linked into it. React, Radix and the rest therefore resolve to the same files on both sides, so a change in a prop always comes from the component and never from a library upgrade. Imports inside the old release, including `tsconfig` path aliases, resolve against the old release's own files. The folder is removed when the run ends.

The new release is the checkout itself. Run Klaus on the checkout of the release, with an inventory built from it.

## The pixel diff

A capture counts as changed when the repo's own pixel diff leaves at least one region of changed pixels after it drops noise. A capture of another size counts as changed.

- `auto` (default) uses `scripts/dieter/regression/diff.mjs`, Meridian's Dieter diff, when the repo has that file. The noise threshold is then the one the repo's regression check uses.
- Without it, a bundled diff is used (`bundled-diff.mjs`, `png.mjs`). It needs no install. It is a port of pixelmatch 8.0.0, the version Meridian pins, with Dieter's settings (colour threshold 0.1, anti-aliased pixels ignored, a group of changed pixels on an 8 px grid dropped when under ten pixels). A different pixelmatch version measures colour another way, so a repo whose own diff uses one should pass it with `--diff <path>`.
- `--diff bundled` forces the bundled diff. `--diff <path>` loads a module that exports `diffMask` and `findRegions` the way Dieter's does. A module that does not also export `readPng` has its PNGs read by the bundled reader.

`diffMask(ref, after)` and `findRegions(mask, width, height)` are called without options, so a module's own defaults decide what counts as noise. A capture that cannot be read, or a diff that throws, stops the run with a message naming the capture, and nothing is written.

The bundled PNG reader reads every colour type and bit depth, one pass. It does not read interlaced files, and it ignores a colour key in `tRNS`.

## Limits

- An import the compiler cannot resolve reads as `any`, so a prop typed with it cannot be compared. The run lists such imports in `notes`. Imports of stylesheets and images, and modules declared with `declare module`, are not listed.
- When a field inside an object or list prop changed, only the field changes are reported for that prop. A separate change to the prop's own type at the same time, such as `Row[]` becoming `Row[] | null`, is not reported.
- Behaviour with the same props is invisible: a changed default value, or a handler that does something else, has no trace in the types.
- A prop typed with a type from another workspace package is read as that package is now, on both sides.
- A component whose props are a union of object types is merged the way the inventory merges it. A change to a prop's type that appears in only some members is not seen.
- Method-style members: TypeScript compares method parameters loosely, so narrowing a parameter on a prop declared with method syntax can read as compatible.
- A generic component is compared by the printed type, so any difference in a prop type is major.
- `isTypeAssignableTo` is public from TypeScript 5.4. On an older version, any difference in a prop type is major, and the run says so in `notes`.
- A stored version that is not `x.y.z` counts as 1.0.0, and the run says so in `notes`.
- One call gives one bump for the whole span from `--from` to the checkout. To get one bump per release, run it for each release in turn.

## Tests

```sh
# once, in plugins/process-pack/tools/klaus
pnpm install

# from the repo root
node --test "plugins/process-pack/tools/klaus/version/**/*.test.mjs"
```

The quoted glob is needed on Node 22, where a bare directory argument is not expanded.

The three examples from the research on NJM-1771 run on the real component files from component-monkey-app (`test/fixtures/research/`), read with `git show <sha>:<path>`. React, Radix and lucide are stubs in `test/fixtures/common/stubs/`, so the tests need nothing but `typescript`. The pixel tests write their PNGs with a small encoder in `test/helpers.mjs`.
