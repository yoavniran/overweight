import pc from "picocolors";

const columns = [
  { key: "status", label: "Status" },
  { key: "label", label: "Label" },
  { key: "file", label: "File" },
  { key: "tester", label: "Tester" },
  { key: "size", label: "Size" },
  { key: "limit", label: "Limit" },
  { key: "diff", label: "Δ" }
];

const buildRow = (result) => {
  const status = result.error ? pc.red("ERR") : result.passed ? pc.green("PASS") : pc.red("FAIL");

  return {
    status,
    label: result.label,
    file: result.filePath,
    tester: result.testerLabel,
    size: result.sizeFormatted,
    limit: result.maxSizeFormatted,
    diff: result.diffFormatted
  };
};

const pad = (value, width) => value.padEnd(width, " ");

export const consoleReporter = ({ results, stats }) => {
  if (!results.length) {
    console.log(pc.yellow("No files were evaluated. Check your configuration."));
    return;
  }

  const tableRows = results.map(buildRow);
  const widths = columns.map(({ key, label }) =>
    Math.max(label.length, ...tableRows.map((row) => row[key].length))
  );

  const header = columns
    .map(({ label }, index) => pad(pc.bold(label), widths[index]))
    .join("  ");
  const divider = widths.map((width) => "-".repeat(width)).join("  ");

  console.log(header);
  console.log(divider);
  tableRows.forEach((row) => {
    const line = columns
      .map(({ key }, index) => pad(row[key], widths[index]))
      .join("  ");
    console.log(line);
  });

  if (stats.hasFailures) {
    const failed = stats.failures.filter((entry) => !entry.error).length;
    const errored = stats.failures.filter((entry) => Boolean(entry.error)).length;
    const parts = [`Bundle size check failed for ${failed} file(s)`];

    if (errored) {
      parts.push(`${errored} pattern(s) produced errors`);
    }

    console.error(pc.red(parts.join(". ")));
  } else {
    console.log(pc.green(`All ${results.length} file(s) passed their size limits.`));
  }
};

