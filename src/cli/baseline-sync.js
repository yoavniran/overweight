import path from "node:path";

import {
  readBaselineState,
  writeBaseline,
  reconcileBaseline,
  toBaselineEntries
} from "../core/baseline.js";

/**
 * Compare a {@link runChecks} result against a stored baseline and optionally
 * refresh it. Drift is reported but never fails the run — only `maxSize` checks do —
 * so the baseline stays a tracking artifact rather than a second gate.
 *
 * @param {Object} params
 * @param {{results: Array}} params.result - The `runChecks` result.
 * @param {string} [params.baseline] - Baseline file path; when absent, the sync is skipped.
 * @param {string|number} [params.threshold] - Tolerance value (see `parseBaselineThreshold`).
 * @param {boolean} [params.update] - Write the reconciled baseline back when it drifts.
 * @param {string} [params.root] - Root used to resolve `baseline`.
 * @returns {Promise<{status: "skipped"|"up-to-date"|"updated"|"created"|"drift", path?: string}>}
 * @throws {Error} When `update` is requested without a `baseline` path.
 */
export const syncBaseline = async ({ result, baseline, threshold, update, root = process.cwd() }) => {
  if (update && !baseline) {
    throw new Error("--update-baseline requires --baseline to be set.");
  }

  if (!baseline) {
    return { status: "skipped" };
  }

  const baselinePath = path.resolve(root, baseline);
  const { data: previous } = await readBaselineState(baselinePath);
  const entries = toBaselineEntries(result);
  const { needsUpdate, rows } = reconcileBaseline(entries, previous, threshold);
  const display = path.relative(root, baselinePath) || baselinePath;
  const exists = Array.isArray(previous);

  if (!needsUpdate) {
    return { status: "up-to-date", path: display };
  }

  if (update) {
    await writeBaseline(baselinePath, rows);
    return { status: exists ? "updated" : "created", path: display };
  }

  return { status: "drift", path: display };
};
