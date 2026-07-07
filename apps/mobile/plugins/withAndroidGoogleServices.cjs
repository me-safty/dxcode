const fs = require("node:fs");
const path = require("node:path");

const { withDangerousMod } = require("expo/config-plugins");

function resolveGoogleServicesPath(config) {
  const configured = config.android?.googleServicesFile;
  if (typeof configured !== "string" || configured.trim().length === 0) {
    return null;
  }
  return path.resolve(config._internal?.projectRoot ?? process.cwd(), configured);
}

module.exports = function withAndroidGoogleServices(config) {
  return withDangerousMod(config, [
    "android",
    async (modConfig) => {
      const googleServicesPath = resolveGoogleServicesPath(modConfig);
      if (googleServicesPath == null) {
        return modConfig;
      }
      if (!fs.existsSync(googleServicesPath)) {
        throw new Error(
          [
            "Missing google-services.json for Android FCM.",
            `Expected file at ${googleServicesPath}.`,
            "Download it from Firebase Console for the active APP_VARIANT package,",
            "or set GOOGLE_SERVICES_JSON to an EAS file secret before building.",
            "See apps/mobile/docs/FIREBASE-ANDROID.md.",
          ].join(" "),
        );
      }
      return modConfig;
    },
  ]);
};
