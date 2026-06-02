import "vite-plus/test/config";
import { defineConfig, mergeConfig } from "vite-plus";

import baseConfig from "../../vite.config.ts";

const internalPackagePrefixes = ["@t3tools/", "effect-acp", "effect-codex-app-server"];

export default mergeConfig(
  baseConfig,
  defineConfig({
    pack: {
      entry: ["src/bin.ts"],
      outDir: "dist",
      sourcemap: true,
      clean: true,
      noExternal: (id: string) => internalPackagePrefixes.some((prefix) => id.startsWith(prefix)),
      inlineOnly: false,
      banner: {
        js: "#!/usr/bin/env node\n",
      },
    },
    test: {
      // The server suite exercises sqlite, git, temp worktrees, and orchestration
      // runtimes heavily. Running files in parallel introduces load-sensitive flakes.
      fileParallelism: false,
      // Server integration tests exercise sqlite, git, and orchestration together.
      // Under package-wide parallel runs they regularly exceed the default 15s budget.
      hookTimeout: 60_000,
      testTimeout: 60_000,
    },
  }),
);
