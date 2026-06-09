import path from "node:path";
import { formatDiff, formatDiffPercent } from "../utils/size.js";
import {
  DEFAULT_BASELINE_THRESHOLD,
  parseBaselineThreshold,
  reconcileBaseline,
  serializeBaselineSnapshot,
  buildBaselineSnapshot,
  toBaselineEntries,
  isWithinThreshold,
  readBaselineState,
  writeBaseline
} from "../core/baseline.js";

// Re-export the pure baseline primitives so the action layer has a single import site.
// The canonical home (and Node API surface) is src/core/baseline.js.
export {
  DEFAULT_BASELINE_THRESHOLD,
  parseBaselineThreshold,
  reconcileBaseline,
  serializeBaselineSnapshot,
  buildBaselineSnapshot,
  toBaselineEntries,
  isWithinThreshold,
  readBaselineState,
  writeBaseline
};

/**
 * Merge current rows with baseline data
 * @param {Array} rows - Current summary rows
 * @param {Array|null} baseline - Baseline data
 * @returns {Array} Merged rows with baseline info
 */
export const mergeWithBaseline = (rows, baseline) => {
  if (!baseline) {
    return rows;
  }

  const map = new Map(baseline.map((row) => [row.file, row]));

  return rows.map((row) => {
    const previous = map.get(row.file);

    if (!previous) {
      return { ...row, baselineSize: "N/A", baselineDiff: "N/A", diffPercent: null, trend: "N/A" };
    }

    const delta = row.sizeBytes - (previous.sizeBytes || 0);

    return {
      ...row,
      baselineSize: previous.size,
      baselineDiff: formatDiff(delta),
      diffPercent: formatDiffPercent(delta, previous.sizeBytes),
      trend: delta === 0 ? "➖" : delta > 0 ? "🔺" : "⬇"
    };
  });
};

/**
 * Get workspace root directory
 * @returns {string} Workspace root path
 */
export const getWorkspaceRoot = () => process.env.GITHUB_WORKSPACE || process.cwd();

/**
 * Ensure a path is relative to workspace root
 * @param {string} absolutePath - Absolute path
 * @returns {string} Relative path
 * @throws {Error} If path is outside workspace
 */
export const ensureRelativePath = (absolutePath) => {
  const workspaceRoot = getWorkspaceRoot();
  const relative = path.relative(workspaceRoot, absolutePath);

  if (relative.startsWith("..")) {
    throw new Error(
      `Baseline path "${absolutePath}" is outside of the repository checkout (${workspaceRoot}).`
    );
  }

  return relative.replace(/\\/g, "/");
};

