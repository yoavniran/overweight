import { brotliTester } from "./brotli.js";
import { gzipTester } from "./gzip.js";
import { noneTester } from "./none.js";
import { DEFAULT_TESTER_ID, createTester, normalizeTesterId } from "./shared.js";

export { DEFAULT_TESTER_ID } from "./shared.js";

const builtinTesters = new Map(
  [noneTester, gzipTester, brotliTester].map((tester) => [tester.id, createTester(tester)])
);

export const createTesterRegistry = (customTesters) => {
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

export const getTester = (testerId, registry) => {
  const normalized = normalizeTesterId(testerId);
  const tester = registry.get(normalized);

  if (!tester) {
    throw new Error(`Unknown tester "${testerId}"`);
  }

  return tester;
};

export const listTesters = () =>
  Array.from(builtinTesters.values()).map((tester) => ({
    id: tester.id,
    label: tester.label
  }));

