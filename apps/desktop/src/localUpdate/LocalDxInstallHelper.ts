#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off globalConsole:off globalTimers:off

import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

interface InstallRequest {
  readonly sessionId: string;
  readonly parentPid: number;
  readonly artifactPath: string;
  readonly artifactSha256: string;
  readonly sourceCommit: string;
  readonly currentAppPath: string;
  readonly healthMarkerPath: string;
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function bundleId(appPath: string): string {
  return NodeChildProcess.execFileSync(
    "plutil",
    [
      "-extract",
      "CFBundleIdentifier",
      "raw",
      "-o",
      "-",
      NodePath.join(appPath, "Contents", "Info.plist"),
    ],
    { encoding: "utf8" },
  ).trim();
}

function validateProvenance(appPath: string, sourceCommit: string): void {
  const provenancePath = NodePath.join(
    appPath,
    "Contents",
    "Resources",
    "dx-build-provenance.json",
  );
  const provenance = JSON.parse(NodeFS.readFileSync(provenancePath, "utf8")) as {
    readonly flavor?: unknown;
    readonly sourceCommit?: unknown;
    readonly dirty?: unknown;
  };
  if (
    provenance.flavor !== "dx" ||
    provenance.sourceCommit !== sourceCommit ||
    provenance.dirty !== false
  ) {
    throw new Error("DMG provenance does not match the approved DX source commit.");
  }
}

async function main() {
  const requestPath = process.argv[2];
  if (!requestPath) throw new Error("Missing install request.");
  const request = JSON.parse(NodeFS.readFileSync(requestPath, "utf8")) as InstallRequest;
  if (
    !/^[0-9a-f-]{16,64}$/i.test(request.sessionId) ||
    !Number.isSafeInteger(request.parentPid) ||
    !/^[0-9a-f]{64}$/i.test(request.artifactSha256) ||
    !/^[0-9a-f]{40,64}$/i.test(request.sourceCommit) ||
    NodePath.basename(request.currentAppPath) !== "DX Code.app" ||
    !request.artifactPath.endsWith(".dmg")
  ) {
    throw new Error("Invalid DX install request.");
  }
  if (bundleId(request.currentAppPath) !== "com.t3tools.dxcode") {
    throw new Error("Current app is not DX Code.");
  }
  const artifactHash = NodeCrypto.createHash("sha256")
    .update(NodeFS.readFileSync(request.artifactPath))
    .digest("hex");
  if (artifactHash !== request.artifactSha256.toLowerCase()) {
    throw new Error("DMG hash changed after installation approval.");
  }

  for (let attempt = 0; attempt < 1_200 && isAlive(request.parentPid); attempt += 1) {
    await sleep(100);
  }
  if (isAlive(request.parentPid)) throw new Error("DX Code did not quit for installation.");

  const mountPoint = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "dx-install-mount-"));
  const appParent = NodePath.dirname(request.currentAppPath);
  const stagingPath = NodePath.join(appParent, `.DX Code.update-${request.sessionId}.app`);
  const backupPath = NodePath.join(appParent, ".DX Code.rollback.app");
  let replaced = false;
  try {
    NodeChildProcess.execFileSync("hdiutil", [
      "attach",
      "-readonly",
      "-nobrowse",
      "-mountpoint",
      mountPoint,
      request.artifactPath,
    ]);
    const sourceApp = NodePath.join(mountPoint, "DX Code.app");
    if (bundleId(sourceApp) !== "com.t3tools.dxcode") throw new Error("DMG is not DX Code.");
    validateProvenance(sourceApp, request.sourceCommit.toLowerCase());
    if (NodeFS.existsSync(stagingPath)) NodeFS.rmSync(stagingPath, { recursive: true });
    NodeFS.cpSync(sourceApp, stagingPath, { recursive: true, preserveTimestamps: true });
    if (NodeFS.existsSync(backupPath)) NodeFS.rmSync(backupPath, { recursive: true });
    NodeFS.renameSync(request.currentAppPath, backupPath);
    NodeFS.renameSync(stagingPath, request.currentAppPath);
    replaced = true;
  } finally {
    try {
      NodeChildProcess.execFileSync("hdiutil", ["detach", mountPoint]);
    } catch {
      // OS will release a read-only mount after helper exit.
    }
  }

  NodeChildProcess.spawn(
    "open",
    [
      "-n",
      request.currentAppPath,
      "--args",
      "--dx-update-session",
      request.sessionId,
      "--dx-update-health-marker",
      request.healthMarkerPath,
    ],
    { detached: true, stdio: "ignore" },
  ).unref();

  for (let attempt = 0; attempt < 900; attempt += 1) {
    if (NodeFS.existsSync(request.healthMarkerPath)) return;
    await sleep(100);
  }

  if (replaced && NodeFS.existsSync(backupPath)) {
    if (NodeFS.existsSync(request.currentAppPath)) {
      NodeFS.rmSync(request.currentAppPath, { recursive: true });
    }
    NodeFS.renameSync(backupPath, request.currentAppPath);
    NodeChildProcess.spawn("open", ["-n", request.currentAppPath], {
      detached: true,
      stdio: "ignore",
    }).unref();
  }
  throw new Error("Updated DX Code failed its startup health check; rollback restored.");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
