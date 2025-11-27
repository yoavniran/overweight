import { defineConfig } from "tsup";
import pkg from "./package.json" assert { type: "json" };

const externalDeps = Object.keys({
  ...(pkg.dependencies || {}),
  ...(pkg.peerDependencies || {})
});

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
  external: externalDeps
});

