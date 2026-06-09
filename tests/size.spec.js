import { describe, expect, it } from "vitest";

import { formatDiff, formatDiffPercent, parseSize } from "../src/utils/size.js";

describe("parseSize", () => {
  it("parses decimal units", () => {
    expect(parseSize("10kb")).toBe(10_000);
    expect(parseSize("1.5 MB")).toBe(1_500_000);
  });

  it("parses binary units", () => {
    expect(parseSize("2MiB")).toBe(2_097_152);
  });

  it("parses raw numbers", () => {
    expect(parseSize(250)).toBe(250);
    expect(parseSize("250")).toBe(250);
  });

  it("throws on invalid input", () => {
    expect(() => parseSize("abc")).toThrow();
  });
});

describe("formatDiff", () => {
  it("returns signed values", () => {
    expect(formatDiff(1024)).toContain("+");
    expect(formatDiff(-1024)).toContain("-");
    expect(formatDiff(0)).toBe("0 B");
  });
});

describe("formatDiffPercent", () => {
  it("returns the signed percentage relative to the limit", () => {
    expect(formatDiffPercent(500, 10_000)).toBe("+5.0%");
    expect(formatDiffPercent(-2500, 10_000)).toBe("-25.0%");
    expect(formatDiffPercent(0, 10_000)).toBe("0.0%");
  });

  it("returns null when inputs are not usable", () => {
    expect(formatDiffPercent(null, 10_000)).toBeNull();
    expect(formatDiffPercent(500, 0)).toBeNull();
    expect(formatDiffPercent(500, null)).toBeNull();
  });
});

