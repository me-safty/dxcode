#!/usr/bin/env node
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const mobileRoot = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");

function firstExisting(paths) {
  for (const candidate of paths) {
    if (typeof candidate === "string" && candidate.length > 0 && NodeFS.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveJavaHome() {
  const configured = process.env.JAVA_HOME;
  if (typeof configured === "string" && configured.trim().length > 0) {
    return configured.trim();
  }

  return firstExisting([
    "/usr/lib/jvm/java-21-openjdk",
    "/usr/lib/jvm/java-17-openjdk",
    "/usr/lib/jvm/default",
  ]);
}

function resolveAndroidHome() {
  const configured =
    process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? process.env.ANDROID_SDK_HOME;
  if (typeof configured === "string" && configured.trim().length > 0) {
    return configured.trim();
  }

  const home = NodeOS.homedir();
  return firstExisting([
    NodePath.join(home, "Android", "Sdk"),
    "/opt/android-sdk",
    "/usr/lib/android-sdk",
  ]);
}

function ensureLocalProperties(androidHome) {
  const androidDir = NodePath.join(mobileRoot, "android");
  if (!NodeFS.existsSync(androidDir)) {
    return;
  }

  const localPropertiesPath = NodePath.join(androidDir, "local.properties");
  const contents = `sdk.dir=${androidHome.replace(/\\/g, "/")}\n`;
  if (
    !NodeFS.existsSync(localPropertiesPath) ||
    NodeFS.readFileSync(localPropertiesPath, "utf8") !== contents
  ) {
    NodeFS.writeFileSync(localPropertiesPath, contents);
  }
}

const javaHome = resolveJavaHome();
if (javaHome == null) {
  console.error(
    [
      "No JDK 17+ found for Android builds.",
      "Install OpenJDK 21 (or 17) and set JAVA_HOME, e.g.",
      "  export JAVA_HOME=/usr/lib/jvm/java-21-openjdk",
    ].join("\n"),
  );
  process.exit(1);
}

const androidHome = resolveAndroidHome();
const env = {
  ...process.env,
  JAVA_HOME: javaHome,
  PATH: `${NodePath.join(javaHome, "bin")}${NodePath.delimiter}${process.env.PATH ?? ""}`,
};

if (androidHome != null) {
  env.ANDROID_HOME = androidHome;
  env.ANDROID_SDK_ROOT = androidHome;
  env.PATH = `${NodePath.join(androidHome, "platform-tools")}${NodePath.delimiter}${env.PATH}`;
  ensureLocalProperties(androidHome);
} else {
  console.warn(
    "ANDROID_HOME is not set and no Android SDK was found. Gradle must resolve the SDK via local.properties.",
  );
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("Usage: node scripts/with-android-env.mjs <command> [args...]");
  process.exit(1);
}

const result = NodeChildProcess.spawnSync(command, args, {
  stdio: "inherit",
  env,
  cwd: mobileRoot,
});

process.exit(result.status ?? 1);
