import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import { RouterProvider } from "@tanstack/react-router";
import { createBrowserHistory } from "@tanstack/react-router";

import "@xterm/xterm/css/xterm.css";
import "./index.css";

import { ManagedRelayAuthProvider } from "./cloud/managedAuth";
import { hasCloudPublicConfig } from "./cloud/publicConfig";
import { getRouter } from "./router";
import { APP_DISPLAY_NAME } from "./branding";
const history = createBrowserHistory();

const router = getRouter(history);

document.title = APP_DISPLAY_NAME;

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
const cloudWaitlistUrl = "/settings/cloud";

const app = <RouterProvider router={router} />;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {clerkPublishableKey && hasCloudPublicConfig() ? (
      <ClerkProvider publishableKey={clerkPublishableKey} waitlistUrl={cloudWaitlistUrl}>
        <ManagedRelayAuthProvider>{app}</ManagedRelayAuthProvider>
      </ClerkProvider>
    ) : (
      app
    )}
  </React.StrictMode>,
);
