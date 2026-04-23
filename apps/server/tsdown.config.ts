import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/bin.ts"],
  format: ["esm", "cjs"],
  checks: {
    legacyCjs: false,
  },
  outDir: "dist",
  sourcemap: true,
  clean: true,
  noExternal: [/^@marcode\//, /^effect-acp(\/|$)/, /^effect-codex-app-server(\/|$)/],
  inlineOnly: false,
  banner: {
    js: "#!/usr/bin/env node\n",
  },
});
