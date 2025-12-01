import fs from "node:fs/promises";
import path from "node:path";
import { formatDiff } from "../utils/size.js";

/**
 * Read baseline state from file
 * @param {string} baselinePath - Path to baseline file
 * @returns {Promise<{raw: string|null, data: object|null}>} Baseline state
 */
export const readBaselineState = async (baselinePath) => {
  try {
    const raw = await fs.readFile(baselinePath, "utf-8");
    let data = null;

    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }

    return { raw, data };
  } catch {
    return { raw: null, data: null };
  }
};

/**
 * Build baseline snapshot from rows
 * @param {Array} rows - Summary rows
 * @returns {Array} Baseline snapshot data
 */
const buildBaselineSnapshot = (rows) =>
  [...rows]
    .map((row) => ({
      label: row.label,
      file: row.file,
      tester: row.tester,
      size: row.size,
      sizeBytes: row.sizeBytes,
      limit: row.limit,
      limitBytes: row.limitBytes
    }))
    .sort((a, b) => a.file.localeCompare(b.file));

/**
 * Serialize baseline snapshot to JSON
 * @param {Array} rows - Summary rows
 * @returns {string} JSON string
 */
export const serializeBaselineSnapshot = (rows) => JSON.stringify(buildBaselineSnapshot(rows), null, 2);

/**
 * Write baseline file to disk
 * @param {string} baselinePath - Path to write baseline file
 * @param {Array} rows - Summary rows
 * @param {string|undefined} precomputedContent - Precomputed content (optional)
 * @returns {Promise<void>}
 */
export const writeBaseline = async (baselinePath, rows, precomputedContent) => {
  await fs.mkdir(path.dirname(baselinePath), { recursive: true });
  const content = precomputedContent ?? serializeBaselineSnapshot(rows);
  await fs.writeFile(baselinePath, content);
};

/**
 * Get baseline update info (whether update is needed and new content)
 * @param {string} baselinePath - Path to baseline file
 * @param {Array} rows - Summary rows
 * @param {string|undefined} previousContent - Previous content (optional)
 * @returns {Promise<{needsUpdate: boolean, content: string}>} Update info
 */
export const getBaselineUpdateInfo = async (baselinePath, rows, previousContent = undefined) => {
  const nextContent = serializeBaselineSnapshot(rows);

  if (previousContent !== undefined) {
    return {
      needsUpdate: previousContent === null ? true : previousContent !== nextContent,
      content: nextContent
    };
  }

  try {
    const currentContent = await fs.readFile(baselinePath, "utf-8");
    return { needsUpdate: currentContent !== nextContent, content: nextContent };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { needsUpdate: true, content: nextContent };
    }

    throw error;
  }
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
      return { ...row, baselineSize: "N/A", baselineDiff: "N/A", trend: "N/A" };
    }

    const delta = row.sizeBytes - (previous.sizeBytes || 0);

    return {
      ...row,
      baselineSize: previous.size,
      baselineDiff: formatDiff(delta),
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

