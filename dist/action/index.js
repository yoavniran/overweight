import fs4 from 'fs/promises';
import path from 'path';
import { Buffer } from 'buffer';
import core from '@actions/core';
import github from '@actions/github';
import { z } from 'zod';
import { promisify } from 'util';
import { brotliCompress, gzip, constants } from 'zlib';
import prettyBytes from 'pretty-bytes';
import fg from 'fast-glob';
import fs3 from 'fs';

// src/action/index.js
var brotliAsync = promisify(brotliCompress);
var brotliTester = {
  id: "brotli",
  label: "brotli",
  measure: async (buffer) => {
    const compressed = await brotliAsync(buffer, {
      params: {
        [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
        [constants.BROTLI_PARAM_QUALITY]: 11
      }
    });
    return { bytes: compressed.byteLength };
  }
};
var gzipAsync = promisify(gzip);
var gzipTester = {
  id: "gzip",
  label: "gzip",
  measure: async (buffer) => {
    const compressed = await gzipAsync(buffer);
    return { bytes: compressed.byteLength };
  }
};

// src/testers/none.js
var noneTester = {
  id: "none",
  label: "raw",
  measure: async (buffer) => ({ bytes: buffer.byteLength })
};

// src/testers/shared.js
var DEFAULT_TESTER_ID = "gzip";
var NORMALIZED_TOKENS = /* @__PURE__ */ new Set(["none", "gzip", "brotli"]);
var createTester = ({ id, label, measure }) => {
  if (!id || typeof measure !== "function") {
    throw new Error("Tester definitions must include an id and a measure function");
  }
  return {
    id,
    label: label || id,
    measure
  };
};
var normalizeTesterId = (value) => {
  if (!value) {
    return DEFAULT_TESTER_ID;
  }
  const normalized = value.toLowerCase();
  return NORMALIZED_TOKENS.has(normalized) ? normalized : value;
};

// src/testers/index.js
var builtinTesters = new Map(
  [noneTester, gzipTester, brotliTester].map((tester) => [tester.id, createTester(tester)])
);
var createTesterRegistry = (customTesters) => {
  const registry = new Map(builtinTesters);
  if (customTesters) {
    const entries = customTesters instanceof Map ? customTesters.entries() : Object.entries(customTesters);
    for (const [, tester] of entries) {
      const normalizedTester = createTester(tester);
      registry.set(normalizedTester.id, normalizedTester);
    }
  }
  return registry;
};
var getTester = (testerId, registry) => {
  const normalized = normalizeTesterId(testerId);
  const tester = registry.get(normalized);
  if (!tester) {
    throw new Error(`Unknown tester "${testerId}"`);
  }
  return tester;
};
var UNIT_FACTORS = {
  b: 1,
  byte: 1,
  bytes: 1,
  k: 1e3,
  kb: 1e3,
  kib: 1024,
  m: 1e6,
  mb: 1e6,
  mib: 1048576,
  g: 1e9,
  gb: 1e9,
  gib: 1073741824
};
var formatBytes = (value) => prettyBytes(Math.max(0, value), { binary: false });
var formatDiff = (diff) => {
  if (diff === 0) {
    return "0 B";
  }
  const sign = diff > 0 ? "+" : "-";
  return `${sign}${formatBytes(Math.abs(diff))}`;
};
var parseSize = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    throw new Error(`Unsupported size value. Expected string or number, received: ${typeof value}`);
  }
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "");
  const match = normalized.match(/^(-?\d+(?:\.\d+)?)([a-z]+)?$/i);
  if (!match) {
    throw new Error(`Invalid size format: "${value}"`);
  }
  const [, rawNumber, rawUnit] = match;
  const unit = rawUnit || "b";
  const factor = UNIT_FACTORS[unit];
  if (!factor) {
    throw new Error(`Unknown size unit "${unit}" in value "${value}"`);
  }
  const numericValue = Number(rawNumber);
  if (!Number.isFinite(numericValue)) {
    throw new Error(`Invalid numeric size: "${value}"`);
  }
  return Math.round(numericValue * factor);
};
var toDisplaySize = (original, bytes) => {
  if (typeof original === "string" && original.trim().length) {
    return original.trim();
  }
  return formatBytes(bytes);
};

// src/config/load-config.js
var NORMALIZED_CONFIG_FLAG = Symbol.for("overweight.normalizedConfig");
var FileSchema = z.object({
  path: z.string().min(1, "Each file rule requires a path or glob pattern"),
  maxSize: z.union([z.string(), z.number()]),
  compression: z.string().optional(),
  label: z.string().optional()
});
var ConfigSchema = z.object({
  root: z.string().optional(),
  defaultCompression: z.string().optional(),
  files: z.array(FileSchema).min(1, "Provide at least one file rule to check")
});
var ensureArrayConfig = (input) => Array.isArray(input) ? { files: input } : input;
var fileExists = async (targetPath) => {
  try {
    await fs4.access(targetPath);
    return true;
  } catch {
    return false;
  }
};
var readJson = async (targetPath) => {
  const raw = await fs4.readFile(targetPath, "utf-8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse JSON file at ${targetPath}: ${error.message}`);
  }
};
var isNormalizedConfig = (config) => Boolean(config?.[NORMALIZED_CONFIG_FLAG]);
var normalizeConfig = (rawConfig, { cwd, source } = {}) => {
  const configRoot = path.resolve(cwd || process.cwd());
  const parsed = ConfigSchema.parse(ensureArrayConfig(rawConfig));
  const defaultCompression = (parsed.defaultCompression || DEFAULT_TESTER_ID).toLowerCase();
  const normalized = {
    root: parsed.root ? path.resolve(configRoot, parsed.root) : configRoot,
    defaultCompression,
    files: parsed.files.map((file) => {
      const maxBytes = parseSize(file.maxSize);
      if (maxBytes < 0) {
        throw new Error(`maxSize for "${file.path}" must be greater than or equal to zero`);
      }
      const compression = (file.compression || defaultCompression).toLowerCase();
      return {
        path: file.path,
        pattern: file.path,
        label: file.label || file.path,
        compression,
        maxBytes,
        maxSizeInput: file.maxSize,
        maxDisplay: toDisplaySize(file.maxSize, maxBytes),
        maxFormatted: formatBytes(maxBytes)
      };
    }),
    source: source || { type: "inline" }
  };
  normalized[NORMALIZED_CONFIG_FLAG] = true;
  return normalized;
};
var loadConfig = async ({ cwd = process.cwd(), configPath, inlineConfig } = {}) => {
  const root = path.resolve(cwd);
  if (inlineConfig) {
    return normalizeConfig(inlineConfig, { cwd: root, source: { type: "inline" } });
  }
  const tryLoadConfig = async (candidatePath) => {
    if (!await fileExists(candidatePath)) {
      return null;
    }
    const data = await readJson(candidatePath);
    return normalizeConfig(data, { cwd: root, source: { type: "file", location: candidatePath } });
  };
  if (configPath) {
    const absoluteConfig = path.resolve(root, configPath);
    const loaded = await tryLoadConfig(absoluteConfig);
    if (!loaded) {
      throw new Error(`Could not find config file at "${absoluteConfig}"`);
    }
    return loaded;
  }
  const defaultConfigPaths = ["overweight.json", "overweight.config.json"].map(
    (file) => path.join(root, file)
  );
  for (const candidate of defaultConfigPaths) {
    const loaded = await tryLoadConfig(candidate);
    if (loaded) {
      return loaded;
    }
  }
  const packageJsonPath = path.join(root, "package.json");
  if (await fileExists(packageJsonPath)) {
    const pkgJson = await readJson(packageJsonPath);
    const field = pkgJson.overweight;
    if (field) {
      return normalizeConfig(ensureArrayConfig(field), {
        cwd: root,
        source: { type: "package", location: packageJsonPath }
      });
    }
  }
  throw new Error(
    "No overweight configuration found. Create an overweight.json (or overweight.config.json) file, add an `overweight` field to package.json, or pass --config."
  );
};
var resolveFiles = async (pattern, { root }) => {
  const matches = await fg(pattern, {
    cwd: root,
    absolute: true,
    dot: true,
    onlyFiles: true
  });
  const unique = Array.from(new Set(matches));
  return unique.map((absolutePath) => ({
    absolutePath,
    relativePath: path.relative(root, absolutePath) || path.basename(absolutePath)
  }));
};

// src/core/run-checks.js
var buildMissingResult = (rule) => ({
  pattern: rule.pattern,
  label: rule.label,
  filePath: rule.pattern,
  tester: rule.compression,
  testerLabel: rule.compression,
  size: null,
  sizeFormatted: "N/A",
  maxSizeFormatted: rule.maxFormatted,
  maxSize: rule.maxBytes,
  diff: null,
  diffFormatted: "N/A",
  passed: false,
  error: "No files matched this pattern"
});
var markNormalized = (config) => normalizeConfig(config, {
  cwd: config.root || process.cwd(),
  source: config.source || { type: "inline" }
});
var runChecks = async (rawConfig, options = {}) => {
  const normalizedConfig = isNormalizedConfig(rawConfig) ? rawConfig : markNormalized(rawConfig);
  const registry = createTesterRegistry(options.testers);
  const results = [];
  for (const fileRule of normalizedConfig.files) {
    const tester = getTester(fileRule.compression || normalizedConfig.defaultCompression, registry);
    const matches = await resolveFiles(fileRule.pattern, { root: normalizedConfig.root });
    if (!matches.length) {
      results.push(buildMissingResult(fileRule));
      continue;
    }
    for (const match of matches) {
      const buffer = await fs4.readFile(match.absolutePath);
      const measurement = await tester.measure(buffer, {
        filePath: match.absolutePath,
        pattern: fileRule.pattern
      });
      const size = Number(measurement?.bytes);
      if (!Number.isFinite(size)) {
        throw new Error(`Tester "${tester.id}" did not return a numeric size for "${match.relativePath}"`);
      }
      const diff = size - fileRule.maxBytes;
      const passed = diff <= 0;
      results.push({
        pattern: fileRule.pattern,
        label: fileRule.label,
        filePath: match.relativePath,
        absolutePath: match.absolutePath,
        tester: tester.id,
        testerLabel: tester.label,
        size,
        sizeFormatted: formatBytes(size),
        maxSizeFormatted: fileRule.maxFormatted,
        maxSize: fileRule.maxBytes,
        diff,
        diffFormatted: formatDiff(diff),
        passed
      });
    }
  }
  const failures = results.filter((entry) => !entry.passed || entry.error);
  return {
    results,
    stats: {
      files: results.length,
      failures,
      hasFailures: failures.length > 0,
      hasErrors: failures.some((entry) => Boolean(entry.error))
    }
  };
};
var DEFAULT_FILE = "overweight-report.json";
var resolveTargetPath = (target, cwd = process.cwd()) => {
  if (!target) {
    return path.join(cwd, DEFAULT_FILE);
  }
  return path.isAbsolute(target) ? target : path.join(cwd, target);
};
var jsonFileReporter = (result, options = {}) => {
  const filePath = resolveTargetPath(options.reportFile, options.cwd);
  fs3.mkdirSync(path.dirname(filePath), { recursive: true });
  fs3.writeFileSync(filePath, JSON.stringify(result, null, 2));
  if (!options.silent) {
    console.log(`Saved Overweight report to ${filePath}`);
  }
};

// src/action/index.js
var BOT_COMMIT_IDENTITY = {
  name: "Overweight Bot",
  email: "ci-bot@overweight-gh-action.com"
};
var statusEmoji = (row) => {
  if (row.error) {
    return "\u{1F4A5}";
  }
  return row.status === "pass" ? "\u{1F7E2}" : "\u{1F53A}";
};
var buildSummaryRows = (results) => results.map((entry) => ({
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
var readBaselineState = async (baselinePath) => {
  try {
    const raw = await fs4.readFile(baselinePath, "utf-8");
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
var buildBaselineSnapshot = (rows) => [...rows].map((row) => ({
  label: row.label,
  file: row.file,
  tester: row.tester,
  size: row.size,
  sizeBytes: row.sizeBytes,
  limit: row.limit,
  limitBytes: row.limitBytes
})).sort((a, b) => a.file.localeCompare(b.file));
var serializeBaselineSnapshot = (rows) => JSON.stringify(buildBaselineSnapshot(rows), null, 2);
var writeBaseline = async (baselinePath, rows, precomputedContent) => {
  await fs4.mkdir(path.dirname(baselinePath), { recursive: true });
  const content = precomputedContent ?? serializeBaselineSnapshot(rows);
  await fs4.writeFile(baselinePath, content);
};
var getBaselineUpdateInfo = async (baselinePath, rows, previousContent = void 0) => {
  const nextContent = serializeBaselineSnapshot(rows);
  if (previousContent !== void 0) {
    return {
      needsUpdate: previousContent === null ? true : previousContent !== nextContent,
      content: nextContent
    };
  }
  try {
    const currentContent = await fs4.readFile(baselinePath, "utf-8");
    return { needsUpdate: currentContent !== nextContent, content: nextContent };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { needsUpdate: true, content: nextContent };
    }
    throw error;
  }
};
var mergeWithBaseline = (rows, baseline) => {
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
      trend: delta === 0 ? "\u2796" : delta > 0 ? "\u{1F53A}" : "\u2B07"
    };
  });
};
var toTableData = (rows) => [
  [
    { data: "Status", header: true },
    { data: "Label", header: true },
    { data: "File", header: true },
    { data: "Size", header: true },
    { data: "Limit", header: true },
    { data: "\u0394", header: true },
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
var renderHtmlTable = (rows) => {
  const header = ["Status", "Label", "File", "Size", "Limit", "\u0394", "Trend"].map((title) => `<th>${title}</th>`).join("");
  const body = rows.map(
    (row) => `<tr><td>${statusEmoji(row)}</td><td>${row.label}</td><td>${row.file}</td><td>${row.size}</td><td>${row.limit}</td><td>${row.diff}</td><td>${row.trend || "N/A"}</td></tr>`
  ).join("");
  return `<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
};
var buildInlineConfig = (input) => {
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
var resolveWorkingDirectory = (input) => input ? path.resolve(process.cwd(), input) : process.cwd();
var DEFAULT_PROTECTED_BRANCHES = ["main", "master"];
var parseProtectedBranchPatterns = (input) => {
  const raw = input && input.trim().length ? input : DEFAULT_PROTECTED_BRANCHES.join(",");
  return raw.split(",").map((entry) => entry.trim()).filter(Boolean);
};
var escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var patternToRegex = (pattern) => new RegExp(`^${pattern.split("*").map((segment) => escapeRegex(segment)).join(".*")}$`);
var branchMatchesPattern = (branch, pattern) => {
  if (!pattern || !branch) {
    return false;
  }
  return patternToRegex(pattern).test(branch);
};
var isBranchProtected = (branch, patterns) => Boolean(branch) && patterns.some((pattern) => branchMatchesPattern(branch, pattern));
var getWorkspaceRoot = () => process.env.GITHUB_WORKSPACE || process.cwd();
var ensureRelativePath = (absolutePath) => {
  const workspaceRoot = getWorkspaceRoot();
  const relative = path.relative(workspaceRoot, absolutePath);
  if (relative.startsWith("..")) {
    throw new Error(
      `Baseline path "${absolutePath}" is outside of the repository checkout (${workspaceRoot}).`
    );
  }
  return relative.replace(/\\/g, "/");
};
var sanitizeBranchPrefix = (prefix) => `${prefix}`.replace(/\/+$/, "");
var sanitizeBranchSuffix = (suffix) => suffix.replace(/[^0-9A-Za-z._-]+/g, "-") ;
var buildUpdateBranchName = ({ prefix, prNumber, currentBranch }) => {
  const suffix = prNumber != null ? `pr-${prNumber}` : sanitizeBranchSuffix(currentBranch) || `run-${github.context.runId || Date.now()}`;
  return `${sanitizeBranchPrefix(prefix)}/${suffix}`;
};
var resolveBaseBranch = () => github.context.payload.pull_request?.base?.ref || process.env.GITHUB_REF_NAME || process.env.GITHUB_REF?.split("/").pop() || "main";
var ensureUpdateBranchExists = async ({ octokit, branchName, baseBranch }) => {
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
var getExistingFileSha = async ({ octokit, branchName, path: repoPath }) => {
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
    return void 0;
  } catch (error) {
    if (error.status === 404) {
      return void 0;
    }
    throw error;
  }
};
var findExistingBaselinePr = async ({ octokit, branchName }) => {
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
var findPrNumberForBranch = async ({ octokit, branch }) => {
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
var resolveConfig = async () => {
  const configInput = core.getInput("config");
  const filesInput = core.getInput("files");
  const cwd = resolveWorkingDirectory(core.getInput("working-directory"));
  const inlineConfig = buildInlineConfig(filesInput);
  if (inlineConfig) {
    return normalizeConfig(inlineConfig, { cwd, source: { type: "inline" } });
  }
  return loadConfig({ cwd, configPath: configInput || void 0 });
};
var REPORT_MARKER = "<!-- overweight-report -->";
var findExistingReportComment = async (octokit, pullRequest) => {
  const { owner, repo } = github.context.repo;
  const existingComments = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: pullRequest.number,
    per_page: 100
  });
  const existing = existingComments.data.filter((comment) => comment?.user?.type === "Bot" && comment?.body?.includes(REPORT_MARKER)).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0];
  return existing || null;
};
var commentOnPullRequest = async ({ octokit, pullRequest, body, existingComment }) => {
  if (!pullRequest) {
    core.info("No pull request found in the event payload; skipping comment.");
    return;
  }
  const isFork = pullRequest.head?.repo?.full_name && pullRequest.base?.repo?.full_name && pullRequest.head.repo.full_name !== pullRequest.base.repo.full_name;
  if (isFork) {
    core.info("Skipping pull request comment because the PR originates from a fork.");
    return;
  }
  const previous = existingComment !== void 0 ? existingComment : await findExistingReportComment(octokit, pullRequest);
  const commentBody = `${REPORT_MARKER}
${body}`;
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
var getBranchName = () => process.env.GITHUB_REF_NAME || process.env.GITHUB_REF?.split("/").pop() || "";
var runAction = async () => {
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
    const shouldDefaultBaselinePath = !baselineReportPathInput && updateBaseline && Boolean(reportFileInput);
    const baselinePathCandidate = baselineReportPathInput || (shouldDefaultBaselinePath ? reportFileInput : null);
    if (shouldDefaultBaselinePath) {
      core.info(
        `Overweight: baseline-report-path not provided, defaulting to report-file "${reportFileInput}".`
      );
    }
    const baselinePath = baselinePathCandidate ? path.resolve(config.root, baselinePathCandidate) : null;
    const baselineState = baselinePath ? await readBaselineState(baselinePath) : null;
    const baselineData = baselineState?.data ?? null;
    const baselineFileContent = baselineState ? baselineState.raw : void 0;
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
    core.summary.addHeading("\u{1F9F3} Overweight Size Report");
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
        if (!needsUpdate) {
          core.info("Baseline is already up to date; no changes written.");
        } else if (branchIsProtected) {
          core.info(
            `Skipping baseline update because branch "${currentBranch}" matches baseline-protected-branches.`
          );
        } else {
          const baseBranch = resolveBaseBranch();
          const prTitleInput = core.getInput("update-pr-title") || "chore: update baseline report";
          const prTitle = `${prTitleInput} (\u{1F9F3} Overweight Guard)`;
          const prBody = core.getInput("update-pr-body") || "Automatic pull request updating the baseline report.";
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
          let baselinePr = await findExistingBaselinePr({ octokit, branchName: updateBranchName }) || null;
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
    const existingComment = octokit && prPayload ? await findExistingReportComment(octokit, prPayload) : null;
    const shouldCommentOnSuccess = prPayload && (commentOnEachRun || commentOnFirstRun && prAction === "opened");
    const shouldCommentOnFailure = result.stats.hasFailures && commentOnFailure;
    const shouldUpdateExisting = Boolean(existingComment) && !result.stats.hasFailures && commentOnFailure;
    if (octokit && (shouldCommentOnFailure || shouldCommentOnSuccess || shouldUpdateExisting)) {
      const statusText = result.stats.hasFailures ? "Overweight: Size check failed" : "Overweight: Size check passed";
      core.info(
        `Overweight: preparing PR comment (failure=${result.stats.hasFailures}, existingComment=${Boolean(
          existingComment
        )}, forceUpdate=${shouldUpdateExisting})`
      );
      await commentOnPullRequest({
        octokit,
        pullRequest: prPayload,
        body: `${statusText}:

${htmlTable}`,
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
var action_default = runAction;
if (process.env.NODE_ENV !== "test") {
  runAction();
}

export { action_default as default, runAction };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map