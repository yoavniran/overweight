/**
 * Compile-time only: `pnpm run typecheck` fails if the public typings drift.
 * Nothing here is executed by vitest.
 */
import {
  DEFAULT_BASELINE_THRESHOLD,
  buildBaselineSnapshot,
  isWithinThreshold,
  listTesters,
  loadConfig,
  normalizeConfig,
  parseBaselineThreshold,
  reconcileBaseline,
  runChecks,
  serializeBaselineSnapshot,
  toBaselineEntries,
  type BaselineEntry,
  type CheckResult,
  type OverweightConfig,
  type Tester
} from "overweight";

const expectType = <T>(_value: T): void => {};

const config: OverweightConfig = {
  root: "dist",
  defaultCompression: "brotli",
  files: [
    { path: "*.js", maxSize: "12 kB" },
    { path: "*.css", maxSize: 4096, compression: "gzip", label: "styles" }
  ]
};

// array shorthand is a valid config input
const shorthand = normalizeConfig([{ path: "dist/*.js", maxSize: "1 kB" }]);
expectType<string>(shorthand.root);
expectType<number>(shorthand.files[0].maxBytes);

const customTester: Tester = {
  id: "raw-copy",
  label: "Raw copy",
  measure: async (buffer) => ({ bytes: buffer.byteLength })
};

const run = async () => {
  const normalized = normalizeConfig(config, { cwd: "/tmp/project" });
  const loaded = await loadConfig({ cwd: "/tmp/project", configPath: "overweight.json" });
  expectType<string>(loaded.source.type);

  // accepts raw, normalized, and custom tester ids
  await runChecks(config);
  const result = await runChecks(normalized, {
    testers: { "raw-copy": customTester }
  });
  await runChecks(config, { testers: new Map([["raw-copy", customTester]]) });

  expectType<boolean>(result.stats.hasFailures);
  expectType<number>(result.stats.files);
  expectType<CheckResult[]>(result.stats.failures);

  const [entry] = result.results;
  expectType<number | null>(entry.size);
  expectType<string | undefined>(entry.error);

  // the union narrows on `error`
  if (entry.error !== undefined) {
    expectType<null>(entry.size);
  } else {
    expectType<number>(entry.size);
    expectType<string>(entry.absolutePath);
  }

  const entries: BaselineEntry[] = toBaselineEntries(result);
  expectType<string>(serializeBaselineSnapshot(buildBaselineSnapshot(entries)));

  const threshold = parseBaselineThreshold("1 kB");
  expectType<number>(threshold.thresholdPercent);
  expectType<boolean>(isWithinThreshold(10, 12, threshold));
  expectType<boolean>(isWithinThreshold(10, 12, DEFAULT_BASELINE_THRESHOLD));

  // threshold accepts raw values, parsed descriptors, and omission
  reconcileBaseline(entries, null);
  reconcileBaseline(entries, entries, "0.05");
  const { needsUpdate, rows } = reconcileBaseline(entries, entries, threshold);
  expectType<boolean>(needsUpdate);
  expectType<BaselineEntry[]>(rows);

  expectType<Array<{ id: "none" | "gzip" | "brotli"; label: string }>>(listTesters());
};

void run;
