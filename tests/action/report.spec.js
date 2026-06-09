import { describe, expect, it } from "vitest";

import { buildSummaryRows, toTableData, renderHtmlTable } from "../../src/action/report.js";
import { mergeWithBaseline } from "../../src/action/baseline.js";

// Limit (12 kB) deliberately differs from the baseline (10 kB) so the rendered Δ
// reflects the change vs baseline (+500 B), not the vs-limit diff (-1.5 kB).
const result = (overrides = {}) => ({
  label: "main bundle",
  filePath: "dist/index.js",
  testerLabel: "gzip",
  sizeFormatted: "10.5 kB",
  size: 10_500,
  maxSizeFormatted: "12 kB",
  maxSize: 12_000,
  diffFormatted: "-1.5 kB",
  diff: -1500,
  passed: true,
  error: null,
  ...overrides
});

const baseline = (overrides = {}) => [
  { file: "dist/index.js", size: "10 kB", sizeBytes: 10_000, ...overrides }
];

describe("mergeWithBaseline delta", () => {
  it("records the change vs the previous size with its percentage", () => {
    const [merged] = mergeWithBaseline(buildSummaryRows([result()]), baseline());
    expect(merged.baselineDiff).toBe("+500 B");
    expect(merged.diffPercent).toBe("+5.0%");
  });

  it("leaves the delta as N/A when the file has no baseline match", () => {
    const [merged] = mergeWithBaseline(buildSummaryRows([result()]), baseline({ file: "dist/other.js" }));
    expect(merged.baselineDiff).toBe("N/A");
    expect(merged.diffPercent).toBeNull();
  });
});

describe("Δ cell rendering", () => {
  it("shows the baseline change and percentage in the table data", () => {
    const rows = mergeWithBaseline(buildSummaryRows([result()]), baseline());
    expect(toTableData(rows)[1][5].data).toBe("+500 B (+5.0%)");
  });

  it("shows N/A in the table data when there is no baseline", () => {
    expect(toTableData(buildSummaryRows([result()]))[1][5].data).toBe("N/A");
  });

  it("shows the baseline change and percentage in the HTML table", () => {
    const html = renderHtmlTable(mergeWithBaseline(buildSummaryRows([result()]), baseline()));
    expect(html).toContain("<td>+500 B (+5.0%)</td>");
  });

  it("shows N/A in the HTML table when there is no baseline", () => {
    const html = renderHtmlTable(buildSummaryRows([result()]));
    expect(html).toContain("<td>N/A</td>");
  });
});
