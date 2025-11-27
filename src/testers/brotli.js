import { promisify } from "node:util";
import { brotliCompress, constants } from "node:zlib";

const brotliAsync = promisify(brotliCompress);

export const brotliTester = {
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

