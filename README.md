# Overweight

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

- `overweight.json` at the project root (default when the CLI runs without args).
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

Available reporters: `console` (default), `json`, `silent`.

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
      - uses: yoavniran/overweight@v1 after publishing
        with:
          config: overweight.config.json
          github-token: ${{ secrets.GITHUB_TOKEN }}
          baseline-path: overweight-report.json
          baseline-branch: main
          update-baseline: true
```

- `report-json` and `report-table` outputs enable downstream workflows (PR comments, Slack alerts, etc.).
- When `baseline-path` + `update-baseline` are set, the action refreshes the stored bundle size report on the baseline branch, mirroring the workflow React Uploady uses today.

## Release & contributing

- The project is ESM-only and built via `tsup`
- Conventional commits are enforced via `simple-git-hooks` + `commitlint`.
- `pnpm run release` triggers `semantic-release`, which:
  - Checks commit history,
  - Updates the changelog,
  - Publishes to npm,
  - Creates a GitHub release/tag.

MIT License © Yoav Niran.

