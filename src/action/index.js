import path from "node:path";
import { Buffer } from "node:buffer";

import core from "@actions/core";
import github from "@actions/github";

import { resolveConfig } from "./config.js";
import { runChecks } from "../core/run-checks.js";
import { jsonFileReporter } from "../reporters/json-file-reporter.js";
import { buildSummaryRows, toTableData, renderHtmlTable } from "./report.js";
import {
  readBaselineState,
  writeBaseline,
  getBaselineUpdateInfo,
  mergeWithBaseline,
  ensureRelativePath
} from "./baseline.js";
import {
  resolveBaseBranch,
  parseProtectedBranchPatterns,
  isBranchProtected,
  getBranchName,
  buildUpdateBranchName,
  ensureCreatableBranchName
} from "./branch.js";
import { ensureUpdateBranchExists } from "./git.js";
import {
  getExistingFileSha,
  createOrUpdateFileContents,
  findExistingBaselinePr,
  findPrNumberForBranch,
  createPullRequest,
  findExistingReportComment,
  commentOnPullRequest
} from "./github.js";

/**
 * Main action orchestrator
 */
export const runAction = async () => {
  try {
    // Load configuration
    const config = await resolveConfig();
    const githubToken = core.getInput("github-token");
    const octokit = githubToken ? github.getOctokit(githubToken) : null;
    const commentOnFailure = core.getBooleanInput("comment-on-pr");
    const commentOnFirstRun = core.getBooleanInput("comment-on-pr-always");
    const commentOnEachRun = core.getBooleanInput("comment-on-pr-each-run");
    const prPayload = github.context.payload.pull_request;
    const prAction = github.context.payload.action;

    // Run size checks
    const result = await runChecks(config);
    const baseRows = buildSummaryRows(result.results);

    // Handle baseline configuration
    const reportFileInput = core.getInput("report-file") || "overweight-report.json";
    const updateBaseline = core.getBooleanInput("update-baseline");
    const baselineReportPathInput = core.getInput("baseline-report-path");
    const shouldDefaultBaselinePath =
      !baselineReportPathInput && updateBaseline && Boolean(reportFileInput);
    const baselinePathCandidate = baselineReportPathInput || (shouldDefaultBaselinePath ? reportFileInput : null);

    if (shouldDefaultBaselinePath) {
      core.info(
        `Overweight: baseline-report-path not provided, defaulting to report-file "${reportFileInput}".`
      );
    }

    const baselinePath = baselinePathCandidate
      ? path.resolve(config.root, baselinePathCandidate)
      : null;
    const baselineState = baselinePath ? await readBaselineState(baselinePath) : null;
    const baselineData = baselineState?.data ?? null;
    const baselineFileContent = baselineState ? baselineState.raw : undefined;
    const summaryRows = mergeWithBaseline(baseRows, baselineData);

    // Generate report file
    jsonFileReporter(result, {
      reportFile: reportFileInput,
      cwd: config.root,
      silent: true
    });
    const resolvedReportPath = path.resolve(config.root, reportFileInput);

    // Generate summary and outputs
    core.info(
      `Overweight: processed ${result.results.length} entries (failures: ${result.stats.hasFailures})`
    );
    core.summary.addHeading("🧳 Overweight Size Report");
    core.summary.addTable(toTableData(summaryRows));
    await core.summary.write();

    const htmlTable = renderHtmlTable(summaryRows);

    core.setOutput("report-json", JSON.stringify({ rows: summaryRows, stats: result.stats }));
    core.setOutput("report-table", htmlTable);
    core.setOutput("has-failures", String(result.stats.hasFailures));
    core.setOutput("report-file", resolvedReportPath);

    // Handle baseline update if needed
    if (baselinePath) {
      if (result.stats.hasFailures) {
        core.info("Skipping baseline update because size checks failed.");
      } else if (!updateBaseline) {
        core.info("update-baseline=false, skipping baseline write.");
      } else if (!githubToken || !octokit) {
        core.setFailed("update-baseline requires github-token to be provided.");
      } else {
        await handleBaselineUpdate({
          octokit,
          baselinePath,
          summaryRows,
          baselineFileContent,
          config
        });
      }
    }

    // Handle PR comments
    const existingComment =
      octokit && prPayload ? await findExistingReportComment(octokit, prPayload) : null;

    const shouldCommentOnSuccess =
      prPayload &&
      (commentOnEachRun || (commentOnFirstRun && prAction === "opened"));
    const shouldCommentOnFailure = result.stats.hasFailures && commentOnFailure;
    const shouldUpdateExisting =
      Boolean(existingComment) && !result.stats.hasFailures && commentOnFailure;

    if (octokit && (shouldCommentOnFailure || shouldCommentOnSuccess || shouldUpdateExisting)) {
      const statusText = result.stats.hasFailures ?
       "Overweight: Size check failed" :
       "Overweight: Size check passed";

      core.info(
        `Overweight: preparing PR comment (failure=${result.stats.hasFailures}, existingComment=${Boolean(
          existingComment
        )}, forceUpdate=${shouldUpdateExisting})`
      );

      await commentOnPullRequest({
        octokit,
        pullRequest: prPayload,
        body: `${statusText}:\n\n${htmlTable}`,
        existingComment
      });
    }

    if (result.stats.hasFailures) {
      core.setFailed("One or more size checks failed.");
    }
  } catch (error) {
    core.warning(`Action failed with error: ${error.message}`);
    if (error.status) {
      core.warning(`HTTP status: ${error.status}`);
    }
    if (error.response) {
      core.warning(`Error response: ${JSON.stringify(error.response.data || error.response)}`);
    }
    if (error.stack) {
      core.warning(`Stack trace: ${error.stack}`);
    }
    core.setFailed(error.message);
  }
};

/**
 * Handle baseline update workflow
 * @param {Object} params
 * @param {Object} params.octokit - GitHub Octokit instance
 * @param {string} params.baselinePath - Path to baseline file
 * @param {Array} params.summaryRows - Summary rows
 * @param {string|undefined} params.baselineFileContent - Existing baseline content
 * @param {Object} params.config - Config object
 */
const handleBaselineUpdate = async ({
  octokit,
  baselinePath,
  summaryRows,
  baselineFileContent,
  config
}) => {
  core.info(`Checking if baseline update is needed for ${baselinePath}...`);
  const { needsUpdate, content } = await getBaselineUpdateInfo(
    baselinePath,
    summaryRows,
    baselineFileContent
  );
  const currentBranch = getBranchName() || "unknown";
  const protectedPatterns = parseProtectedBranchPatterns(
    core.getInput("baseline-protected-branches")
  );
  const branchIsProtected = isBranchProtected(currentBranch, protectedPatterns);

  core.info(
    `Overweight: baseline path detected at ${baselinePath} (branch=${currentBranch}, needsUpdate=${needsUpdate}, protected=${branchIsProtected})`
  );

  if (!needsUpdate) {
    core.info("Baseline is already up to date; no changes written.");
    return;
  }

  if (branchIsProtected) {
    core.info(
      `Skipping baseline update because branch "${currentBranch}" matches baseline-protected-branches.`
    );
    return;
  }

  // Resolve base branch
  core.info("Resolving base branch for baseline update...");
  const baseBranch = await resolveBaseBranch(octokit);
  core.info(`Resolved base branch: ${baseBranch}`);
  
  // Prepare PR details
  const prTitleInput = core.getInput("update-pr-title") || "chore: update baseline report";
  const prTitle = `${prTitleInput} (🧳 Overweight Guard)`;
  const prBody =
    core.getInput("update-pr-body") ||
    "Automatic pull request updating the baseline report.";
  const branchPrefix = core.getInput("update-branch-prefix") || "overweight/baseline";
  
  // Determine PR identifier
  core.info(`Determining PR identifier for branch ${currentBranch}...`);
  let prIdentifier = github.context.payload.pull_request?.number ?? null;

  if (!prIdentifier) {
    try {
      prIdentifier = await findPrNumberForBranch({ octokit, branch: currentBranch });
      if (prIdentifier) {
        core.info(
          `Detected existing pull request #${prIdentifier} for branch ${currentBranch}.`
        );
      }
    } catch (error) {
      core.warning(
        `Unable to infer pull request number for branch ${currentBranch}: ${error.message}`
      );
    }
  }

  let updateBranchName = buildUpdateBranchName({
    prefix: branchPrefix,
    prNumber: prIdentifier,
    currentBranch
  });
  if (octokit) {
    updateBranchName = await ensureCreatableBranchName({
      octokit,
      branchName: updateBranchName
    });
  }
  const repoRelativePath = ensureRelativePath(baselinePath);

  core.info(`Preparing to update baseline on branch: ${updateBranchName} (base: ${baseBranch})`);
  core.info(`Baseline file path: ${repoRelativePath}`);

  // Ensure branch exists
  await ensureUpdateBranchExists({
    octokit,
    branchName: updateBranchName,
    baseBranch
  });

  // Get existing file SHA if it exists
  const existingFileSha = await getExistingFileSha({
    octokit,
    branchName: updateBranchName,
    path: repoRelativePath
  });

  // Write baseline to disk
  await writeBaseline(baselinePath, summaryRows, content);
  core.info(`Wrote updated baseline snapshot to ${baselinePath} (${content.length} bytes)`);

  // Update file on GitHub
  const fileContentBase64 = Buffer.from(content, "utf-8").toString("base64");
  core.info(`Attempting to update file ${repoRelativePath} on branch ${updateBranchName}${existingFileSha ? ` (existing SHA: ${existingFileSha})` : " (new file)"}...`);

  await createOrUpdateFileContents({
    octokit,
    branchName: updateBranchName,
    path: repoRelativePath,
    content: fileContentBase64,
    message: prTitle,
    existingSha: existingFileSha,
    ensureBranchExists,
    baseBranch
  });

  // Find or create PR
  let baselinePr =
    (await findExistingBaselinePr({ octokit, branchName: updateBranchName })) || null;

  if (!baselinePr) {
    core.info(`No existing PR found for branch ${updateBranchName}, creating new PR...`);
    baselinePr = await createPullRequest({
      octokit,
      head: updateBranchName,
      base: baseBranch,
      title: prTitle,
      body: prBody
    });
  } else {
    core.info(
      `Updated existing baseline PR #${baselinePr.number} (${baselinePr.html_url})`
    );
  }

  core.setOutput("baseline-update-pr-number", String(baselinePr.number));
  core.setOutput("baseline-update-pr-url", baselinePr.html_url);
  core.setOutput("baseline-updated", "true");
};

/**
 * Wrapper for ensureUpdateBranchExists to match createOrUpdateFileContents signature
 */
const ensureBranchExists = async ({ octokit, branchName, baseBranch }) => {
  return ensureUpdateBranchExists({ octokit, branchName, baseBranch });
};

export default runAction;

if (process.env.NODE_ENV !== "test") {
  runAction();
}
