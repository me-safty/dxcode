import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";
import {
  PROVIDER_DISPLAY_NAMES,
  type ProviderKind,
  type ServerProvider,
  type ServerProviderUpdatedPayload,
} from "@t3tools/contracts";

import { ensureLocalApi } from "../localApi";
import { useServerProviders } from "../rpc/serverState";
import { stackedThreadToast, toastManager } from "./ui/toast";

const seenProviderUpdateNotificationKeys = new Set<string>();
type ProviderUpdateToastId = ReturnType<typeof toastManager.add>;

function isProviderUpdateCandidate(provider: ServerProvider): boolean {
  return (
    provider.enabled &&
    (provider.versionAdvisory?.status === "behind_tested" ||
      provider.versionAdvisory?.status === "behind_latest")
  );
}

function providerUpdateNotificationKey(providers: ReadonlyArray<ServerProvider>): string | null {
  const parts = providers.filter(isProviderUpdateCandidate).map((provider) => {
    const advisory = provider.versionAdvisory;
    return [
      provider.provider,
      advisory?.status,
      advisory?.currentVersion,
      advisory?.testedVersion,
      advisory?.latestVersion,
    ].join(":");
  });

  return parts.length > 0 ? parts.join("|") : null;
}

function formatProviderList(providers: ReadonlyArray<ServerProvider>): string {
  const names = providers.map(
    (provider) => PROVIDER_DISPLAY_NAMES[provider.provider] ?? provider.provider,
  );
  if (names.length <= 2) {
    return names.join(" and ");
  }
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function collectFailedUpdateProviders(
  results: ReadonlyArray<PromiseSettledResult<ServerProviderUpdatedPayload>>,
  attemptedProviders: ReadonlySet<ProviderKind>,
): ServerProvider[] {
  const latestProviderByKind = new Map<ProviderKind, ServerProvider>();

  for (const result of results) {
    if (result.status !== "fulfilled") {
      continue;
    }
    for (const provider of result.value.providers) {
      if (attemptedProviders.has(provider.provider)) {
        latestProviderByKind.set(provider.provider, provider);
      }
    }
  }

  return [...latestProviderByKind.values()].filter(
    (provider) => provider.updateState?.status === "failed",
  );
}

function firstRejectedMessage(
  results: ReadonlyArray<PromiseSettledResult<ServerProviderUpdatedPayload>>,
): string | null {
  const rejected = results.find((result) => result.status === "rejected");
  if (!rejected) {
    return null;
  }
  return rejected.reason instanceof Error ? rejected.reason.message : "Provider update failed.";
}

export function ProviderUpdateLaunchNotification() {
  const navigate = useNavigate();
  const providers = useServerProviders();
  const activeUpdatePromptRef = useRef<{ key: string; toastId: ProviderUpdateToastId } | null>(
    null,
  );

  const updateProviders = useMemo(() => providers.filter(isProviderUpdateCandidate), [providers]);
  const notificationKey = useMemo(() => providerUpdateNotificationKey(providers), [providers]);
  const oneClickProviders = useMemo(
    () =>
      updateProviders.filter(
        (provider) =>
          provider.versionAdvisory?.canUpdate === true &&
          provider.updateState?.status !== "running",
      ),
    [updateProviders],
  );

  useEffect(() => {
    if (activeUpdatePromptRef.current && activeUpdatePromptRef.current.key !== notificationKey) {
      toastManager.close(activeUpdatePromptRef.current.toastId);
      activeUpdatePromptRef.current = null;
    }

    if (
      !notificationKey ||
      seenProviderUpdateNotificationKeys.has(notificationKey) ||
      updateProviders.length === 0
    ) {
      return;
    }

    seenProviderUpdateNotificationKeys.add(notificationKey);

    const updateCount = updateProviders.length;
    const providerNames = formatProviderList(updateProviders);
    const title =
      updateCount === 1
        ? `${providerNames} has an update`
        : `${updateCount} providers have updates`;
    const description =
      oneClickProviders.length > 0
        ? "Install the update now or review provider settings."
        : `${providerNames} can be updated from provider settings.`;

    let toastId: ProviderUpdateToastId | null = null;
    let updateStarted = false;
    const openSettings = () => {
      if (toastId) {
        toastManager.close(toastId);
      }
      activeUpdatePromptRef.current = null;
      void navigate({ to: "/settings/general" });
    };

    const runUpdates = () => {
      if (updateStarted || oneClickProviders.length === 0 || !toastId) {
        return;
      }
      updateStarted = true;
      activeUpdatePromptRef.current = null;
      const attemptedProviderKinds = new Set(
        oneClickProviders.map((provider) => provider.provider),
      );

      toastManager.update(toastId, {
        type: "loading",
        title: oneClickProviders.length === 1 ? "Updating provider" : "Updating providers",
        description: "Running provider update command.",
        timeout: 0,
        data: {
          hideCopyButton: true,
        },
      });

      void Promise.allSettled(
        oneClickProviders.map(async (provider) =>
          ensureLocalApi().server.updateProvider({ provider: provider.provider }),
        ),
      ).then((results) => {
        if (!toastId) {
          return;
        }

        const rejectedMessage = firstRejectedMessage(results);
        const failedProviders = collectFailedUpdateProviders(results, attemptedProviderKinds);
        if (rejectedMessage || failedProviders.length > 0) {
          toastManager.update(
            toastId,
            stackedThreadToast({
              type: "error",
              title:
                failedProviders.length === 1 ? "Provider update failed" : "Provider updates failed",
              description:
                rejectedMessage ??
                `${formatProviderList(failedProviders)} failed to update. Check provider settings for details.`,
              timeout: 0,
              actionProps: {
                children: "Settings",
                onClick: openSettings,
              },
              actionVariant: "outline",
              data: {
                hideCopyButton: true,
              },
            }),
          );
          return;
        }

        toastManager.update(toastId, {
          type: "success",
          title: oneClickProviders.length === 1 ? "Provider updated" : "Provider updates finished",
          description: "Provider status will refresh automatically.",
          timeout: 0,
          data: {
            dismissAfterVisibleMs: 10_000,
            hideCopyButton: true,
          },
        });
      });
    };

    toastId = toastManager.add(
      stackedThreadToast({
        type: "warning",
        title,
        description,
        timeout: 0,
        actionProps:
          oneClickProviders.length > 0
            ? {
                children: "Update",
                onClick: runUpdates,
              }
            : {
                children: "Settings",
                onClick: openSettings,
              },
        actionVariant: oneClickProviders.length > 0 ? "default" : "outline",
        data: {
          hideCopyButton: true,
          ...(oneClickProviders.length > 0
            ? {
                secondaryActionProps: {
                  children: "Settings",
                  onClick: openSettings,
                },
                secondaryActionVariant: "outline" as const,
              }
            : {}),
        },
      }),
    );
    activeUpdatePromptRef.current = { key: notificationKey, toastId };
  }, [navigate, notificationKey, oneClickProviders, updateProviders]);

  return null;
}
