import core from "@actions/core";
import github from "@actions/github";

const DEFAULT_PROTECTED_BRANCHES = ["main", "master"];
const SHORT_REF_PREFIX = "heads/";

/**
 * Resolve the base branch for baseline updates
 * @param {Object} octokit - GitHub Octokit instance
 * @returns {Promise<string>} The base branch name
 */
export const resolveBaseBranch = async (octokit) => {
  if (github.context.payload.pull_request?.base?.ref) {
    core.info(`base branch is ${github.context.payload.pull_request.base.ref}`);
    return github.context.payload.pull_request.base.ref;
  }

  if (octokit) {
    try {
      const { owner, repo } = github.context.repo;
      const repoInfo = await octokit.rest.repos.get({
        owner,
        repo
      });

      core.info(`base branch is ${repoInfo.data.default_branch}`);
      return repoInfo.data.default_branch;
    } catch (error) {
      core.warning(
        `Unable to fetch default branch from repository: ${error.message}. Falling back to "main".`
      );
    }
  }

  core.warning("Falling back to 'main' as base branch.");
  return "main";
};

/**
 * Parse protected branch patterns from input
 * @param {string} input - Comma-separated list of branch patterns
 * @returns {string[]} Array of branch patterns
 */
export const parseProtectedBranchPatterns = (input) => {
  const raw = input && input.trim().length ? input : DEFAULT_PROTECTED_BRANCHES.join(",");

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

/**
 * Escape special regex characters in a pattern
 * @param {string} value - The pattern to escape
 * @returns {string} Escaped pattern
 */
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Convert a wildcard pattern to a regex
 * @param {string} pattern - Pattern with * wildcards
 * @returns {RegExp} Regular expression
 */
const patternToRegex = (pattern) =>
  new RegExp(`^${pattern.split("*").map((segment) => escapeRegex(segment)).join(".*")}$`);

/**
 * Check if a branch matches a pattern
 * @param {string} branch - Branch name
 * @param {string} pattern - Pattern to match against
 * @returns {boolean} True if branch matches pattern
 */
const branchMatchesPattern = (branch, pattern) => {
  if (!pattern || !branch) {
    return false;
  }

  return patternToRegex(pattern).test(branch);
};

/**
 * Check if a branch is protected based on patterns
 * @param {string} branch - Branch name to check
 * @param {string[]} patterns - Array of protected branch patterns
 * @returns {boolean} True if branch is protected
 */
export const isBranchProtected = (branch, patterns) =>
  Boolean(branch) && patterns.some((pattern) => branchMatchesPattern(branch, pattern));

/**
 * Get the current branch name from environment
 * @returns {string} Current branch name or empty string
 */
export const getBranchName = () => {
  if (process.env.GITHUB_REF_NAME) {
    return process.env.GITHUB_REF_NAME;
  }
  if (process.env.GITHUB_REF) {
    // Extract branch name from refs/heads/branch-name or refs/tags/tag-name
    const match = process.env.GITHUB_REF.match(/refs\/heads\/(.+)$/);
    return match ? match[1] : process.env.GITHUB_REF.split("/").pop() || "";
  }
  return "";
};

/**
 * Sanitize branch prefix by removing trailing slashes
 * @param {string} prefix - Branch prefix
 * @returns {string} Sanitized prefix
 */
const sanitizeBranchPrefix = (prefix) =>
  `${prefix || "overweight/baseline"}`.replace(/\/+$/, "");

/**
 * Sanitize branch suffix by removing invalid characters
 * @param {string} suffix - Branch suffix
 * @returns {string} Sanitized suffix
 */
const sanitizeBranchSuffix = (suffix) =>
  suffix ? suffix.replace(/[^0-9A-Za-z._-]+/g, "-") : "";

/**
 * Build the update branch name from components
 * @param {Object} params
 * @param {string} params.prefix - Branch prefix
 * @param {number|null} params.prNumber - PR number if available
 * @param {string} params.currentBranch - Current branch name
 * @returns {string} Full branch name
 */
export const buildUpdateBranchName = ({ prefix, prNumber, currentBranch }) => {
  const suffix =
    prNumber != null
      ? `pr-${prNumber}`
      : sanitizeBranchSuffix(currentBranch) || `run-${github.context.runId || Date.now()}`;

  return `${sanitizeBranchPrefix(prefix)}/${suffix}`;
};

const flattenBranchName = (branchName) =>
  branchName
    .split("/")
    .filter(Boolean)
    .join("-")
    .replace(/-+/g, "-");

/**
 * Ensure the generated branch name does not conflict with existing refs
 * @param {Object} params
 * @param {Object} params.octokit - Authenticated Octokit instance
 * @param {string} params.branchName - Candidate branch name
 * @returns {Promise<string>} Resolved branch name
 */
export const ensureCreatableBranchName = async ({ octokit, branchName }) => {
  if (!octokit || !branchName || !branchName.includes("/")) {
    return branchName;
  }

  const segments = branchName.split("/").filter(Boolean);
  if (segments.length <= 1) {
    return branchName;
  }

  const { owner, repo } = github.context.repo;
  let prefixSegments = [];

  for (let i = 0; i < segments.length - 1; i++) {
    prefixSegments.push(segments[i]);
    const prefix = prefixSegments.join("/");

    try {
      await octokit.rest.git.getRef({
        owner,
        repo,
        ref: `${SHORT_REF_PREFIX}${prefix}`
      });
      const fallbackName = flattenBranchName(branchName);
      core.info(
        `Branch prefix "${prefix}" already exists. Using fallback branch name "${fallbackName}".`
      );
      return fallbackName;
    } catch (error) {
      if (error.status === 404) {
        continue;
      }
      throw error;
    }
  }

  return branchName;
};

