import fs from "node:fs/promises";
import path from "node:path";

import core from "@actions/core";
import github from "@actions/github";

import { loadConfig, normalizeConfig } from "../config/load-config.js";
import { runChecks } from "../core/run-checks.js";
import { jsonFileReporter } from "../reporters/json-file-reporter.js";
import { formatDiff } from "../utils/size.js";

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

const readBaseline = async (baselinePath) => {
  try {
    const raw = await fs.readFile(baselinePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const writeBaseline = async (baselinePath, rows) => {
  await fs.mkdir(path.dirname(baselinePath), { recursive: true });
  const sorted = [...rows]
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

  await fs.writeFile(baselinePath, JSON.stringify(sorted, null, 2));
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

const getWorkspaceRoot = () => process.env.GITHUB_WORKSPACE || process.cwd();

const ensureRelativePath = (absolutePath) => {
  const workspaceRoot = getWorkspaceRoot();
  const relative = path.relative(workspaceRoot, absolutePath);

  if (relative.startsWith("..")) {
    throw new Error(`Baseline path "${absolutePath}" is outside of the repository checkout (${workspaceRoot}).`);
  }

  return relative.replace(/\\/g, "/");
};

const sanitizeBranchName = (prefix) =>
  `${prefix || "overweight/baseline"}`.replace(/\/+$/, "");

const parseLabels = (labels) =>
  labels
    ?.split(",")
    .map((label) => label.trim())
    .filter(Boolean) ?? [];

const createBaselinePullRequest = async ({
  baselinePath,
  baseBranch,
  title,
  body,
  branchPrefix,
  labels,
  token
}) => {
  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;
  const baseRef = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${baseBranch}`
  });

  const branchName = `${sanitizeBranchName(branchPrefix)}/${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}`;

  await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branchName}`,
    sha: baseRef.data.object.sha
  });

  const repoRelativePath = ensureRelativePath(baselinePath);
  const fileContent = await fs.readFile(baselinePath, "utf-8");

  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: repoRelativePath,
    message: title,
    content: Buffer.from(fileContent, "utf-8").toString("base64"),
    branch: branchName
  });

  const pr = await octokit.pulls.create({
    owner,
    repo,
    head: branchName,
    base: baseBranch,
    title,
    body
  });

  const parsedLabels = parseLabels(labels);
  if (parsedLabels.length) {
    await octokit.issues.addLabels({
      owner,
      repo,
      issue_number: pr.data.number,
      labels: parsedLabels
    });
  }

  core.info(`Opened baseline update PR #${pr.data.number} (${pr.data.html_url})`);
  core.setOutput("baseline-pr-number", String(pr.data.number));
  core.setOutput("baseline-pr-url", pr.data.html_url);
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

const commentOnPullRequest = async (token, body) => {
  const pullRequest = github.context.payload.pull_request;

  if (!pullRequest) {
    core.info("No pull request found in the event payload; skipping comment.");
    return;
  }

  const octokit = github.getOctokit(token);
  await octokit.rest.issues.createComment({
    repo: github.context.repo.repo,
    owner: github.context.repo.owner,
    issue_number: pullRequest.number,
    body
  });
};

const getBranchName = () =>
  process.env.GITHUB_REF_NAME || process.env.GITHUB_REF?.split("/").pop() || "";

const runAction = async () => {
  try {
    const config = await resolveConfig();
    const githubToken = core.getInput("github-token");
    const commentOnFailure = core.getBooleanInput("comment-on-pr");
    const commentOnFirstRun = core.getBooleanInput("comment-on-pr-always");
    const commentOnEachRun = core.getBooleanInput("comment-on-pr-each-run");
    const prPayload = github.context.payload.pull_request;
    const prAction = github.context.payload.action;
    const result = await runChecks(config);
    const baseRows = buildSummaryRows(result.results);

    const baselinePathInput = core.getInput("baseline-path");
    const baselinePath = baselinePathInput
      ? path.resolve(config.root, baselinePathInput)
      : null;
    const baselineData = baselinePath ? await readBaseline(baselinePath) : null;
    const summaryRows = mergeWithBaseline(baseRows, baselineData);
    const reportFileInput = core.getInput("report-file") || "overweight-report.json";
    jsonFileReporter(result, {
      reportFile: reportFileInput,
      cwd: config.root,
      silent: true
    });
    const resolvedReportPath = path.resolve(config.root, reportFileInput);

    core.summary.addHeading("📦 Bundle Size Report");
    core.summary.addTable(toTableData(summaryRows));
    await core.summary.write();

    const htmlTable = renderHtmlTable(summaryRows);

    core.setOutput("report-json", JSON.stringify({ rows: summaryRows, stats: result.stats }));
    core.setOutput("report-table", htmlTable);
    core.setOutput("has-failures", String(result.stats.hasFailures));
    core.setOutput("report-file", resolvedReportPath);

    if (baselinePath) {
      const targetBranch = core.getInput("baseline-branch") || "main";
      const updateBaseline = core.getBooleanInput("update-baseline");
      const createBaselinePr = core.getBooleanInput("baseline-create-pr");
      const currentBranch = getBranchName();

      if (updateBaseline) {
        if (createBaselinePr) {
          if (!githubToken) {
            core.setFailed("baseline-create-pr requires github-token to be set.");
          } else {
            await writeBaseline(baselinePath, summaryRows);
            await createBaselinePullRequest({
              baselinePath,
              baseBranch: targetBranch,
              title: core.getInput("baseline-pr-title") || "chore: update bundle size baseline",
              body: core.getInput("baseline-pr-body") || "This PR refreshes the bundle size baseline.",
              branchPrefix: core.getInput("baseline-pr-branch-prefix") || "overweight/baseline",
              labels: core.getInput("baseline-pr-labels") || "",
              token: githubToken
            });
            core.setOutput("baseline-updated", "true");
          }
        } else if (currentBranch === targetBranch) {
          await writeBaseline(baselinePath, summaryRows);
          core.info(`Saved updated baseline report to ${baselinePath}`);
          core.setOutput("baseline-updated", "true");
        } else {
          core.info(
            `Skipping baseline update because current branch "${currentBranch}" does not match target branch "${targetBranch}". Enable baseline-create-pr to open a pull request automatically.`
          );
        }
      }
    }

    const shouldCommentOnSuccess =
      prPayload &&
      (commentOnEachRun || (commentOnFirstRun && prAction === "opened"));
    const shouldCommentOnFailure = result.stats.hasFailures && commentOnFailure;
    if (githubToken && (shouldCommentOnFailure || shouldCommentOnSuccess)) {
      const statusText = result.stats.hasFailures
        ? "Bundle size check failed"
        : "Bundle size report";

      await commentOnPullRequest(
        githubToken,
        `${statusText}:\n\n${htmlTable}`
      );
    }

    if (result.stats.hasFailures) {
      core.setFailed("One or more bundle size checks failed.");
    }
  } catch (error) {
    core.setFailed(error.message);
  }
};

runAction();

