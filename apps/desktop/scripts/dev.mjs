import { spawn } from "node:child_process";

const commands = [
  { name: "desktop-bundle", command: "vp", args: ["pack", "--watch"] },
  { name: "desktop-electron", command: "node", args: ["scripts/dev-electron.mjs"] },
];

let shuttingDown = false;
const children = new Set();

function stopChildren(signal = "SIGTERM") {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const child of children) {
    child.kill(signal);
  }
}

for (const { name, command, args } of commands) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: process.env,
  });

  children.add(child);

  child.once("error", (error) => {
    console.error(`[${name}] failed to start:`, error);
    stopChildren();
    process.exitCode = 1;
  });

  child.once("exit", (code, signal) => {
    children.delete(child);

    if (!shuttingDown && (signal !== null || code !== 0)) {
      stopChildren();
      process.exitCode = code ?? 1;
    }

    if (children.size === 0) {
      process.exit(process.exitCode ?? 0);
    }
  });
}

process.once("SIGINT", () => {
  stopChildren("SIGINT");
});
process.once("SIGTERM", () => {
  stopChildren("SIGTERM");
});
