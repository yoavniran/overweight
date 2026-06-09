![Overweight Logo](https://github.com/yoavniran/overweight/blob/main/resources/overweight-logo-dark-small.png#gh-dark-mode-only)
![Overweight Logo](https://github.com/yoavniran/overweight/blob/main/resources/overweight-logo-light-small.png#gh-light-mode-only)

# Overweight

<p align="center">
<a href="https://github.com/sponsors/yoavniran">
        <img src="https://img.shields.io/github/sponsors/yoavniran?logo=GitHub&label=Sponsor&logoColor=#white" alt="Sponsor on Github"/>
    </a>
    <a href="https://badge.fury.io/js/overweight">
        <img src="https://badge.fury.io/js/overweight.svg" alt="npm version" height="20">
    </a>
    <a href="https://github.com/yoavniran/overweight/actions/workflows/pr.yml">
        <img src="https://github.com/yoavniran/overweight/actions/workflows/pr.yml/badge.svg" alt="Build Status"/>
    </a>
    <a href="LICENSE.md">
       <img src="https://img.shields.io/github/license/yoavniran/overweight?color=blue&style=plastic" alt="MIT License"/>
    </a>
    <a href="https://www.npmjs.com/package/overweight">
        <img src="https://img.shields.io/npm/dw/overweight.svg?style=plastic&color=blue&label=weekly%20downloads"/> 
    </a>
</p>


An all-in-one toolkit for keeping your bundle sizes in check. It ships with a CLI, Node API, and GitHub Action, plus a tester architecture that lets you decide how assets are evaluated.

## Highlights

- Drop-in configuration: define `overweight` entries in `package.json` or `overweight.config.json`.
- Works everywhere: CLI, Node API, and an official reusable GitHub Action.
- Extensible testers: start with `gzip` (default), `brotli`, or `none`, and plug in your own logic programmatically.
- Globs & multi-match aware: every file matched by a glob is tracked individually.
- Conventional commits + semantic-release driven publishing with automatic changelog generation.
- Modern successor to the original `bundlesize`: migration is trivial, yet the project stands on its own roadmap.

## Installation

```sh
pnpm add -D overweight
```

## Configuration

Keep your configuration close to your code:

- `overweight.json` (or `overweight.config.json`) at the project root (default when the CLI runs without args).
- `package.json` → `overweight` field (array or object with a `files` property).
- Any JSON file referenced via `overweight --config path/to/config.json`.

```json
{
  "files": [
    {
      "path": "./dist/vendor.js",
      "maxSize": "30 kB",
      "compression": "gzip",
      "label": "Vendor bundle"
    },
    {
      "path": "./dist/chunk-*.js",
      "maxSize": "10 kB",
      "compression": "brotli"
    }
  ]
}
```

Field reference:

| Field        | Type            | Description                                                                 |
| ------------ | --------------- | --------------------------------------------------------------------------- |
| `path`       | string          | File path or glob resolved from the config root.                            |
| `maxSize`    | string \| number | Accepts units (`10 kB`, `2MiB`). Numbers are treated as raw bytes.          |
| `compression`| string          | Tester id (`gzip`, `brotli`, `none`). Defaults to `gzip`.                   |
| `label`      | string          | Optional human-friendly label used in reports.                              |

## CLI

```sh
pnpm overweight
pnpm overweight --config ./configs/overweight.json
pnpm overweight --reporter json

# quick ad-hoc checks
pnpm overweight --file "dist/*.js" --max-size "15 kB" --compression brotli
```

Available reporters: `console` (default), `json`, `json-file`, `silent`.

```sh
# emit a machine-readable report
pnpm overweight --reporter json-file --report-file ./reports/overweight.json
```

### Baseline tracking

Track sizes against a committed baseline and ignore insignificant build-to-build noise with a
tolerance threshold (see [Baseline tracking with a tolerance threshold](#baseline-tracking-with-a-tolerance-threshold)):

```sh
# compare against a baseline; reports drift but never fails the run
pnpm overweight --baseline ./overweight-report.json

# refresh the baseline locally when a file moves beyond tolerance
pnpm overweight --baseline ./overweight-report.json --update-baseline

# override the default 1% tolerance (fraction = percent, integer/size = absolute bytes)
pnpm overweight --baseline ./overweight-report.json --baseline-threshold "50 B"
pnpm overweight --baseline ./overweight-report.json --baseline-threshold 0   # record every byte
```

| Option | Description |
| --- | --- |
| `--baseline <path>` | Compare current sizes against this baseline JSON. Reports drift; never changes the exit code. |
| `--baseline-threshold <value>` | Tolerance below which a change is ignored. Fraction in `(0,1)` = percent, integer/size string = absolute bytes. Defaults to `0.01` (1%); use `0` to record every byte. |
| `--update-baseline` | Write the reconciled baseline back to `--baseline` when a file drifts beyond tolerance. |

Only each rule's `maxSize` affects the exit code — the baseline is a tracking artifact. Messages
are suppressed for the `json`, `json-file`, and `silent` reporters so machine output stays clean.

## Node API

```js
import { runChecks, normalizeConfig } from "overweight";

const config = normalizeConfig({
  files: [{ path: "./dist/app.js", maxSize: "15 kB", compression: "brotli" }]
});

const result = await runChecks(config, {
  testers: {
    custom: {
      id: "custom",
      label: "custom",
      async measure(buffer) {
        return { bytes: buffer.byteLength / 2 };
      }
    }
  }
});

if (result.stats.hasFailures) {
  throw new Error("Bundle too big!");
}
```

### Exports

| Export                       | Signature                                                          | Purpose                                           |
|------------------------------|--------------------------------------------------------------------|---------------------------------------------------|
| `runChecks`                  | `(config, options?) => Promise<{ results, stats }>`                | Measure files against their `maxSize` rules.      |
| `loadConfig`                 | `({ cwd?, configPath?, inlineConfig? }) => Promise<Config>`        | Resolve + normalize config from disk or inline.   |
| `normalizeConfig`            | `(rawConfig, { cwd?, source? }) => Config`                         | Normalize an in-memory config.                    |
| `listTesters`                | `() => Array<{ id, label }>`                                       | List the built-in testers.                        |
| `parseBaselineThreshold`     | `(value) => { thresholdBytes, thresholdPercent }`                  | Parse a tolerance value; defaults to 1% when unset. |
| `isWithinThreshold`          | `(nextBytes, previousBytes, threshold) => boolean`                 | Whether a size move is within tolerance.          |
| `toBaselineEntries`          | `(runChecksResult) => BaselineEntry[]`                             | Convert a `runChecks` result to baseline entries. |
| `reconcileBaseline`          | `(nextEntries, previousData, threshold?) => { needsUpdate, rows }` | Diff against a stored baseline with tolerance.    |
| `serializeBaselineSnapshot`  | `(entries) => string`                                              | Canonical baseline JSON (sorted by file).         |
| `buildBaselineSnapshot`      | `(entries) => BaselineEntry[]`                                     | Same projection without serializing.              |
| `DEFAULT_BASELINE_THRESHOLD` | `0.01`                                                             | The default tolerance (1%).                       |

A `BaselineEntry` is `{ label, file, tester, size, sizeBytes, limit, limitBytes }`.

### Baseline tracking with a tolerance threshold

Bundlers and minifiers rarely emit byte-identical output across builds (embedded build dates,
filesystem-dependent module ordering, non-seeded identifier mangling). Without a tolerance,
every few-byte wobble looks like a real change. The baseline API lets you track sizes over time
and ignore insignificant noise.

The `threshold` value's shape decides how it is interpreted:

- a bare fraction in `(0, 1)` (e.g. `0.01`) is a **percentage** of the previous size;
- an integer or size string (e.g. `50`, `"50 B"`, `"1 kB"`) is an **absolute** byte tolerance;
- omitting it (or passing `undefined`/`null`/`""`) applies the default `0.01` (1%);
- an explicit `0` disables the tolerance and records every byte.

A file is treated as changed only when `|newSize − previousSize|` exceeds
`max(thresholdBytes, thresholdPercent × previousSize)`. Files within tolerance **retain their
previously recorded size**, so the baseline never drifts or oscillates. A change to a file's
`limit`, `tester`, or `label` — or a file being added/removed — always counts as a change.

```js
import { readFile, writeFile } from "node:fs/promises";
import { runChecks, toBaselineEntries, reconcileBaseline, serializeBaselineSnapshot } from "overweight";

const result = await runChecks(config);
const entries = toBaselineEntries(result);

const previous = await readFile("overweight-report.json", "utf8")
  .then(JSON.parse)
  .catch(() => null); // no baseline yet

// Ignore moves under 1%; pass "50 B" for an absolute tolerance instead.
const { needsUpdate, rows } = reconcileBaseline(entries, previous, 0.01);

if (needsUpdate) {
  await writeFile("overweight-report.json", serializeBaselineSnapshot(rows));
}
```

> The baseline gates nothing on its own — each rule's `maxSize` is the hard regression guard
> (`result.stats.hasFailures`). A generous tolerance never weakens that protection.

## GitHub Action

```yaml
name: bundle-overweight-test

on:
  pull_request:
  push:
    branches: [main]

jobs:
  overweight:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with:
          version: 9
      - run: pnpm install
      - uses: yoavniran/overweight@v1
        with:
          config: overweight.json
          github-token: ${{ secrets.GITHUB_TOKEN }}
          baseline-report-path: overweight-report.json
          update-baseline: true
          report-file: overweight-report.json
```

- `report-json`, `report-table`, and `report-file` outputs enable downstream workflows (PR comments, Slack alerts, artifact uploads, etc.).
- When `baseline-report-path` + `update-baseline` are set, the action regenerates the stored bundle size report on a dedicated update branch (not the branch that triggered the workflow). If `baseline-report-path` is omitted and `report-file` is set, the baseline defaults to that path. The update runs on a dedicated branch + pull request using `update-pr-title`, `update-pr-body`, and `update-branch-prefix`. Use `baseline-protected-branches` (default `main,master`, supports glob patterns) to block updates on protected branches.
- `comment-on-pr-always` (first run only) and `comment-on-pr-each-run` control when PR comments are posted even if checks pass.
- Additional outputs (`report-file`, `baseline-updated`, `baseline-update-pr-url`, `baseline-update-pr-number`) make it easy to chain artifact uploads or follow-up workflows.

### Baseline auto-PR requirements

When `update-baseline: true`, Overweight will:

1. Regenerate the baseline snapshot locally.
2. Create a temporary branch from the PR's base branch.
3. Commit the updated baseline file with the bot identity.
4. Open a pull request targeting the base branch using the configured title/body.

To allow that flow:

- Ensure the workflow grants `contents: write` permission (GitHub defaults to read-only).
- Check out the repository with `actions/checkout@v4` (fetch-depth defaults are fine because commits are created via the GitHub API).
- Pass a `github-token` secret with permission to create branches and PRs in the repository (the default `secrets.GITHUB_TOKEN` works for same-repo PRs).
- Optionally customize `update-pr-title`, `update-pr-body`, and `update-branch-prefix` to fit your repo conventions.
- In the repository settings go to **Settings → Actions → General → Workflow permissions** and enable **Allow GitHub Actions to create and approve pull requests**, otherwise GitHub will block the auto-PR.
- Overweight reuses the same update branch/PR per source PR (branch suffix `pr-<number>`), so subsequent pushes to your feature branch simply update the existing baseline PR instead of opening multiples.
- Use `baseline-protected-branches` to list branches or patterns (comma-separated) where baseline updates are forbidden; the default `main,master` protects the typical default branches.
- Manual workflows triggered on a feature branch automatically detect the open PR for that branch and reuse its baseline update PR instead of opening a new one.
- Baseline updates occur only when all size checks pass. Failing runs skip the baseline refresh entirely to avoid locking in broken results.

### Tolerance thresholds (avoiding noisy baseline PRs)

Minifiers and bundlers rarely produce byte-identical output across builds — embedded
build dates, filesystem-dependent module ordering, and non-seeded identifier mangling all
shift the compressed size by a few bytes even when no source changed. Without a tolerance,
every such wobble opens a baseline PR.

Use the `baseline-threshold` input to require a change to exceed a tolerance before the
baseline is rewritten. Its value's shape decides how it's interpreted:

```yaml
      - uses: yoavniran/overweight@v1
        with:
          # ...
          update-baseline: true
          baseline-threshold: 0.01   # a fraction in (0,1) -> percentage of previous size (1%)
          # baseline-threshold: "50 B"  # an integer or size string -> absolute bytes
```

- A bare fraction between `0` and `1` (e.g. `0.01`) is a **percentage** of the previous size.
- An integer or size string (e.g. `50`, `"50 B"`, `"1 kB"`) is an **absolute** byte tolerance.
- A file is only treated as changed when `|newSize − previousSize|` exceeds that tolerance.
- Files within tolerance **retain their previously recorded size**, so the baseline never
  drifts or oscillates run-to-run.
- A change in a file's `limit`, tester, or label — or a file being added/removed — always
  updates the baseline regardless of tolerance.
- Defaults to `0.01` (1%). Set to `0` to record every byte.
- Your real regression guard is each rule's `maxSize`; the baseline file gates nothing, so a
  generous tolerance does not weaken protection.


## Release & contributing

- The project is ESM-only and built via `tsup`
- Conventional commits are enforced via `simple-git-hooks` + `commitlint`.
- `semantic-release` uses the **conventionalcommits** preset, so a `!` after the type/scope
  (e.g. `feat!: …`, `chore!: …`) or a `BREAKING CHANGE:` footer triggers a **major** bump.
  `feat:` → minor, `fix:`/`perf:` → patch; `chore`/`refactor`/`docs` alone trigger no release.
- `pnpm run release` triggers `semantic-release`, which:
  - Checks commit history,
  - Updates the changelog,
  - Publishes to npm,
  - Creates a GitHub release/tag.
- After each non-dry release run the workflow force-updates a moving major tag (e.g. `v1`) so consumers can reference `yoavniran/overweight@v1` for the latest release in that major line.
- `.github/workflows/release.yml` exposes a `dry-run` workflow input (defaults to `true`) so manual dispatches preview semantic-release without mutating tags or npm. Set the field to `false` to publish for real, e.g.:

```
gh workflow run "Overweight Release" \
  --ref release-main \
  --field dry-run=false
```

### Syncing tags

Since the release workflow force-updates major tags (e.g., `v1`), when syncing your local repository you may encounter tag conflicts. To sync tags properly:

```sh
# Recommended: Use the sync-tags script
pnpm run sync-tags

# Or manually force-update all tags from remote
git fetch --tags --force

# Alternative: Delete conflicting tag and re-fetch
git tag -d v1 && git fetch origin tag v1
```


MIT License © Yoav Niran.

