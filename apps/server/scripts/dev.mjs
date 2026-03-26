import { spawn } from "node:child_process";

const isDesktopServerBuildOnly = process.env.T3CODE_DESKTOP_SERVER_BUILD_ONLY === "1";
const command = isDesktopServerBuildOnly
  ? ["tsdown", "--watch", "--clean"]
  : ["run", "src/index.ts"];

const child = spawn("bun", command, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
