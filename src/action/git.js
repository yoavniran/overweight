import * as core from "@actions/core";
import * as github from "@actions/github";

/**
 * Ensure a branch exists, creating it from the base branch if needed
 * @param {Object} params
 * @param {Object} params.octokit - GitHub Octokit instance (unused but kept for API compatibility)
 * @param {string} params.branchName - The branch name to ensure exists
 * @param {string} params.baseBranch - The base branch to create from
 * @returns {Promise<boolean>} True if branch already existed, false if it was created
 */
const MAX_CREATION_ATTEMPTS = 2;
const MAX_VERIFICATION_ATTEMPTS = 7;
const VERIFICATION_BASE_DELAY_MS = 500;

const BRANCH_REF_PREFIX = "refs/heads/";
const SHORT_REF_PREFIX = "heads/";

const resolveRefSha = (response) => response.data.object?.sha || response.data.sha;

export const ensureUpdateBranchExists = async ({ octokit, branchName, baseBranch }) => {
  if (!octokit) {
    throw new Error("ensureUpdateBranchExists requires an authenticated octokit client.");
  }

  const { owner, repo } = github.context.repo;
  const branchRef = `${SHORT_REF_PREFIX}${branchName}`;
  const baseRef = `${SHORT_REF_PREFIX}${baseBranch}`;
  const fullBranchRef = `${BRANCH_REF_PREFIX}${branchName}`;

  core.info(`Checking if branch ${branchName} exists via GitHub API...`);
  try {
    const existing = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: branchRef
    });
    const branchSha = existing.data.object?.sha || existing.data.sha;
    core.info(`Branch ${branchName} already exists at SHA: ${branchSha}`);
    return true;
  } catch (error) {
    if (error.status !== 404) {
      core.warning(
        `Failed to check branch ${branchName} existence via GitHub API: ${error.message}`
      );
      throw error;
    }
    core.info(`Branch ${branchName} does not exist (404), will create it from ${baseBranch}`);
  }

  core.info(`Fetching base branch ${baseBranch} via GitHub API...`);
  const base = await octokit.rest.git.getRef({
    owner,
    repo,
    ref: baseRef
  });
  const baseSha = base.data.object?.sha || base.data.sha;
  core.info(`Base branch ${baseBranch} SHA: ${baseSha}`);

  await createBranchWithCleanup({
    octokit,
    owner,
    repo,
    branchName,
    branchRef,
    fullBranchRef,
    baseSha
  });

  core.info(`Verifying branch ${branchName} is accessible via GitHub API...`);
  for (let attempt = 0; attempt < MAX_VERIFICATION_ATTEMPTS; attempt++) {
    try {
      const branchRefData = await octokit.rest.git.getRef({
        owner,
        repo,
        ref: branchRef
      });
      const branchSha = resolveRefSha(branchRefData);
      core.info(`Branch ${branchName} verified at SHA: ${branchSha}`);
      return true;
    } catch (error) {
      if (error.status === 404 && attempt < MAX_VERIFICATION_ATTEMPTS - 1) {
        const delay = VERIFICATION_BASE_DELAY_MS * Math.pow(2, attempt);
        core.info(
          `Branch ${branchName} not yet accessible (404), retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_VERIFICATION_ATTEMPTS})...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        core.warning(
          `Branch ${branchName} still not accessible after ${MAX_VERIFICATION_ATTEMPTS} attempts via GitHub API`
        );
        throw new Error(
          `Branch ${branchName} was created but is not accessible after multiple retries`
        );
      }
    }
  }

  return true;
};

const createBranchWithCleanup = async ({
  octokit,
  owner,
  repo,
  branchName,
  branchRef,
  fullBranchRef,
  baseSha
}) => {
  for (let attempt = 0; attempt < MAX_CREATION_ATTEMPTS; attempt++) {
    try {
      core.info(`Creating branch ${branchName} via GitHub API (attempt ${attempt + 1})...`);
      await octokit.rest.git.createRef({
        owner,
        repo,
        ref: fullBranchRef,
        sha: baseSha
      });
      core.info(`Successfully created branch ${branchName}`);
      return;
    } catch (error) {
      if (error.status !== 422) {
        core.warning(
          `Failed to create branch ${branchName} via GitHub API: ${error.message} (status: ${error.status})`
        );
        throw error;
      }

      core.info(
        `Branch ${branchName} already exists (422). Attempting to reuse or remove stale reference...`
      );

      try {
        const existing = await octokit.rest.git.getRef({
          owner,
          repo,
          ref: branchRef
        });
        const existingSha = resolveRefSha(existing);
        core.info(`Found existing branch ${branchName} at SHA ${existingSha}, reusing it.`);
        return;
      } catch (getError) {
        if (getError.status !== 404) {
          throw getError;
        }

        core.info(
          `Branch ${branchName} not readable after 422 (404). Deleting stale ref and retrying...`
        );
        try {
          await octokit.rest.git.deleteRef({
            owner,
            repo,
            ref: fullBranchRef
          });
          core.info(`Deleted stale reference ${fullBranchRef}`);
        } catch (deleteError) {
          if (deleteError.status === 404 || deleteError.status === 422) {
            core.info(`Stale reference ${fullBranchRef} was already absent.`);
          } else {
            core.warning(
              `Failed to delete stale ref ${fullBranchRef}: ${deleteError.message} (status: ${deleteError.status})`
            );
            throw deleteError;
          }
        }
        // Retry creation on next iteration
      }
    }
  }

  throw new Error(
    `Unable to create branch ${branchName} after cleaning up conflicting references.`
  );
};

