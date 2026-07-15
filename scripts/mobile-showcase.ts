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

const REPO_ROOT = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const MOBILE_ROOT = NodePath.join(REPO_ROOT, "apps/mobile");
const ANDROID_PACKAGE = "com.t3tools.t3code.dev";
const APP_SCHEME = "t3code-dev";
const IOS_READY_KEY = "T3ShowcaseReadyScene";
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

async function commandOutput(command: string, args: ReadonlyArray<string>): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    NodeChildProcess.execFile(
      command,
      [...args],
      { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForPort(port: number, timeoutMs = 60_000): Promise<void> {
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
  throw new Error(`Metro did not begin listening on port ${port} within ${timeoutMs}ms.`);
}

function startMetro(config: ShowcaseConfig): NodeChildProcess.ChildProcess {
  return spawnProcess(
    "pnpm",
    ["exec", "expo", "start", "--dev-client", "--port", String(config.metroPort), "--clear"],
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
      "CODE_SIGNING_ALLOWED=NO",
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

async function iosPreferencesPath(udid: string): Promise<string> {
  const appContainer = (
    await commandOutput("xcrun", ["simctl", "get_app_container", udid, ANDROID_PACKAGE, "data"])
  ).trim();
  return NodePath.join(appContainer, "Library/Preferences", `${ANDROID_PACKAGE}.plist`);
}

async function waitForIosShowcaseScene(
  udid: string,
  scene: ShowcaseScene,
  timeoutMs = 90_000,
): Promise<void> {
  const preferencesPath = await iosPreferencesPath(udid);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const readyScene = await commandOutput("plutil", [
      "-extract",
      IOS_READY_KEY,
      "raw",
      "-o",
      "-",
      preferencesPath,
    ]).catch(() => "");
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
): Promise<boolean> {
  const simulator = await findIosSimulator(capture.device.simulator);
  const startedByRunner = simulator.state !== "Booted";
  if (startedByRunner) {
    await runCommand("xcrun", ["simctl", "boot", simulator.udid]);
  }
  await runCommand("xcrun", ["simctl", "bootstatus", simulator.udid, "-b"]);
  await normalizeIosSimulator(capture.device, simulator.udid);
  if (appPath) {
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

  for (const scene of capture.scenes) {
    await runCommand("xcrun", ["simctl", "terminate", simulator.udid, ANDROID_PACKAGE]).catch(
      () => undefined,
    );
    const preferencesPath = await iosPreferencesPath(simulator.udid);
    await runCommand("plutil", ["-remove", IOS_READY_KEY, preferencesPath]).catch(() => undefined);
    await runCommand("xcrun", [
      "simctl",
      "launch",
      simulator.udid,
      ANDROID_PACKAGE,
      "--initialUrl",
      metroUrl,
      "--showcaseScene",
      scene,
    ]);
    await waitForIosShowcaseScene(simulator.udid, scene);
    await delay(config.settleDelayMs);
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
  const marker = `showcase-ready-${scene}`;
  const hierarchyPath = "/sdcard/t3-showcase-window.xml";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await adbOutput(serial, [
      "shell",
      "am",
      "start",
      "-W",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      `${APP_SCHEME}://showcase/${scene}`,
      ANDROID_PACKAGE,
    ]).catch(() => "");
    await delay(750);
    await adbOutput(serial, ["shell", "rm", "-f", hierarchyPath]).catch(() => "");
    const hierarchy = await adbOutput(serial, ["shell", "uiautomator", "dump", hierarchyPath])
      .then(() => adbOutput(serial, ["shell", "cat", hierarchyPath]))
      .catch(() => "");
    if (hierarchy.includes(marker)) return;
    await delay(500);
  }
  throw new Error(`Android showcase scene '${scene}' did not render within ${timeoutMs}ms.`);
}

async function captureAndroid(
  capture: ShowcaseCapture & { readonly device: ShowcaseAndroidDevice },
  apkPath: string | null,
  outputDirectory: string,
  config: ShowcaseConfig,
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
  await runAdb(serial, ["reverse", `tcp:${config.metroPort}`, `tcp:${config.metroPort}`]);
  await runAdb(serial, ["shell", "am", "force-stop", ANDROID_PACKAGE]);
  const metroUrl = encodeURIComponent(`http://127.0.0.1:${config.metroPort}?disableOnboarding=1`);
  await runAdb(serial, [
    "shell",
    "am",
    "start",
    "-W",
    "-a",
    "android.intent.action.VIEW",
    "-d",
    `${APP_SCHEME}://expo-development-client/?url=${metroUrl}`,
    ANDROID_PACKAGE,
  ]);
  for (const scene of capture.scenes) {
    await waitForAndroidShowcaseScene(serial, scene);
    await delay(Math.max(config.settleDelayMs, 5_000));
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

  let metro: NodeChildProcess.ChildProcess | null = null;
  const startedIosUdids: string[] = [];
  const androidCleanups: Array<{
    readonly device: ShowcaseAndroidDevice;
    readonly serial: string;
    readonly startedByRunner: boolean;
  }> = [];

  try {
    if (!options.skipMetro) {
      metro = startMetro(showcaseConfig);
      await waitForPort(showcaseConfig.metroPort);
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
      if (capture.device.platform === "ios") {
        const simulator = await findIosSimulator(capture.device.simulator);
        const started = await captureIos(
          capture as ShowcaseCapture & { readonly device: ShowcaseIosDevice },
          iosAppPath,
          outputDirectory,
          showcaseConfig,
          metroHost,
        );
        if (started) startedIosUdids.push(simulator.udid);
      } else {
        const result = await captureAndroid(
          capture as ShowcaseCapture & { readonly device: ShowcaseAndroidDevice },
          androidApkPath,
          outputDirectory,
          showcaseConfig,
        );
        androidCleanups.push({ device: capture.device, ...result });
      }
    }

    NodeProcess.stdout.write(
      `\nDone. Screenshots are in ${NodePath.relative(REPO_ROOT, outputDirectory)}/\n`,
    );
    if (options.keepRunning) {
      metro?.unref();
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
      metro?.kill("SIGTERM");
    }
  }
}

if (import.meta.main) {
  void main().catch((error: unknown) => {
    NodeProcess.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    NodeProcess.exit(1);
  });
}
