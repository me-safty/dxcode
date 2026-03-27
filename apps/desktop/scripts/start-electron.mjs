import { spawn } from "node:child_process";

import { desktopDir, resolveElectronPath } from "./electron-launcher.mjs";

const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;
process.env.TERO_DESKTOP_LOCAL_DEV = "1";

const child = spawn(resolveElectronPath(), ["dist-electron/main.js"], {
  stdio: "inherit",
  cwd: desktopDir,
  env: {
    ...childEnv,
    TERO_DESKTOP_LOCAL_DEV: "1",
    TERO_DESKTOP_SERVER_EXECUTABLE: process.execPath,
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
