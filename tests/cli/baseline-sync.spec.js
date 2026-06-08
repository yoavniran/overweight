import { describe, it, expect, beforeEach, vi } from "vitest";

const fsMock = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn()
}));
vi.mock("node:fs/promises", () => {
  fsMock.default = fsMock;
  return fsMock;
});

import { syncBaseline } from "../../src/cli/baseline-sync.js";

const ENOENT = Object.assign(new Error("ENOENT"), { code: "ENOENT" });

const makeResult = (sizeBytes) => ({
  results: [
    {
      label: "app",
      filePath: "dist/app.js",
      testerLabel: "gzip",
      size: sizeBytes,
      sizeFormatted: `${sizeBytes} B`,
      maxSize: 20000,
      maxSizeFormatted: "20 kB"
    }
  ]
});

const previousSnapshot = (sizeBytes) =>
  JSON.stringify([
    {
      label: "app",
      file: "dist/app.js",
      tester: "gzip",
      size: `${sizeBytes} B`,
      sizeBytes,
      limit: "20 kB",
      limitBytes: 20000
    }
  ]);

describe("syncBaseline", () => {
  beforeEach(() => {
    fsMock.readFile.mockReset();
    fsMock.writeFile.mockReset();
    fsMock.mkdir.mockReset();
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
  });

  it("skips when no baseline path is given", async () => {
    const outcome = await syncBaseline({ result: makeResult(10000), root: "/repo" });
    expect(outcome).toEqual({ status: "skipped" });
    expect(fsMock.readFile).not.toHaveBeenCalled();
  });

  it("throws when --update-baseline is set without a baseline path", async () => {
    await expect(syncBaseline({ result: makeResult(10000), update: true, root: "/repo" })).rejects.toThrow(
      /--update-baseline requires --baseline/
    );
  });

  it("reports up-to-date when within the default tolerance", async () => {
    fsMock.readFile.mockResolvedValueOnce(previousSnapshot(10000));
    // +0.5% is within the default 1%
    const outcome = await syncBaseline({
      result: makeResult(10050),
      baseline: "baseline.json",
      root: "/repo"
    });
    expect(outcome).toEqual({ status: "up-to-date", path: "baseline.json" });
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it("reports drift (without writing) when beyond tolerance and not updating", async () => {
    fsMock.readFile.mockResolvedValueOnce(previousSnapshot(10000));
    const outcome = await syncBaseline({
      result: makeResult(11000), // +10%
      baseline: "baseline.json",
      root: "/repo"
    });
    expect(outcome).toEqual({ status: "drift", path: "baseline.json" });
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it("writes and reports updated when beyond tolerance with --update-baseline", async () => {
    fsMock.readFile.mockResolvedValueOnce(previousSnapshot(10000));
    const outcome = await syncBaseline({
      result: makeResult(11000),
      baseline: "baseline.json",
      update: true,
      root: "/repo"
    });
    expect(outcome).toEqual({ status: "updated", path: "baseline.json" });
    expect(fsMock.writeFile).toHaveBeenCalledTimes(1);
    const written = JSON.parse(fsMock.writeFile.mock.calls[0][1]);
    expect(written[0].sizeBytes).toBe(11000);
  });

  it("creates the baseline when none exists and --update-baseline is set", async () => {
    fsMock.readFile.mockRejectedValueOnce(ENOENT);
    const outcome = await syncBaseline({
      result: makeResult(10000),
      baseline: "baseline.json",
      update: true,
      root: "/repo"
    });
    expect(outcome).toEqual({ status: "created", path: "baseline.json" });
    expect(fsMock.writeFile).toHaveBeenCalledTimes(1);
  });

  it("reports drift when no baseline exists and not updating", async () => {
    fsMock.readFile.mockRejectedValueOnce(ENOENT);
    const outcome = await syncBaseline({
      result: makeResult(10000),
      baseline: "baseline.json",
      root: "/repo"
    });
    expect(outcome).toEqual({ status: "drift", path: "baseline.json" });
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it("honors an explicit 0 threshold (byte-exact) over the default", async () => {
    fsMock.readFile.mockResolvedValueOnce(previousSnapshot(10000));
    const outcome = await syncBaseline({
      result: makeResult(10001), // +1 byte
      baseline: "baseline.json",
      threshold: 0,
      root: "/repo"
    });
    expect(outcome.status).toBe("drift");
  });

  it("accepts an absolute size-string threshold", async () => {
    fsMock.readFile.mockResolvedValueOnce(previousSnapshot(10000));
    const outcome = await syncBaseline({
      result: makeResult(10040), // +40 B, within 50 B
      baseline: "baseline.json",
      threshold: "50 B",
      root: "/repo"
    });
    expect(outcome.status).toBe("up-to-date");
  });
});
