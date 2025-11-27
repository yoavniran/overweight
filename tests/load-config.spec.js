import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../src/config/load-config.js";

const createTempProject = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "overweight-config-"));
  await fs.mkdir(path.join(dir, "dist"));
  return dir;
};

const writeJson = (target, data) => fs.writeFile(target, JSON.stringify(data, null, 2));

describe("loadConfig", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await createTempProject();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const sampleRule = () => ({
    files: [
      {
        path: "./dist/app.js",
        maxSize: "10 kB",
        compression: "gzip"
      }
    ]
  });

  it("loads overweight.json by default", async () => {
    await writeJson(path.join(tmpDir, "overweight.json"), sampleRule());

    const config = await loadConfig({ cwd: tmpDir });
    expect(config.source).toEqual({ type: "file", location: path.join(tmpDir, "overweight.json") });
    expect(config.files[0].pattern).toBe("./dist/app.js");
  });

  it("falls back to overweight.config.json when overweight.json missing", async () => {
    const configPath = path.join(tmpDir, "overweight.config.json");
    await writeJson(configPath, sampleRule());

    const config = await loadConfig({ cwd: tmpDir });
    expect(config.source.location).toBe(configPath);
  });

  it("loads configuration from package.json overweight field", async () => {
    await writeJson(path.join(tmpDir, "package.json"), {
      name: "test",
      overweight: sampleRule().files
    });

    const config = await loadConfig({ cwd: tmpDir });
    expect(config.source).toEqual({ type: "package", location: path.join(tmpDir, "package.json") });
  });

  it("respects explicit --config paths", async () => {
    const customPath = path.join(tmpDir, "configs", "sizes.json");
    await fs.mkdir(path.dirname(customPath), { recursive: true });
    await writeJson(customPath, sampleRule());

    const config = await loadConfig({ cwd: tmpDir, configPath: customPath });
    expect(config.source.location).toBe(customPath);
  });

  it("throws when no configuration exists", async () => {
    await expect(loadConfig({ cwd: tmpDir })).rejects.toThrow(/No overweight configuration found/);
  });

  it("prefers inline configuration when provided", async () => {
    const inline = sampleRule();
    const config = await loadConfig({ cwd: tmpDir, inlineConfig: inline });

    expect(config.source.type).toBe("inline");
    expect(config.files[0].pattern).toBe("./dist/app.js");
  });
});

