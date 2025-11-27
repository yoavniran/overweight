import path from "node:path";

import fg from "fast-glob";

export const resolveFiles = async (pattern, { root }) => {
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

