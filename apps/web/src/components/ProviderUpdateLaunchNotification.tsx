import { useNavigate } from "@tanstack/react-router";
import { DownloadIcon } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import {
  defaultInstanceIdForDriver,
  PROVIDER_DISPLAY_NAMES,
  type ProviderDriverKind,
  type ServerProvider,
  type ServerProviderUpdatedPayload,
} from "@t3tools/contracts";

import { ensureLocalApi } from "../localApi";
import { useServerProviders } from "../rpc/serverState";
import { PROVIDER_ICON_BY_PROVIDER } from "./chat/providerIconUtils";
import { stackedThreadToast, toastManager } from "./ui/toast";

const seenProviderUpdateNotificationKeys = new Set<string>();
type ProviderUpdateToastId = ReturnType<typeof toastManager.add>;

function formatVersion(value: string): string {
  return value.startsWith("v") ? value : `v${value}`;
}

function isProviderUpdateCandidate(provider: ServerProvider): boolean {
  return (
    provider.enabled &&
    (provider.versionAdvisory?.status === "behind_tested" ||
      provider.versionAdvisory?.status === "behind_latest")
  );
}

function chooseRepresentativeProvider(
  current: ServerProvider | undefined,
  candidate: ServerProvider,
): ServerProvider {
  if (!current) {
    return candidate;
  }
  const defaultInstanceId = defaultInstanceIdForDriver(candidate.driver);
  if (candidate.instanceId === defaultInstanceId) {
    return candidate;
  }
  if (current.instanceId === defaultInstanceId) {
    return current;
  }
  return candidate.checkedAt.localeCompare(current.checkedAt) >= 0 ? candidate : current;
}

function dedupeUpdateProvidersByDriver(
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<ServerProvider> {
  const representatives = new Map<ProviderDriverKind, ServerProvider>();
  for (const provider of providers) {
    if (!isProviderUpdateCandidate(provider)) {
      continue;
    }
    representatives.set(
      provider.driver,
      chooseRepresentativeProvider(representatives.get(provider.driver), provider),
    );
  }
  return [...representatives.values()];
}

function providerUpdateNotificationKey(providers: ReadonlyArray<ServerProvider>): string | null {
  const parts = dedupeUpdateProvidersByDriver(providers).map((provider) => {
    const advisory = provider.versionAdvisory;
    return [
      provider.driver,
      advisory?.status,
      advisory?.currentVersion,
      advisory?.testedVersion,
      advisory?.latestVersion,
    ].join(":");
  });

  return parts.length > 0 ? parts.join("|") : null;
}

function formatProviderList(providers: ReadonlyArray<ServerProvider>): string {
  const names = providers.map((provider) => PROVIDER_DISPLAY_NAMES[provider.driver] ?? provider.driver);
  if (names.length <= 2) {
    return names.join(" and ");
  }
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function getProviderUpdateTargetVersion(provider: ServerProvider): string | null {
  return provider.versionAdvisory?.latestVersion ?? provider.versionAdvisory?.testedVersion ?? null;
}

function getProviderUpdateToastTitle(providers: ReadonlyArray<ServerProvider>): string {
  if (providers.length === 1) {
    const provider = providers[0]!;
    const providerName = PROVIDER_DISPLAY_NAMES[provider.driver] ?? provider.driver;
    const targetVersion = getProviderUpdateTargetVersion(provider);
    return targetVersion
      ? `Update Available: ${providerName} ${formatVersion(targetVersion)}`
      : `Update Available: ${providerName}`;
  }

  return `Updates Available: ${providers.length} providers`;
}

function ProviderUpdateToastIcon({ provider }: { provider: ProviderDriverKind }) {
  const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[provider];

  return (
    <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
      <ProviderIcon aria-hidden="true" className="size-4" />
      <span className="absolute -right-1 -bottom-1 inline-flex size-3 items-center justify-center rounded-full bg-popover">
        <DownloadIcon aria-hidden="true" className="size-2.5 text-success" strokeWidth={2.5} />
      </span>
    </span>
  );
}

function collectUpdateOutcomeProviders(
  results: ReadonlyArray<PromiseSettledResult<ServerProviderUpdatedPayload>>,
  attemptedProviders: ReadonlySet<ProviderDriverKind>,
): { failedProviders: ServerProvider[]; unchangedProviders: ServerProvider[] } {
  const matchedProviders: ServerProvider[] = [];

  for (const result of results) {
    if (result.status !== "fulfilled") {
      continue;
    }
    for (const provider of result.value.providers) {
      if (attemptedProviders.has(provider.driver)) {
        matchedProviders.push(provider);
      }
    }
  }

  const providers = dedupeUpdateProvidersByDriver(matchedProviders);
  return {
    failedProviders: providers.filter((provider) => provider.updateState?.status === "failed"),
    unchangedProviders: providers.filter(
      (provider) => provider.updateState?.status === "unchanged",
    ),
  };
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

  const updateProviders = useMemo(() => dedupeUpdateProvidersByDriver(providers), [providers]);
  const notificationKey = useMemo(() => providerUpdateNotificationKey(providers), [providers]);
  const oneClickProviders = useMemo(
    () =>
      updateProviders.filter(
        (provider) =>
          provider.versionAdvisory?.canUpdate === true &&
          provider.updateState?.status !== "queued" &&
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

    const providerNames = formatProviderList(updateProviders);
    const title = getProviderUpdateToastTitle(updateProviders);
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
      void navigate({ to: "/settings/general", hash: "providers" });
    };

    const runUpdates = () => {
      if (updateStarted || oneClickProviders.length === 0 || !toastId) {
        return;
      }
      updateStarted = true;
      activeUpdatePromptRef.current = null;
      const attemptedProviderKinds = new Set(oneClickProviders.map((provider) => provider.driver));

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
          ensureLocalApi().server.updateProvider({ provider: provider.driver }),
        ),
      ).then((results) => {
        if (!toastId) {
          return;
        }

        const rejectedMessage = firstRejectedMessage(results);
        const { failedProviders, unchangedProviders } = collectUpdateOutcomeProviders(
          results,
          attemptedProviderKinds,
        );
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
        if (unchangedProviders.length > 0) {
          toastManager.update(
            toastId,
            stackedThreadToast({
              type: "warning",
              title:
                unchangedProviders.length === 1
                  ? "Provider still needs an update"
                  : "Providers still need updates",
              description: `${formatProviderList(unchangedProviders)} still appears outdated. Check provider settings for details.`,
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
          leadingIcon:
            updateProviders.length === 1 ? (
              <ProviderUpdateToastIcon provider={updateProviders[0]!.driver} />
            ) : undefined,
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
