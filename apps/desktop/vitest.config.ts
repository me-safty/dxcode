import * as path from "node:path";
import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "../../vitest.config.ts";

export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: {
      alias: [
        {
          find: /^electron$/,
          replacement: path.resolve(import.meta.dirname, "./src/test/electronMock.ts"),
        },
      ],
    },
  }),
);
