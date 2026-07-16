import type { EnvironmentId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useEffectEvent } from "react";

import { subscribeDesktopNotificationEnvironment } from "../../desktopNotifications.subscription";
import { isElectron } from "../../env";
import { useClientSettings, useClientSettingsHydrated } from "../../hooks/useSettings";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { useEnvironmentConnectionState, useEnvironments } from "../../state/environments";
import { environmentShell } from "../../state/shell";

function DesktopNotificationEnvironmentObserver({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const isHydrated = useClientSettingsHydrated();
  const isEnabled = useClientSettings((settings) => settings.desktopNotificationsEnabled);
  const connection = useEnvironmentConnectionState(environmentId);
  const generation = connection.data?.generation ?? 0;
  const isConnected = connection.data?.phase === "connected";

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge?.showDesktopNotification || !isHydrated || !isEnabled || !isConnected) return;
    return subscribeDesktopNotificationEnvironment({
      registry: appAtomRegistry,
      shellAtom: environmentShell.stateValueAtom(environmentId),
      environmentId,
      generation,
      deliver: (event) => {
        void bridge.showDesktopNotification(event).catch(() => undefined);
      },
    });
  }, [environmentId, generation, isConnected, isEnabled, isHydrated]);

  return null;
}

function DesktopNotificationNavigation() {
  const navigate = useNavigate();
  const consumeTarget = useEffectEvent(() => {
    const bridge = window.desktopBridge;
    if (!bridge?.consumePendingDesktopNotificationTarget) return;
    void bridge
      .consumePendingDesktopNotificationTarget()
      .then((target) => {
        if (target === null) return;
        return navigate({
          to: "/$environmentId/$threadId",
          params: target,
        });
      })
      .catch(() => undefined);
  });

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge?.onDesktopNotificationTargetAvailable) return;
    const unsubscribe = bridge.onDesktopNotificationTargetAvailable(consumeTarget);
    consumeTarget();
    return unsubscribe;
  }, []);

  return null;
}

export function DesktopNotificationBootstrap() {
  const { environments } = useEnvironments();
  if (!isElectron) return null;
  return (
    <>
      <DesktopNotificationNavigation />
      {environments.map(({ environmentId }) => (
        <DesktopNotificationEnvironmentObserver key={environmentId} environmentId={environmentId} />
      ))}
    </>
  );
}
