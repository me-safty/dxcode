import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import type { OrchestrationSessionStatus } from "@t3tools/contracts";

import { useClientSettings } from "~/hooks/useSettings";
import { decideAgentStopNotifications } from "~/lib/agentStopNotifications";
import { playNotificationTone } from "~/lib/notificationSound";
import { useProjects, useThreadShells } from "~/state/entities";

/**
 * App-global observer that watches every thread's session status and emits a
 * native notification + sound when an agent stops working. Renders nothing.
 */
export function AgentStopNotifications(): null {
  const threads = useThreadShells();
  const projects = useProjects();
  const popup = useClientSettings((s) => s.notifyOnAgentStopPopup);
  const sound = useClientSettings((s) => s.notifyOnAgentStopSound);
  const soundSource = useClientSettings((s) => s.notifyOnAgentStopSoundSource);
  const activeThreadId = (useParams({ strict: false }) as { threadId?: string }).threadId ?? null;
  const navigate = useNavigate();

  const prevStatusesRef = useRef<Map<string, OrchestrationSessionStatus>>(new Map());

  useEffect(() => {
    const isAppFocused = typeof document !== "undefined" ? document.hasFocus() : false;
    const { notifications, nextStatuses } = decideAgentStopNotifications({
      prevStatuses: prevStatusesRef.current,
      threads,
      projects,
      settings: { popup, sound, soundSource },
      activeThreadId,
      isAppFocused,
    });
    prevStatusesRef.current = nextStatuses;

    for (const notification of notifications) {
      if (popup) {
        void window.desktopBridge?.showAgentNotification({
          title: notification.title,
          body: notification.body,
          threadId: notification.threadId,
          environmentId: notification.environmentId,
        });
      }
      if (sound) {
        if (soundSource === "system") {
          void window.desktopBridge?.playSystemSound();
        } else {
          playNotificationTone();
        }
      }
    }
  }, [threads, projects, popup, sound, soundSource, activeThreadId]);

  useEffect(() => {
    const subscribe = window.desktopBridge?.onAgentNotificationClicked;
    if (typeof subscribe !== "function") return;
    const unsubscribe = subscribe(({ threadId, environmentId }) => {
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId },
      });
    });
    return () => unsubscribe?.();
  }, [navigate]);

  return null;
}
