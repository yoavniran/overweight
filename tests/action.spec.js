import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.GITHUB_WORKSPACE = "/repo";
const originalGithubRefName = process.env.GITHUB_REF_NAME;
const originalGithubRef = process.env.GITHUB_REF;

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

const createEnoentError = () => {
  const error = new Error("ENOENT");
  error.code = "ENOENT";
  return error;
};

describe("GitHub Action integration", () => {
  beforeEach(() => {
    delete process.env.GITHUB_REF_NAME;
    delete process.env.GITHUB_REF;
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
        base: { repo: { full_name: "owner/repo" }, ref: "main" }
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

  it("creates a baseline update pull request when update-baseline is true", async () => {
    mockRunResult.stats.hasFailures = false;
    process.env.GITHUB_REF_NAME = "feature/add-bundle";
    inputs = {
      "github-token": "token",
      "baseline-report-path": "baseline.json",
      "update-baseline": "true",
      "update-pr-title": "chore: update baseline",
      "update-pr-body": "Auto PR body",
      "update-branch-prefix": "overweight/test"
    };
    fsMock.readFile.mockRejectedValueOnce(createEnoentError());
    fsMock.readFile.mockRejectedValueOnce(createEnoentError());

    await runAction();

    expect(setFailed).not.toHaveBeenCalled();
    expect(fsMock.writeFile).toHaveBeenCalledWith("/repo/baseline.json", expect.any(String));
    expect(octokitMock.rest.git.getRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: "heads/main" })
    );
    expect(octokitMock.rest.git.createRef).toHaveBeenCalled();
    expect(octokitMock.rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({ path: "baseline.json", branch: expect.stringContaining("overweight/test") })
    );
    expect(octokitMock.rest.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({
        base: "main",
        title: "chore: update baseline (🧳 Overweight Guard)",
        body: "Auto PR body"
      })
    );
    expect(setOutput).toHaveBeenCalledWith("baseline-updated", "true");
    expect(setOutput).toHaveBeenCalledWith(
      "baseline-update-pr-url",
      expect.stringContaining("https://example.com/pr/15")
    );
  });

  it("creates a baseline update pull request when existing baseline content changes", async () => {
    mockRunResult.stats.hasFailures = false;
    process.env.GITHUB_REF_NAME = "feature/update-baseline";
    inputs = {
      "github-token": "token",
      "baseline-report-path": "baseline.json",
      "update-baseline": "true"
    };
    const previousSnapshot = JSON.stringify(
      [
        {
          label: "bundle",
          file: "dist/file.js",
          tester: "gzip",
          size: "10 kB",
          sizeBytes: 10000,
          limit: "10 kB",
          limitBytes: 10000
        }
      ],
      null,
      2
    );
    fsMock.readFile.mockResolvedValueOnce(previousSnapshot);
    fsMock.readFile.mockResolvedValueOnce(previousSnapshot);

    await runAction();

    expect(fsMock.writeFile).toHaveBeenCalledWith("/repo/baseline.json", expect.any(String));
    expect(octokitMock.rest.pulls.create).toHaveBeenCalledTimes(1);
    expect(setOutput).toHaveBeenCalledWith("baseline-updated", "true");
  });

  it("defaults baseline-report-path to report-file when updating baseline without explicit path", async () => {
    mockRunResult.stats.hasFailures = false;
    process.env.GITHUB_REF_NAME = "feature/default-report";
    inputs = {
      "github-token": "token",
      "report-file": "custom-baseline.json",
      "update-baseline": "true"
    };
    fsMock.readFile.mockRejectedValueOnce(createEnoentError());
    fsMock.readFile.mockRejectedValueOnce(createEnoentError());

    await runAction();

    expect(fsMock.writeFile).toHaveBeenCalledWith("/repo/custom-baseline.json", expect.any(String));
    expect(octokitMock.rest.pulls.create).toHaveBeenCalledTimes(1);
  });

  it("skips baseline update when update-baseline is false", async () => {
    mockRunResult.stats.hasFailures = false;
    process.env.GITHUB_REF_NAME = "feature/no-update";
    inputs = {
      "github-token": "token",
      "baseline-report-path": "baseline.json",
      "update-baseline": "false"
    };
    fsMock.readFile.mockRejectedValueOnce(createEnoentError());
    fsMock.readFile.mockRejectedValueOnce(createEnoentError());

    await runAction();

    expect(fsMock.writeFile).not.toHaveBeenCalled();
    expect(setOutput).not.toHaveBeenCalledWith("baseline-updated", "true");
  });

  it("does nothing when baseline content is unchanged", async () => {
    mockRunResult.stats.hasFailures = false;
    process.env.GITHUB_REF_NAME = "feature/no-change";
    inputs = {
      "github-token": "token",
      "baseline-report-path": "baseline.json",
      "update-baseline": "true"
    };
    const snapshot = JSON.stringify(
      [
        {
          label: "bundle",
          file: "dist/file.js",
          tester: "gzip",
          size: "12 kB",
          sizeBytes: 12000,
          limit: "10 kB",
          limitBytes: 10000
        }
      ],
      null,
      2
    );
    fsMock.readFile.mockResolvedValueOnce(snapshot);
    fsMock.readFile.mockResolvedValueOnce(snapshot);

    await runAction();

    expect(fsMock.writeFile).not.toHaveBeenCalled();
    expect(octokitMock.rest.pulls.create).not.toHaveBeenCalled();
    expect(setOutput).not.toHaveBeenCalledWith("baseline-updated", "true");
  });

  it("fails when update-baseline is true but github-token is missing", async () => {
    mockRunResult.stats.hasFailures = false;
    inputs = {
      "baseline-report-path": "baseline.json",
      "update-baseline": "true"
    };
    fsMock.readFile.mockRejectedValueOnce(createEnoentError());
    fsMock.readFile.mockRejectedValueOnce(createEnoentError());

    await runAction();

    expect(fsMock.writeFile).not.toHaveBeenCalled();
    expect(setFailed).toHaveBeenCalledWith(
      "update-baseline requires github-token to be provided."
    );
  });

  afterAll(() => {
    if (originalGithubRefName === undefined) {
      delete process.env.GITHUB_REF_NAME;
    } else {
      process.env.GITHUB_REF_NAME = originalGithubRefName;
    }

    if (originalGithubRef === undefined) {
      delete process.env.GITHUB_REF;
    } else {
      process.env.GITHUB_REF = originalGithubRef;
    }
  });
});

