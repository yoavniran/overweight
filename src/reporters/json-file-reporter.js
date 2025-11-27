import fs from "node:fs";
import path from "node:path";

const DEFAULT_FILE = "overweight-report.json";

const resolveTargetPath = (target, cwd = process.cwd()) => {
  if (!target) {
    return path.join(cwd, DEFAULT_FILE);
  }

  return path.isAbsolute(target) ? target : path.join(cwd, target);
};

export const jsonFileReporter = (result, options = {}) => {
  const filePath = resolveTargetPath(options.reportFile, options.cwd);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(result, null, 2));

  if (!options.silent) {
    console.log(`Saved Overweight report to ${filePath}`);
  }
};

