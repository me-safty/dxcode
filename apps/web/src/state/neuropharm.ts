import { createNeuropharmEnvironmentAtoms } from "@t3tools/client-runtime/state/neuropharm";

import { connectionAtomRuntime } from "../connection/runtime";

export const neuropharmEnvironment = createNeuropharmEnvironmentAtoms(connectionAtomRuntime);
