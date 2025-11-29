import fs from "node:fs/promises";
import path from "node:path";
import { Buffer } from "node:buffer";

import core from "@actions/core";
import github from "@actions/github";

import { loadConfig, normalizeConfig } from "../config/load-config.js";
import { runChecks } from "../core/run-checks.js";
import { jsonFileReporter } from "../reporters/json-file-reporter.js";
import { formatDiff } from "../utils/size.js";

const BOT_COMMIT_IDENTITY = {
  name: "Overweight Bot",
  email: "ci-bot@overweight-gh-action.com"
};

const statusEmoji = (row) => {
  if (row.error) {
    return "💥";
  }

  return row.status === "pass" ? "🟢" : "🔺";
};

const buildSummaryRows = (results) =>
  results.map((entry) => ({
    label: entry.label,
    file: entry.filePath,
    tester: entry.testerLabel,
    size: entry.sizeFormatted,
    sizeBytes: typeof entry.size === "number" ? entry.size : 0,
    limit: entry.maxSizeFormatted,
    limitBytes: entry.maxSize,
    diff: entry.diffFormatted,
    diffBytes: typeof entry.diff === "number" ? entry.diff : 0,
    status: entry.error ? "error" : entry.passed ? "pass" : "fail",
    error: entry.error || null
  }));

const readBaselineState = async (baselinePath) => {
  try {
    const raw = await fs.readFile(baselinePath, "utf-8");
    let data = null;

    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }

    return { raw, data };
  } catch {
    return { raw: null, data: null };
  }
};

const buildBaselineSnapshot = (rows) =>
  [...rows]
    .map((row) => ({
      label: row.label,
      file: row.file,
      tester: row.tester,
      size: row.size,
      sizeBytes: row.sizeBytes,
      limit: row.limit,
      limitBytes: row.limitBytes
    }))
    .sort((a, b) => a.file.localeCompare(b.file));

const serializeBaselineSnapshot = (rows) => JSON.stringify(buildBaselineSnapshot(rows), null, 2);

const writeBaseline = async (baselinePath, rows, precomputedContent) => {
  await fs.mkdir(path.dirname(baselinePath), { recursive: true });
  const content = precomputedContent ?? serializeBaselineSnapshot(rows);
  await fs.writeFile(baselinePath, content);
};

const getBaselineUpdateInfo = async (baselinePath, rows, previousContent = undefined) => {
  const nextContent = serializeBaselineSnapshot(rows);

  if (previousContent !== undefined) {
    return {
      needsUpdate: previousContent === null ? true : previousContent !== nextContent,
      content: nextContent
    };
  }

  try {
    const currentContent = await fs.readFile(baselinePath, "utf-8");
    return { needsUpdate: currentContent !== nextContent, content: nextContent };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { needsUpdate: true, content: nextContent };
    }

    throw error;
  }
};

const mergeWithBaseline = (rows, baseline) => {
  if (!baseline) {
    return rows;
  }

  const map = new Map(baseline.map((row) => [row.file, row]));

  return rows.map((row) => {
    const previous = map.get(row.file);

    if (!previous) {
      return { ...row, baselineSize: "N/A", baselineDiff: "N/A", trend: "N/A" };
    }

    const delta = row.sizeBytes - (previous.sizeBytes || 0);

    return {
      ...row,
      baselineSize: previous.size,
      baselineDiff: formatDiff(delta),
      trend: delta === 0 ? "➖" : delta > 0 ? "🔺" : "⬇"
    };
  });
};

const toTableData = (rows) => [
  [
    { data: "Status", header: true },
    { data: "Label", header: true },
    { data: "File", header: true },
    { data: "Size", header: true },
    { data: "Limit", header: true },
    { data: "Δ", header: true },
    { data: "Trend", header: true }
  ],
  ...rows.map((row) => [
    { data: statusEmoji(row) },
    { data: row.label },
    { data: row.file },
    { data: row.size },
    { data: row.limit },
    { data: row.diff },
    { data: row.trend || "N/A" }
  ])
];

const renderHtmlTable = (rows) => {
  const header = ["Status", "Label", "File", "Size", "Limit", "Δ", "Trend"]
    .map((title) => `<th>${title}</th>`)
    .join("");
  const body = rows
    .map(
      (row) =>
        `<tr><td>${statusEmoji(row)}</td><td>${row.label}</td><td>${row.file}</td><td>${row.size}</td><td>${row.limit}</td><td>${row.diff}</td><td>${row.trend || "N/A"}</td></tr>`
    )
    .join("");

  return `<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
};

const buildInlineConfig = (input) => {
  if (!input) {
    return null;
  }

  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed) ? { files: parsed } : parsed;
  } catch (error) {
    throw new Error(`Failed to parse \`files\` input: ${error.message}`);
  }
};

const resolveWorkingDirectory = (input) =>
  input ? path.resolve(process.cwd(), input) : process.cwd();

const DEFAULT_PROTECTED_BRANCHES = ["main", "master"];

const parseProtectedBranchPatterns = (input) => {
  const raw = input && input.trim().length ? input : DEFAULT_PROTECTED_BRANCHES.join(",");

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patternToRegex = (pattern) =>
  new RegExp(`^${pattern.split("*").map((segment) => escapeRegex(segment)).join(".*")}$`);

const branchMatchesPattern = (branch, pattern) => {
  if (!pattern || !branch) {
    return false;
  }

  return patternToRegex(pattern).test(branch);
};

const isBranchProtected = (branch, patterns) =>
  Boolean(branch) && patterns.some((pattern) => branchMatchesPattern(branch, pattern));

const getWorkspaceRoot = () => process.env.GITHUB_WORKSPACE || process.cwd();

const ensureRelativePath = (absolutePath) => {
  const workspaceRoot = getWorkspaceRoot();
  const relative = path.relative(workspaceRoot, absolutePath);

  if (relative.startsWith("..")) {
    throw new Error(
      `Baseline path "${absolutePath}" is outside of the repository checkout (${workspaceRoot}).`
    );
  }

  return relative.replace(/\\/g, "/");
};

const sanitizeBranchPrefix = (prefix) =>
  `${prefix || "overweight/baseline"}`.replace(/\/+$/, "");

const sanitizeBranchSuffix = (suffix) =>
  suffix ? suffix.replace(/[^0-9A-Za-z._-]+/g, "-") : "";

const buildUpdateBranchName = ({ prefix, prNumber, currentBranch }) => {
  const suffix =
    prNumber != null
      ? `pr-${prNumber}`
      : sanitizeBranchSuffix(currentBranch) || `run-${github.context.runId || Date.now()}`;

  return `${sanitizeBranchPrefix(prefix)}/${suffix}`;
};

const resolveBaseBranch = () =>
  github.context.payload.pull_request?.base?.ref ||
  process.env.GITHUB_REF_NAME ||
  process.env.GITHUB_REF?.split("/").pop() ||
  "main";

const ensureUpdateBranchExists = async ({ octokit, branchName, baseBranch }) => {
  const { owner, repo } = github.context.repo;

  try {
    await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${branchName}`
    });
    return true;
  } catch (error) {
    if (error.status !== 404) {
      throw error;
    }
  }

  const baseRef = await octokit.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${baseBranch}`
  });

  const baseSha = baseRef.data.object?.sha || baseRef.data.sha;

  await octokit.rest.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branchName}`,
    sha: baseSha
  });

  return false;
};

const getExistingFileSha = async ({ octokit, branchName, path: repoPath }) => {
  const { owner, repo } = github.context.repo;

  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: repoPath,
      ref: branchName
    });

    if (!Array.isArray(response.data) && response.data.type === "file") {
      return response.data.sha;
    }

    return undefined;
  } catch (error) {
    if (error.status === 404) {
      return undefined;
    }

    throw error;
  }
};

const findExistingBaselinePr = async ({ octokit, branchName }) => {
  const { owner, repo } = github.context.repo;

  const prs = await octokit.rest.pulls.list({
    owner,
    repo,
    head: `${owner}:${branchName}`,
    state: "open",
    per_page: 1
  });

  return prs.data?.[0] || null;
};

const findPrNumberForBranch = async ({ octokit, branch }) => {
  if (!branch) {
    return null;
  }

  const { owner, repo } = github.context.repo;
  const prs = await octokit.rest.pulls.list({
    owner,
    repo,
    head: `${owner}:${branch}`,
    state: "open",
    per_page: 1
  });

  const pr = prs.data?.[0];
  return pr?.number ?? null;
};

const resolveConfig = async () => {
  const configInput = core.getInput("config");
  const filesInput = core.getInput("files");
  const cwd = resolveWorkingDirectory(core.getInput("working-directory"));
  const inlineConfig = buildInlineConfig(filesInput);

  if (inlineConfig) {
    return normalizeConfig(inlineConfig, { cwd, source: { type: "inline" } });
  }

  return loadConfig({ cwd, configPath: configInput || undefined });
};

const REPORT_MARKER = "<!-- overweight-report -->";

const findExistingReportComment = async (octokit, pullRequest) => {
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

const commentOnPullRequest = async ({ octokit, pullRequest, body, existingComment }) => {
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

const getBranchName = () =>
  process.env.GITHUB_REF_NAME || process.env.GITHUB_REF?.split("/").pop() || "";

export const runAction = async () => {
  try {
    const config = await resolveConfig();
    const githubToken = core.getInput("github-token");
    const octokit = githubToken ? github.getOctokit(githubToken) : null;
    const commentOnFailure = core.getBooleanInput("comment-on-pr");
    const commentOnFirstRun = core.getBooleanInput("comment-on-pr-always");
    const commentOnEachRun = core.getBooleanInput("comment-on-pr-each-run");
    const prPayload = github.context.payload.pull_request;
    const prAction = github.context.payload.action;
    const result = await runChecks(config);
    const baseRows = buildSummaryRows(result.results);

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
    jsonFileReporter(result, {
      reportFile: reportFileInput,
      cwd: config.root,
      silent: true
    });
    const resolvedReportPath = path.resolve(config.root, reportFileInput);

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

    if (baselinePath) {
      if (result.stats.hasFailures) {
        core.info("Skipping baseline update because size checks failed.");
      } else if (!updateBaseline) {
        core.info("update-baseline=false, skipping baseline write.");
      } else if (!githubToken || !octokit) {
        core.setFailed("update-baseline requires github-token to be provided.");
      } else {
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
          `Overweight: baseline path detected at ${baselinePath} (branch=${currentBranch}, needsUpdate=${needsUpdate})`
        );

        if (branchIsProtected) {
          core.info(
            `Skipping baseline update because branch "${currentBranch}" matches baseline-protected-branches.`
          );
        } else if (!needsUpdate) {
          core.info("Baseline is already up to date; no changes written.");
        } else {
          const baseBranch = resolveBaseBranch();
          const prTitleInput = core.getInput("update-pr-title") || "chore: update baseline report";
          const prTitle = `${prTitleInput} (🧳 Overweight Guard)`;
          const prBody =
            core.getInput("update-pr-body") ||
            "Automatic pull request updating the baseline report.";
          const branchPrefix = core.getInput("update-branch-prefix") || "overweight/baseline";
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

          const updateBranchName = buildUpdateBranchName({
            prefix: branchPrefix,
            prNumber: prIdentifier,
            currentBranch
          });
          const repoRelativePath = ensureRelativePath(baselinePath);

          await ensureUpdateBranchExists({
            octokit,
            branchName: updateBranchName,
            baseBranch
          });

          const existingFileSha = await getExistingFileSha({
            octokit,
            branchName: updateBranchName,
            path: repoRelativePath
          });

          await writeBaseline(baselinePath, summaryRows, content);
          core.info(`Wrote updated baseline snapshot to ${baselinePath}`);

          await octokit.rest.repos.createOrUpdateFileContents({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            path: repoRelativePath,
            message: prTitle,
            content: Buffer.from(content, "utf-8").toString("base64"),
            branch: updateBranchName,
            sha: existingFileSha,
            committer: BOT_COMMIT_IDENTITY,
            author: BOT_COMMIT_IDENTITY
          });

          let baselinePr =
            (await findExistingBaselinePr({ octokit, branchName: updateBranchName })) || null;

          if (!baselinePr) {
            const prResponse = await octokit.rest.pulls.create({
              owner: github.context.repo.owner,
              repo: github.context.repo.repo,
              head: updateBranchName,
              base: baseBranch,
              title: prTitle,
              body: prBody
            });
            baselinePr = prResponse.data;
            core.info(`Opened baseline update PR #${baselinePr.number} (${baselinePr.html_url})`);
          } else {
            core.info(
              `Updated existing baseline PR #${baselinePr.number} (${baselinePr.html_url})`
            );
          }

          core.setOutput("baseline-update-pr-number", String(baselinePr.number));
          core.setOutput("baseline-update-pr-url", baselinePr.html_url);
          core.setOutput("baseline-updated", "true");
        }
      }
    }

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
    core.setFailed(error.message);
  }
};

export default runAction;

if (process.env.NODE_ENV !== "test") {
  runAction();
}

