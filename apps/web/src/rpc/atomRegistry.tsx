import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/unstable/reactivity";
import { useRef, type ReactNode } from "react";

type AtomRegistryValue = ReturnType<typeof AtomRegistry.make>;
type AtomRegistryGlobal = typeof globalThis & {
  __t3AppAtomRegistry?: AtomRegistryValue;
};

export function getAppAtomRegistry() {
  const registryGlobal = globalThis as AtomRegistryGlobal;
  registryGlobal.__t3AppAtomRegistry ??= AtomRegistry.make();
  return registryGlobal.__t3AppAtomRegistry;
}

export function AppAtomRegistryProvider({ children }: { readonly children: ReactNode }) {
  const registryRef = useRef<AtomRegistryValue>(null!);
  if (!registryRef.current) {
    registryRef.current = getAppAtomRegistry();
  }

  return (
    <RegistryContext.Provider value={registryRef.current}>{children}</RegistryContext.Provider>
  );
}
