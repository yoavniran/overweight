import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { DEFAULT_TESTER_ID } from "../testers/index.js";
import { formatBytes, parseSize, toDisplaySize } from "../utils/size.js";

const NORMALIZED_CONFIG_FLAG = Symbol.for("overweight.normalizedConfig");

const FileSchema = z.object({
  path: z.string().min(1, "Each file rule requires a path or glob pattern"),
  maxSize: z.union([z.string(), z.number()]),
  compression: z.string().optional(),
  label: z.string().optional()
});

const ConfigSchema = z.object({
  root: z.string().optional(),
  defaultCompression: z.string().optional(),
  files: z.array(FileSchema).min(1, "Provide at least one file rule to check")
});

const ensureArrayConfig = (input) => (Array.isArray(input) ? { files: input } : input);

const fileExists = async (targetPath) => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const readJson = async (targetPath) => {
  const raw = await fs.readFile(targetPath, "utf-8");

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse JSON file at ${targetPath}: ${error.message}`);
  }
};

export const isNormalizedConfig = (config) => Boolean(config?.[NORMALIZED_CONFIG_FLAG]);

export const normalizeConfig = (rawConfig, { cwd, source } = {}) => {
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

export const loadConfig = async ({ cwd = process.cwd(), configPath, inlineConfig } = {}) => {
  const root = path.resolve(cwd);

  if (inlineConfig) {
    return normalizeConfig(inlineConfig, { cwd: root, source: { type: "inline" } });
  }

  if (configPath) {
    const absoluteConfig = path.resolve(root, configPath);

    if (!(await fileExists(absoluteConfig))) {
      throw new Error(`Could not find config file at "${absoluteConfig}"`);
    }

    const data = await readJson(absoluteConfig);
    return normalizeConfig(data, { cwd: root, source: { type: "file", location: absoluteConfig } });
  }

  const defaultConfigPath = path.join(root, "overweight.config.json");

  if (await fileExists(defaultConfigPath)) {
    const data = await readJson(defaultConfigPath);
    return normalizeConfig(data, { cwd: root, source: { type: "file", location: defaultConfigPath } });
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
    "No overweight configuration found. Create an overweight.config.json file, add an `overweight` field to package.json, or pass --config."
  );
};

export const NORMALIZED_FLAG = NORMALIZED_CONFIG_FLAG;

