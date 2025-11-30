#!/usr/bin/env node
import path from 'path';
import cac from 'cac';
import pc from 'picocolors';
import fs from 'fs/promises';
import { z } from 'zod';
import { promisify } from 'util';
import { brotliCompress, gzip, constants } from 'zlib';
import prettyBytes from 'pretty-bytes';
import fg from 'fast-glob';
import fs3 from 'fs';

var brotliAsync = promisify(brotliCompress);
var brotliTester = {
  id: "brotli",
  label: "brotli",
  measure: async (buffer) => {
    const compressed = await brotliAsync(buffer, {
      params: {
        [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
        [constants.BROTLI_PARAM_QUALITY]: 11
      }
    });
    return { bytes: compressed.byteLength };
  }
};
var gzipAsync = promisify(gzip);
var gzipTester = {
  id: "gzip",
  label: "gzip",
  measure: async (buffer) => {
    const compressed = await gzipAsync(buffer);
    return { bytes: compressed.byteLength };
  }
};

// src/testers/none.js
var noneTester = {
  id: "none",
  label: "raw",
  measure: async (buffer) => ({ bytes: buffer.byteLength })
};

// src/testers/shared.js
var DEFAULT_TESTER_ID = "gzip";
var NORMALIZED_TOKENS = /* @__PURE__ */ new Set(["none", "gzip", "brotli"]);
var createTester = ({ id, label, measure }) => {
  if (!id || typeof measure !== "function") {
    throw new Error("Tester definitions must include an id and a measure function");
  }
  return {
    id,
    label: label || id,
    measure
  };
};
var normalizeTesterId = (value) => {
  if (!value) {
    return DEFAULT_TESTER_ID;
  }
  const normalized = value.toLowerCase();
  return NORMALIZED_TOKENS.has(normalized) ? normalized : value;
};

// src/testers/index.js
var builtinTesters = new Map(
  [noneTester, gzipTester, brotliTester].map((tester) => [tester.id, createTester(tester)])
);
var createTesterRegistry = (customTesters) => {
  const registry = new Map(builtinTesters);
  if (customTesters) {
    const entries = customTesters instanceof Map ? customTesters.entries() : Object.entries(customTesters);
    for (const [, tester] of entries) {
      const normalizedTester = createTester(tester);
      registry.set(normalizedTester.id, normalizedTester);
    }
  }
  return registry;
};
var getTester = (testerId, registry) => {
  const normalized = normalizeTesterId(testerId);
  const tester = registry.get(normalized);
  if (!tester) {
    throw new Error(`Unknown tester "${testerId}"`);
  }
  return tester;
};
var UNIT_FACTORS = {
  b: 1,
  byte: 1,
  bytes: 1,
  k: 1e3,
  kb: 1e3,
  kib: 1024,
  m: 1e6,
  mb: 1e6,
  mib: 1048576,
  g: 1e9,
  gb: 1e9,
  gib: 1073741824
};
var formatBytes = (value) => prettyBytes(Math.max(0, value), { binary: false });
var formatDiff = (diff) => {
  if (diff === 0) {
    return "0 B";
  }
  const sign = diff > 0 ? "+" : "-";
  return `${sign}${formatBytes(Math.abs(diff))}`;
};
var parseSize = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    throw new Error(`Unsupported size value. Expected string or number, received: ${typeof value}`);
  }
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "");
  const match = normalized.match(/^(-?\d+(?:\.\d+)?)([a-z]+)?$/i);
  if (!match) {
    throw new Error(`Invalid size format: "${value}"`);
  }
  const [, rawNumber, rawUnit] = match;
  const unit = rawUnit || "b";
  const factor = UNIT_FACTORS[unit];
  if (!factor) {
    throw new Error(`Unknown size unit "${unit}" in value "${value}"`);
  }
  const numericValue = Number(rawNumber);
  if (!Number.isFinite(numericValue)) {
    throw new Error(`Invalid numeric size: "${value}"`);
  }
  return Math.round(numericValue * factor);
};
var toDisplaySize = (original, bytes) => {
  if (typeof original === "string" && original.trim().length) {
    return original.trim();
  }
  return formatBytes(bytes);
};

// src/config/load-config.js
var NORMALIZED_CONFIG_FLAG = Symbol.for("overweight.normalizedConfig");
var FileSchema = z.object({
  path: z.string().min(1, "Each file rule requires a path or glob pattern"),
  maxSize: z.union([z.string(), z.number()]),
  compression: z.string().optional(),
  label: z.string().optional()
});
var ConfigSchema = z.object({
  root: z.string().optional(),
  defaultCompression: z.string().optional(),
  files: z.array(FileSchema).min(1, "Provide at least one file rule to check")
});
var ensureArrayConfig = (input) => Array.isArray(input) ? { files: input } : input;
var fileExists = async (targetPath) => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};
var readJson = async (targetPath) => {
  const raw = await fs.readFile(targetPath, "utf-8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse JSON file at ${targetPath}: ${error.message}`);
  }
};
var isNormalizedConfig = (config) => Boolean(config?.[NORMALIZED_CONFIG_FLAG]);
var normalizeConfig = (rawConfig, { cwd, source } = {}) => {
  const configRoot = path.resolve(cwd || process.cwd());
  const parsed = ConfigSchema.parse(ensureArrayConfig(rawConfig));
  const defaultCompression = (parsed.defaultCompression || DEFAULT_TESTER_ID).toLowerCase();
  const normalized = {
    root: parsed.root ? path.resolve(configRoot, parsed.root) : configRoot,
    defaultCompression,
    files: parsed.files.map((file) => {
      const maxBytes = parseSize(file.maxSize);
      if (maxBytes < 0) {
        throw new Error(`maxSize for "${file.path}" must be greater than or equal to zero`);
      }
      const compression = (file.compression || defaultCompression).toLowerCase();
      return {
        path: file.path,
        pattern: file.path,
        label: file.label || file.path,
        compression,
        maxBytes,
        maxSizeInput: file.maxSize,
        maxDisplay: toDisplaySize(file.maxSize, maxBytes),
        maxFormatted: formatBytes(maxBytes)
      };
    }),
    source: source || { type: "inline" }
  };
  normalized[NORMALIZED_CONFIG_FLAG] = true;
  return normalized;
};
var loadConfig = async ({ cwd = process.cwd(), configPath, inlineConfig } = {}) => {
  const root = path.resolve(cwd);
  if (inlineConfig) {
    return normalizeConfig(inlineConfig, { cwd: root, source: { type: "inline" } });
  }
  const tryLoadConfig = async (candidatePath) => {
    if (!await fileExists(candidatePath)) {
      return null;
    }
    const data = await readJson(candidatePath);
    return normalizeConfig(data, { cwd: root, source: { type: "file", location: candidatePath } });
  };
  if (configPath) {
    const absoluteConfig = path.resolve(root, configPath);
    const loaded = await tryLoadConfig(absoluteConfig);
    if (!loaded) {
      throw new Error(`Could not find config file at "${absoluteConfig}"`);
    }
    return loaded;
  }
  const defaultConfigPaths = ["overweight.json", "overweight.config.json"].map(
    (file) => path.join(root, file)
  );
  for (const candidate of defaultConfigPaths) {
    const loaded = await tryLoadConfig(candidate);
    if (loaded) {
      return loaded;
    }
  }
  const packageJsonPath = path.join(root, "package.json");
  if (await fileExists(packageJsonPath)) {
    const pkgJson = await readJson(packageJsonPath);
    const field = pkgJson.overweight;
    if (field) {
      return normalizeConfig(ensureArrayConfig(field), {
        cwd: root,
        source: { type: "package", location: packageJsonPath }
      });
    }
  }
  throw new Error(
    "No overweight configuration found. Create an overweight.json (or overweight.config.json) file, add an `overweight` field to package.json, or pass --config."
  );
};
var resolveFiles = async (pattern, { root }) => {
  const matches = await fg(pattern, {
    cwd: root,
    absolute: true,
    dot: true,
    onlyFiles: true
  });
  const unique = Array.from(new Set(matches));
  return unique.map((absolutePath) => ({
    absolutePath,
    relativePath: path.relative(root, absolutePath) || path.basename(absolutePath)
  }));
};

// src/core/run-checks.js
var buildMissingResult = (rule) => ({
  pattern: rule.pattern,
  label: rule.label,
  filePath: rule.pattern,
  tester: rule.compression,
  testerLabel: rule.compression,
  size: null,
  sizeFormatted: "N/A",
  maxSizeFormatted: rule.maxFormatted,
  maxSize: rule.maxBytes,
  diff: null,
  diffFormatted: "N/A",
  passed: false,
  error: "No files matched this pattern"
});
var markNormalized = (config) => normalizeConfig(config, {
  cwd: config.root || process.cwd(),
  source: config.source || { type: "inline" }
});
var runChecks = async (rawConfig, options = {}) => {
  const normalizedConfig = isNormalizedConfig(rawConfig) ? rawConfig : markNormalized(rawConfig);
  const registry = createTesterRegistry(options.testers);
  const results = [];
  for (const fileRule of normalizedConfig.files) {
    const tester = getTester(fileRule.compression || normalizedConfig.defaultCompression, registry);
    const matches = await resolveFiles(fileRule.pattern, { root: normalizedConfig.root });
    if (!matches.length) {
      results.push(buildMissingResult(fileRule));
      continue;
    }
    for (const match of matches) {
      const buffer = await fs.readFile(match.absolutePath);
      const measurement = await tester.measure(buffer, {
        filePath: match.absolutePath,
        pattern: fileRule.pattern
      });
      const size = Number(measurement?.bytes);
      if (!Number.isFinite(size)) {
        throw new Error(`Tester "${tester.id}" did not return a numeric size for "${match.relativePath}"`);
      }
      const diff = size - fileRule.maxBytes;
      const passed = diff <= 0;
      results.push({
        pattern: fileRule.pattern,
        label: fileRule.label,
        filePath: match.relativePath,
        absolutePath: match.absolutePath,
        tester: tester.id,
        testerLabel: tester.label,
        size,
        sizeFormatted: formatBytes(size),
        maxSizeFormatted: fileRule.maxFormatted,
        maxSize: fileRule.maxBytes,
        diff,
        diffFormatted: formatDiff(diff),
        passed
      });
    }
  }
  const failures = results.filter((entry) => !entry.passed || entry.error);
  return {
    results,
    stats: {
      files: results.length,
      failures,
      hasFailures: failures.length > 0,
      hasErrors: failures.some((entry) => Boolean(entry.error))
    }
  };
};
var columns = [
  { key: "status", label: "Status" },
  { key: "label", label: "Label" },
  { key: "file", label: "File" },
  { key: "tester", label: "Tester" },
  { key: "size", label: "Size" },
  { key: "limit", label: "Limit" },
  { key: "diff", label: "\u0394" }
];
var buildRow = (result) => {
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
var pad = (value, width) => value.padEnd(width, " ");
var consoleReporter = ({ results, stats }) => {
  if (!results.length) {
    console.log(pc.yellow("No files were evaluated. Check your configuration."));
    return;
  }
  const tableRows = results.map(buildRow);
  const widths = columns.map(
    ({ key, label }) => Math.max(label.length, ...tableRows.map((row) => row[key].length))
  );
  const header = columns.map(({ label }, index) => pad(pc.bold(label), widths[index])).join("  ");
  const divider = widths.map((width) => "-".repeat(width)).join("  ");
  console.log(header);
  console.log(divider);
  tableRows.forEach((row) => {
    const line = columns.map(({ key }, index) => pad(row[key], widths[index])).join("  ");
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
var DEFAULT_FILE = "overweight-report.json";
var resolveTargetPath = (target, cwd = process.cwd()) => {
  if (!target) {
    return path.join(cwd, DEFAULT_FILE);
  }
  return path.isAbsolute(target) ? target : path.join(cwd, target);
};
var jsonFileReporter = (result, options = {}) => {
  const filePath = resolveTargetPath(options.reportFile, options.cwd);
  fs3.mkdirSync(path.dirname(filePath), { recursive: true });
  fs3.writeFileSync(filePath, JSON.stringify(result, null, 2));
  if (!options.silent) {
    console.log(`Saved Overweight report to ${filePath}`);
  }
};

// src/reporters/json-reporter.js
var jsonReporter = (result) => {
  console.log(JSON.stringify(result, null, 2));
};

// src/reporters/silent-reporter.js
var silentReporter = () => {
};

// src/reporters/index.js
var REPORTERS = {
  console: consoleReporter,
  json: jsonReporter,
  "json-file": jsonFileReporter,
  silent: silentReporter
};
var getReporter = (name = "console", options = {}) => {
  const reporterName = name || "console";
  const reporter = REPORTERS[reporterName];
  if (!reporter) {
    throw new Error(`Unknown reporter "${reporterName}". Available reporters: ${Object.keys(REPORTERS).join(", ")}`);
  }
  return (result) => reporter(result, options);
};

// src/cli.js
var cli = cac("overweight");
cli.option("--config <path>", "Path to an overweight configuration file.").option("--root <path>", "Working directory for resolving files and globs.").option("--reporter <name>", "Reporter to use (console, json, json-file, silent).").option("--json", "Shortcut for --reporter=json.").option("--report-file <path>", "Target path for the json-file reporter output.").option("--files <json>", "Inline JSON array of file rules (overrides config file).").option("-f, --file <pattern>", "Quick check for a single file/glob.").option("-s, --max-size <size>", "Max size value for --file usage.").option("-c, --compression <tester>", "Tester to use with --file (default gzip).").help();
var buildSingleRule = (options) => {
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
var parseInlineFiles = (value) => {
  try {
    return { files: JSON.parse(value) };
  } catch (error) {
    throw new Error(`Failed to parse --files JSON: ${error.message}`);
  }
};
var resolveConfig = async (options, root) => {
  const inlineConfig = options.files ? parseInlineFiles(options.files) : buildSingleRule(options);
  if (inlineConfig) {
    return normalizeConfig(inlineConfig, { cwd: root, source: { type: "inline" } });
  }
  return loadConfig({ cwd: root, configPath: options.config });
};
var main = async () => {
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
    process.exit(result.stats.hasFailures ? 1 : 0);
  } catch (error) {
    console.error(pc.red(error.message));
    process.exit(1);
  }
};
main();
//# sourceMappingURL=cli.js.map
//# sourceMappingURL=cli.js.map