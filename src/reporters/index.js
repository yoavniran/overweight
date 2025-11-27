import { consoleReporter } from "./console-reporter.js";
import { jsonReporter } from "./json-reporter.js";
import { silentReporter } from "./silent-reporter.js";

const REPORTERS = {
  console: consoleReporter,
  json: jsonReporter,
  silent: silentReporter
};

export const getReporter = (name = "console") => {
  if (!name) {
    return consoleReporter;
  }

  const reporter = REPORTERS[name];

  if (!reporter) {
    throw new Error(`Unknown reporter "${name}". Available reporters: ${Object.keys(REPORTERS).join(", ")}`);
  }

  return reporter;
};

