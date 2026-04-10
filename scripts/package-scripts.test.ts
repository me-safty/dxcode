import { readFileSync } from "node:fs";
import path from "node:path";
import { assert, describe, it } from "@effect/vitest";

const TS_NODE_SCRIPT_PATTERN = /\bnode\s+[^\r\n"]+\.(?:cts|mts|ts)\b/;

function readPackageScripts(relativePath: string): Record<string, string> {
  const packageJsonPath = path.resolve(import.meta.dirname, "..", relativePath);
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    scripts?: Record<string, string>;
  };

  return packageJson.scripts ?? {};
}

describe("package scripts", () => {
  it("does not rely on node to execute raw TypeScript entrypoints", () => {
    const packageFiles = ["package.json", "apps/server/package.json"];

    for (const packageFile of packageFiles) {
      const scripts = readPackageScripts(packageFile);
      for (const [scriptName, command] of Object.entries(scripts)) {
        assert.equal(
          TS_NODE_SCRIPT_PATTERN.test(command),
          false,
          `${packageFile} script "${scriptName}" should not use node to execute a TypeScript file: ${command}`,
        );
      }
    }
  });

  it("uses a Node-compatible TypeScript runner for the server dev script", () => {
    const scripts = readPackageScripts("apps/server/package.json");

    assert.equal(
      /^bun\s+run\s+src\/bin\.ts\b/.test(scripts.dev ?? ""),
      false,
      `apps/server dev script should not run under Bun on Windows because PTY support is unavailable: ${scripts.dev}`,
    );
  });
});
