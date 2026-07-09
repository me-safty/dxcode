import * as QuickActions from "expo-quick-actions";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { useLinkTo, type NavigationState } from "@react-navigation/native";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";

import {
  loadRecentThreadShortcuts,
  saveRecentThreadShortcuts,
  type RecentThreadShortcut,
} from "../../persistence/imperative";
import { useThreadShell } from "../../state/entities";
import { buildShortcutActions, shortcutHref, withRecentThreadShortcut } from "./appShortcuts";

function firstRouteParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function activeThreadRef(state: NavigationState): ScopedThreadRef | null {
  const route = state.routes[state.index];
  if (route?.name !== "Thread") {
    return null;
  }

  const params = route.params as
    | {
        readonly environmentId?: string | string[];
        readonly threadId?: string | string[];
      }
    | undefined;
  const environmentId = firstRouteParam(params?.environmentId);
  const threadId = firstRouteParam(params?.threadId);
  if (!environmentId || !threadId) {
    return null;
  }

  return {
    environmentId: EnvironmentId.make(environmentId),
    threadId: ThreadId.make(threadId),
  };
}

/**
 * Owns the launcher app shortcuts (Android long-press menu): keeps the
 * static "New task" entry plus the recently opened threads in sync, and
 * routes shortcut taps — cold start included — to their in-app screens.
 * Mounted once in the root stack layout.
 */
export function useAppShortcuts(state: NavigationState): void {
  useShortcutNavigation();
  useRecentThreadShortcutSync(state);
}

function useShortcutNavigation(): void {
  const linkTo = useLinkTo();
  const handledInitialAction = useRef(false);

  useEffect(() => {
    // Cold start: the tapped shortcut arrives as the launch action, before
    // any listener can fire. Navigating from here pushes the target over the
    // initial Home route, so back returns home instead of exiting the app.
    if (!handledInitialAction.current) {
      handledInitialAction.current = true;
      const initialHref = QuickActions.initial ? shortcutHref(QuickActions.initial) : null;
      if (initialHref !== null) {
        linkTo(initialHref);
      }
    }

    const subscription = QuickActions.addListener((action) => {
      const href = shortcutHref(action);
      if (href !== null) {
        linkTo(href);
      }
    });
    return () => subscription.remove();
  }, [linkTo]);
}

function useRecentThreadShortcutSync(state: NavigationState): void {
  const threadRef = useMemo(() => activeThreadRef(state), [state]);
  const threadShell = useThreadShell(threadRef);
  // null until the persisted list loads; recording waits on it so the first
  // thread opened after a cold start cannot clobber older entries.
  const [recents, setRecents] = useState<ReadonlyArray<RecentThreadShortcut> | null>(null);

  useEffect(() => {
    if (Platform.OS !== "android") {
      return;
    }

    let cancelled = false;
    void loadRecentThreadShortcuts()
      .catch((error) => {
        console.warn("[app-shortcuts] failed to load recent threads", error);
        return [] as ReadonlyArray<RecentThreadShortcut>;
      })
      .then((threads) => {
        if (!cancelled) {
          setRecents(threads);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loaded = recents !== null;
  const environmentId = threadRef?.environmentId ?? null;
  const threadId = threadRef?.threadId ?? null;
  const title = threadShell?.title ?? "";
  useEffect(() => {
    if (!loaded || environmentId === null || threadId === null) {
      return;
    }

    // withRecentThreadShortcut returns the same array when nothing changed,
    // so React bails out and the persist effect below does not re-fire.
    setRecents((current) =>
      current === null
        ? current
        : withRecentThreadShortcut(current, { environmentId, threadId, title }),
    );
  }, [loaded, environmentId, threadId, title]);

  useEffect(() => {
    if (recents === null) {
      return;
    }

    void saveRecentThreadShortcuts(recents).catch((error) => {
      console.warn("[app-shortcuts] failed to persist recent threads", error);
    });
    void QuickActions.setItems(buildShortcutActions(recents)).catch((error) => {
      console.warn("[app-shortcuts] failed to update launcher shortcuts", error);
    });
  }, [recents]);
}
