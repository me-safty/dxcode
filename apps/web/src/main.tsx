import * as React from "react";
import * as ReactDOM from "react-dom/client";
import { createHashHistory, createBrowserHistory, RouterProvider } from "@tanstack/react-router";
import { ClerkProvider } from "@clerk/react";
import { passkeys } from "@clerk/electron/passkeys";
import { ClerkProvider as ElectronClerkProvider } from "@clerk/electron/react";

import "@fontsource-variable/dm-sans/index.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@xterm/xterm/css/xterm.css";
import "./index.css";

import { isElectron } from "./env";
import { ManagedRelayAuthProvider } from "./cloud/managedAuth";
import { hasCloudPublicConfig } from "./cloud/publicConfig";
import { getRouter } from "./router";
import { syncDocumentWindowControlsOverlayClass } from "./lib/windowControlsOverlay";
import { AppAtomRegistryProvider } from "./rpc/atomRegistry";
import { ElectronBrowserHost } from "./browser/ElectronBrowserHost";

// Electron loads the app from a file-backed shell, so hash history avoids path resolution issues.
const history = isElectron ? createHashHistory() : createBrowserHistory();

const router = getRouter(history);

if (isElectron) {
  syncDocumentWindowControlsOverlayClass();
}

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

const app = (
  <AppAtomRegistryProvider>
    <RouterProvider router={router} />
    <ElectronBrowserHost />
  </AppAtomRegistryProvider>
);

const AuthWrapper = (props: { children: React.ReactNode }) =>
  clerkPublishableKey && hasCloudPublicConfig() ? (
    isElectron ? (
      <ElectronClerkProvider publishableKey={clerkPublishableKey} passkeys={passkeys}>
        <ManagedRelayAuthProvider>{props.children}</ManagedRelayAuthProvider>
      </ElectronClerkProvider>
    ) : (
      <ClerkProvider publishableKey={clerkPublishableKey}>
        <ManagedRelayAuthProvider>{props.children}</ManagedRelayAuthProvider>
      </ClerkProvider>
    )
  ) : (
    props.children
  );

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AuthWrapper>{app}</AuthWrapper>
  </React.StrictMode>,
);
