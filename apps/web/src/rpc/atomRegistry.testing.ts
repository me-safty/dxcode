import { AtomRegistry } from "effect/unstable/reactivity";

import { getAppAtomRegistry } from "./atomRegistry";

type AtomRegistryValue = ReturnType<typeof AtomRegistry.make>;
type AtomRegistryGlobal = typeof globalThis & {
  __t3AppAtomRegistry?: AtomRegistryValue;
};

export function resetAppAtomRegistryForTests() {
  getAppAtomRegistry().dispose();
  (globalThis as AtomRegistryGlobal).__t3AppAtomRegistry = AtomRegistry.make();
}
