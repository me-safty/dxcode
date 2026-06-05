import * as path from "node:path";
import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "../../vitest.config.ts";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      // Run the server's own suites plus the @t3work/sdk source tests. The SDK is a
      // path-aliased source package (no package.json / `test` script of its own), so
      // `turbo run test` would otherwise never reach it; folding its tests into the
      // server run is what makes `pnpm test` cover both. (Reviewer carry-forward H.1.)
      include: [
        "src/**/*.{test,spec}.?(c|m)[jt]s?(x)",
        "integration/**/*.{test,spec}.?(c|m)[jt]s?(x)",
        path.resolve(import.meta.dirname, "../../packages/t3work-sdk/src/**/*.test.ts"),
      ],
      // The server suite exercises sqlite, git, temp worktrees, and orchestration
      // runtimes heavily. Running files in parallel introduces load-sensitive flakes.
      fileParallelism: false,
      // Server integration tests exercise sqlite, git, and orchestration together.
      // Under package-wide parallel runs they regularly exceed the default 15s budget.
      testTimeout: 60_000,
      hookTimeout: 60_000,
    },
  }),
);
