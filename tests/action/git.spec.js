import { describe, it, expect, beforeEach, vi } from "vitest";
import { ensureUpdateBranchExists } from "../../src/action/git.js";
import { createNotFoundError } from "./test-utils.js";

const octokitMock = {
  rest: {
    git: {
      getRef: vi.fn(),
      createRef: vi.fn(),
      deleteRef: vi.fn()
    }
  }
};

vi.mock("@actions/core", () => ({
  info: vi.fn(),
  warning: vi.fn()
}));

vi.mock("@actions/github", () => ({
  context: {
    repo: { owner: "owner", repo: "repo" }
  }
}));

describe("ensureUpdateBranchExists (GitHub API)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    octokitMock.rest.git.getRef.mockReset();
    octokitMock.rest.git.createRef.mockReset();
    octokitMock.rest.git.deleteRef.mockReset();
    octokitMock.rest.git.getRef.mockResolvedValue({ data: { object: { sha: "existing-sha" } } });
    octokitMock.rest.git.deleteRef.mockResolvedValue({});
  });

  it("reuses existing branch when it already exists", async () => {
    const result = await ensureUpdateBranchExists({
      octokit: octokitMock,
      branchName: "test-branch",
      baseBranch: "main"
    });

    expect(result).toBe(true);
    expect(octokitMock.rest.git.createRef).not.toHaveBeenCalled();
    expect(octokitMock.rest.git.deleteRef).not.toHaveBeenCalled();
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
    expect(octokitMock.rest.git.deleteRef).not.toHaveBeenCalled();
  });

  it("handles createRef returning 422 by reusing existing branch", async () => {
    octokitMock.rest.git.getRef
      .mockRejectedValueOnce(createNotFoundError()) // branch check
      .mockResolvedValueOnce({ data: { object: { sha: "base-sha" } } }) // base branch fetch
      .mockResolvedValueOnce({ data: { object: { sha: "existing-sha" } } }) // reuse after 422
      .mockResolvedValueOnce({ data: { object: { sha: "existing-sha" } } }); // verification
    octokitMock.rest.git.createRef.mockRejectedValueOnce({
      status: 422,
      message: "Reference already exists"
    });

    const result = await ensureUpdateBranchExists({
      octokit: octokitMock,
      branchName: "test-branch",
      baseBranch: "main"
    });

    expect(result).toBe(true);
    expect(octokitMock.rest.git.createRef).toHaveBeenCalledTimes(1);
    expect(octokitMock.rest.git.deleteRef).not.toHaveBeenCalled();
  });

  it("deletes stale reference and retries when createRef returns 422 but getRef is 404", async () => {
    octokitMock.rest.git.getRef
      .mockRejectedValueOnce(createNotFoundError()) // branch check
      .mockResolvedValueOnce({ data: { object: { sha: "base-sha" } } }) // base branch fetch
      .mockRejectedValueOnce(createNotFoundError()) // reuse attempt after 422 -> still missing
      .mockResolvedValueOnce({ data: { object: { sha: "new-branch-sha" } } }); // verification success
    octokitMock.rest.git.createRef
      .mockRejectedValueOnce({ status: 422, message: "Reference already exists" })
      .mockResolvedValueOnce({});

    const result = await ensureUpdateBranchExists({
      octokit: octokitMock,
      branchName: "test-branch",
      baseBranch: "main"
    });

    expect(result).toBe(true);
    expect(octokitMock.rest.git.deleteRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: "refs/heads/test-branch" })
    );
    expect(octokitMock.rest.git.createRef).toHaveBeenCalledTimes(2);
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
