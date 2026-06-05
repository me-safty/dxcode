import * as path from "node:path";
import { defineConfig } from "vitest/config";

// `@t3work/sdk` (and its subpaths) resolve via tsconfig `paths` for tsgo, but Vitest needs
// the same mapping as runtime aliases — otherwise any server suite that imports the SDK
// (e.g. the tool-broker bindings via t3work-workflowSdkToolBridge) fails to resolve it.
// Keep these in sync with tsconfig.base.json#compilerOptions.paths. Subpath aliases are
// listed before the bare one and anchored so the bare entry never shadows a subpath.
const sdkSrc = (file: string): string =>
  path.resolve(import.meta.dirname, "./packages/t3work-sdk/src", file);

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@t3tools\/contracts$/,
        replacement: path.resolve(import.meta.dirname, "./packages/contracts/src/index.ts"),
      },
      { find: /^@t3work\/sdk\/groups$/, replacement: sdkSrc("t3work-sdk.groups.ts") },
      { find: /^@t3work\/sdk\/models$/, replacement: sdkSrc("t3work-sdk.models.ts") },
      { find: /^@t3work\/sdk\/tools\/t3work$/, replacement: sdkSrc("tools/t3work-sdk.t3work.ts") },
      { find: /^@t3work\/sdk$/, replacement: sdkSrc("t3work-sdk.index.ts") },
    ],
  },
});
