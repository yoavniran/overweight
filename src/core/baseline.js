import { parseSize } from "../utils/size.js";

export const DEFAULT_BASELINE_THRESHOLD = 0.01;

/**
 * A baseline entry is the stable, serializable shape stored in a baseline report
 * and compared across runs:
 *
 *   { label, file, tester, size, sizeBytes, limit, limitBytes }
 *
 * `sizeBytes`/`limitBytes` are exact byte counts; `size`/`limit` are their
 * human-readable forms. `file` is the relative path and acts as the entry key.
 *
 * @typedef {Object} BaselineEntry
 * @property {string} label
 * @property {string} file
 * @property {string} tester
 * @property {string} size
 * @property {number} sizeBytes
 * @property {string} limit
 * @property {number} limitBytes
 *
 * @typedef {{thresholdBytes: number, thresholdPercent: number}} BaselineThreshold
 */

/**
 * Parse a baseline tolerance value into a {@link BaselineThreshold} descriptor.
 *
 * When no value is provided (`undefined`, `null`, or an empty string) the
 * {@link DEFAULT_BASELINE_THRESHOLD} (1%) is applied. Otherwise the value's shape
 * decides its meaning:
 * - a bare fraction in `(0, 1)` (e.g. `0.01`) is a **percentage** of the previous size;
 * - an integer or size string (e.g. `50`, `"50 B"`, `"1 kB"`) is an **absolute** byte tolerance;
 * - an explicit `0` disables the tolerance (records every byte).
 *
 * @param {string|number} [value] - Raw threshold value.
 * @returns {BaselineThreshold}
 * @throws {Error} When the value is negative or not a valid size.
 */
export const parseBaselineThreshold = (value) => {
  const provided = !(value === undefined || value === null || `${value}`.trim() === "");
  const raw = provided ? `${value}`.trim() : `${DEFAULT_BASELINE_THRESHOLD}`;
  const isBareNumber = /^-?\d+(?:\.\d+)?$/.test(raw);
  const numeric = Number(raw);

  if (isBareNumber && numeric < 0) {
    throw new Error(`baseline-threshold must be greater than or equal to zero, received "${value}"`);
  }

  if (isBareNumber && numeric > 0 && numeric < 1) {
    return { thresholdBytes: 0, thresholdPercent: numeric };
  }

  return { thresholdBytes: parseSize(raw), thresholdPercent: 0 };
};

const normalizeThreshold = (threshold) =>
  threshold && typeof threshold === "object" && "thresholdBytes" in threshold
    ? threshold
    : parseBaselineThreshold(threshold);

/**
 * Whether a size move is small enough to be treated as unchanged.
 * Tolerance is `max(thresholdBytes, thresholdPercent * previousBytes)`.
 * @param {number} nextBytes
 * @param {number} previousBytes
 * @param {BaselineThreshold} threshold
 * @returns {boolean}
 */
export const isWithinThreshold = (nextBytes, previousBytes, threshold) => {
  const { thresholdBytes, thresholdPercent } = normalizeThreshold(threshold);
  const delta = Math.abs(nextBytes - previousBytes);
  const tolerance = Math.max(thresholdBytes, thresholdPercent * previousBytes);
  return delta <= tolerance;
};

/**
 * Convert a {@link runChecks} result into baseline entries. Errored/missing
 * results (no numeric size) are skipped so the baseline only records measured files.
 * @param {{results: Array}} result - The object returned by `runChecks`.
 * @returns {BaselineEntry[]}
 */
export const toBaselineEntries = (result) =>
  (result?.results ?? [])
    .filter((entry) => typeof entry.size === "number")
    .map((entry) => ({
      label: entry.label,
      file: entry.filePath,
      tester: entry.testerLabel,
      size: entry.sizeFormatted,
      sizeBytes: entry.size,
      limit: entry.maxSizeFormatted,
      limitBytes: entry.maxSize
    }));

/**
 * Project arbitrary rows down to the {@link BaselineEntry} shape, sorted by file.
 * @param {Array} entries
 * @returns {BaselineEntry[]}
 */
export const buildBaselineSnapshot = (entries) =>
  [...entries]
    .map((entry) => ({
      label: entry.label,
      file: entry.file,
      tester: entry.tester,
      size: entry.size,
      sizeBytes: entry.sizeBytes,
      limit: entry.limit,
      limitBytes: entry.limitBytes
    }))
    .sort((a, b) => a.file.localeCompare(b.file));

/**
 * Serialize entries into the canonical baseline JSON document.
 * @param {Array} entries
 * @returns {string}
 */
export const serializeBaselineSnapshot = (entries) =>
  JSON.stringify(buildBaselineSnapshot(entries), null, 2);

/**
 * Reconcile freshly measured entries against a stored baseline using a tolerance
 * threshold. Files whose size moved within tolerance retain their previously
 * recorded values (preventing churn and drift); files beyond tolerance, new files,
 * removed files, or metadata changes (limit/tester/label) mark the baseline dirty.
 *
 * @param {Array} nextEntries - Current entries (e.g. from {@link toBaselineEntries}).
 * @param {Array|null} previousData - Parsed baseline snapshot, or null/non-array when none exists.
 * @param {string|number|BaselineThreshold} [threshold] - Raw value or parsed descriptor. Omitted
 *   uses the {@link DEFAULT_BASELINE_THRESHOLD}; pass an explicit `0` for byte-exact comparison.
 * @returns {{needsUpdate: boolean, rows: Array}} Whether to write, and the reconciled entries.
 */
export const reconcileBaseline = (nextEntries, previousData, threshold) => {
  if (!Array.isArray(previousData)) {
    return { needsUpdate: true, rows: nextEntries };
  }

  const normalized = normalizeThreshold(threshold);
  const previousByFile = new Map(previousData.map((row) => [row.file, row]));
  let needsUpdate = false;

  const rows = nextEntries.map((row) => {
    const previous = previousByFile.get(row.file);

    if (!previous) {
      needsUpdate = true;
      return row;
    }

    previousByFile.delete(row.file);

    const metadataChanged =
      row.limitBytes !== previous.limitBytes ||
      row.tester !== previous.tester ||
      row.label !== previous.label;
    const sizeChanged = !isWithinThreshold(row.sizeBytes, previous.sizeBytes ?? 0, normalized);

    if (metadataChanged || sizeChanged) {
      needsUpdate = true;
      return row;
    }

    return previous;
  });

  if (previousByFile.size > 0) {
    needsUpdate = true;
  }

  return { needsUpdate, rows };
};
