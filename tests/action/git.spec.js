import { describe, it, expect, beforeEach, vi } from "vitest";
import { ensureUpdateBranchExists } from "../../src/action/git.js";
import { createNotFoundError } from "./test-utils.js";

const octokitMock = {
  rest: {
    git: {
      getRef: vi.fn(),
      createRef: vi.fn()
    }
  }
};

vi.mock("@actions/core", () => ({
  default: {
    info: vi.fn(),
    warning: vi.fn()
  }
}));

vi.mock("@actions/github", () => ({
  default: {
    context: {
      repo: { owner: "owner", repo: "repo" }
    }
  }
}));

describe("ensureUpdateBranchExists (GitHub API)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    octokitMock.rest.git.getRef.mockReset();
    octokitMock.rest.git.createRef.mockReset();
    octokitMock.rest.git.getRef.mockResolvedValue({ data: { object: { sha: "existing-sha" } } });
  });

  it("reuses existing branch when it already exists", async () => {
    const result = await ensureUpdateBranchExists({
      octokit: octokitMock,
      branchName: "test-branch",
      baseBranch: "main"
    });

    expect(result).toBe(true);
    expect(octokitMock.rest.git.createRef).not.toHaveBeenCalled();
  });

  it("creates new branch when it does not exist", async () => {
    octokitMock.rest.git.getRef
      .mockRejectedValueOnce(createNotFoundError()) // branch check
      .mockResolvedValueOnce({ data: { object: { sha: "base-sha" } } }) // base branch fetch
      .mockResolvedValueOnce({ data: { object: { sha: "new-branch-sha" } } }); // verification
    octokitMock.rest.git.createRef.mockResolvedValueOnce({});

    const result = await ensureUpdateBranchExists({
      octokit: octokitMock,
      branchName: "test-branch",
      baseBranch: "main"
    });

    expect(result).toBe(true);
    expect(octokitMock.rest.git.createRef).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: "refs/heads/test-branch",
        sha: "base-sha"
      })
    );
  });

  it("handles createRef returning 422 and verifies branch availability", async () => {
    vi.useFakeTimers();
    octokitMock.rest.git.getRef
      .mockRejectedValueOnce(createNotFoundError()) // branch check
      .mockResolvedValueOnce({ data: { object: { sha: "base-sha" } } }) // base branch fetch
      .mockRejectedValueOnce(createNotFoundError()) // verification attempt 1
      .mockResolvedValueOnce({ data: { object: { sha: "new-branch-sha" } } }); // success
    octokitMock.rest.git.createRef.mockRejectedValueOnce({
      status: 422,
      message: "Reference already exists"
    });

    const promise = ensureUpdateBranchExists({
      octokit: octokitMock,
      branchName: "test-branch",
      baseBranch: "main"
    });

    await vi.advanceTimersByTimeAsync(500);
    await promise;
    vi.useRealTimers();

    expect(octokitMock.rest.git.createRef).toHaveBeenCalled();
    expect(octokitMock.rest.git.getRef).toHaveBeenLastCalledWith(
      expect.objectContaining({ ref: "heads/test-branch" })
    );
  });

  it("throws when branch never becomes accessible", async () => {
    vi.useFakeTimers();
    octokitMock.rest.git.getRef
      .mockRejectedValueOnce(createNotFoundError())
      .mockResolvedValueOnce({ data: { object: { sha: "base-sha" } } })
      .mockRejectedValue(createNotFoundError());

    let capturedError = null;
    const promise = ensureUpdateBranchExists({
      octokit: octokitMock,
      branchName: "test-branch",
      baseBranch: "main"
    }).catch((error) => {
      capturedError = error;
    });

    await vi.runAllTimersAsync();
    await promise;
    expect(capturedError).toBeInstanceOf(Error);
    expect(capturedError.message).toMatch(/not accessible after multiple retries/);
    vi.useRealTimers();
  });
});
