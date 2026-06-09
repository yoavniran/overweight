/**
 * Get status emoji for a row
 * @param {Object} row - Summary row
 * @returns {string} Emoji character
 */
const statusEmoji = (row) => {
  if (row.error) {
    return "💥";
  }

  return row.status === "pass" ? "🟢" : "🔺";
};

/**
 * Render the Δ cell as the change between the current size and the recorded
 * baseline, appending the percentage change when available (e.g. "+1.2 kB (+5.0%)").
 * Falls back to "N/A" when there is no baseline to compare against.
 * @param {Object} row - Summary row
 * @returns {string} Delta display value
 */
const diffCell = (row) => {
  const change = row.baselineDiff ?? "N/A";
  return row.diffPercent ? `${change} (${row.diffPercent})` : change;
};

/**
 * Build summary rows from check results
 * @param {Array} results - Check results
 * @returns {Array} Summary rows
 */
export const buildSummaryRows = (results) =>
  results.map((entry) => ({
    label: entry.label,
    file: entry.filePath,
    tester: entry.testerLabel,
    size: entry.sizeFormatted,
    sizeBytes: typeof entry.size === "number" ? entry.size : 0,
    limit: entry.maxSizeFormatted,
    limitBytes: entry.maxSize,
    diff: entry.diffFormatted,
    diffBytes: typeof entry.diff === "number" ? entry.diff : 0,
    status: entry.error ? "error" : entry.passed ? "pass" : "fail",
    error: entry.error || null
  }));

/**
 * Convert rows to table data format for GitHub Actions summary
 * @param {Array} rows - Summary rows
 * @returns {Array} Table data array
 */
export const toTableData = (rows) => [
  [
    { data: "Status", header: true },
    { data: "Label", header: true },
    { data: "File", header: true },
    { data: "Size", header: true },
    { data: "Limit", header: true },
    { data: "Δ", header: true },
    { data: "Trend", header: true }
  ],
  ...rows.map((row) => [
    { data: statusEmoji(row) },
    { data: row.label },
    { data: row.file },
    { data: row.size },
    { data: row.limit },
    { data: diffCell(row) },
    { data: row.trend || "N/A" }
  ])
];

/**
 * Render rows as HTML table
 * @param {Array} rows - Summary rows
 * @returns {string} HTML table string
 */
export const renderHtmlTable = (rows) => {
  const header = ["Status", "Label", "File", "Size", "Limit", "Δ", "Trend"]
    .map((title) => `<th>${title}</th>`)
    .join("");
  const body = rows
    .map(
      (row) =>
        `<tr><td>${statusEmoji(row)}</td><td>${row.label}</td><td>${row.file}</td><td>${row.size}</td><td>${row.limit}</td><td>${diffCell(row)}</td><td>${row.trend || "N/A"}</td></tr>`
    )
    .join("");

  return `<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
};

