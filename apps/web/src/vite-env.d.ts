/// <reference types="vite/client" />

import type { DesktopBridge, LocalApi } from "@t3tools/contracts";

interface ImportMetaEnv {
  readonly APP_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  interface NuaT3SidebarThreadSnapshot {
    id: string;
    kind: "thread";
    title: string;
    subtitle?: string;
    isActive?: boolean;
  }

  interface NuaT3SidebarProjectSnapshot {
    id: string;
    kind: "project";
    title: string;
    subtitle?: string;
    isActive?: boolean;
    isExpanded: boolean;
    threadCount: number;
    threads: NuaT3SidebarThreadSnapshot[];
  }

  interface NuaT3SidebarSnapshot {
    projects: NuaT3SidebarProjectSnapshot[];
  }

  interface NuaT3Hooks {
    openFreshThread?: () => void;
    suppressNextBootstrapThreadRestore?: () => void;
    getSidebarSnapshot?: () => NuaT3SidebarSnapshot;
    selectSidebarEntry?: (entryId: string) => boolean;
  }

  interface Window {
    nativeApi?: LocalApi;
    desktopBridge?: DesktopBridge;
    __NUA_T3_HOOKS__?: NuaT3Hooks;
    __NUA_T3_HOOKS?: NuaT3Hooks;
  }
}
