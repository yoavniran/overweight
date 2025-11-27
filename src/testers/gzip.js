import { promisify } from "node:util";
import { gzip } from "node:zlib";

const gzipAsync = promisify(gzip);

export const gzipTester = {
  id: "gzip",
  label: "gzip",
  measure: async (buffer) => {
    const compressed = await gzipAsync(buffer);
    return { bytes: compressed.byteLength };
  }
};

