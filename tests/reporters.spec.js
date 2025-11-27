import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { consoleReporter } from "../src/reporters/console-reporter.js";
import { jsonReporter } from "../src/reporters/json-reporter.js";
import { silentReporter } from "../src/reporters/silent-reporter.js";
import { getReporter } from "../src/reporters/index.js";

const passingResult = {
  results: [
    {
      label: "main",
      filePath: "dist/main.js",
      testerLabel: "gzip",
      sizeFormatted: "10 kB",
      maxSizeFormatted: "12 kB",
      diffFormatted: "-2 kB",
      passed: true
    }
  ],
  stats: {
    hasFailures: false,
    failures: []
  }
};

const failingResult = {
  results: [
    {
      label: "main",
      filePath: "dist/main.js",
      testerLabel: "gzip",
      sizeFormatted: "14 kB",
      maxSizeFormatted: "12 kB",
      diffFormatted: "+2 kB",
      passed: false
    }
  ],
  stats: {
    hasFailures: true,
    failures: [
      {
        label: "main",
        error: null
      },
      {
        label: "secondary",
        error: "No files matched"
      }
    ]
  }
};

describe("reporters", () => {
  let logSpy;
  let errorSpy;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("consoleReporter prints table and success summary", () => {
    consoleReporter(passingResult);

    expect(logSpy).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("All 1 file(s) passed"));
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("consoleReporter prints failure summary", () => {
    consoleReporter(failingResult);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Bundle size check failed for 1 file(s)")
    );
  });

  it("jsonReporter stringifies the payload", () => {
    jsonReporter(passingResult);

    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(passingResult, null, 2));
  });

  it("silentReporter produces no output", () => {
    silentReporter(passingResult);

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("getReporter resolves registered reporters", () => {
    expect(getReporter()).toBe(consoleReporter);
    expect(getReporter("json")).toBe(jsonReporter);
    expect(getReporter("silent")).toBe(silentReporter);
  });

  it("getReporter throws for unknown reporter", () => {
    expect(() => getReporter("unknown")).toThrow(/Unknown reporter/);
  });
});

