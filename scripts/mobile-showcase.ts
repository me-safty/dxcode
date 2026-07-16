#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - Host-side simulator and emulator automation uses Node subprocess and timing APIs directly.

import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

import showcaseConfig, {
  type ShowcaseAndroidDevice,
  type ShowcaseConfig,
  type ShowcaseDevice,
  type ShowcaseIosDevice,
  SHOWCASE_SCENES,
  type ShowcaseScene,
} from "./mobile-showcase.config.ts";
import {
  SHOWCASE_ENVIRONMENTS,
  SHOWCASE_PROJECTS,
  SHOWCASE_TERMINAL_ID,
  SHOWCASE_THREAD_ID,
  seedShowcaseEnvironment,
} from "./mobile-showcase-environment.ts";

const REPO_ROOT = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const MOBILE_ROOT = NodePath.join(REPO_ROOT, "apps/mobile");
const ANDROID_PACKAGE = "com.t3tools.t3code.dev";
const APP_SCHEME = "t3code-dev";
const IOS_READY_FILENAME = "T3ShowcaseReadyScene";
const SERVER_HOST = "0.0.0.0";
const IOS_SIMULATOR_ARCH = NodeProcess.arch === "arm64" ? "arm64" : "x86_64";
const IOS_APP_PATH = NodePath.join(
  MOBILE_ROOT,
  ".showcase/ios-derived-data/Build/Products/Debug-iphonesimulator/T3CodeDev.app",
);
const ANDROID_APK_PATH = NodePath.join(
  MOBILE_ROOT,
  "android/app/build/outputs/apk/debug/app-debug.apk",
);
const MOBILE_BUILD_ENV = {
  ...NodeProcess.env,
  APP_VARIANT: "development",
  EXPO_NO_GIT_STATUS: "1",
};

interface CliOptions {
  readonly platforms: ReadonlySet<ShowcaseDevice["platform"]>;
  readonly deviceIds: ReadonlySet<string>;
  readonly scenes: ReadonlySet<ShowcaseScene>;
  readonly skipBuild: boolean;
  readonly skipMetro: boolean;
  readonly keepRunning: boolean;
  readonly list: boolean;
}

export interface ShowcaseCapture {
  readonly device: ShowcaseDevice;
  readonly scenes: ReadonlyArray<ShowcaseScene>;
}

interface NetworkAddress {
  readonly address: string;
  readonly family: string;
  readonly internal: boolean;
}

export function selectLanIpv4Address(addresses: ReadonlyArray<NetworkAddress>): string | null {
  return (
    addresses.find(
      ({ address, family, internal }) =>
        family === "IPv4" && !internal && !address.startsWith("169.254."),
    )?.address ?? null
  );
}

function lanIpv4Address(): string {
  const address = selectLanIpv4Address(
    Object.values(NodeOS.networkInterfaces()).flatMap((addresses) => addresses ?? []),
  );
  if (!address) {
    throw new Error("No LAN IPv4 address is available for the iOS Simulator to reach Metro.");
  }
  return address;
}

export function readPngDimensions(bytes: Uint8Array): {
  readonly width: number;
  readonly height: number;
} {
  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.byteLength < 24 || !pngSignature.every((value, index) => bytes[index] === value)) {
    throw new Error("Captured file is not a valid PNG.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

async function reportCapture(destination: string): Promise<void> {
  const dimensions = readPngDimensions(await NodeFSP.readFile(destination));
  NodeProcess.stdout.write(
    `Captured ${NodePath.relative(REPO_ROOT, destination)} (${dimensions.width}×${dimensions.height})\n`,
  );
}

function argumentValue(args: ReadonlyArray<string>, index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

export function parseShowcaseCliArgs(args: ReadonlyArray<string>): CliOptions {
  const platforms = new Set<ShowcaseDevice["platform"]>();
  const deviceIds = new Set<string>();
  const scenes = new Set<ShowcaseScene>();
  let skipBuild = false;
  let skipMetro = false;
  let keepRunning = false;
  let list = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--platform") {
      const value = argumentValue(args, index, argument);
      if (value !== "ios" && value !== "android" && value !== "all") {
        throw new Error(`Unsupported platform '${value}'. Use ios, android, or all.`);
      }
      if (value === "all") {
        platforms.add("ios");
        platforms.add("android");
      } else {
        platforms.add(value);
      }
      index += 1;
    } else if (argument === "--device") {
      deviceIds.add(argumentValue(args, index, argument));
      index += 1;
    } else if (argument === "--scene") {
      const value = argumentValue(args, index, argument);
      if (!SHOWCASE_SCENES.includes(value as ShowcaseScene)) {
        throw new Error(`Unsupported scene '${value}'. Use ${SHOWCASE_SCENES.join(", ")}.`);
      }
      scenes.add(value as ShowcaseScene);
      index += 1;
    } else if (argument === "--skip-build") {
      skipBuild = true;
    } else if (argument === "--skip-metro") {
      skipMetro = true;
    } else if (argument === "--keep-running") {
      keepRunning = true;
    } else if (argument === "--list") {
      list = true;
    } else if (argument === "--help" || argument === "-h") {
      list = true;
    } else {
      throw new Error(`Unknown option '${argument}'.`);
    }
  }

  return {
    platforms,
    deviceIds,
    scenes,
    skipBuild,
    skipMetro,
    keepRunning,
    list,
  };
}

export function planShowcaseCaptures(
  config: ShowcaseConfig,
  options: Pick<CliOptions, "platforms" | "deviceIds" | "scenes">,
): ReadonlyArray<ShowcaseCapture> {
  const captures = config.devices
    .filter((device) => options.platforms.size === 0 || options.platforms.has(device.platform))
    .filter((device) => options.deviceIds.size === 0 || options.deviceIds.has(device.id))
    .map((device) => ({
      device,
      scenes:
        options.scenes.size === 0
          ? device.scenes
          : device.scenes.filter((scene) => options.scenes.has(scene)),
    }))
    .filter((capture) => capture.scenes.length > 0);

  const knownDeviceIds = new Set(config.devices.map((device) => device.id));
  for (const id of options.deviceIds) {
    if (!knownDeviceIds.has(id)) {
      throw new Error(`Unknown device '${id}'. Run with --list to see configured devices.`);
    }
  }
  if (captures.length === 0) {
    throw new Error("No captures match the selected platform, device, and scene filters.");
  }
  return captures;
}

function printUsage(config: ShowcaseConfig): void {
  NodeProcess.stdout.write(`App screenshot showcase

Usage:
  pnpm --filter @t3tools/mobile screenshots [options]

Options:
  --platform ios|android|all  Capture one platform (repeatable)
  --device <id>              Capture one configured device (repeatable)
  --scene <name>             Capture one scene (repeatable)
  --skip-build               Reuse the existing simulator app / debug APK
  --skip-metro               Reuse an already running showcase Metro server
  --keep-running             Leave devices and Metro running after capture
  --list                     Print this help and the configured matrix

Scenes: ${SHOWCASE_SCENES.join(", ")}

Configured devices:
${config.devices
  .map((device) => {
    const target = device.platform === "ios" ? device.simulator : device.avd;
    return `  ${device.id.padEnd(14)} ${device.platform.padEnd(8)} ${target} [${device.scenes.join(", ")}]`;
  })
  .join("\n")}
`);
}

function spawnProcess(
  command: string,
  args: ReadonlyArray<string>,
  options: NodeChildProcess.SpawnOptions = {},
): NodeChildProcess.ChildProcess {
  return NodeChildProcess.spawn(command, args, {
    cwd: REPO_ROOT,
    env: NodeProcess.env,
    stdio: "inherit",
    ...options,
  });
}

async function runCommand(
  command: string,
  args: ReadonlyArray<string>,
  options: NodeChildProcess.SpawnOptions = {},
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawnProcess(command, args, options);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `${command} ${args.join(" ")} failed ${signal ? `with signal ${signal}` : `with code ${String(code)}`}.`,
          ),
        );
      }
    });
  });
}

async function commandOutput(
  command: string,
  args: ReadonlyArray<string>,
  options: NodeChildProcess.ExecFileOptions = {},
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    NodeChildProcess.execFile(
      command,
      [...args],
      { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 10 * 1024 * 1024, ...options },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(String(stdout));
      },
    );
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function stopProcess(child: NodeChildProcess.ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;

  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
  child.kill("SIGTERM");
  await Promise.race([exited, delay(5_000)]);
  if (child.exitCode !== null || child.signalCode !== null) return;

  child.kill("SIGKILL");
  await Promise.race([exited, delay(1_000)]);
}

async function waitForPort(port: number, label = "Process", timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = NodeNet.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
      socket.setTimeout(500, () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (open) return;
    await delay(500);
  }
  throw new Error(`${label} did not begin listening on port ${port} within ${timeoutMs}ms.`);
}

async function reserveAvailablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = NodeNet.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a local port for the showcase environment."));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function createShowcaseShell(baseDir: string): Promise<string> {
  const shellPath = NodePath.join(baseDir, "showcase-shell");
  await NodeFSP.writeFile(
    shellPath,
    `#!/bin/sh
if [ "$1" = "-ilc" ] || [ "$1" = "-lic" ]; then
  exec /bin/sh -c "$2"
fi
exec /bin/cat
`,
    { mode: 0o755 },
  );
  return shellPath;
}

async function createShowcaseLabelProbe(baseDir: string, label: string): Promise<string> {
  const binDirectory = NodePath.join(baseDir, "showcase-bin");
  await NodeFSP.mkdir(binDirectory, { recursive: true });
  const probeScript = `#!/bin/sh
if [ "$1" = "--get" ] && [ "$2" = "ComputerName" ]; then
  printf '%s\\n' ${JSON.stringify(label)}
  exit 0
fi
if [ "$1" = "--pretty" ]; then
  printf '%s\\n' ${JSON.stringify(label)}
  exit 0
fi
exit 1
`;
  await Promise.all(
    ["scutil", "hostnamectl"].map((executable) =>
      NodeFSP.writeFile(NodePath.join(binDirectory, executable), probeScript, { mode: 0o755 }),
    ),
  );
  return binDirectory;
}

function startShowcaseServer(
  baseDir: string,
  workspaceRoot: string,
  port: number,
  shellPath: string,
  labelProbeDirectory: string,
): NodeChildProcess.ChildProcess {
  return spawnProcess(
    "node",
    [
      "apps/server/src/bin.ts",
      "serve",
      "--host",
      SERVER_HOST,
      "--port",
      String(port),
      "--base-dir",
      baseDir,
      "--no-browser",
      "--log-level",
      "error",
      workspaceRoot,
    ],
    {
      env: {
        ...NodeProcess.env,
        PATH: `${labelProbeDirectory}:${NodeProcess.env.PATH ?? ""}`,
        SHELL: shellPath,
      },
    },
  );
}

export function parsePairingCredentialOutput(output: string): string {
  const jsonStart = output.indexOf("{");
  const jsonEnd = output.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd < jsonStart) {
    throw new Error("Pairing credential command did not return JSON.");
  }
  const parsed = JSON.parse(output.slice(jsonStart, jsonEnd + 1)) as {
    readonly credential?: unknown;
  };
  if (typeof parsed.credential !== "string" || parsed.credential.length === 0) {
    throw new Error("Pairing credential command returned no credential.");
  }
  return parsed.credential;
}

async function issuePairingCredential(baseDir: string): Promise<string> {
  const output = await commandOutput(
    "node",
    ["apps/server/src/bin.ts", "auth", "pairing", "create", "--base-dir", baseDir, "--json"],
    { env: { ...NodeProcess.env, NO_COLOR: "1" } },
  );
  return parsePairingCredentialOutput(output);
}

function buildShowcasePairingUrl(host: string, port: number, credential: string): string {
  const url = new URL(`http://${host}:${port}/`);
  url.hash = new URLSearchParams([["token", credential]]).toString();
  return url.toString();
}

export function showcaseSceneUrl(scene: ShowcaseScene, environmentId: string): string {
  if (scene === "threads") return `${APP_SCHEME}://`;
  if (scene === "environments") return `${APP_SCHEME}://settings/environments`;
  const threadPath = `threads/${encodeURIComponent(environmentId)}/${SHOWCASE_THREAD_ID}`;
  if (scene === "thread") return `${APP_SCHEME}://${threadPath}`;
  if (scene === "terminal") {
    return `${APP_SCHEME}://${threadPath}/terminal?terminalId=${SHOWCASE_TERMINAL_ID}`;
  }
  return `${APP_SCHEME}://${threadPath}/review`;
}

export function encodeAndroidPairingUrls(pairingUrls: ReadonlyArray<string>): string {
  return `json-uri:${encodeURIComponent(JSON.stringify(pairingUrls))}`;
}

function startMetro(config: ShowcaseConfig): NodeChildProcess.ChildProcess {
  return spawnProcess(
    "pnpm",
    ["exec", "expo", "start", "--dev-client", "--port", String(config.metroPort)],
    {
      cwd: MOBILE_ROOT,
      env: {
        ...MOBILE_BUILD_ENV,
        EXPO_PUBLIC_SHOWCASE: "1",
      },
    },
  );
}

async function warmMetroBundle(
  platform: ShowcaseDevice["platform"],
  host: string,
  config: ShowcaseConfig,
): Promise<void> {
  const url = `http://${host}:${config.metroPort}/apps/mobile/index.bundle?platform=${platform}&dev=true&minify=false`;
  await runCommand("curl", ["--fail", "--silent", "--show-error", "--output", "/dev/null", url]);
}

async function buildIos(): Promise<string> {
  const derivedData = NodePath.join(MOBILE_ROOT, ".showcase/ios-derived-data");
  await runCommand("pnpm", ["exec", "expo", "prebuild", "--clean", "--platform", "ios"], {
    cwd: MOBILE_ROOT,
    env: MOBILE_BUILD_ENV,
  });
  await runCommand(
    "xcodebuild",
    [
      "-workspace",
      NodePath.join(MOBILE_ROOT, "ios/T3CodeDev.xcworkspace"),
      "-scheme",
      "T3CodeDev",
      "-configuration",
      "Debug",
      "-sdk",
      "iphonesimulator",
      "-derivedDataPath",
      derivedData,
      "-quiet",
      `ARCHS=${IOS_SIMULATOR_ARCH}`,
      "ONLY_ACTIVE_ARCH=YES",
      "build",
    ],
    { cwd: MOBILE_ROOT },
  );
  return IOS_APP_PATH;
}

async function buildAndroid(abis: ReadonlyArray<string>): Promise<string> {
  await runCommand("pnpm", ["exec", "expo", "prebuild", "--clean", "--platform", "android"], {
    cwd: MOBILE_ROOT,
    env: MOBILE_BUILD_ENV,
  });
  await runCommand(
    "./gradlew",
    [
      "app:assembleDebug",
      ...(abis.length > 0 ? [`-PreactNativeArchitectures=${abis.join(",")}`] : []),
    ],
    {
      cwd: NodePath.join(MOBILE_ROOT, "android"),
    },
  );
  return ANDROID_APK_PATH;
}

async function existingArtifact(path: string): Promise<string | null> {
  return await NodeFSP.access(path).then(
    () => path,
    () => null,
  );
}

interface SimctlDevice {
  readonly name: string;
  readonly udid: string;
  readonly state: "Booted" | "Shutdown" | string;
  readonly isAvailable: boolean;
}

async function findIosSimulator(name: string): Promise<SimctlDevice> {
  const parsed = JSON.parse(
    await commandOutput("xcrun", ["simctl", "list", "devices", "available", "-j"]),
  ) as {
    readonly devices: Readonly<Record<string, ReadonlyArray<SimctlDevice>>>;
  };
  const candidates = Object.entries(parsed.devices)
    .filter(([runtime]) => runtime.includes("iOS"))
    .flatMap(([, devices]) => devices)
    .filter((device) => device.isAvailable && device.name === name);
  const simulator = candidates.at(-1);
  if (!simulator) {
    throw new Error(
      `iOS simulator '${name}' is not installed. Run xcrun simctl list devices available.`,
    );
  }
  return simulator;
}

async function normalizeIosSimulator(device: ShowcaseIosDevice, udid: string): Promise<void> {
  await runCommand("xcrun", ["simctl", "ui", udid, "appearance", device.appearance]);
  await runCommand("xcrun", [
    "simctl",
    "status_bar",
    udid,
    "override",
    "--time",
    "9:41",
    "--batteryState",
    "charged",
    "--batteryLevel",
    "100",
    "--wifiBars",
    "3",
    "--cellularBars",
    "4",
  ]);
}

async function iosAppContainer(udid: string): Promise<string> {
  return (
    await commandOutput("xcrun", ["simctl", "get_app_container", udid, ANDROID_PACKAGE, "data"])
  ).trim();
}

async function waitForIosShowcaseScene(
  udid: string,
  scene: ShowcaseScene,
  timeoutMs = 90_000,
): Promise<void> {
  const readyPath = NodePath.join(
    await iosAppContainer(udid),
    "Library/Caches",
    IOS_READY_FILENAME,
  );
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const readyScene = await NodeFSP.readFile(readyPath, "utf8").catch(() => "");
    if (readyScene.trim() === scene) return;
    await delay(500);
  }
  throw new Error(`iOS showcase scene '${scene}' did not render within ${timeoutMs}ms.`);
}

async function captureIos(
  capture: ShowcaseCapture & { readonly device: ShowcaseIosDevice },
  appPath: string | null,
  outputDirectory: string,
  config: ShowcaseConfig,
  metroHost: string,
  pairingUrls: ReadonlyArray<string>,
): Promise<boolean> {
  const simulator = await findIosSimulator(capture.device.simulator);
  const startedByRunner = simulator.state !== "Booted";
  if (!startedByRunner) {
    // Clear transient SpringBoard state (permission prompts, stale URL-open
    // confirmations, keyboards) without erasing the developer's simulator.
    await runCommand("xcrun", ["simctl", "shutdown", simulator.udid]);
  }
  await runCommand("xcrun", ["simctl", "boot", simulator.udid]);
  await runCommand("xcrun", ["simctl", "bootstatus", simulator.udid, "-b"]);
  await normalizeIosSimulator(capture.device, simulator.udid);
  if (appPath) {
    await runCommand("xcrun", ["simctl", "uninstall", simulator.udid, ANDROID_PACKAGE]).catch(
      () => undefined,
    );
    await runCommand("xcrun", ["simctl", "install", simulator.udid, appPath]);
  }

  for (const [key, value] of [
    ["EXDevMenuIsOnboardingFinished", "true"],
    ["EXDevMenuShowFloatingActionButton", "false"],
    ["EXDevMenuShowsAtLaunch", "false"],
  ] as const) {
    await runCommand("xcrun", [
      "simctl",
      "spawn",
      simulator.udid,
      "defaults",
      "write",
      ANDROID_PACKAGE,
      key,
      "-bool",
      value,
    ]);
  }

  const metroUrl = `http://${metroHost}:${config.metroPort}?disableOnboarding=1`;
  const scenePath = NodePath.join(
    await iosAppContainer(simulator.udid),
    "Library/Caches/T3ShowcaseScene",
  );
  const readyPath = NodePath.join(
    await iosAppContainer(simulator.udid),
    "Library/Caches",
    IOS_READY_FILENAME,
  );
  const firstScene = capture.scenes[0] ?? "threads";
  const launchShowcaseApp = async (terminateRunningProcess: boolean) => {
    await runCommand("xcrun", [
      "simctl",
      "launch",
      ...(terminateRunningProcess ? ["--terminate-running-process"] : []),
      simulator.udid,
      ANDROID_PACKAGE,
      "--initialUrl",
      metroUrl,
      "--showcasePairingUrl",
      JSON.stringify(pairingUrls),
      "--showcaseScene",
      firstScene,
    ]);
  };
  await NodeFSP.rm(readyPath, { force: true });
  await NodeFSP.writeFile(scenePath, firstScene);
  await launchShowcaseApp(false);
  for (const [sceneIndex, scene] of capture.scenes.entries()) {
    if (sceneIndex > 0) await NodeFSP.rm(readyPath, { force: true });
    await NodeFSP.writeFile(scenePath, scene);
    if (sceneIndex === 0) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const isLastAttempt = attempt === 1;
        try {
          // A freshly installed Expo development build can spend well over 30s
          // applying an already-bundled update after it reaches 100%. Killing it
          // at that point sends the next capture back to the dev launcher.
          await waitForIosShowcaseScene(simulator.udid, scene, 120_000);
          break;
        } catch (error) {
          if (isLastAttempt) throw error;
          await launchShowcaseApp(true);
        }
      }
    } else {
      await waitForIosShowcaseScene(simulator.udid, scene);
    }
    await delay(scene === "review" ? Math.max(config.settleDelayMs, 8_000) : config.settleDelayMs);
    const destination = NodePath.join(outputDirectory, `${capture.device.id}-${scene}.png`);
    await runCommand("xcrun", ["simctl", "io", simulator.udid, "screenshot", destination]);
    await reportCapture(destination);
  }
  return startedByRunner;
}

function androidSdkTool(relativePath: string): string {
  const sdkRoot =
    NodeProcess.env.ANDROID_HOME ??
    NodePath.join(NodeProcess.env.HOME ?? "", "Library/Android/sdk");
  return NodePath.join(sdkRoot, relativePath);
}

async function adbOutput(serial: string, args: ReadonlyArray<string>): Promise<string> {
  return await commandOutput(androidSdkTool("platform-tools/adb"), ["-s", serial, ...args]);
}

async function runAdb(serial: string, args: ReadonlyArray<string>): Promise<void> {
  await runCommand(androidSdkTool("platform-tools/adb"), ["-s", serial, ...args]);
}

async function runningAndroidAvds(): Promise<ReadonlyMap<string, string>> {
  const adb = androidSdkTool("platform-tools/adb");
  const devices = (await commandOutput(adb, ["devices"]))
    .split("\n")
    .map((line) => line.trim().split(/\s+/u))
    .filter((parts) => parts[0]?.startsWith("emulator-") && parts[1] === "device")
    .map((parts) => parts[0] as string);
  const result = new Map<string, string>();
  for (const serial of devices) {
    const avdName = (await adbOutput(serial, ["emu", "avd", "name"])).split("\n")[0]?.trim();
    if (avdName) result.set(avdName, serial);
  }
  return result;
}

async function waitForAndroidSerial(avd: string, timeoutMs = 120_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const serial = (await runningAndroidAvds()).get(avd);
    if (serial) {
      await runAdb(serial, ["wait-for-device"]);
      const bootCompleted = (
        await adbOutput(serial, ["shell", "getprop", "sys.boot_completed"])
      ).trim();
      if (bootCompleted === "1") return serial;
    }
    await delay(1_000);
  }
  throw new Error(`Android AVD '${avd}' did not finish booting within ${timeoutMs}ms.`);
}

async function normalizeAndroidEmulator(
  device: ShowcaseAndroidDevice,
  serial: string,
): Promise<void> {
  await runAdb(serial, ["shell", "settings", "put", "global", "window_animation_scale", "0"]);
  await runAdb(serial, ["shell", "settings", "put", "global", "transition_animation_scale", "0"]);
  await runAdb(serial, ["shell", "settings", "put", "global", "animator_duration_scale", "0"]);
  await runAdb(serial, [
    "shell",
    "cmd",
    "uimode",
    "night",
    device.appearance === "dark" ? "yes" : "no",
  ]);
  await runAdb(serial, ["shell", "settings", "put", "system", "time_12_24", "12"]);
  await runAdb(serial, ["emu", "power", "capacity", "100"]);
  await runAdb(serial, ["shell", "settings", "put", "global", "sysui_demo_allowed", "1"]);
  await runAdb(serial, [
    "shell",
    "am",
    "broadcast",
    "-a",
    "com.android.systemui.demo",
    "-e",
    "command",
    "enter",
  ]);
  await runAdb(serial, [
    "shell",
    "am",
    "broadcast",
    "-a",
    "com.android.systemui.demo",
    "-e",
    "command",
    "clock",
    "-e",
    "hhmm",
    "0941",
  ]);
  await runAdb(serial, [
    "shell",
    "am",
    "broadcast",
    "-a",
    "com.android.systemui.demo",
    "-e",
    "command",
    "battery",
    "-e",
    "level",
    "100",
    "-e",
    "plugged",
    "false",
  ]);
  if (device.viewport) {
    await runAdb(serial, [
      "shell",
      "wm",
      "size",
      `${device.viewport.width}x${device.viewport.height}`,
    ]);
    if (device.viewport.density) {
      await runAdb(serial, ["shell", "wm", "density", String(device.viewport.density)]);
    }
  }
}

async function waitForAndroidShowcaseScene(
  serial: string,
  scene: ShowcaseScene,
  timeoutMs = 90_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const readyScene = await adbOutput(serial, [
      "shell",
      "run-as",
      ANDROID_PACKAGE,
      "cat",
      "files/t3-showcase-ready",
    ]).catch(() => "");
    if (readyScene.trim() === scene) return;
    await delay(500);
  }
  throw new Error(`Android showcase scene '${scene}' did not render within ${timeoutMs}ms.`);
}

async function writeAndroidShowcaseScene(serial: string, scene: ShowcaseScene): Promise<void> {
  await runAdb(serial, [
    "shell",
    `run-as ${ANDROID_PACKAGE} sh -c 'mkdir -p files && rm -f files/t3-showcase-ready && printf %s ${scene} > files/t3-showcase-scene'`,
  ]);
}

async function prepareAndroidShowcaseApp(serial: string): Promise<void> {
  const preferences = `<?xml version="1.0" encoding="utf-8" standalone="yes" ?>
<map>
  <boolean name="isOnboardingFinished" value="true" />
  <boolean name="showsAtLaunch" value="false" />
  <boolean name="showFab" value="false" />
  <boolean name="motionGestureEnabled" value="false" />
  <boolean name="touchGestureEnabled" value="false" />
  <boolean name="keyCommandsEnabled" value="false" />
</map>`;
  const encodedPreferences = Buffer.from(preferences).toString("base64");
  await runAdb(serial, [
    "shell",
    `run-as ${ANDROID_PACKAGE} sh -c 'mkdir -p shared_prefs && printf %s ${encodedPreferences} | base64 -d > shared_prefs/expo.modules.devmenu.sharedpreferences.xml'`,
  ]);
}

async function captureAndroid(
  capture: ShowcaseCapture & { readonly device: ShowcaseAndroidDevice },
  apkPath: string | null,
  outputDirectory: string,
  config: ShowcaseConfig,
  pairingUrls: ReadonlyArray<string>,
): Promise<{ readonly startedByRunner: boolean; readonly serial: string }> {
  const running = await runningAndroidAvds();
  const existingSerial = running.get(capture.device.avd);
  const startedByRunner = !existingSerial;
  if (startedByRunner) {
    const installedAvds = (await commandOutput(androidSdkTool("emulator/emulator"), ["-list-avds"]))
      .split("\n")
      .map((value) => value.trim());
    if (!installedAvds.includes(capture.device.avd)) {
      throw new Error(
        `Android AVD '${capture.device.avd}' is not installed. Run emulator -list-avds.`,
      );
    }
    spawnProcess(
      androidSdkTool("emulator/emulator"),
      ["-avd", capture.device.avd, "-no-snapshot-load", "-no-boot-anim"],
      { stdio: "ignore", detached: true },
    ).unref();
  }
  const serial = existingSerial ?? (await waitForAndroidSerial(capture.device.avd));
  await normalizeAndroidEmulator(capture.device, serial);
  if (apkPath) {
    await runAdb(serial, ["install", "-r", apkPath]);
  }
  await runAdb(serial, ["shell", "pm", "clear", ANDROID_PACKAGE]);
  await prepareAndroidShowcaseApp(serial);
  await runAdb(serial, ["reverse", `tcp:${config.metroPort}`, `tcp:${config.metroPort}`]);
  const metroUrl = encodeURIComponent(`http://127.0.0.1:${config.metroPort}?disableOnboarding=1`);
  const firstScene = capture.scenes[0] ?? "threads";
  await writeAndroidShowcaseScene(serial, firstScene);
  await runAdb(serial, [
    "shell",
    "am",
    "start",
    "-W",
    "-a",
    "android.intent.action.VIEW",
    "-d",
    `${APP_SCHEME}://expo-development-client/?url=${metroUrl}`,
    "--es",
    "showcasePairingUrl",
    encodeAndroidPairingUrls(pairingUrls),
    "--es",
    "showcaseScene",
    firstScene,
    ANDROID_PACKAGE,
  ]);
  for (const scene of capture.scenes) {
    await writeAndroidShowcaseScene(serial, scene);
    await waitForAndroidShowcaseScene(serial, scene);
    await delay(Math.max(config.settleDelayMs, scene === "review" ? 8_000 : 5_000));
    const destination = NodePath.join(outputDirectory, `${capture.device.id}-${scene}.png`);
    const png = await new Promise<Buffer>((resolve, reject) => {
      NodeChildProcess.execFile(
        androidSdkTool("platform-tools/adb"),
        ["-s", serial, "exec-out", "screencap", "-p"],
        { cwd: REPO_ROOT, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
        (error, stdout) => {
          if (error) reject(error);
          else resolve(stdout);
        },
      );
    });
    await NodeFSP.writeFile(destination, png);
    await reportCapture(destination);
  }
  return { startedByRunner, serial };
}

async function cleanupAndroidViewport(
  device: ShowcaseAndroidDevice,
  serial: string,
): Promise<void> {
  await runAdb(serial, [
    "shell",
    "am",
    "broadcast",
    "-a",
    "com.android.systemui.demo",
    "-e",
    "command",
    "exit",
  ]);
  if (!device.viewport) return;
  await runAdb(serial, ["shell", "wm", "size", "reset"]);
  if (device.viewport.density) {
    await runAdb(serial, ["shell", "wm", "density", "reset"]);
  }
}

async function main(): Promise<void> {
  const options = parseShowcaseCliArgs(NodeProcess.argv.slice(2));
  if (options.list) {
    printUsage(showcaseConfig);
    return;
  }
  const captures = planShowcaseCaptures(showcaseConfig, options);
  const hasIos = captures.some((capture) => capture.device.platform === "ios");
  const hasAndroid = captures.some((capture) => capture.device.platform === "android");
  const metroHost = hasIos ? lanIpv4Address() : "127.0.0.1";
  const outputDirectory = NodePath.resolve(REPO_ROOT, showcaseConfig.outputDirectory);
  await NodeFSP.mkdir(outputDirectory, { recursive: true });

  const showcaseRootDir = await NodeFSP.mkdtemp(
    NodePath.join(NodeOS.tmpdir(), "t3-mobile-showcase-"),
  );
  const showcaseServers: NodeChildProcess.ChildProcess[] = [];
  const showcaseEnvironments: Array<{
    readonly baseDir: string;
    readonly environmentId: string;
    readonly label: string;
    readonly port: number;
  }> = [];
  let metro: NodeChildProcess.ChildProcess | null = null;
  const startedIosUdids: string[] = [];
  const androidCleanups: Array<{
    readonly device: ShowcaseAndroidDevice;
    readonly serial: string;
    readonly startedByRunner: boolean;
  }> = [];

  try {
    for (const environment of SHOWCASE_ENVIRONMENTS) {
      const projectId = environment.projectIds[0];
      const project = SHOWCASE_PROJECTS.find((candidate) => candidate.id === projectId);
      if (!project) throw new Error(`Showcase environment '${environment.id}' has no project.`);

      const baseDir = NodePath.join(showcaseRootDir, "environments", environment.id);
      const workspaceRoot = NodePath.join(baseDir, "workspace", project.directory);
      const port = await reserveAvailablePort();
      await NodeFSP.mkdir(workspaceRoot, { recursive: true });
      const shellPath = await createShowcaseShell(baseDir);
      const labelProbeDirectory = await createShowcaseLabelProbe(baseDir, environment.label);
      const server = startShowcaseServer(
        baseDir,
        workspaceRoot,
        port,
        shellPath,
        labelProbeDirectory,
      );
      showcaseServers.push(server);
      await waitForPort(port, `${environment.label} server`);
      await seedShowcaseEnvironment({ baseDir, projectIds: environment.projectIds });
      const environmentId = (
        await NodeFSP.readFile(NodePath.join(baseDir, "userdata", "environment-id"), "utf8")
      ).trim();
      if (!environmentId) {
        throw new Error(`${environment.label} did not persist an environment id.`);
      }
      showcaseEnvironments.push({ baseDir, environmentId, label: environment.label, port });
    }

    if (!options.skipMetro) {
      metro = startMetro(showcaseConfig);
      await waitForPort(showcaseConfig.metroPort, "Metro");
      await Promise.all([
        hasIos ? warmMetroBundle("ios", metroHost, showcaseConfig) : Promise.resolve(),
        hasAndroid ? warmMetroBundle("android", "127.0.0.1", showcaseConfig) : Promise.resolve(),
      ]);
    }

    const iosAppPath = hasIos
      ? options.skipBuild
        ? await existingArtifact(IOS_APP_PATH)
        : await buildIos()
      : null;
    const androidAbis = captures.flatMap((capture) =>
      capture.device.platform === "android" && capture.device.abi ? [capture.device.abi] : [],
    );
    const androidApkPath = hasAndroid
      ? options.skipBuild
        ? await existingArtifact(ANDROID_APK_PATH)
        : await buildAndroid([...new Set(androidAbis)])
      : null;

    for (const capture of captures) {
      const pairingHost = capture.device.platform === "ios" ? "127.0.0.1" : "10.0.2.2";
      const pairingUrls = await Promise.all(
        showcaseEnvironments.map(async (environment) => {
          const credential = await issuePairingCredential(environment.baseDir);
          return buildShowcasePairingUrl(pairingHost, environment.port, credential);
        }),
      );
      if (capture.device.platform === "ios") {
        const simulator = await findIosSimulator(capture.device.simulator);
        const started = await captureIos(
          capture as ShowcaseCapture & { readonly device: ShowcaseIosDevice },
          iosAppPath,
          outputDirectory,
          showcaseConfig,
          metroHost,
          pairingUrls,
        );
        if (started) startedIosUdids.push(simulator.udid);
      } else {
        const result = await captureAndroid(
          capture as ShowcaseCapture & { readonly device: ShowcaseAndroidDevice },
          androidApkPath,
          outputDirectory,
          showcaseConfig,
          pairingUrls,
        );
        androidCleanups.push({ device: capture.device, ...result });
      }
    }

    NodeProcess.stdout.write(
      `\nDone. Screenshots are in ${NodePath.relative(REPO_ROOT, outputDirectory)}/\n`,
    );
    if (options.keepRunning) {
      metro?.unref();
      for (const server of showcaseServers) server.unref();
      const serverSummary = showcaseEnvironments
        .map((environment) => `${environment.label}:${environment.port}`)
        .join(", ");
      NodeProcess.stdout.write(
        `Showcase environments kept at ${showcaseRootDir} (${serverSummary}).\n`,
      );
    }
  } finally {
    if (!options.keepRunning) {
      for (const cleanup of androidCleanups) {
        await cleanupAndroidViewport(cleanup.device, cleanup.serial).catch(() => undefined);
        if (cleanup.startedByRunner) {
          await runAdb(cleanup.serial, ["emu", "kill"]).catch(() => undefined);
        }
      }
      for (const udid of startedIosUdids) {
        await runCommand("xcrun", ["simctl", "shutdown", udid]).catch(() => undefined);
      }
      await Promise.all([
        ...(metro ? [stopProcess(metro)] : []),
        ...showcaseServers.map((server) => stopProcess(server)),
      ]);
      await NodeFSP.rm(showcaseRootDir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  }
}

if (import.meta.main) {
  void main().catch((error: unknown) => {
    NodeProcess.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    NodeProcess.exit(1);
  });
}
