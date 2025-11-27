export const DEFAULT_TESTER_ID = "gzip";
export const NORMALIZED_TOKENS = new Set(["none", "gzip", "brotli"]);

export const createTester = ({ id, label, measure }) => {
  if (!id || typeof measure !== "function") {
    throw new Error("Tester definitions must include an id and a measure function");
  }

  return {
    id,
    label: label || id,
    measure
  };
};

export const normalizeTesterId = (value) => {
  if (!value) {
    return DEFAULT_TESTER_ID;
  }

  const normalized = value.toLowerCase();
  return NORMALIZED_TOKENS.has(normalized) ? normalized : value;
};

