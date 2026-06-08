import { describe, it, expect } from "vitest";

import {
  parseBaselineThresholds,
  reconcileBaseline,
  serializeBaselineSnapshot,
  DEFAULT_BASELINE_THRESHOLD_PERCENT
} from "../../src/action/baseline.js";

const row = (overrides = {}) => ({
  label: "core",
  file: "dist/core.js",
  tester: "gzip",
  size: "10 kB",
  sizeBytes: 10000,
  limit: "11 kB",
  limitBytes: 11000,
  ...overrides
});

describe("parseBaselineThresholds", () => {
  it("defaults to no tolerance when nothing is provided", () => {
    expect(parseBaselineThresholds()).toEqual({ thresholdBytes: 0, thresholdPercent: 0 });
    expect(parseBaselineThresholds({})).toEqual({ thresholdBytes: 0, thresholdPercent: 0 });
  });

  it("treats empty strings as unset", () => {
    expect(parseBaselineThresholds({ absolute: "", percent: "  " })).toEqual({
      thresholdBytes: 0,
      thresholdPercent: 0
    });
  });

  it("parses absolute size strings via parseSize", () => {
    expect(parseBaselineThresholds({ absolute: "50 B" })).toEqual({
      thresholdBytes: 50,
      thresholdPercent: 0
    });
    expect(parseBaselineThresholds({ absolute: "1 kB" }).thresholdBytes).toBe(1000);
  });

  it("parses fractional percent values", () => {
    expect(parseBaselineThresholds({ percent: "0.01" }).thresholdPercent).toBe(0.01);
    expect(parseBaselineThresholds({ percent: 0 }).thresholdPercent).toBe(0);
    expect(parseBaselineThresholds({ percent: 1 }).thresholdPercent).toBe(1);
  });

  it("throws when percent is out of range", () => {
    expect(() => parseBaselineThresholds({ percent: "1.5" })).toThrow(/between 0 and 1/);
    expect(() => parseBaselineThresholds({ percent: "-0.1" })).toThrow(/between 0 and 1/);
    expect(() => parseBaselineThresholds({ percent: "abc" })).toThrow(/between 0 and 1/);
  });

  it("throws when absolute is negative", () => {
    expect(() => parseBaselineThresholds({ absolute: "-10" })).toThrow(/greater than or equal to zero/);
  });

  it("exposes the documented default percent", () => {
    expect(DEFAULT_BASELINE_THRESHOLD_PERCENT).toBe(0.01);
  });
});

describe("reconcileBaseline", () => {
  const noTolerance = { thresholdBytes: 0, thresholdPercent: 0 };

  it("treats a missing baseline as needing a full write", () => {
    const next = [row()];
    expect(reconcileBaseline(next, null, noTolerance)).toEqual({ needsUpdate: true, rows: next });
  });

  it("flags any byte change when no tolerance is configured", () => {
    const next = [row({ sizeBytes: 10001 })];
    const previous = [row({ sizeBytes: 10000 })];
    const result = reconcileBaseline(next, previous, noTolerance);
    expect(result.needsUpdate).toBe(true);
    expect(result.rows[0].sizeBytes).toBe(10001);
  });

  it("retains previous values when the change is within absolute tolerance", () => {
    const next = [row({ sizeBytes: 10040, size: "10 kB" })];
    const previous = [row({ sizeBytes: 10000, size: "10 kB" })];
    const result = reconcileBaseline(next, previous, { thresholdBytes: 50, thresholdPercent: 0 });
    expect(result.needsUpdate).toBe(false);
    expect(result.rows[0].sizeBytes).toBe(10000);
  });

  it("retains previous values when the change is within percent tolerance", () => {
    const next = [row({ sizeBytes: 10090 })]; // +0.9% of 10000
    const previous = [row({ sizeBytes: 10000 })];
    const result = reconcileBaseline(next, previous, { thresholdBytes: 0, thresholdPercent: 0.01 });
    expect(result.needsUpdate).toBe(false);
    expect(result.rows[0].sizeBytes).toBe(10000);
  });

  it("updates when the change exceeds tolerance", () => {
    const next = [row({ sizeBytes: 10200 })]; // +2% of 10000
    const previous = [row({ sizeBytes: 10000 })];
    const result = reconcileBaseline(next, previous, { thresholdBytes: 0, thresholdPercent: 0.01 });
    expect(result.needsUpdate).toBe(true);
    expect(result.rows[0].sizeBytes).toBe(10200);
  });

  it("uses the larger of absolute and percent tolerance", () => {
    // 5% of 10000 = 500; absolute 50 is smaller, so percent governs
    const next = [row({ sizeBytes: 10300 })];
    const previous = [row({ sizeBytes: 10000 })];
    const result = reconcileBaseline(next, previous, { thresholdBytes: 50, thresholdPercent: 0.05 });
    expect(result.needsUpdate).toBe(false);
    expect(result.rows[0].sizeBytes).toBe(10000);
  });

  it("retains within-tolerance files but updates ones that cross, in a mixed set", () => {
    const next = [
      row({ file: "a.js", sizeBytes: 10040 }), // within
      row({ file: "b.js", sizeBytes: 20500 }) // crosses
    ];
    const previous = [
      row({ file: "a.js", sizeBytes: 10000 }),
      row({ file: "b.js", sizeBytes: 20000 })
    ];
    const result = reconcileBaseline(next, previous, { thresholdBytes: 0, thresholdPercent: 0.01 });
    expect(result.needsUpdate).toBe(true);
    const byFile = Object.fromEntries(result.rows.map((r) => [r.file, r.sizeBytes]));
    expect(byFile["a.js"]).toBe(10000); // retained
    expect(byFile["b.js"]).toBe(20500); // updated
  });

  it("flags new files as a change", () => {
    const next = [row({ file: "a.js" }), row({ file: "new.js" })];
    const previous = [row({ file: "a.js" })];
    const result = reconcileBaseline(next, previous, { thresholdBytes: 0, thresholdPercent: 0.5 });
    expect(result.needsUpdate).toBe(true);
    expect(result.rows.map((r) => r.file)).toEqual(["a.js", "new.js"]);
  });

  it("flags removed files as a change", () => {
    const next = [row({ file: "a.js" })];
    const previous = [row({ file: "a.js" }), row({ file: "gone.js" })];
    const result = reconcileBaseline(next, previous, { thresholdBytes: 0, thresholdPercent: 0.5 });
    expect(result.needsUpdate).toBe(true);
    expect(result.rows.map((r) => r.file)).toEqual(["a.js"]);
  });

  it("flags a limit change even when size is within tolerance", () => {
    const next = [row({ sizeBytes: 10000, limitBytes: 12000, limit: "12 kB" })];
    const previous = [row({ sizeBytes: 10000, limitBytes: 11000, limit: "11 kB" })];
    const result = reconcileBaseline(next, previous, { thresholdBytes: 0, thresholdPercent: 0.5 });
    expect(result.needsUpdate).toBe(true);
    expect(result.rows[0].limitBytes).toBe(12000);
  });

  it("flags tester or label changes even when size is within tolerance", () => {
    const testerChange = reconcileBaseline(
      [row({ tester: "brotli" })],
      [row({ tester: "gzip" })],
      { thresholdBytes: 0, thresholdPercent: 0.5 }
    );
    expect(testerChange.needsUpdate).toBe(true);

    const labelChange = reconcileBaseline(
      [row({ label: "renamed" })],
      [row({ label: "core" })],
      { thresholdBytes: 0, thresholdPercent: 0.5 }
    );
    expect(labelChange.needsUpdate).toBe(true);
  });

  it("treats a missing previous sizeBytes as zero", () => {
    const next = [row({ sizeBytes: 100 })];
    const previous = [row({ sizeBytes: undefined })];
    const result = reconcileBaseline(next, previous, { thresholdBytes: 50, thresholdPercent: 0 });
    expect(result.needsUpdate).toBe(true);
  });

  it("defaults to zero tolerance when thresholds are omitted", () => {
    const result = reconcileBaseline([row({ sizeBytes: 10001 })], [row({ sizeBytes: 10000 })]);
    expect(result.needsUpdate).toBe(true);
  });

  it("serializes reconciled rows into a sorted snapshot", () => {
    const result = reconcileBaseline(
      [row({ file: "b.js" }), row({ file: "a.js" })],
      null,
      noTolerance
    );
    const parsed = JSON.parse(serializeBaselineSnapshot(result.rows));
    expect(parsed.map((r) => r.file)).toEqual(["a.js", "b.js"]);
  });
});
