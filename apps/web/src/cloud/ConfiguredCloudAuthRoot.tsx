import { ClerkProvider } from "@clerk/react";
import { passkeys } from "@clerk/electron/passkeys";
import { ClerkProvider as ElectronClerkProvider } from "@clerk/electron/react";
import type { ReactNode } from "react";

import { isElectron } from "../env";
import { ManagedRelayAuthProvider } from "./managedAuth";

export default function ConfiguredCloudAuthRoot({
  children,
  publishableKey,
}: {
  readonly children: ReactNode;
  readonly publishableKey: string;
}) {
  return isElectron ? (
    <ElectronClerkProvider publishableKey={publishableKey} passkeys={passkeys}>
      <ManagedRelayAuthProvider>{children}</ManagedRelayAuthProvider>
    </ElectronClerkProvider>
  ) : (
    <ClerkProvider publishableKey={publishableKey}>
      <ManagedRelayAuthProvider>{children}</ManagedRelayAuthProvider>
    </ClerkProvider>
  );
}
