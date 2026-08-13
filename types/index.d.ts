/**
 * Type definitions for the `overweight` Node API (`src/index.js`).
 *
 * The runtime is plain ESM JavaScript; these declarations are hand-maintained
 * and must be kept in sync with the exports of `src/index.js`.
 */

/** Ids of the built-in testers. Custom testers may register any id. */
export type BuiltinTesterId = "none" | "gzip" | "brotli";

/**
 * A tester id. Built-in ids are suggested by autocomplete while any custom id
 * registered through {@link RunChecksOptions.testers} remains valid.
 */
export type TesterId = BuiltinTesterId | (string & {});

/** A byte count (`1024`) or a human-readable size string (`"12 kB"`, `"1.5mb"`). */
export type SizeInput = string | number;

/** A single file rule as authored in an overweight config. */
export interface FileRule {
  /** Path or glob, resolved against the config `root`. */
  path: string;
  /** Maximum allowed measured size. Required by the config schema. */
  maxSize: SizeInput;
  /** Tester id for this rule. Defaults to the config `defaultCompression`. */
  compression?: TesterId;
  /** Display name. Defaults to `path`. */
  label?: string;
}

/** The object form of an overweight config. */
export interface OverweightConfig {
  /** Directory globs resolve against. Defaults to the resolution `cwd`. */
  root?: string;
  /** Tester used by rules that omit `compression`. Defaults to `"gzip"`. */
  defaultCompression?: TesterId;
  files: FileRule[];
}

/** A config as accepted by the API: the object form, or a bare array of rules. */
export type OverweightConfigInput = OverweightConfig | FileRule[];

/** Where a config was resolved from. */
export interface ConfigSource {
  type: "inline" | "file" | "package" | (string & {});
  /** Absolute path of the file the config came from, when applicable. */
  location?: string;
}

/** A file rule after normalization: sizes parsed, defaults applied. */
export interface NormalizedFileRule {
  path: string;
  /** Same value as `path`; the glob handed to the file resolver. */
  pattern: string;
  label: string;
  compression: TesterId;
  /** `maxSize` parsed to exact bytes. */
  maxBytes: number;
  /** The original, unparsed `maxSize`. */
  maxSizeInput: SizeInput;
  /** The authored size string when given, otherwise the formatted byte count. */
  maxDisplay: string;
  /** `maxBytes` rendered human-readable. */
  maxFormatted: string;
}

/**
 * A config that has been through {@link normalizeConfig}. `runChecks` detects
 * these and skips re-normalizing.
 */
export interface NormalizedConfig {
  /** Absolute root directory. */
  root: string;
  defaultCompression: TesterId;
  files: NormalizedFileRule[];
  source: ConfigSource;
}

export interface NormalizeConfigOptions {
  /** Directory that `root` and default lookups resolve against. Defaults to `process.cwd()`. */
  cwd?: string;
  source?: ConfigSource;
}

export interface LoadConfigOptions {
  cwd?: string;
  /** Explicit config file path, resolved against `cwd`. */
  configPath?: string;
  /** Config object/array to use instead of reading from disk. */
  inlineConfig?: OverweightConfigInput;
}

/** Context passed to a tester alongside the file contents. */
export interface TesterContext {
  /** Absolute path of the file being measured. */
  filePath: string;
  /** The glob that matched it. */
  pattern: string;
}

export interface TesterMeasurement {
  bytes: number;
}

/** A measurement strategy. Built-ins: `none`, `gzip`, `brotli`. */
export interface Tester {
  id: TesterId;
  /** Display name. Defaults to `id`. */
  label?: string;
  measure(
    buffer: Uint8Array,
    context: TesterContext,
  ): TesterMeasurement | Promise<TesterMeasurement>;
}

interface CheckResultBase {
  /** The glob that produced this row. */
  pattern: string;
  label: string;
  tester: TesterId;
  testerLabel: string;
  sizeFormatted: string;
  /** The rule's limit in exact bytes. */
  maxSize: number;
  maxSizeFormatted: string;
  diffFormatted: string;
  passed: boolean;
}

/** A row for a file that was found and measured. */
export interface MeasuredCheckResult extends CheckResultBase {
  /** Path relative to the config `root`. */
  filePath: string;
  absolutePath: string;
  /** Measured size in bytes. */
  size: number;
  /** `size - maxSize`; negative means headroom. */
  diff: number;
  passed: boolean;
  error?: undefined;
}

/** A row for a glob that matched no file. Always counts as a failure. */
export interface MissingCheckResult extends CheckResultBase {
  /** Falls back to the unmatched pattern. */
  filePath: string;
  absolutePath?: undefined;
  size: null;
  diff: null;
  passed: false;
  error: string;
}

/** One row per matched file — a single rule can yield many. */
export type CheckResult = MeasuredCheckResult | MissingCheckResult;

export interface RunChecksStats {
  /** Total number of result rows. */
  files: number;
  /** Rows that exceeded their limit or errored. */
  failures: CheckResult[];
  hasFailures: boolean;
  /** True when at least one failure carries an `error` (e.g. an unmatched glob). */
  hasErrors: boolean;
}

export interface RunChecksResult {
  results: CheckResult[];
  stats: RunChecksStats;
}

export interface RunChecksOptions {
  /** Custom testers, merged over the built-ins. Keyed by id (the tester's own `id` wins). */
  testers?: Record<string, Tester> | Map<string, Tester>;
}

/**
 * Resolve a config: inline value, explicit path, or the search order
 * `overweight.json` → `overweight.config.json` → `package.json#overweight`.
 * @throws When no config is found or the file is invalid.
 */
export function loadConfig(options?: LoadConfigOptions): Promise<NormalizedConfig>;

/**
 * Validate a raw config and resolve roots, sizes, labels, and tester ids.
 * @throws When the config fails schema validation or a size is unparseable.
 */
export function normalizeConfig(
  rawConfig: OverweightConfigInput,
  options?: NormalizeConfigOptions,
): NormalizedConfig;

/** Measure every file matched by the config against its `maxSize` rule. */
export function runChecks(
  config: OverweightConfigInput | NormalizedConfig,
  options?: RunChecksOptions,
): Promise<RunChecksResult>;

/** The built-in testers. */
export function listTesters(): Array<{ id: BuiltinTesterId; label: string }>;

/* ---------------------------------- baseline --------------------------------- */

/** Default baseline tolerance: 1% of the previously recorded size. */
export const DEFAULT_BASELINE_THRESHOLD: number;

/** The serializable shape stored in a baseline file, keyed by `file`. */
export interface BaselineEntry {
  label: string;
  /** Path relative to the config `root`; the entry key. */
  file: string;
  tester: string;
  /** Human-readable measured size. */
  size: string;
  sizeBytes: number;
  /** Human-readable limit. */
  limit: string;
  limitBytes: number;
}

/** A parsed tolerance: `max(thresholdBytes, thresholdPercent * previousBytes)`. */
export interface BaselineThreshold {
  thresholdBytes: number;
  thresholdPercent: number;
}

/** A tolerance as a raw value or an already-parsed descriptor. */
export type BaselineThresholdInput = string | number | BaselineThreshold;

/**
 * Parse a tolerance by shape: a bare fraction in `(0, 1)` is a percentage,
 * anything else (integer or size string) is absolute bytes. Omitted uses
 * {@link DEFAULT_BASELINE_THRESHOLD}; `0` disables the tolerance.
 * @throws When the value is negative or not a valid size.
 */
export function parseBaselineThreshold(value?: string | number | null): BaselineThreshold;

/** Whether a size move is small enough to count as unchanged. */
export function isWithinThreshold(
  nextBytes: number,
  previousBytes: number,
  threshold: BaselineThresholdInput,
): boolean;

/** Convert a `runChecks` result to baseline entries, skipping unmeasured rows. */
export function toBaselineEntries(result: RunChecksResult): BaselineEntry[];

/** Project rows down to the {@link BaselineEntry} shape, sorted by `file`. */
export function buildBaselineSnapshot(entries: BaselineEntry[]): BaselineEntry[];

/** Serialize entries into the canonical baseline JSON document. */
export function serializeBaselineSnapshot(entries: BaselineEntry[]): string;

export interface ReconcileBaselineResult {
  /** Whether the baseline file should be rewritten. */
  needsUpdate: boolean;
  /** Reconciled entries: within-tolerance files keep their previous values. */
  rows: BaselineEntry[];
}

/**
 * Compare fresh entries against a stored snapshot. Files that moved within
 * tolerance retain their recorded values; moves beyond tolerance, metadata
 * changes, and added/removed files mark the snapshot dirty.
 */
export function reconcileBaseline(
  nextEntries: BaselineEntry[],
  previousData: BaselineEntry[] | null,
  threshold?: BaselineThresholdInput,
): ReconcileBaselineResult;
