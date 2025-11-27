#!/usr/bin/env node
import path from "node:path";

import cac from "cac";
import pc from "picocolors";

import { loadConfig, normalizeConfig } from "./config/load-config.js";
import { runChecks } from "./core/run-checks.js";
import { getReporter } from "./reporters/index.js";

const cli = cac("overweight");

cli
  .option("--config <path>", "Path to an overweight configuration file.")
  .option("--root <path>", "Working directory for resolving files and globs.")
  .option("--reporter <name>", "Reporter to use (console, json, silent).")
  .option("--json", "Shortcut for --reporter=json.")
  .option("--files <json>", "Inline JSON array of file rules (overrides config file).")
  .option("-f, --file <pattern>", "Quick check for a single file/glob.")
  .option("-s, --max-size <size>", "Max size value for --file usage.")
  .option("-c, --compression <tester>", "Tester to use with --file (default gzip).")
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

const resolveConfig = async (options) => {
  const root = options.root ? path.resolve(process.cwd(), options.root) : process.cwd();
  const inlineConfig = options.files ? parseInlineFiles(options.files) : buildSingleRule(options);

  if (inlineConfig) {
    return normalizeConfig(inlineConfig, { cwd: root, source: { type: "inline" } });
  }

  return loadConfig({ cwd: root, configPath: options.config });
};

const main = async () => {
  try {
    const { options } = cli.parse();
    const reporterName = options.json ? "json" : options.reporter;
    const reporter = getReporter(reporterName || "console");
    const config = await resolveConfig(options);
    const result = await runChecks(config);

    reporter(result);

    process.exit(result.stats.hasFailures ? 1 : 0);
  } catch (error) {
    console.error(pc.red(error.message));
    process.exit(1);
  }
};

main();

