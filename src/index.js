export { loadConfig, normalizeConfig } from "./config/load-config.js";
export { runChecks } from "./core/run-checks.js";
export { listTesters } from "./testers/index.js";
export {
  DEFAULT_BASELINE_THRESHOLD,
  parseBaselineThreshold,
  isWithinThreshold,
  toBaselineEntries,
  buildBaselineSnapshot,
  serializeBaselineSnapshot,
  reconcileBaseline
} from "./core/baseline.js";

