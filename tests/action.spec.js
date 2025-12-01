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
const execExec = vi.hoisted(() => vi.fn());

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

const createNotFoundError = vi.hoisted(() => {
  return () => {
    const error = new Error("Not Found");
    error.status = 404;
    return error;
  };
});

const octokitMock = vi.hoisted(() => {
  const issuesApi = {
    listComments: vi.fn().mockResolvedValue({ data: [] }),
    createComment: vi.fn().mockResolvedValue({}),
    updateComment: vi.fn().mockResolvedValue({}),
    addLabels: vi.fn().mockResolvedValue({})
  };
  const reposApi = {
    createOrUpdateFileContents: vi.fn().mockResolvedValue({}),
    getContent: vi.fn().mockRejectedValue(createNotFoundError()),
    get: vi.fn().mockResolvedValue({ data: { default_branch: "main" } })
  };
  const pullsApi = {
    create: vi.fn().mockResolvedValue({ data: { number: 15, html_url: "https://example.com/pr/15" } }),
    list: vi.fn().mockResolvedValue({ data: [] })
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

vi.mock("@actions/exec", () => {
  return {
    exec: execExec
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
  Object.values(octokitMock.rest.issues).forEach((fn) => fn.mockReset?.());
  Object.values(octokitMock.rest.repos).forEach((fn) => fn.mockReset?.());
  Object.values(octokitMock.rest.pulls).forEach((fn) => fn.mockReset?.());
  Object.values(octokitMock.git).forEach((fn) => fn.mockReset?.());

  octokitMock.rest.issues.listComments.mockResolvedValue({ data: [] });
  octokitMock.rest.issues.createComment.mockResolvedValue({});
  octokitMock.rest.issues.updateComment.mockResolvedValue({});
  octokitMock.rest.issues.addLabels.mockResolvedValue({});

  octokitMock.rest.repos.createOrUpdateFileContents.mockResolvedValue({});
  octokitMock.rest.repos.getContent.mockRejectedValue(createNotFoundError());
  octokitMock.rest.repos.get.mockResolvedValue({ data: { default_branch: "main" } });

  octokitMock.rest.pulls.create.mockResolvedValue({
    data: { number: 15, html_url: "https://example.com/pr/15" }
  });
  octokitMock.rest.pulls.list.mockResolvedValue({ data: [] });

  octokitMock.rest.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
  octokitMock.rest.git.createRef.mockResolvedValue({});
  
  // Reset exec mock - by default, git commands succeed
  execExec.mockReset();
  execExec.mockResolvedValue(0);
};

const createEnoentError = () => {
  const error = new Error("ENOENT");
  error.code = "ENOENT";
  return error;
};

// Helper to setup git exec mocks for branch operations
const setupGitMocks = (options = {}) => {
  const {
    branchExists = false, // Whether the branch exists when fetched
    baseBranch = "main"
  } = options;
  
  execExec.mockImplementation((command, args) => {
    if (command !== "git") {
      return Promise.resolve(0);
    }
    
    // Handle git fetch for branch check
    if (args?.[0] === "fetch" && args?.some(arg => typeof arg === "string" && arg.includes("overweight/baseline"))) {
      if (branchExists) {
        return Promise.resolve(0); // Branch exists
      } else {
        return Promise.reject(new Error("branch not found")); // Branch doesn't exist
      }
    }
    
    // All other git commands succeed
    return Promise.resolve(0);
  });
};

const buildSnapshotFromResults = () =>
  JSON.stringify(
    [...mockRunResult.results]
      .map((entry) => ({
        label: entry.label,
        file: entry.filePath,
        tester: entry.testerLabel,
        size: entry.sizeFormatted,
        sizeBytes: typeof entry.size === "number" ? entry.size : 0,
        limit: entry.maxSizeFormatted,
        limitBytes: entry.maxSize
      }))
      .sort((a, b) => a.file.localeCompare(b.file)),
    null,
    2
  );

describe("GitHub Action integration", () => {
  beforeEach(() => {
    delete process.env.GITHUB_REF_NAME;
    delete process.env.GITHUB_REF;
    inputs = {};
    mockConfig = { root: "/repo", files: [] };
    resetOctokitMocks();
    // Setup default git mocks - branch doesn't exist by default
    setupGitMocks({ branchExists: false });
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
    setupGitMocks({ branchExists: false });

    await runAction();

    expect(setFailed).not.toHaveBeenCalled();
    expect(fsMock.writeFile).toHaveBeenCalledWith("/repo/baseline.json", expect.any(String));
    // Check that git commands were called (push should be called during branch creation)
    const allGitCalls = execExec.mock.calls.filter(call => call[0] === "git");
    expect(allGitCalls.length).toBeGreaterThan(0);
    expect(octokitMock.rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "baseline.json",
        branch: "overweight/test/pr-7",
        sha: undefined,
        committer: expect.objectContaining({ name: "Overweight Bot" })
      })
    );
    expect(octokitMock.rest.pulls.list).toHaveBeenCalledWith(
      expect.objectContaining({ head: "owner:overweight/test/pr-7", state: "open" })
    );
    expect(octokitMock.rest.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({
        base: "main",
        head: "overweight/test/pr-7",
        title: "chore: update baseline (🧳 Overweight Guard)",
        body: "Auto PR body"
      })
    );
    expect(setOutput).toHaveBeenCalledWith("baseline-updated", "true");
    expect(setOutput).toHaveBeenCalledWith("baseline-update-pr-number", "15");
    expect(setOutput).toHaveBeenCalledWith(
      "baseline-update-pr-url",
      expect.stringContaining("https://example.com/pr/15")
    );
  });

  it("includes the existing file sha when creating the baseline update branch", async () => {
    mockRunResult.stats.hasFailures = false;
    process.env.GITHUB_REF_NAME = "feature/add-sha";
    inputs = {
      "github-token": "token",
      "baseline-report-path": "baseline.json",
      "update-baseline": "true"
    };
    fsMock.readFile.mockRejectedValueOnce(createEnoentError());
    octokitMock.rest.git.getRef
      .mockRejectedValueOnce(createNotFoundError())
      .mockResolvedValueOnce({ data: { object: { sha: "abc123" } } });
    octokitMock.rest.repos.getContent.mockResolvedValueOnce({
      data: { type: "file", sha: "baseline-sha" }
    });

    await runAction();

    expect(octokitMock.rest.repos.getContent).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "baseline.json",
        ref: "overweight/baseline/pr-7"
      })
    );
    expect(octokitMock.rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({ sha: "baseline-sha" })
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
    octokitMock.rest.git.getRef
      .mockRejectedValueOnce(createNotFoundError())
      .mockResolvedValueOnce({ data: { object: { sha: "abc123" } } });

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
    octokitMock.rest.git.getRef
      .mockRejectedValueOnce(createNotFoundError())
      .mockResolvedValueOnce({ data: { object: { sha: "abc123" } } });

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

    await runAction();

    expect(fsMock.writeFile).not.toHaveBeenCalled();
    expect(setOutput).not.toHaveBeenCalledWith("baseline-updated", "true");
  });

  it("skips baseline update on default protected branches", async () => {
    mockRunResult.stats.hasFailures = false;
    process.env.GITHUB_REF_NAME = "main";
    inputs = {
      "github-token": "token",
      "baseline-report-path": "baseline.json",
      "update-baseline": "true"
    };
    fsMock.readFile.mockRejectedValueOnce(createEnoentError());

    await runAction();

    expect(fsMock.writeFile).not.toHaveBeenCalled();
    expect(octokitMock.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
    expect(setOutput).not.toHaveBeenCalledWith("baseline-updated", "true");
  });

  it("skips baseline update when branch matches custom protected patterns", async () => {
    mockRunResult.stats.hasFailures = false;
    process.env.GITHUB_REF_NAME = "release-2025.11";
    inputs = {
      "github-token": "token",
      "baseline-report-path": "baseline.json",
      "update-baseline": "true",
      "baseline-protected-branches": "main,release-*"
    };
    fsMock.readFile.mockRejectedValueOnce(createEnoentError());

    await runAction();

    expect(fsMock.writeFile).not.toHaveBeenCalled();
    expect(octokitMock.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
    expect(setOutput).not.toHaveBeenCalledWith("baseline-updated", "true");
  });

  it("fails when update-baseline is true but github-token is missing", async () => {
    mockRunResult.stats.hasFailures = false;
    inputs = {
      "baseline-report-path": "baseline.json",
      "update-baseline": "true"
    };
    fsMock.readFile.mockRejectedValueOnce(createEnoentError());

    await runAction();

    expect(fsMock.writeFile).not.toHaveBeenCalled();
    expect(setFailed).toHaveBeenCalledWith(
      "update-baseline requires github-token to be provided."
    );
  });

  it("skips baseline update when checks fail even if update-baseline is true", async () => {
    mockRunResult.stats.hasFailures = true;
    process.env.GITHUB_REF_NAME = "feature/failing";
    inputs = {
      "github-token": "token",
      "baseline-report-path": "baseline.json",
      "update-baseline": "true"
    };
    fsMock.readFile.mockRejectedValueOnce(createEnoentError());

    await runAction();

    expect(fsMock.writeFile).not.toHaveBeenCalled();
    expect(octokitMock.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
    expect(octokitMock.rest.pulls.create).not.toHaveBeenCalled();
    expect(setOutput).not.toHaveBeenCalledWith("baseline-updated", "true");
  });

  it("updates existing baseline PR instead of opening a new one", async () => {
    mockRunResult.stats.hasFailures = false;
    process.env.GITHUB_REF_NAME = "feature/reuse";
    inputs = {
      "github-token": "token",
      "baseline-report-path": "baseline.json",
      "update-baseline": "true"
    };
    fsMock.readFile.mockRejectedValueOnce(createEnoentError());
    octokitMock.rest.repos.getContent.mockResolvedValueOnce({
      data: { type: "file", sha: "existing-sha" }
    });
    octokitMock.rest.pulls.list.mockResolvedValueOnce({
      data: [{ number: 42, html_url: "https://example.com/pr/42" }]
    });

    await runAction();

    expect(octokitMock.rest.git.createRef).not.toHaveBeenCalled();
    expect(octokitMock.rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({ sha: "existing-sha" })
    );
    expect(octokitMock.rest.pulls.create).not.toHaveBeenCalled();
    expect(setOutput).toHaveBeenCalledWith("baseline-update-pr-number", "42");
    expect(setOutput).toHaveBeenCalledWith("baseline-update-pr-url", "https://example.com/pr/42");
  });

  it("does nothing when baseline content is unchanged", async () => {
    mockRunResult.stats.hasFailures = false;
    process.env.GITHUB_REF_NAME = "feature/no-change";
    inputs = {
      "github-token": "token",
      "baseline-report-path": "baseline.json",
      "update-baseline": "true"
    };
    const snapshot = buildSnapshotFromResults();
    fsMock.readFile.mockResolvedValueOnce(snapshot);

    await runAction();

    expect(octokitMock.rest.git.createRef).not.toHaveBeenCalled();
    expect(octokitMock.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
    expect(octokitMock.rest.pulls.create).not.toHaveBeenCalled();
    expect(setOutput).not.toHaveBeenCalledWith("baseline-updated", "true");
  });

  it("skips baseline update when baseline path defaults to report-file and nothing changed", async () => {
    mockRunResult.stats.hasFailures = false;
    process.env.GITHUB_REF_NAME = "feature/shared-report";
    inputs = {
      "github-token": "token",
      "report-file": "shared-report.json",
      "update-baseline": "true"
    };
    const snapshot = buildSnapshotFromResults();
    fsMock.readFile.mockResolvedValueOnce(snapshot);
    fsMock.readFile.mockResolvedValueOnce("should-not-be-read");

    await runAction();

    expect(fsMock.readFile).toHaveBeenCalledTimes(1);
    expect(octokitMock.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
    expect(octokitMock.rest.pulls.create).not.toHaveBeenCalled();
    expect(setOutput).not.toHaveBeenCalledWith("baseline-updated", "true");
  });

  it("detects PR number when workflow_dispatch runs on a branch with an open PR", async () => {
    mockRunResult.stats.hasFailures = false;
    githubContext.payload = {
      action: "workflow_dispatch",
      ref: "refs/heads/feature/manual"
    };
    process.env.GITHUB_REF_NAME = "feature/manual";
    inputs = {
      "github-token": "token",
      "baseline-report-path": "baseline.json",
      "update-baseline": "true"
    };
    fsMock.readFile.mockRejectedValueOnce(createEnoentError());
    octokitMock.rest.pulls.list
      .mockResolvedValueOnce({ data: [{ number: 88, html_url: "https://example.com/pr/88" }] })
      .mockResolvedValueOnce({ data: [{ number: 90, html_url: "https://example.com/pr/90" }] });
    octokitMock.rest.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
    octokitMock.rest.repos.getContent.mockResolvedValueOnce({
      data: { type: "file", sha: "baseline-sha" }
    });

    await runAction();

    expect(octokitMock.rest.git.createRef).not.toHaveBeenCalled();
    expect(octokitMock.rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({ branch: "overweight/baseline/pr-88", sha: "baseline-sha" })
    );
    expect(octokitMock.rest.pulls.create).not.toHaveBeenCalled();
    expect(setOutput).toHaveBeenCalledWith("baseline-update-pr-number", "90");
    expect(setOutput).toHaveBeenCalledWith("baseline-update-pr-url", "https://example.com/pr/90");
  });

  describe("resolveBaseBranch", () => {
    it("uses PR base branch when in PR context", async () => {
      mockRunResult.stats.hasFailures = false;
      githubContext.payload = {
        action: "opened",
        pull_request: {
          number: 7,
          head: { repo: { full_name: "owner/repo" } },
          base: { repo: { full_name: "owner/repo" }, ref: "develop" }
        }
      };
      process.env.GITHUB_REF_NAME = "feature/test";
      inputs = {
        "github-token": "token",
        "baseline-report-path": "baseline.json",
        "update-baseline": "true"
      };
      fsMock.readFile.mockRejectedValueOnce(createEnoentError());
      octokitMock.rest.git.getRef
        .mockRejectedValueOnce(createNotFoundError())
        .mockResolvedValueOnce({ data: { object: { sha: "abc123" } } });

      await runAction();

      expect(info).toHaveBeenCalledWith(expect.stringContaining("base branch is develop"));
      expect(octokitMock.rest.pulls.create).toHaveBeenCalledWith(
        expect.objectContaining({ base: "develop" })
      );
    });

    it("uses default branch from API when no PR context", async () => {
      mockRunResult.stats.hasFailures = false;
      githubContext.payload = {};
      process.env.GITHUB_REF_NAME = "feature-branch";
      delete process.env.GITHUB_REF;
      octokitMock.rest.repos.get.mockResolvedValueOnce({
        data: { default_branch: "master" }
      });
      inputs = {
        "github-token": "token",
        "baseline-report-path": "baseline.json",
        "update-baseline": "true"
      };
      fsMock.readFile.mockRejectedValueOnce(createEnoentError());
      octokitMock.rest.git.getRef
        .mockRejectedValueOnce(createNotFoundError())
        .mockResolvedValueOnce({ data: { object: { sha: "abc123" } } });

      await runAction();

      expect(octokitMock.rest.repos.get).toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith(expect.stringContaining("base branch is master"));
      expect(octokitMock.rest.pulls.create).toHaveBeenCalledWith(
        expect.objectContaining({ base: "master" })
      );
    });

    it("uses default branch from API regardless of GITHUB_REF", async () => {
      mockRunResult.stats.hasFailures = false;
      githubContext.payload = {};
      delete process.env.GITHUB_REF_NAME;
      process.env.GITHUB_REF = "refs/heads/release-v1";
      octokitMock.rest.repos.get.mockResolvedValueOnce({
        data: { default_branch: "main" }
      });
      inputs = {
        "github-token": "token",
        "baseline-report-path": "baseline.json",
        "update-baseline": "true"
      };
      fsMock.readFile.mockRejectedValueOnce(createEnoentError());
      octokitMock.rest.git.getRef
        .mockRejectedValueOnce(createNotFoundError())
        .mockResolvedValueOnce({ data: { object: { sha: "abc123" } } });

      await runAction();

      expect(octokitMock.rest.repos.get).toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith(expect.stringContaining("base branch is main"));
    });

    it("fetches default branch from API when no context available", async () => {
      mockRunResult.stats.hasFailures = false;
      githubContext.payload = {};
      delete process.env.GITHUB_REF_NAME;
      delete process.env.GITHUB_REF;
      octokitMock.rest.repos.get.mockResolvedValueOnce({
        data: { default_branch: "master" }
      });
      inputs = {
        "github-token": "token",
        "baseline-report-path": "baseline.json",
        "update-baseline": "true"
      };
      fsMock.readFile.mockRejectedValueOnce(createEnoentError());
      octokitMock.rest.git.getRef
        .mockRejectedValueOnce(createNotFoundError())
        .mockResolvedValueOnce({ data: { object: { sha: "abc123" } } });

      await runAction();

      expect(octokitMock.rest.repos.get).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo"
      });
      expect(info).toHaveBeenCalledWith(expect.stringContaining("base branch is master"));
      expect(octokitMock.rest.pulls.create).toHaveBeenCalledWith(
        expect.objectContaining({ base: "master" })
      );
    });

    it("falls back to main when API call fails", async () => {
      mockRunResult.stats.hasFailures = false;
      githubContext.payload = {};
      delete process.env.GITHUB_REF_NAME;
      delete process.env.GITHUB_REF;
      octokitMock.rest.repos.get.mockRejectedValueOnce(new Error("API error"));
      inputs = {
        "github-token": "token",
        "baseline-report-path": "baseline.json",
        "update-baseline": "true"
      };
      fsMock.readFile.mockRejectedValueOnce(createEnoentError());
      octokitMock.rest.git.getRef
        .mockRejectedValueOnce(createNotFoundError())
        .mockResolvedValueOnce({ data: { object: { sha: "abc123" } } });

      await runAction();

      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining("Falling back to 'main' as base branch")
      );
    });
  });

  describe("ensureUpdateBranchExists", () => {
    it("reuses existing branch when it already exists", async () => {
      mockRunResult.stats.hasFailures = false;
      process.env.GITHUB_REF_NAME = "feature/existing-branch";
      inputs = {
        "github-token": "token",
        "baseline-report-path": "baseline.json",
        "update-baseline": "true"
      };
      fsMock.readFile.mockRejectedValueOnce(createEnoentError());
      setupGitMocks({ branchExists: true });

      await runAction();

      // Check that git fetch was called for the branch
      const fetchCalls = execExec.mock.calls.filter(
        call => call[0] === "git" && call[1]?.[0] === "fetch" && call[1]?.[1] === "origin"
      );
      expect(fetchCalls.length).toBeGreaterThan(0);
      const fetchArgs = fetchCalls[0][1];
      expect(fetchArgs).toContain("fetch");
      expect(fetchArgs).toContain("origin");
      expect(fetchArgs.some(arg => typeof arg === "string" && arg.includes("overweight/baseline/pr-7"))).toBe(true);
      
      // Check that git checkout was called for the branch
      const checkoutCalls = execExec.mock.calls.filter(
        call => call[0] === "git" && call[1]?.[0] === "checkout" && !call[1]?.includes("-b")
      );
      expect(checkoutCalls.length).toBeGreaterThan(0);
      const checkoutArgs = checkoutCalls[0][1];
      expect(checkoutArgs.some(arg => typeof arg === "string" && arg.includes("overweight/baseline/pr-7"))).toBe(true);
    });

    it("creates new branch when it does not exist", async () => {
      mockRunResult.stats.hasFailures = false;
      process.env.GITHUB_REF_NAME = "feature/new-branch";
      inputs = {
        "github-token": "token",
        "baseline-report-path": "baseline.json",
        "update-baseline": "true"
      };
      fsMock.readFile.mockRejectedValueOnce(createEnoentError());
      setupGitMocks({ branchExists: false });

      await runAction();

      // Verify git commands were called
      const allCalls = execExec.mock.calls;
      const fetchBranchCalls = allCalls.filter(
        call => call[0] === "git" && call[1]?.[0] === "fetch" && 
        call[1]?.some(arg => typeof arg === "string" && arg.includes("overweight/baseline/pr-7"))
      );
      expect(fetchBranchCalls.length).toBeGreaterThan(0);
      
      const fetchBaseCalls = allCalls.filter(
        call =>
          call[0] === "git" &&
          call[1]?.[0] === "fetch" &&
          call[1]?.some(
            arg => typeof arg === "string" && arg.includes("refs/remotes/origin/main")
          )
      );
      expect(fetchBaseCalls.length).toBeGreaterThan(0);

      const createBranchCalls = allCalls.filter(
        call =>
          call[0] === "git" &&
          call[1]?.[0] === "checkout" &&
          call[1]?.includes("-B") &&
          call[1]?.some(
            arg => typeof arg === "string" && arg.includes("origin/main")
          )
      );
      expect(createBranchCalls.length).toBeGreaterThan(0);
      
      const pushCalls = allCalls.filter(
        call => call[0] === "git" && call[1]?.[0] === "push" &&
        call[1]?.some(arg => typeof arg === "string" && arg.includes("overweight/baseline/pr-7"))
      );
      expect(pushCalls.length).toBeGreaterThan(0);
    });

    it("handles race condition when branch is created between check and create", async () => {
      mockRunResult.stats.hasFailures = false;
      process.env.GITHUB_REF_NAME = "feature/race-condition";
      inputs = {
        "github-token": "token",
        "baseline-report-path": "baseline.json",
        "update-baseline": "true"
      };
      fsMock.readFile.mockRejectedValueOnce(createEnoentError());
      // First fetch fails (branch doesn't exist), then we create it
      setupGitMocks({ branchExists: false });

      await runAction();

      // Should try to fetch first (fails), then create branch
      const fetchCalls = execExec.mock.calls.filter(
        call => call[0] === "git" && call[1]?.[0] === "fetch" && 
        call[1]?.some(arg => typeof arg === "string" && arg.includes("overweight/baseline/pr-7"))
      );
      expect(fetchCalls.length).toBeGreaterThan(0);
      // The action should complete successfully
      expect(octokitMock.rest.repos.createOrUpdateFileContents).toHaveBeenCalled();
    });

    it("throws error for git push failures", async () => {
      mockRunResult.stats.hasFailures = false;
      process.env.GITHUB_REF_NAME = "feature/error-case";
      inputs = {
        "github-token": "token",
        "baseline-report-path": "baseline.json",
        "update-baseline": "true"
      };
      fsMock.readFile.mockRejectedValueOnce(createEnoentError());
      // Make git push fail with a real error
      let pushCalled = false;
      execExec.mockImplementation((command, args) => {
        if (command !== "git") {
          return Promise.resolve(0);
        }
        if (args?.[0] === "fetch" && args?.some(arg => typeof arg === "string" && arg.includes("overweight/baseline"))) {
          // Branch does not exist yet
          return Promise.reject(new Error("branch not found"));
        }
        if (args?.[0] === "fetch" && args?.some(arg => typeof arg === "string" && arg.includes("refs/remotes/origin/main"))) {
          return Promise.resolve(0);
        }
        if (args?.[0] === "checkout") {
          return Promise.resolve(0);
        }
        if (args?.[0] === "push") {
          pushCalled = true;
          return Promise.reject(new Error("Permission denied"));
        }
        return Promise.resolve(0);
      });

      await runAction();

      expect(pushCalled).toBe(true);
      expect(setFailed).toHaveBeenCalled();
    });

    it("handles case where branch exists but createOrUpdateFileContents fails with branch not found", async () => {
      vi.useFakeTimers();
      mockRunResult.stats.hasFailures = false;
      process.env.GITHUB_REF_NAME = "feature/branch-exists-but-file-update-fails";
      githubContext.payload = {
        action: "opened",
        pull_request: {
          number: 929,
          head: { repo: { full_name: "owner/repo" } },
          base: { repo: { full_name: "owner/repo" }, ref: "master" }
        }
      };
      inputs = {
        "github-token": "token",
        "baseline-report-path": "baseline.json",
        "update-baseline": "true"
      };
      fsMock.readFile.mockRejectedValueOnce(createEnoentError());
      
      // First call: branch exists (git fetch succeeds)
      let fetchCallCount = 0;
      execExec.mockImplementation((command, args) => {
        if (command === "git" && args?.[0] === "fetch" && args?.includes("overweight/baseline/pr-929")) {
          fetchCallCount++;
          if (fetchCallCount === 1) {
            return Promise.resolve(0); // Branch exists initially
          } else {
            return Promise.reject(new Error("branch not found")); // Branch deleted before retry
          }
        }
        return Promise.resolve(0);
      });
      
      // getExistingFileSha returns undefined (file doesn't exist, 404 from getContent)
      octokitMock.rest.repos.getContent.mockRejectedValueOnce(createNotFoundError());
      
      // But createOrUpdateFileContents fails saying branch not found
      const branchNotFoundError = new Error("Branch overweight/baseline/pr-929 not found");
      branchNotFoundError.status = 404;
      octokitMock.rest.repos.createOrUpdateFileContents
        .mockRejectedValueOnce(branchNotFoundError);
      
      // Second attempt to update file succeeds
      octokitMock.rest.repos.createOrUpdateFileContents.mockResolvedValueOnce({});

      const actionPromise = runAction();
      await vi.advanceTimersByTimeAsync(1000);
      await actionPromise;
      vi.useRealTimers();

      expect(octokitMock.rest.repos.createOrUpdateFileContents).toHaveBeenCalledTimes(2);
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining("Branch overweight/baseline/pr-929 not found when updating file")
      );
      // In recovery, ensureUpdateBranchExists should be called again
      const recoveryFetchCalls = execExec.mock.calls.filter(
        call => call[0] === "git" && call[1]?.[0] === "fetch" && 
        call[1]?.some(arg => typeof arg === "string" && arg.includes("overweight/baseline/pr-929"))
      );
      expect(recoveryFetchCalls.length).toBeGreaterThan(0);
      expect(setFailed).not.toHaveBeenCalled();
    });

    it("handles getExistingFileSha returning undefined, then createOrUpdateFileContents fails with branch not found and recreates", async () => {
      vi.useFakeTimers();
      mockRunResult.stats.hasFailures = false;
      process.env.GITHUB_REF_NAME = "feature/recreate-branch";
      githubContext.payload = {
        action: "opened",
        pull_request: {
          number: 929,
          head: { repo: { full_name: "owner/repo" } },
          base: { repo: { full_name: "owner/repo" }, ref: "master" }
        }
      };
      inputs = {
        "github-token": "token",
        "baseline-report-path": "baseline.json",
        "update-baseline": "true"
      };
      fsMock.readFile.mockRejectedValueOnce(createEnoentError());
      
      // First call: branch exists (git fetch succeeds)
      let fetchCallCount = 0;
      execExec.mockImplementation((command, args) => {
        if (command === "git" && args?.[0] === "fetch" && args?.includes("overweight/baseline/pr-929")) {
          fetchCallCount++;
          if (fetchCallCount === 1) {
            return Promise.resolve(0); // Branch exists initially
          } else {
            return Promise.reject(new Error("branch not found")); // Branch deleted before retry
          }
        }
        return Promise.resolve(0);
      });
      
      // getExistingFileSha returns undefined (file doesn't exist, 404 from getContent)
      octokitMock.rest.repos.getContent.mockRejectedValueOnce(createNotFoundError());
      
      // createOrUpdateFileContents fails with branch not found
      const branchNotFoundError = new Error("Branch overweight/baseline/pr-929 not found");
      branchNotFoundError.status = 404;
      octokitMock.rest.repos.createOrUpdateFileContents.mockRejectedValueOnce(branchNotFoundError);
      
      // Second attempt to update file succeeds
      octokitMock.rest.repos.createOrUpdateFileContents.mockResolvedValueOnce({});

      const actionPromise = runAction();
      await vi.advanceTimersByTimeAsync(1000);
      await actionPromise;
      vi.useRealTimers();

      const fetchCalls = execExec.mock.calls.filter(
        call => call[0] === "git" && call[1]?.[0] === "fetch" && 
        call[1]?.some(arg => typeof arg === "string" && arg.includes("overweight/baseline/pr-929"))
      );
      expect(fetchCalls.length).toBeGreaterThan(0);
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining("Branch overweight/baseline/pr-929 not found when updating file")
      );
      expect(setFailed).not.toHaveBeenCalled();
    });


    it("handles file update retry with multiple 404s and branch verification", async () => {
      vi.useFakeTimers();
      mockRunResult.stats.hasFailures = false;
      process.env.GITHUB_REF_NAME = "feature/file-update-retry";
      githubContext.payload = {
        action: "opened",
        pull_request: {
          number: 929,
          head: { repo: { full_name: "owner/repo" } },
          base: { repo: { full_name: "owner/repo" }, ref: "master" }
        }
      };
      inputs = {
        "github-token": "token",
        "baseline-report-path": "baseline.json",
        "update-baseline": "true"
      };
      fsMock.readFile.mockRejectedValueOnce(createEnoentError());
      
      // Initial branch check succeeds
      octokitMock.rest.git.getRef
        .mockResolvedValueOnce({ data: { object: { sha: "existing-branch-sha" } } });
      
      octokitMock.rest.repos.getContent.mockRejectedValueOnce(createNotFoundError());
      
      // File update fails with 404 multiple times, then succeeds
      const branchNotFoundError = new Error("Branch overweight/baseline/pr-929 not found");
      branchNotFoundError.status = 404;
      
      octokitMock.rest.repos.createOrUpdateFileContents
        .mockRejectedValueOnce(branchNotFoundError) // Attempt 1: 404
        .mockRejectedValueOnce(branchNotFoundError); // Attempt 2: 404 (after verification)
      
      // After first 404, verify branch (succeeds immediately)
      octokitMock.rest.git.getRef
        .mockResolvedValueOnce({ data: { object: { sha: "branch-sha" } } });
      
      // After second 404, verify branch again (succeeds immediately)
      octokitMock.rest.git.getRef
        .mockResolvedValueOnce({ data: { object: { sha: "branch-sha" } } });
      
      // Third attempt succeeds
      octokitMock.rest.repos.createOrUpdateFileContents.mockResolvedValueOnce({});

      const actionPromise = runAction();
      
      // Fast-forward through delays: 1000ms + 2000ms
      await vi.advanceTimersByTimeAsync(3000);
      
      await actionPromise;
      vi.useRealTimers();

      expect(octokitMock.rest.repos.createOrUpdateFileContents).toHaveBeenCalledTimes(3);
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining("Branch overweight/baseline/pr-929 not found when updating file")
      );
      expect(info).toHaveBeenCalledWith(
        expect.stringContaining("Successfully updated file")
      );
      expect(setFailed).not.toHaveBeenCalled();
    });

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

