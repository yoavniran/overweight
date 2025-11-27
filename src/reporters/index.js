import { consoleReporter } from "./console-reporter.js";
import { jsonFileReporter } from "./json-file-reporter.js";
import { jsonReporter } from "./json-reporter.js";
import { silentReporter } from "./silent-reporter.js";

const REPORTERS = {
  console: consoleReporter,
  json: jsonReporter,
  "json-file": jsonFileReporter,
  silent: silentReporter
};

export const getReporter = (name = "console", options = {}) => {
  const reporterName = name || "console";
  const reporter = REPORTERS[reporterName];

  if (!reporter) {
    throw new Error(`Unknown reporter "${reporterName}". Available reporters: ${Object.keys(REPORTERS).join(", ")}`);
  }

  return (result) => reporter(result, options);
};

