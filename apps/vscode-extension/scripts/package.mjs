import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const extensionDir = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(extensionDir, "package.json"), "utf8"));
const vsixName = `${packageJson.name}-${packageJson.version}.vsix`;
const vsixPath = join(extensionDir, vsixName);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: extensionDir,
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

rmSync(vsixPath, { force: true });
rmSync(join(extensionDir, "dist", vsixName), { force: true });
run("bun", ["run", "build"]);
run("bun", ["x", "vsce", "package", "--no-dependencies", "--out", vsixPath]);
