const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { withDangerousMod, withProjectBuildGradle } = require("expo/config-plugins");

const DEV_CLIENT_BUILD_ORDER_MARKER =
  "expo-dev-launcher debug sources reference expo-dev-menu symbols";

const DEV_CLIENT_BUILD_ORDER = `
// ${DEV_CLIENT_BUILD_ORDER_MARKER} that are not visible until dev-menu has
// compiled. Gradle parallel project execution can compile both modules
// concurrently and fail with unresolved Kotlin references.
subprojects { subproject ->
  if (subproject.name == "expo-dev-launcher") {
    subproject.plugins.withId("com.android.library") {
      subproject.tasks.configureEach { task ->
        if (task.name == "compileDebugKotlin") {
          task.dependsOn(":expo-dev-menu:compileDebugKotlin")
        }
        if (task.name == "compileDebugOptimizedKotlin") {
          task.dependsOn(":expo-dev-menu:compileDebugOptimizedKotlin")
        }
      }
    }
  }
}
`;

function firstExistingDirectory(candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0 && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveAndroidSdkDirectory() {
  const configured =
    process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? process.env.ANDROID_SDK_HOME;
  if (typeof configured === "string" && configured.trim().length > 0) {
    return configured.trim();
  }

  const home = os.homedir();
  return firstExistingDirectory([
    path.join(home, "Android", "Sdk"),
    "/opt/android-sdk",
    "/usr/lib/android-sdk",
  ]);
}

function writeLocalProperties(androidProjectRoot) {
  const sdkDirectory = resolveAndroidSdkDirectory();
  if (sdkDirectory == null) {
    return;
  }

  const localPropertiesPath = path.join(androidProjectRoot, "local.properties");
  const contents = `sdk.dir=${sdkDirectory.replace(/\\/g, "/")}\n`;
  if (
    !fs.existsSync(localPropertiesPath) ||
    fs.readFileSync(localPropertiesPath, "utf8") !== contents
  ) {
    fs.writeFileSync(localPropertiesPath, contents);
  }
}

module.exports = function withAndroidBuildFixes(config) {
  config = withProjectBuildGradle(config, (gradle) => {
    if (!gradle.modResults.contents.includes(DEV_CLIENT_BUILD_ORDER_MARKER)) {
      gradle.modResults.contents += DEV_CLIENT_BUILD_ORDER;
    }
    return gradle;
  });

  return withDangerousMod(config, [
    "android",
    async (modConfig) => {
      writeLocalProperties(modConfig.modRequest.platformProjectRoot);
      return modConfig;
    },
  ]);
};
