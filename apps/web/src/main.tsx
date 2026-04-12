import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { createHashHistory, createBrowserHistory } from "@tanstack/react-router";

import "@xterm/xterm/css/xterm.css";
import "./index.css";

import { isElectron } from "./env";
import { isLinuxPlatform, isMacPlatform, isWindowsPlatform } from "./lib/utils";
import { getRouter } from "./router";
import { APP_DISPLAY_NAME } from "./branding";

// Electron loads the app from a file-backed shell, so hash history avoids path resolution issues.
const history = isElectron ? createHashHistory() : createBrowserHistory();

const router = getRouter(history);

document.title = APP_DISPLAY_NAME;

const rootElement = document.documentElement;
rootElement.classList.remove("electron", "os-windows", "os-macos", "os-linux");
rootElement.style.setProperty("--desktop-titlebar-height", "40px");

if (isElectron) {
  rootElement.classList.add("electron");
}

if (typeof navigator !== "undefined") {
  if (isWindowsPlatform(navigator.platform)) {
    rootElement.classList.add("os-windows");
    rootElement.dataset.platform = "windows";
  } else if (isMacPlatform(navigator.platform)) {
    rootElement.classList.add("os-macos");
    rootElement.dataset.platform = "macos";
  } else if (isLinuxPlatform(navigator.platform)) {
    rootElement.classList.add("os-linux");
    rootElement.dataset.platform = "linux";
  } else {
    delete rootElement.dataset.platform;
  }
}

interface WindowControlsOverlayLike extends EventTarget {
  getTitlebarAreaRect(): DOMRect;
}

const windowControlsOverlay = (
  navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlayLike }
).windowControlsOverlay;

if (windowControlsOverlay && typeof windowControlsOverlay.getTitlebarAreaRect === "function") {
  const syncDesktopTitlebarHeight = (rect?: DOMRect) => {
    const nextRect = rect ?? windowControlsOverlay.getTitlebarAreaRect();
    const nextHeight = nextRect.height;
    rootElement.style.setProperty(
      "--desktop-titlebar-height",
      Number.isFinite(nextHeight) && nextHeight > 0 ? `${nextHeight}px` : "40px",
    );
  };

  syncDesktopTitlebarHeight();
  windowControlsOverlay.addEventListener("geometrychange", (event) => {
    syncDesktopTitlebarHeight((event as Event & { titlebarAreaRect?: DOMRect }).titlebarAreaRect);
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
