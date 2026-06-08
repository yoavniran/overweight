# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`overweight` is an ESM-only bundle size guard published to npm. A single `src/` tree
produces three consumable surfaces, all sharing the same core engine:

- **Node API** (`src/index.js` → `dist/index.js`) — `loadConfig`, `normalizeConfig`, `runChecks`,
  `listTesters`, plus the baseline primitives re-exported from `src/core/baseline.js`
  (`parseBaselineThreshold`, `isWithinThreshold`, `toBaselineEntries`, `reconcileBaseline`,
  `serializeBaselineSnapshot`, `buildBaselineSnapshot`, `DEFAULT_BASELINE_THRESHOLD`).
- **CLI** (`src/cli.js` → `dist/cli.js`, bin `overweight`) — built on `cac`. Supports baseline
  tracking via `--baseline`, `--baseline-threshold`, `--update-baseline` (orchestrated by
  `src/cli/baseline-sync.js`'s `syncBaseline`, which returns a status the CLI renders). Drift
  never affects the exit code; messages are suppressed for quiet reporters.
- **GitHub Action** (`src/action/index.js` → `dist/action/index.js`) — entry referenced by `action.yml`.

## Commands

- `pnpm test` — run all tests once (vitest). `pnpm test:watch` for watch mode.
- `pnpm vitest run tests/run-checks.spec.js` — run a single test file.
- `pnpm vitest run -t "name"` — run tests matching a name.
- `pnpm build` — bundle with tsup into `dist/`.
- `pnpm check` — `test` + `build`; run this before considering work done.
- `pnpm dogfood` — build then run the CLI against this repo's own `overweight.json`.

Use **pnpm only** (enforced by `packageManager` + cursor rule). Node >= 20.

## Build specifics (tsup.config.mjs)

Two separate build configs run in sequence:
1. `index` + `cli` — runtime `dependencies` are kept **external** (not bundled).
2. `action/index` — bundles **everything** (`noExternal: [/.*/]`) into one self-contained file,
   with a banner that reconstructs `require`/`__dirname`/`__filename` so CommonJS deps
   (`@actions/*`) work inside the ESM output. The action build runs with `clean: false` so it
   doesn't wipe the first build's output.

No `dts` is emitted. The package is `"type": "module"` and ESM-only.

## Core engine flow (src/core/run-checks.js)

`runChecks(config, options)` is the heart shared by all three surfaces:
1. Normalizes the config if not already normalized (config carries a `Symbol.for("overweight.normalizedConfig")` flag — `isNormalizedConfig` checks it to avoid re-normalizing).
2. Builds a tester registry (built-ins + any `options.testers` overrides).
3. For each file rule: resolves the glob via `resolveFiles` (fast-glob), reads each match, calls `tester.measure(buffer)`, compares measured bytes against `maxBytes`.
4. Unmatched globs become a "missing" result with `error` set (counts as a failure).
5. Returns `{ results, stats: { files, failures, hasFailures, hasErrors } }`.

Every glob match is tracked as its own result row — one rule can yield many results.

## Configuration resolution (src/config/load-config.js)

`loadConfig` search order when no inline/explicit path: `overweight.json` →
`overweight.config.json` → `package.json` `overweight` field. Config may be an array
(shorthand for `{ files: [...] }`) or an object. Validated with **zod** (`ConfigSchema`).
`normalizeConfig` resolves roots, parses sizes (`parseSize` in `src/utils/size.js`), and
lowercases compression ids.

## Testers (src/testers/)

A tester is `{ id, label, measure(buffer, ctx) => { bytes } }`. Built-ins: `none`, `gzip`
(default), `brotli`. `createTesterRegistry` merges custom testers (passed via the Node API's
`options.testers`) over the built-ins. To add a built-in, create the file and register it in
`src/testers/index.js`; add its id to `NORMALIZED_TOKENS` in `shared.js` if it should be
case-normalized.

## Reporters (src/reporters/)

`getReporter(name, options)` maps `console` | `json` | `json-file` | `silent` to a function
taking the `runChecks` result. The CLI exits with code 1 when `stats.hasFailures`.

## GitHub Action baseline workflow (src/action/)

The action runs checks, writes a JSON report, posts/updates a PR comment, and optionally
maintains a **baseline** file. Key behavior to preserve when editing:
- Baseline updates are committed to a **dedicated branch + auto-PR** (via the GitHub API,
  `src/action/github.js` + `git.js`), never to the triggering branch.
- Baseline updates are **skipped when checks fail** and on **protected branches**
  (`baseline-protected-branches`, default `main,master`, glob-aware — `branch.js`).
- Baseline rewrites are gated by a single **tolerance threshold** (`baseline-threshold`,
  default `0.01`) to absorb non-deterministic build noise. The pure logic plus baseline file IO
  (`readBaselineState`, `writeBaseline`) live in `src/core/baseline.js` (Node API surface);
  `src/action/baseline.js` re-exports them and adds the GitHub-specific bits
  (`mergeWithBaseline`, `ensureRelativePath`, `getWorkspaceRoot`). `parseBaselineThreshold`
  interprets the value by shape: a bare
  fraction in `(0,1)` → percentage, anything else (integer / size string) → absolute bytes,
  yielding `{thresholdBytes, thresholdPercent}`. `reconcileBaseline(nextEntries, previousData,
  threshold)` (threshold may be raw or a parsed descriptor) compares each entry against the
  stored snapshot: files within `max(thresholdBytes, thresholdPercent × previousBytes)`
  **retain their previous recorded value** (no drift/oscillation), while size moves beyond
  tolerance, limit/tester/label changes, or added/removed files mark the snapshot dirty.
  `toBaselineEntries(runChecksResult)` converts core results into the `BaselineEntry` shape.
  The `maxSize` rule — not the baseline — is the real regression guard, so the tolerance never
  weakens protection.
- The update branch/PR is reused per source PR (suffix `pr-<number>`) so pushes don't open duplicates.
- Module split: `config.js` (input parsing), `baseline.js` (read/merge/write baseline state),
  `branch.js` (branch naming + protection), `git.js` (branch creation), `github.js` (octokit
  calls), `report.js` (summary rows / table / HTML rendering), `index.js` (orchestration).

Action inputs/outputs are declared in `action.yml` — keep it in sync with `core.getInput`/
`core.setOutput` calls in `index.js`.

## Conventions

These are mandatory project rules — adhere to all of them.

- **Package manager**: use **pnpm** only, never npm or yarn, for any package-manager operation.
- **Commits**: conventional commits, enforced by commitlint via a `commit-msg` git hook.
  Keep messages terse and technical — short sentences only.
  - Header < 100 chars (commitlint `header-max-length`). If more detail is needed, add a
    blank line after the header followed by a short body.
  - No line in any part of the message may exceed 100 chars (`body-max-line-length`).
  - Pick a verb that maps to the intended semver bump (semantic-release drives publishing):
    every user-facing commit (code or docs change) should translate to a new version. For
    workflow-only changes that don't affect library consumers, use `chore`/`refactor` so no
    version bump is triggered.
- **Design / code style**:
  - Design functions and components as generic **pure functions**: receive input, operate on
    it, return a result. Avoid mutating global state as much as possible.
  - Keep functions and components compact and short, each handling a **single concern**.
  - Avoid large files — split per concern/component into separate, well-named files and import
    them rather than inlining.
  - For React components, keep state as close as possible to where it's used to avoid
    re-rendering large sections.
- **Comments**: add a comment only when it's genuinely valuable. Never write a comment that
  merely restates what the code does — comments should add non-obvious contextual information
  that can't be recognized by reading the code.
- **Tests**: vitest, in `tests/`. Every file and function with logic should be covered by unit
  tests that mock input data and assert the expected output, with **all branches covered**. The
  action is tested with `NODE_ENV=test` (the entry guards its auto-run on this).
- **Docs**: every feature and external API should be documented with its properties/fields and
  with code examples.
- **Releases**: `semantic-release` (`release.config.mjs`). After release a moving major tag
  (e.g. `v1`) is force-updated. Use `pnpm run sync-tags` to reconcile local tags.
