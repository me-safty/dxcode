import { createUpstreamSyncEnvironmentAtoms } from "@t3tools/client-runtime/state/upstream-sync";

import { connectionAtomRuntime } from "../connection/runtime";

export const upstreamSyncEnvironment = createUpstreamSyncEnvironmentAtoms(connectionAtomRuntime);
