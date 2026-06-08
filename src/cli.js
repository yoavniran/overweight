#!/usr/bin/env node
import path from "node:path";

import cac from "cac";
import pc from "picocolors";

import { loadConfig, normalizeConfig } from "./config/load-config.js";
import { runChecks } from "./core/run-checks.js";
import { getReporter } from "./reporters/index.js";
import { syncBaseline } from "./cli/baseline-sync.js";

const cli = cac("overweight");

cli
  .option("--config <path>", "Path to an overweight configuration file.")
  .option("--root <path>", "Working directory for resolving files and globs.")
  .option("--reporter <name>", "Reporter to use (console, json, json-file, silent).")
  .option("--json", "Shortcut for --reporter=json.")
  .option("--report-file <path>", "Target path for the json-file reporter output.")
  .option("--files <json>", "Inline JSON array of file rules (overrides config file).")
  .option("-f, --file <pattern>", "Quick check for a single file/glob.")
  .option("-s, --max-size <size>", "Max size value for --file usage.")
  .option("-c, --compression <tester>", "Tester to use with --file (default gzip).")
  .option("--baseline <path>", "Path to a baseline report JSON to compare sizes against.")
  .option(
    "--baseline-threshold <value>",
    "Tolerance below which a size change is ignored. Fraction in (0,1) = percent, integer/size = absolute bytes. Default 0.01 (1%); use 0 to record every byte."
  )
  .option("--update-baseline", "Write the reconciled baseline back to --baseline when it changes beyond tolerance.")
  .help();

const buildSingleRule = (options) => {
  const pattern = options.file || options.f;

  if (!pattern) {
    return null;
  }

  const maxSize = options.maxSize || options.s;

  if (!maxSize) {
    throw new Error("Using --file requires --max-size to be provided.");
  }

  return {
    files: [
      {
        path: pattern,
        maxSize,
        compression: options.compression || options.c
      }
    ]
  };
};

const parseInlineFiles = (value) => {
  try {
    return { files: JSON.parse(value) };
  } catch (error) {
    throw new Error(`Failed to parse --files JSON: ${error.message}`);
  }
};

const QUIET_REPORTERS = new Set(["json", "json-file", "silent"]);

const renderBaselineStatus = ({ status, path: display }) => {
  switch (status) {
    case "up-to-date":
      return pc.dim(`Baseline up to date (within tolerance): ${display}`);
    case "updated":
      return pc.green(`Baseline updated: ${display}`);
    case "created":
      return pc.green(`Baseline created: ${display}`);
    case "drift":
      return pc.yellow(
        `Baseline differs beyond tolerance: ${display}. Re-run with --update-baseline to refresh it.`
      );
    default:
      return null;
  }
};

const resolveConfig = async (options, root) => {
  const inlineConfig = options.files ? parseInlineFiles(options.files) : buildSingleRule(options);

  if (inlineConfig) {
    return normalizeConfig(inlineConfig, { cwd: root, source: { type: "inline" } });
  }

  return loadConfig({ cwd: root, configPath: options.config });
};

const main = async () => {
  try {
    const { options } = cli.parse();
    const root = options.root ? path.resolve(process.cwd(), options.root) : process.cwd();
    const reporterName = options.json ? "json" : options.reporter;
    const config = await resolveConfig(options, root);
    const reporter = getReporter(reporterName || "console", {
      reportFile: options.reportFile,
      cwd: root
    });
    const result = await runChecks(config);

    reporter(result);

    const baselineOutcome = await syncBaseline({
      result,
      baseline: options.baseline,
      threshold: options.baselineThreshold,
      update: options.updateBaseline,
      root
    });

    const baselineMessage = renderBaselineStatus(baselineOutcome);

    if (baselineMessage && !QUIET_REPORTERS.has(reporterName)) {
      console.log(baselineMessage);
    }

    process.exit(result.stats.hasFailures ? 1 : 0);
  } catch (error) {
    console.error(pc.red(error.message));
    process.exit(1);
  }
};

main();

