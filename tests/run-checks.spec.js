import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { normalizeConfig } from "../src/config/load-config.js";
import { runChecks } from "../src/core/run-checks.js";

const createTempDir = async () => fs.mkdtemp(path.join(os.tmpdir(), "overweight-"));

describe("runChecks", () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("passes when file is below the limit", async () => {
    const filePath = path.join(tempDir, "bundle.js");
    await fs.writeFile(filePath, "console.log('hello world');");

    const config = normalizeConfig(
      {
        files: [
          {
            path: filePath,
            maxSize: "2 kB",
            compression: "none"
          }
        ]
      },
      { cwd: tempDir }
    );

    const result = await runChecks(config);
    expect(result.stats.hasFailures).toBe(false);
    expect(result.results[0].passed).toBe(true);
  });

  it("fails when file exceeds the limit", async () => {
    const filePath = path.join(tempDir, "bundle.js");
    await fs.writeFile(filePath, "a".repeat(200));

    const config = normalizeConfig(
      {
        files: [
          {
            path: filePath,
            maxSize: 100,
            compression: "none"
          }
        ]
      },
      { cwd: tempDir }
    );

    const result = await runChecks(config);
    expect(result.stats.hasFailures).toBe(true);
    expect(result.results[0].passed).toBe(false);
  });

  it("expands glob patterns", async () => {
    await fs.mkdir(path.join(tempDir, "dist"));
    await fs.writeFile(path.join(tempDir, "dist", "chunk-a.js"), "a".repeat(10));
    await fs.writeFile(path.join(tempDir, "dist", "chunk-b.js"), "b".repeat(10));

    const config = normalizeConfig(
      {
        files: [
          {
            path: path.join(tempDir, "dist", "*.js"),
            maxSize: "1 kB",
            compression: "none"
          }
        ]
      },
      { cwd: tempDir }
    );

    const result = await runChecks(config);
    expect(result.results).toHaveLength(2);
    expect(result.stats.hasFailures).toBe(false);
  });

  it("marks missing files as errors", async () => {
    const config = normalizeConfig(
      {
        files: [
          {
            path: path.join(tempDir, "missing.js"),
            maxSize: "1 kB",
            compression: "none"
          }
        ]
      },
      { cwd: tempDir }
    );

    const result = await runChecks(config);
    expect(result.stats.hasFailures).toBe(true);
    expect(result.results[0].error).toMatch(/No files matched/);
  });
});

