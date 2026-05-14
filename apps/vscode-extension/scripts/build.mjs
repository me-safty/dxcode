import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const extensionDir = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const repoRoot = join(extensionDir, "../..");
const packageJson = JSON.parse(readFileSync(join(extensionDir, "package.json"), "utf8"));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...options.env },
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

const distDir = join(extensionDir, "dist");
rmSync(join(distDir, "webview"), { force: true, recursive: true });
rmSync(join(distDir, "server"), { force: true, recursive: true });
rmSync(join(distDir, "node_modules"), { force: true, recursive: true });

run("bun", ["run", "build"], {
  cwd: join(repoRoot, "apps/web"),
  env: { VITE_BASE_URL: "./" },
});
run("bun", ["run", "build"], {
  cwd: join(repoRoot, "apps/server"),
});
run("bun", ["run", "build:extension"], {
  cwd: extensionDir,
});

cpSync(join(repoRoot, "apps/web/dist"), join(distDir, "webview"), { recursive: true });
cpSync(join(repoRoot, "apps/server/dist"), join(distDir, "server"), { recursive: true });

writeFileSync(
  join(distDir, "package.json"),
  `${JSON.stringify(
    {
      private: true,
      type: "module",
      dependencies: packageJson.dependencies,
      trustedDependencies: ["node-pty"],
    },
    null,
    2,
  )}\n`,
);
run("bun", ["install", "--production"], { cwd: distDir });
