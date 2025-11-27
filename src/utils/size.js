import prettyBytes from "pretty-bytes";

const UNIT_FACTORS = {
  b: 1,
  byte: 1,
  bytes: 1,
  k: 1_000,
  kb: 1_000,
  kib: 1_024,
  m: 1_000_000,
  mb: 1_000_000,
  mib: 1_048_576,
  g: 1_000_000_000,
  gb: 1_000_000_000,
  gib: 1_073_741_824
};

export const formatBytes = (value) => prettyBytes(Math.max(0, value), { binary: false });

export const formatDiff = (diff) => {
  if (diff === 0) {
    return "0 B";
  }

  const sign = diff > 0 ? "+" : "-";
  return `${sign}${formatBytes(Math.abs(diff))}`;
};

export const parseSize = (value) => {
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

export const toDisplaySize = (original, bytes) => {
  if (typeof original === "string" && original.trim().length) {
    return original.trim();
  }

  return formatBytes(bytes);
};

