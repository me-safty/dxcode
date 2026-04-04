import { ConfigManager } from "../config/ConfigManager.ts";

export async function configureAPI(): Promise<void> {
  const config = new ConfigManager();
  await config.runSetup();
}
