#!/usr/bin/env node
// @effect-diagnostics globalConsole:off

import { seedOwnerPairingTokenFromEnv, resolveOwnerPairingUrl } from "./owner-pairing-token.ts";

const dbPath = seedOwnerPairingTokenFromEnv(process.env);
if (!dbPath) {
  console.log("T3CODE_OWNER_PAIRING_TOKEN is not set; no stable owner pairing token was seeded.");
  process.exit(0);
}

console.log(`Seeded stable owner pairing token in ${dbPath}`);
console.log(resolveOwnerPairingUrl(process.env) ?? "Pairing URL unavailable.");
