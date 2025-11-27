import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.js",
    cli: "src/cli.js",
    "action/index": "src/action/index.js"
  },
  format: ["esm"],
  target: "node18",
  platform: "node",
  bundle: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  dts: false,
  shims: false,
  treeshake: true,
  shebang: {
    cli: "#!/usr/bin/env node"
  },
  noExternal: ["@actions/core", "@actions/github", "cac", "fast-glob", "picocolors", "pretty-bytes", "zod"]
});

