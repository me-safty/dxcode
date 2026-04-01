import { useEffect, useRef } from "react";
import type { ThreadId } from "@t3tools/contracts";
import { isElectron } from "../env";
import { useStore } from "../store";
import {
  type ThreadNotificationSnapshot,
  collectThreadNotificationSnapshots,
  consolidateNotifications,
  diffThreadNotifications,
} from "../lib/threadNotifications";

function isAppBackgrounded(): boolean {
  return document.visibilityState === "hidden" || !document.hasFocus();
}

function canSendNotifications(): boolean {
  return typeof Notification !== "undefined" && Notification.permission === "granted";
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

export function getNotificationPermissionState(): NotificationPermission | "unsupported" {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

export function useThreadNotifications(enabled: boolean): void {
  const previousSnapshotRef = useRef<ReadonlyMap<ThreadId, ThreadNotificationSnapshot> | null>(
    null,
  );
  const bootstrapComplete = useStore((state) => state.bootstrapComplete);
  const threads = useStore((state) => state.threads);
  const projects = useStore((state) => state.projects);

  useEffect(() => {
    if (!bootstrapComplete) return;

    const currentSnapshot = collectThreadNotificationSnapshots(threads, projects);

    if (!enabled) {
      // Keep in sync so toggling on doesn't fire for stale transitions.
      previousSnapshotRef.current = currentSnapshot;
      return;
    }

    if (previousSnapshotRef.current === null) {
      previousSnapshotRef.current = currentSnapshot;
      return;
    }

    if (!isAppBackgrounded() || !canSendNotifications()) {
      previousSnapshotRef.current = currentSnapshot;
      return;
    }

    const rawNotifications = diffThreadNotifications(previousSnapshotRef.current, currentSnapshot);

    if (rawNotifications.length > 0) {
      const consolidated = consolidateNotifications(rawNotifications);
      for (const notification of consolidated) {
        const browserNotification = new Notification(notification.title, {
          body: notification.body,
          tag: notification.threadId ?? "t3code-batch",
        });

        if (notification.threadId) {
          const threadId = notification.threadId;
          browserNotification.addEventListener("click", () => {
            window.focus();
            if (isElectron) {
              window.location.hash = `#/${threadId}`;
            } else {
              window.history.pushState(null, "", `/${threadId}`);
              window.dispatchEvent(new PopStateEvent("popstate"));
            }
          });
        } else {
          browserNotification.addEventListener("click", () => {
            window.focus();
          });
        }
      }
    }

    previousSnapshotRef.current = currentSnapshot;
  }, [bootstrapComplete, enabled, projects, threads]);
}
