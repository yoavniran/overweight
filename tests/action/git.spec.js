import { describe, it, expect, beforeEach, vi } from "vitest";
import * as exec from "@actions/exec";
import { tryFetchBranch, ensureUpdateBranchExists } from "../../src/action/git.js";
import { setupGitMocks } from "./test-utils.js";

vi.mock("@actions/exec", () => ({
  exec: vi.fn()
}));

vi.mock("@actions/core", () => ({
  default: {
    info: vi.fn(),
    warning: vi.fn()
  }
}));

describe("git helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exec.exec.mockResolvedValue(0);
  });

  describe("tryFetchBranch", () => {
    it("returns true when branch exists", async () => {
      exec.exec.mockResolvedValue(0);
      const result = await tryFetchBranch("test-branch");
      expect(result).toBe(true);
      const calls = exec.exec.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0][0]).toBe("git");
      expect(calls[0][1]).toContain("fetch");
      expect(calls[0][1]).toContain("origin");
      expect(calls[0][1].some(arg => typeof arg === "string" && arg.includes("test-branch"))).toBe(true);
    });

    it("returns false when branch does not exist", async () => {
      exec.exec.mockRejectedValue(new Error("branch not found"));
      const result = await tryFetchBranch("test-branch");
      expect(result).toBe(false);
    });
  });

  describe("ensureUpdateBranchExists", () => {
    it("reuses existing branch when it already exists", async () => {
      exec.exec.mockImplementation((command, args) => {
        if (command === "git" && args?.[0] === "fetch" && args?.some(arg => arg.includes("test-branch"))) {
          return Promise.resolve(0); // Branch exists
        }
        return Promise.resolve(0);
      });

      const result = await ensureUpdateBranchExists({
        octokit: null,
        branchName: "test-branch",
        baseBranch: "main"
      });

      expect(result).toBe(true);
      const calls = exec.exec.mock.calls;
      expect(calls.some(call => call[1]?.[0] === "checkout" && call[1]?.includes("test-branch"))).toBe(true);
    });

    it("creates new branch when it does not exist", async () => {
      let fetchCallCount = 0;
      exec.exec.mockImplementation((command, args) => {
        if (command === "git" && args?.[0] === "fetch") {
          if (args?.some(arg => arg.includes("test-branch"))) {
            fetchCallCount++;
            if (fetchCallCount === 1) {
              return Promise.reject(new Error("branch not found"));
            }
          }
        }
        return Promise.resolve(0);
      });

      const result = await ensureUpdateBranchExists({
        octokit: null,
        branchName: "test-branch",
        baseBranch: "main"
      });

      expect(result).toBe(false);
      const calls = exec.exec.mock.calls;
      expect(calls.some(call => call[1]?.includes("checkout") && call[1]?.includes("-b"))).toBe(true);
      expect(calls.some(call => call[1]?.[0] === "push")).toBe(true);
    });
  });
});

