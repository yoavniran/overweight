import { describe, it, expect, beforeEach, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.GITHUB_WORKSPACE = "/repo";

let inputs = {};
const summary = vi.hoisted(() => {
  const summaryObj = {
    addHeading: vi.fn(),
    addTable: vi.fn(),
    write: vi.fn()
  };
  summaryObj.addHeading.mockReturnThis();
  summaryObj.addTable.mockReturnThis();
  return summaryObj;
});
const setOutput = vi.hoisted(() => vi.fn());
const setFailed = vi.hoisted(() => vi.fn());
const info = vi.hoisted(() => vi.fn());
const warning = vi.hoisted(() => vi.fn());

vi.mock("@actions/core", () => {
  const coreMock = {
  getInput: (key) => inputs[key] ?? "",
  getBooleanInput: (key) => {
    const value = inputs[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      return value.toLowerCase() === "true";
    }
    return false;
  },
  summary,
  setOutput,
  setFailed,
  info,
  warning
  };
  return {
    ...coreMock,
    default: coreMock
  };
});

const githubContext = vi.hoisted(() => ({
  payload: {
    action: "opened",
    pull_request: {
      number: 7,
      head: { repo: { full_name: "owner/repo" } },
      base: { repo: { full_name: "owner/repo" } }
    }
  },
  repo: { owner: "owner", repo: "repo" }
}));

const octokitMock = vi.hoisted(() => {
  const issuesApi = {
    listComments: vi.fn().mockResolvedValue({ data: [] }),
    createComment: vi.fn().mockResolvedValue({}),
    updateComment: vi.fn().mockResolvedValue({}),
    addLabels: vi.fn().mockResolvedValue({})
  };
  const reposApi = {
    createOrUpdateFileContents: vi.fn().mockResolvedValue({})
  };
  const pullsApi = {
    create: vi.fn().mockResolvedValue({ data: { number: 15, html_url: "https://example.com/pr/15" } })
  };
  const gitApi = {
    getRef: vi.fn().mockResolvedValue({ data: { object: { sha: "abc123" } } }),
    createRef: vi.fn().mockResolvedValue({})
  };

  return {
    rest: {
      issues: issuesApi,
      repos: reposApi,
      pulls: pullsApi,
      git: gitApi
    },
    issues: issuesApi,
    repos: reposApi,
    pulls: pullsApi,
    git: gitApi
  };
});

vi.mock("@actions/github", () => {
  const githubModule = {
    context: githubContext,
    getOctokit: () => octokitMock
  };
  return {
    ...githubModule,
    default: githubModule
  };
});

let mockConfig;
const loadConfig = vi.hoisted(() => vi.fn());
vi.mock("../src/config/load-config.js", () => ({
  loadConfig,
  normalizeConfig: vi.fn()
}));

let mockRunResult;
const runChecks = vi.hoisted(() => vi.fn());
vi.mock("../src/core/run-checks.js", () => ({
  runChecks
}));

const jsonFileReporter = vi.hoisted(() => vi.fn());
vi.mock("../src/reporters/json-file-reporter.js", () => ({
  jsonFileReporter
}));

const fsMock = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  rm: vi.fn()
}));
vi.mock("node:fs/promises", () => {
  fsMock.default = fsMock;
  return fsMock;
});

import runAction from "../src/action/index.js";

const resetOctokitMocks = () => {
  Object.values(octokitMock.rest.issues).forEach((fn) => fn.mockClear?.());
  Object.values(octokitMock.rest.repos).forEach((fn) => fn.mockClear?.());
  Object.values(octokitMock.rest.pulls).forEach((fn) => fn.mockClear?.());
  Object.values(octokitMock.git).forEach((fn) => fn.mockClear?.());
};

describe("GitHub Action integration", () => {
  beforeEach(() => {
    inputs = {};
    mockConfig = { root: "/repo", files: [] };
    mockRunResult = {
      results: [
        {
          label: "bundle",
          filePath: "dist/file.js",
          testerLabel: "gzip",
          sizeFormatted: "12 kB",
          maxSizeFormatted: "10 kB",
          diffFormatted: "+2 kB",
          passed: false,
          size: 12000,
          maxSize: 10000,
          diff: 2000
        }
      ],
      stats: { hasFailures: false }
    };
    setOutput.mockClear();
    setFailed.mockClear();
    info.mockClear();
    warning.mockClear();
    summary.addHeading.mockClear();
    summary.addTable.mockClear();
    summary.write.mockClear();
    loadConfig.mockReset();
    runChecks.mockReset();
    jsonFileReporter.mockReset();
    loadConfig.mockImplementation(async () => mockConfig);
    runChecks.mockImplementation(async () => mockRunResult);
    resetOctokitMocks();
    fsMock.readFile.mockReset();
    fsMock.writeFile.mockReset();
    fsMock.mkdir.mockReset();
    fsMock.rm.mockReset();
    githubContext.payload = {
      action: "opened",
      pull_request: {
        number: 7,
        head: { repo: { full_name: "owner/repo" } },
        base: { repo: { full_name: "owner/repo" } }
      }
    };
  });

  it("comments when checks fail and commenting is enabled", async () => {
    mockRunResult.stats.hasFailures = true;
    inputs = {
      "github-token": "token",
      "comment-on-pr": "true"
    };

    await runAction();

    expect(octokitMock.rest.issues.createComment).toHaveBeenCalledTimes(1);
    expect(octokitMock.rest.issues.createComment.mock.calls[0][0].body).toContain("Size check failed");
    expect(octokitMock.rest.issues.listComments).toHaveBeenCalledTimes(1);
    expect(setFailed).toHaveBeenCalledWith("One or more size checks failed.");
  });

  it("updates existing comment when checks transition from fail to pass", async () => {
    mockRunResult.stats.hasFailures = true;
    inputs = {
      "github-token": "token",
      "comment-on-pr": "true"
    };

    await runAction();

    expect(octokitMock.rest.issues.createComment).toHaveBeenCalledTimes(1);
    expect(octokitMock.rest.issues.listComments).toHaveBeenCalledTimes(1);

    octokitMock.rest.issues.listComments.mockResolvedValueOnce({
      data: [
        {
          id: 123,
          user: { type: "Bot" },
          body: "<!-- overweight-report -->\nFailing report",
          updated_at: new Date().toISOString()
        }
      ]
    });

    mockRunResult.stats.hasFailures = false;
    inputs = {
      "github-token": "token",
      "comment-on-pr-always": "true"
    };

    await runAction();

    expect(octokitMock.rest.issues.listComments).toHaveBeenCalledTimes(2);
    expect(octokitMock.rest.issues.updateComment).toHaveBeenCalledTimes(1);
    expect(octokitMock.rest.issues.updateComment.mock.calls[0][0].comment_id).toBe(123);
    expect(octokitMock.rest.issues.updateComment.mock.calls[0][0].body).toContain("Size check passed");
  });

  it("comments on first successful run when comment-on-pr-always is true", async () => {
    mockRunResult.stats.hasFailures = false;
    inputs = {
      "github-token": "token",
      "comment-on-pr-always": "true"
    };

    await runAction();

    expect(octokitMock.rest.issues.createComment).toHaveBeenCalledTimes(1);
    expect(octokitMock.rest.issues.createComment.mock.calls[0][0].body).toContain("Size check passed");
    expect(octokitMock.rest.issues.listComments).toHaveBeenCalledTimes(1);
    expect(setFailed).not.toHaveBeenCalled();
  });

  it("creates a baseline PR when baseline-create-pr is true", async () => {
    mockRunResult.stats.hasFailures = false;
    inputs = {
      "github-token": "token",
      "baseline-report-path": "baseline.json",
      "update-baseline": "true",
      "baseline-create-pr": "true",
      "baseline-branch": "main",
      "baseline-pr-title": "chore: update baseline",
      "baseline-pr-body": "refresh baseline",
      "baseline-pr-branch-prefix": "overweight/base",
      "baseline-pr-labels": "baseline"
    };
    githubContext.payload = { action: "push" };
    fsMock.readFile.mockResolvedValue("[]");

    await runAction();

    expect(setFailed).not.toHaveBeenCalled();
    expect(octokitMock.rest.issues.listComments).not.toHaveBeenCalled();
    expect(octokitMock.git.getRef).toHaveBeenCalled();
    expect(octokitMock.git.createRef).toHaveBeenCalled();
    expect(octokitMock.rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({ path: "baseline.json" })
    );
    expect(octokitMock.rest.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: "chore: update baseline" })
    );
    expect(setOutput).toHaveBeenCalledWith("baseline-pr-url", "https://example.com/pr/15");
  });

  it("defaults baseline-report-path to report-file when updating baseline without explicit path", async () => {
    mockRunResult.stats.hasFailures = false;
    inputs = {
      "github-token": "token",
      "report-file": "custom-baseline.json",
      "update-baseline": "true",
      "baseline-create-pr": "true"
    };
    githubContext.payload = { action: "push" };
    fsMock.readFile.mockResolvedValueOnce("[]");
    fsMock.readFile.mockResolvedValueOnce("[]");

    await runAction();

    expect(fsMock.writeFile).toHaveBeenCalledWith(
      "/repo/custom-baseline.json",
      expect.any(String)
    );
    expect(octokitMock.rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({ path: "custom-baseline.json" })
    );
  });
});

