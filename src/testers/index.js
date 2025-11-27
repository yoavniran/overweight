import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";

const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);

export const DEFAULT_TESTER_ID = "gzip";
const NORMALIZED_TOKENS = new Set(["none", "gzip", "brotli"]);

const createTester = ({ id, label, measure }) => {
  if (!id || typeof measure !== "function") {
    throw new Error("Tester definitions must include an id and a measure function");
  }

  return {
    id,
    label: label || id,
    measure
  };
};

const builtinTesters = new Map([
  [
    "none",
    createTester({
      id: "none",
      label: "raw",
      measure: async (buffer) => ({ bytes: buffer.byteLength })
    })
  ],
  [
    "gzip",
    createTester({
      id: "gzip",
      label: "gzip",
      measure: async (buffer) => {
        const compressed = await gzipAsync(buffer);
        return { bytes: compressed.byteLength };
      }
    })
  ],
  [
    "brotli",
    createTester({
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
    })
  ]
]);

const normalizeTesterId = (value) => {
  if (!value) {
    return DEFAULT_TESTER_ID;
  }

  const normalized = value.toLowerCase();
  return NORMALIZED_TOKENS.has(normalized) ? normalized : value;
};

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

