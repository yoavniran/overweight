import path from "node:path";
import core from "@actions/core";
import { loadConfig, normalizeConfig } from "../config/load-config.js";

/**
 * Build inline config from JSON input
 * @param {string} input - JSON string input
 * @returns {Object|null} Parsed config or null
 * @throws {Error} If input is invalid JSON
 */
const buildInlineConfig = (input) => {
  if (!input) {
    return null;
  }

  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed) ? { files: parsed } : parsed;
  } catch (error) {
    throw new Error(`Failed to parse \`files\` input: ${error.message}`);
  }
};

/**
 * Resolve working directory from input
 * @param {string} input - Working directory input
 * @returns {string} Resolved working directory path
 */
const resolveWorkingDirectory = (input) =>
  input ? path.resolve(process.cwd(), input) : process.cwd();

/**
 * Resolve action configuration
 * @returns {Promise<Object>} Normalized config object
 */
export const resolveConfig = async () => {
  const configInput = core.getInput("config");
  const filesInput = core.getInput("files");
  const cwd = resolveWorkingDirectory(core.getInput("working-directory"));
  const inlineConfig = buildInlineConfig(filesInput);

  if (inlineConfig) {
    return normalizeConfig(inlineConfig, { cwd, source: { type: "inline" } });
  }

  return loadConfig({ cwd, configPath: configInput || undefined });
};

