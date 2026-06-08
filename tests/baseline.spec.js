import { describe, it, expect } from "vitest";

import {
  parseBaselineThreshold,
  isWithinThreshold,
  toBaselineEntries,
  buildBaselineSnapshot,
  reconcileBaseline,
  serializeBaselineSnapshot,
  DEFAULT_BASELINE_THRESHOLD
} from "../src/core/baseline.js";

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

describe("parseBaselineThreshold", () => {
  it("applies the default (1%) when no value is provided", () => {
    const expected = { thresholdBytes: 0, thresholdPercent: DEFAULT_BASELINE_THRESHOLD };
    expect(parseBaselineThreshold()).toEqual(expected);
    expect(parseBaselineThreshold(null)).toEqual(expected);
    expect(parseBaselineThreshold("")).toEqual(expected);
    expect(parseBaselineThreshold("  ")).toEqual(expected);
  });

  it("treats an explicit 0 as disabled, distinct from omitting the value", () => {
    expect(parseBaselineThreshold("0")).toEqual({ thresholdBytes: 0, thresholdPercent: 0 });
    expect(parseBaselineThreshold(0)).toEqual({ thresholdBytes: 0, thresholdPercent: 0 });
    expect(parseBaselineThreshold("0.0")).toEqual({ thresholdBytes: 0, thresholdPercent: 0 });
  });

  it("treats a bare fraction in (0, 1) as a percentage", () => {
    expect(parseBaselineThreshold("0.01")).toEqual({ thresholdBytes: 0, thresholdPercent: 0.01 });
    expect(parseBaselineThreshold(0.5)).toEqual({ thresholdBytes: 0, thresholdPercent: 0.5 });
  });

  it("treats integers as absolute bytes", () => {
    expect(parseBaselineThreshold("50")).toEqual({ thresholdBytes: 50, thresholdPercent: 0 });
    expect(parseBaselineThreshold(100)).toEqual({ thresholdBytes: 100, thresholdPercent: 0 });
  });

  it("treats 1 as an absolute byte, not 100%", () => {
    expect(parseBaselineThreshold("1")).toEqual({ thresholdBytes: 1, thresholdPercent: 0 });
  });

  it("treats size strings with units as absolute bytes", () => {
    expect(parseBaselineThreshold("50 B")).toEqual({ thresholdBytes: 50, thresholdPercent: 0 });
    expect(parseBaselineThreshold("1 kB").thresholdBytes).toBe(1000);
  });

  it("throws on negative numbers", () => {
    expect(() => parseBaselineThreshold("-10")).toThrow(/greater than or equal to zero/);
    expect(() => parseBaselineThreshold("-0.5")).toThrow(/greater than or equal to zero/);
  });

  it("throws on non-numeric, non-size values", () => {
    expect(() => parseBaselineThreshold("abc")).toThrow();
  });

  it("exposes the documented default threshold", () => {
    expect(DEFAULT_BASELINE_THRESHOLD).toBe(0.01);
  });
});

describe("isWithinThreshold", () => {
  it("accepts a raw value and parses it", () => {
    expect(isWithinThreshold(10090, 10000, 0.01)).toBe(true); // +0.9% within 1%
    expect(isWithinThreshold(10200, 10000, 0.01)).toBe(false); // +2% beyond 1%
  });

  it("accepts a pre-parsed descriptor", () => {
    expect(isWithinThreshold(10040, 10000, { thresholdBytes: 50, thresholdPercent: 0 })).toBe(true);
    expect(isWithinThreshold(10060, 10000, { thresholdBytes: 50, thresholdPercent: 0 })).toBe(false);
  });

  it("uses the larger of absolute and percent tolerance", () => {
    expect(isWithinThreshold(10300, 10000, { thresholdBytes: 50, thresholdPercent: 0.05 })).toBe(true);
  });
});

describe("toBaselineEntries", () => {
  it("maps measured runChecks results to baseline entries", () => {
    const result = {
      results: [
        {
          label: "core",
          filePath: "dist/core.js",
          testerLabel: "gzip",
          size: 10000,
          sizeFormatted: "10 kB",
          maxSize: 11000,
          maxSizeFormatted: "11 kB"
        }
      ]
    };
    expect(toBaselineEntries(result)).toEqual([
      {
        label: "core",
        file: "dist/core.js",
        tester: "gzip",
        size: "10 kB",
        sizeBytes: 10000,
        limit: "11 kB",
        limitBytes: 11000
      }
    ]);
  });

  it("skips errored / missing results without a numeric size", () => {
    const result = {
      results: [
        { label: "ok", filePath: "a.js", testerLabel: "gzip", size: 100, sizeFormatted: "100 B", maxSize: 200, maxSizeFormatted: "200 B" },
        { label: "missing", filePath: "b.js", testerLabel: "gzip", size: null, error: "No files matched this pattern" }
      ]
    };
    expect(toBaselineEntries(result).map((e) => e.file)).toEqual(["a.js"]);
  });

  it("tolerates a missing results array", () => {
    expect(toBaselineEntries(undefined)).toEqual([]);
    expect(toBaselineEntries({})).toEqual([]);
  });
});

describe("buildBaselineSnapshot", () => {
  it("projects to the entry shape and sorts by file", () => {
    const snapshot = buildBaselineSnapshot([
      row({ file: "b.js", extra: "dropped" }),
      row({ file: "a.js" })
    ]);
    expect(snapshot.map((e) => e.file)).toEqual(["a.js", "b.js"]);
    expect(snapshot[0]).not.toHaveProperty("extra");
  });
});

describe("reconcileBaseline", () => {
  it("treats a missing baseline as needing a full write", () => {
    const next = [row()];
    expect(reconcileBaseline(next, null, 0.01)).toEqual({ needsUpdate: true, rows: next });
  });

  it("flags any byte change when tolerance is explicitly disabled with 0", () => {
    const result = reconcileBaseline([row({ sizeBytes: 10001 })], [row({ sizeBytes: 10000 })], 0);
    expect(result.needsUpdate).toBe(true);
    expect(result.rows[0].sizeBytes).toBe(10001);
  });

  it("applies the 1% default tolerance when no threshold is passed", () => {
    // +0.5% is within the default 1%
    const result = reconcileBaseline([row({ sizeBytes: 10050 })], [row({ sizeBytes: 10000 })]);
    expect(result.needsUpdate).toBe(false);
    expect(result.rows[0].sizeBytes).toBe(10000);
  });

  it("accepts a raw threshold value", () => {
    const result = reconcileBaseline([row({ sizeBytes: 10040 })], [row({ sizeBytes: 10000 })], "50 B");
    expect(result.needsUpdate).toBe(false);
    expect(result.rows[0].sizeBytes).toBe(10000);
  });

  it("retains previous values when the change is within percent tolerance", () => {
    const result = reconcileBaseline([row({ sizeBytes: 10090 })], [row({ sizeBytes: 10000 })], 0.01);
    expect(result.needsUpdate).toBe(false);
    expect(result.rows[0].sizeBytes).toBe(10000);
  });

  it("updates when the change exceeds tolerance", () => {
    const result = reconcileBaseline([row({ sizeBytes: 10200 })], [row({ sizeBytes: 10000 })], 0.01);
    expect(result.needsUpdate).toBe(true);
    expect(result.rows[0].sizeBytes).toBe(10200);
  });

  it("retains within-tolerance files but updates ones that cross, in a mixed set", () => {
    const next = [row({ file: "a.js", sizeBytes: 10040 }), row({ file: "b.js", sizeBytes: 20500 })];
    const previous = [row({ file: "a.js", sizeBytes: 10000 }), row({ file: "b.js", sizeBytes: 20000 })];
    const result = reconcileBaseline(next, previous, 0.01);
    expect(result.needsUpdate).toBe(true);
    const byFile = Object.fromEntries(result.rows.map((r) => [r.file, r.sizeBytes]));
    expect(byFile["a.js"]).toBe(10000);
    expect(byFile["b.js"]).toBe(20500);
  });

  it("flags new files as a change", () => {
    const result = reconcileBaseline([row({ file: "a.js" }), row({ file: "new.js" })], [row({ file: "a.js" })], 0.5);
    expect(result.needsUpdate).toBe(true);
    expect(result.rows.map((r) => r.file)).toEqual(["a.js", "new.js"]);
  });

  it("flags removed files as a change", () => {
    const result = reconcileBaseline([row({ file: "a.js" })], [row({ file: "a.js" }), row({ file: "gone.js" })], 0.5);
    expect(result.needsUpdate).toBe(true);
    expect(result.rows.map((r) => r.file)).toEqual(["a.js"]);
  });

  it("flags a limit change even when size is within tolerance", () => {
    const result = reconcileBaseline(
      [row({ sizeBytes: 10000, limitBytes: 12000, limit: "12 kB" })],
      [row({ sizeBytes: 10000, limitBytes: 11000, limit: "11 kB" })],
      0.5
    );
    expect(result.needsUpdate).toBe(true);
    expect(result.rows[0].limitBytes).toBe(12000);
  });

  it("flags tester or label changes even when size is within tolerance", () => {
    expect(reconcileBaseline([row({ tester: "brotli" })], [row({ tester: "gzip" })], 0.5).needsUpdate).toBe(true);
    expect(reconcileBaseline([row({ label: "renamed" })], [row({ label: "core" })], 0.5).needsUpdate).toBe(true);
  });

  it("treats a missing previous sizeBytes as zero", () => {
    const result = reconcileBaseline([row({ sizeBytes: 100 })], [row({ sizeBytes: undefined })], "50 B");
    expect(result.needsUpdate).toBe(true);
  });

  it("serializes reconciled rows into a sorted snapshot", () => {
    const result = reconcileBaseline([row({ file: "b.js" }), row({ file: "a.js" })], null);
    const parsed = JSON.parse(serializeBaselineSnapshot(result.rows));
    expect(parsed.map((r) => r.file)).toEqual(["a.js", "b.js"]);
  });
});
