import { describe, it, expect, beforeEach, vi } from "vitest";
import github from "@actions/github";
import {
  resolveBaseBranch,
  parseProtectedBranchPatterns,
  isBranchProtected,
  getBranchName,
  buildUpdateBranchName,
  ensureCreatableBranchName
} from "../../src/action/branch.js";
import { createOctokitMock, resetOctokitMocks, createNotFoundError } from "./test-utils.js";

vi.mock("@actions/core", () => ({
  default: {
    info: vi.fn(),
    warning: vi.fn()
  }
}));

const octokitMock = createOctokitMock();

vi.mock("@actions/github", () => ({
  default: {
    context: {
      payload: {
        pull_request: null
      },
      repo: { owner: "owner", repo: "repo" }
    }
  }
}));

describe("branch utilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOctokitMocks(octokitMock);
    delete process.env.GITHUB_REF_NAME;
    delete process.env.GITHUB_REF;
  });

  describe("resolveBaseBranch", () => {
    it("uses PR base branch when in PR context", async () => {
      github.context.payload.pull_request = {
        base: { ref: "develop" }
      };

      const result = await resolveBaseBranch(octokitMock);
      expect(result).toBe("develop");
    });

    it("fetches default branch from API when no PR context", async () => {
      github.context.payload.pull_request = null;
      octokitMock.rest.repos.get.mockResolvedValue({
        data: { default_branch: "master" }
      });

      const result = await resolveBaseBranch(octokitMock);
      expect(result).toBe("master");
      expect(octokitMock.rest.repos.get).toHaveBeenCalled();
    });

    it("falls back to main when API call fails", async () => {
      github.context.payload.pull_request = null;
      octokitMock.rest.repos.get.mockRejectedValue(new Error("API error"));

      const result = await resolveBaseBranch(octokitMock);
      expect(result).toBe("main");
    });
  });

  describe("parseProtectedBranchPatterns", () => {
    it("parses comma-separated patterns", () => {
      const result = parseProtectedBranchPatterns("main,master,release/*");
      expect(result).toEqual(["main", "master", "release/*"]);
    });

    it("uses defaults when input is empty", () => {
      const result = parseProtectedBranchPatterns("");
      expect(result).toEqual(["main", "master"]);
    });
  });

  describe("isBranchProtected", () => {
    it("returns true for exact match", () => {
      expect(isBranchProtected("main", ["main", "master"])).toBe(true);
    });

    it("returns true for wildcard match", () => {
      expect(isBranchProtected("release/v1.0", ["release/*"])).toBe(true);
    });

    it("returns false for non-matching branch", () => {
      expect(isBranchProtected("feature/test", ["main", "master"])).toBe(false);
    });
  });

  describe("getBranchName", () => {
    it("uses GITHUB_REF_NAME when available", () => {
      process.env.GITHUB_REF_NAME = "feature/test";
      expect(getBranchName()).toBe("feature/test");
    });

    it("extracts from GITHUB_REF when GITHUB_REF_NAME not available", () => {
      delete process.env.GITHUB_REF_NAME;
      process.env.GITHUB_REF = "refs/heads/feature/test";
      expect(getBranchName()).toBe("feature/test");
    });
  });

  describe("buildUpdateBranchName", () => {
    it("builds branch name with PR number", () => {
      const result = buildUpdateBranchName({
        prefix: "overweight/baseline",
        prNumber: 123,
        currentBranch: "feature/test"
      });
      expect(result).toBe("overweight/baseline/pr-123");
    });

    it("builds branch name from current branch when no PR number", () => {
      const result = buildUpdateBranchName({
        prefix: "overweight/baseline",
        prNumber: null,
        currentBranch: "feature-test"
      });
      expect(result).toBe("overweight/baseline/feature-test");
    });
  });

  describe("ensureCreatableBranchName", () => {
    it("returns original branch name when no prefix conflict", async () => {
      octokitMock.rest.git.getRef.mockRejectedValue(createNotFoundError());

      const branchName = "overweight/baseline/pr-1";
      const result = await ensureCreatableBranchName({ octokit: octokitMock, branchName });

      expect(result).toBe(branchName);
      expect(octokitMock.rest.git.getRef).toHaveBeenCalledWith(
        expect.objectContaining({ ref: "heads/overweight" })
      );
    });

    it("flattens branch name when a prefix already exists", async () => {
      octokitMock.rest.git.getRef
        .mockResolvedValueOnce({ data: { object: { sha: "abc123" } } });

      const result = await ensureCreatableBranchName({
        octokit: octokitMock,
        branchName: "overweight/baseline/pr-1"
      });

      expect(result).toBe("overweight-baseline-pr-1");
    });
  });
});

