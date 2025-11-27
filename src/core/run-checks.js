import fs from "node:fs/promises";

import { normalizeConfig, isNormalizedConfig } from "../config/load-config.js";
import { resolveFiles } from "../files/resolve-files.js";
import { createTesterRegistry, getTester } from "../testers/index.js";
import { formatBytes, formatDiff } from "../utils/size.js";

const buildMissingResult = (rule) => ({
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

const markNormalized = (config) =>
  normalizeConfig(config, {
    cwd: config.root || process.cwd(),
    source: config.source || { type: "inline" }
  });

export const runChecks = async (rawConfig, options = {}) => {
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

