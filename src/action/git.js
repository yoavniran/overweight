import * as exec from "@actions/exec";
import core from "@actions/core";

/**
 * Try to fetch a branch to check if it exists (similar to peter-evans/create-pull-request)
 * @param {string} branchName - The branch name to check
 * @returns {Promise<boolean>} True if branch exists, false otherwise
 */
export const tryFetchBranch = async (branchName) => {
  try {
    await exec.exec("git", [
      "fetch",
      "origin",
      `${branchName}:refs/remotes/origin/${branchName}`,
      "--force",
      "--depth=1"
    ]);
    return true;
  } catch (error) {
    return false;
  }
};

/**
 * Ensure a branch exists, creating it from the base branch if needed
 * @param {Object} params
 * @param {Object} params.octokit - GitHub Octokit instance (unused but kept for API compatibility)
 * @param {string} params.branchName - The branch name to ensure exists
 * @param {string} params.baseBranch - The base branch to create from
 * @returns {Promise<boolean>} True if branch already existed, false if it was created
 */
export const ensureUpdateBranchExists = async ({ octokit, branchName, baseBranch }) => {
  core.info(`Checking if branch ${branchName} exists...`);
  
  // Try to fetch the branch to see if it exists (like peter-evans/create-pull-request)
  const branchExists = await tryFetchBranch(branchName);
  
  if (branchExists) {
    core.info(`Branch ${branchName} already exists as remote branch origin/${branchName}`);
    // Checkout the existing branch
    await exec.exec("git", ["checkout", branchName], { silent: true });
    return true;
  }

  // Branch doesn't exist, create it from base branch
  core.info(`Branch ${branchName} does not exist. Creating it from ${baseBranch}...`);
  
  // Fetch the base branch to ensure we have the latest commit from origin
  await exec.exec(
    "git",
    [
      "fetch",
      "origin",
      `${baseBranch}:refs/remotes/origin/${baseBranch}`,
      "--force",
      "--depth=1"
    ],
    { silent: true }
  );
  
  // Create and checkout the new branch directly from origin/<baseBranch>
  await exec.exec(
    "git",
    [
      "checkout",
      "-B",
      branchName,
      `origin/${baseBranch}`
    ],
    { silent: true }
  );
  
  // Push the branch to origin
  core.info(`Pushing branch ${branchName} to origin...`);
  await exec.exec("git", ["push", "origin", branchName, "--force"], { silent: true });
  
  core.info(`Successfully created and pushed branch ${branchName}`);
  return false;
};

