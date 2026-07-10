import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "tools.t3code.mobile",
  appName: "T3 Code",
  webDir: "../web/dist",
  loggingBehavior: "none",
  plugins: {
    SystemBars: {
      insetsHandling: "css",
    },
  },
  server: {
    cleartext: true,
    androidScheme: "http",
  },
};

export default config;
