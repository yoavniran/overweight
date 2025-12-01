import core from "@actions/core";
import github from "@actions/github";

export const BOT_COMMIT_IDENTITY = {
  name: "Overweight Bot",
  email: "ci-bot@overweight-gh-action.com"
};

/**
 * Get the SHA of an existing file on a branch
 * @param {Object} params
 * @param {Object} params.octokit - GitHub Octokit instance
 * @param {string} params.branchName - Branch name
 * @param {string} params.path - File path in repository
 * @returns {Promise<string|undefined>} File SHA if exists, undefined otherwise
 */
export const getExistingFileSha = async ({ octokit, branchName, path: repoPath }) => {
  const { owner, repo } = github.context.repo;

  core.info(`Checking for existing file ${repoPath} on branch ${branchName}...`);
  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: repoPath,
      ref: branchName
    });

    if (!Array.isArray(response.data) && response.data.type === "file") {
      core.info(`Found existing file ${repoPath} on branch ${branchName} with SHA: ${response.data.sha}`);
      return response.data.sha;
    }

    core.info(`File ${repoPath} exists on branch ${branchName} but is not a file (type: ${response.data?.type || "unknown"})`);
    return undefined;
  } catch (error) {
    if (error.status === 404) {
      core.info(`File ${repoPath} does not exist on branch ${branchName} (404), will create new file`);
      return undefined;
    }

    core.warning(`Failed to check for existing file ${repoPath} on branch ${branchName}: ${error.message} (status: ${error.status})`);
    throw error;
  }
};

/**
 * Update or create a file on a branch with retry logic
 * @param {Object} params
 * @param {Object} params.octokit - GitHub Octokit instance
 * @param {string} params.branchName - Branch name
 * @param {string} params.path - File path in repository
 * @param {string} params.content - Base64 encoded file content
 * @param {string} params.message - Commit message
 * @param {string|undefined} params.existingSha - Existing file SHA if updating
 * @param {Function} params.ensureBranchExists - Function to ensure branch exists (for retry)
 * @param {string} params.baseBranch - Base branch name (for retry)
 * @returns {Promise<void>}
 */
export const createOrUpdateFileContents = async ({
  octokit,
  branchName,
  path: repoPath,
  content,
  message,
  existingSha,
  ensureBranchExists,
  baseBranch
}) => {
  const maxRetries = 5;
  const baseDelay = 1000; // 1 second
  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await octokit.rest.repos.createOrUpdateFileContents({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        path: repoPath,
        message,
        content,
        branch: branchName,
        sha: existingSha,
        committer: BOT_COMMIT_IDENTITY,
        author: BOT_COMMIT_IDENTITY
      });
      core.info(`Successfully updated file ${repoPath} on branch ${branchName}`);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (error.status === 404 && error.message?.includes("Branch") && attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        core.warning(
          `Branch ${branchName} not found when updating file (attempt ${attempt + 1}/${maxRetries}). Verifying branch and retrying in ${delay}ms...`
        );
        // Verify branch exists before retrying
        if (ensureBranchExists) {
          await ensureBranchExists({
            octokit,
            branchName,
            baseBranch
          });
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }

  if (lastError) {
    core.warning(`Failed to update file after ${maxRetries} attempts: ${lastError.message}`);
    throw lastError;
  }
};

/**
 * Find an existing open PR for a branch
 * @param {Object} params
 * @param {Object} params.octokit - GitHub Octokit instance
 * @param {string} params.branchName - Branch name
 * @returns {Promise<Object|null>} PR object or null if not found
 */
export const findExistingBaselinePr = async ({ octokit, branchName }) => {
  const { owner, repo } = github.context.repo;

  core.info(`Searching for existing open PRs for branch ${branchName}...`);
  const prs = await octokit.rest.pulls.list({
    owner,
    repo,
    head: `${owner}:${branchName}`,
    state: "open",
    per_page: 1
  });

  const existingPr = prs.data?.[0] || null;
  if (existingPr) {
    core.info(`Found existing PR #${existingPr.number} for branch ${branchName}: ${existingPr.html_url}`);
  } else {
    core.info(`No existing open PR found for branch ${branchName}`);
  }

  return existingPr;
};

/**
 * Find PR number for a branch
 * @param {Object} params
 * @param {Object} params.octokit - GitHub Octokit instance
 * @param {string} params.branch - Branch name
 * @returns {Promise<number|null>} PR number or null if not found
 */
export const findPrNumberForBranch = async ({ octokit, branch }) => {
  if (!branch) {
    core.info("No branch provided to findPrNumberForBranch");
    return null;
  }

  const { owner, repo } = github.context.repo;
  core.info(`Searching for PR number for branch ${branch}...`);
  const prs = await octokit.rest.pulls.list({
    owner,
    repo,
    head: `${owner}:${branch}`,
    state: "open",
    per_page: 1
  });

  const pr = prs.data?.[0];
  if (pr) {
    core.info(`Found PR #${pr.number} for branch ${branch}`);
  } else {
    core.info(`No open PR found for branch ${branch}`);
  }
  return pr?.number ?? null;
};

/**
 * Create a new pull request
 * @param {Object} params
 * @param {Object} params.octokit - GitHub Octokit instance
 * @param {string} params.head - Head branch name
 * @param {string} params.base - Base branch name
 * @param {string} params.title - PR title
 * @param {string} params.body - PR body
 * @returns {Promise<Object>} Created PR object
 */
export const createPullRequest = async ({ octokit, head, base, title, body }) => {
  const { owner, repo } = github.context.repo;
  
  core.info(`Creating new PR: head=${head}, base=${base}, title="${title}"`);
  const prResponse = await octokit.rest.pulls.create({
    owner,
    repo,
    head,
    base,
    title,
    body
  });
  
  core.info(`Created baseline update PR #${prResponse.data.number}: ${prResponse.data.html_url}`);
  return prResponse.data;
};

const REPORT_MARKER = "<!-- overweight-report -->";

/**
 * Find an existing report comment on a PR
 * @param {Object} octokit - GitHub Octokit instance
 * @param {Object} pullRequest - Pull request object
 * @returns {Promise<Object|null>} Comment object or null if not found
 */
export const findExistingReportComment = async (octokit, pullRequest) => {
  const { owner, repo } = github.context.repo;
  const existingComments = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: pullRequest.number,
    per_page: 100
  });

  const existing = existingComments.data
    .filter((comment) => comment?.user?.type === "Bot" && comment?.body?.includes(REPORT_MARKER))
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0];

  return existing || null;
};

/**
 * Comment on a pull request (create or update)
 * @param {Object} params
 * @param {Object} params.octokit - GitHub Octokit instance
 * @param {Object} params.pullRequest - Pull request object
 * @param {string} params.body - Comment body
 * @param {Object|undefined} params.existingComment - Existing comment to update
 * @returns {Promise<void>}
 */
export const commentOnPullRequest = async ({ octokit, pullRequest, body, existingComment }) => {
  if (!pullRequest) {
    core.info("No pull request found in the event payload; skipping comment.");
    return;
  }

  const isFork =
    pullRequest.head?.repo?.full_name &&
    pullRequest.base?.repo?.full_name &&
    pullRequest.head.repo.full_name !== pullRequest.base.repo.full_name;

  if (isFork) {
    core.info("Skipping pull request comment because the PR originates from a fork.");
    return;
  }

  const previous =
    existingComment !== undefined
      ? existingComment
      : await findExistingReportComment(octokit, pullRequest);

  const commentBody = `${REPORT_MARKER}\n${body}`;

  try {
    if (previous) {
      await octokit.rest.issues.updateComment({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        comment_id: previous.id,
        body: commentBody
      });
    } else {
      await octokit.rest.issues.createComment({
        repo: github.context.repo.repo,
        owner: github.context.repo.owner,
        issue_number: pullRequest.number,
        body: commentBody
      });
    }
  } catch (error) {
    if (error.status === 403) {
      core.warning(
        `Unable to comment on pull request due to permissions (403). Message: ${error.message}`
      );
      return;
    }

    throw error;
  }
};

