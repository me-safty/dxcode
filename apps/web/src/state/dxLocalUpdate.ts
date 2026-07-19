import { createDxLocalUpdateEnvironmentAtoms } from "@t3tools/client-runtime/state/dx-local-update";

import { connectionAtomRuntime } from "../connection/runtime";

export const dxLocalUpdateEnvironment = createDxLocalUpdateEnvironmentAtoms(connectionAtomRuntime);
