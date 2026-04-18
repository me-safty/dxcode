import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef } from "react";

import { useCommandPaletteStore } from "../commandPaletteStore";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import {
  startFreshThreadFromContext,
  startNewLocalThreadFromContext,
  startNewThreadFromContext,
} from "../lib/chatThreadActions";
import { clearNuaFreshThreadRequest, hasNuaFreshThreadRequest } from "../lib/nuaFreshThread";
import { isTerminalFocused } from "../lib/terminalFocus";
import { resolveShortcutCommand } from "../keybindings";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { resolveSidebarNewThreadEnvMode } from "~/components/Sidebar.logic";
import { useSettings } from "~/hooks/useSettings";
import { useServerKeybindings } from "~/rpc/serverState";

function ChatRouteGlobalShortcuts() {
  const clearSelection = useThreadSelectionStore((state) => state.clearSelection);
  const selectedThreadKeysSize = useThreadSelectionStore((state) => state.selectedThreadKeys.size);
  const {
    activeDraftThread,
    activeThread,
    defaultProjectRef,
    handleFreshThread,
    handleNewThread,
    routeThreadRef,
  } = useHandleNewThread();
  const keybindings = useServerKeybindings();
  const terminalOpen = useTerminalStateStore((state) =>
    routeThreadRef
      ? selectThreadTerminalState(state.terminalStateByThreadKey, routeThreadRef).terminalOpen
      : false,
  );
  const appSettings = useSettings();
  const defaultThreadEnvMode = resolveSidebarNewThreadEnvMode({
    defaultEnvMode: appSettings.defaultThreadEnvMode,
  });
  const didHandleUrlFreshThreadRef = useRef(false);
  const createThreadActionContext = useEffectEvent(() => ({
    activeDraftThread,
    activeThread,
    defaultProjectRef,
    defaultThreadEnvMode,
    handleFreshThread,
    handleNewThread,
  }));

  useEffect(() => {
    if (didHandleUrlFreshThreadRef.current) {
      return;
    }
    if (!hasNuaFreshThreadRequest()) {
      return;
    }
    if (!defaultProjectRef) {
      return;
    }

    didHandleUrlFreshThreadRef.current = true;
    void startFreshThreadFromContext(createThreadActionContext()).then((didStart) => {
      if (!didStart) {
        didHandleUrlFreshThreadRef.current = false;
        return;
      }

      clearNuaFreshThreadRequest();
    });
  }, [createThreadActionContext, defaultProjectRef]);

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen,
        },
      });

      if (useCommandPaletteStore.getState().open) {
        return;
      }

      if (event.key === "Escape" && selectedThreadKeysSize > 0) {
        event.preventDefault();
        clearSelection();
        return;
      }

      if (command === "chat.newLocal") {
        event.preventDefault();
        event.stopPropagation();
        void startNewLocalThreadFromContext(createThreadActionContext());
        return;
      }

      if (command === "chat.new") {
        event.preventDefault();
        event.stopPropagation();
        void startNewThreadFromContext(createThreadActionContext());
      }
    };

    const onFreshThreadRequest = () => {
      void startFreshThreadFromContext(createThreadActionContext());
    };

    window.addEventListener("keydown", onWindowKeyDown);
    window.__NUA_T3_HOOKS__ = {
      ...window.__NUA_T3_HOOKS__,
      openFreshThread: onFreshThreadRequest,
    };
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
      if (window.__NUA_T3_HOOKS__?.openFreshThread === onFreshThreadRequest) {
        const nextHooks = { ...window.__NUA_T3_HOOKS__ };
        delete nextHooks.openFreshThread;
        if (Object.keys(nextHooks).length === 0) {
          delete window.__NUA_T3_HOOKS__;
        } else {
          window.__NUA_T3_HOOKS__ = nextHooks;
        }
      }
    };
  }, [
    clearSelection,
    createThreadActionContext,
    keybindings,
    selectedThreadKeysSize,
    terminalOpen,
  ]);

  return null;
}

function ChatRouteLayout() {
  return (
    <>
      <ChatRouteGlobalShortcuts />
      <Outlet />
    </>
  );
}

export const Route = createFileRoute("/_chat")({
  beforeLoad: async ({ context }) => {
    if (context.authGateState.status !== "authenticated") {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: ChatRouteLayout,
});
