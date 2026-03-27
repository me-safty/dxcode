import { type ServerProviderStatus } from "@t3tools/contracts";
import { memo, useCallback, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { CircleAlertIcon, CheckCircleIcon, RefreshCwIcon, LogInIcon } from "lucide-react";
import { Button } from "../ui/button";
import { ensureNativeApi } from "~/nativeApi";

function providerLabel(provider: string): string {
  return provider === "codex" ? "Codex" : provider === "claudeAgent" ? "Claude" : provider;
}

function statusIcon(status: ServerProviderStatus) {
  if (status.status === "ready") {
    return <CheckCircleIcon className="h-4 w-4 text-green-500" />;
  }
  return <CircleAlertIcon className="h-4 w-4" />;
}

function statusBadge(status: ServerProviderStatus) {
  const label = status.authStatus === "authenticated"
    ? "Authenticated"
    : status.authStatus === "unauthenticated"
      ? "Not authenticated"
      : status.available
        ? "Unknown auth"
        : "Not installed";
  const color = status.authStatus === "authenticated"
    ? "text-green-500"
    : status.authStatus === "unauthenticated"
      ? "text-red-400"
      : "text-yellow-500";
  return <span className={`text-xs font-medium ${color}`}>{label}</span>;
}

const ProviderStatusRow = memo(function ProviderStatusRow({
  status,
  onLogin,
  loginLoading,
}: {
  status: ServerProviderStatus;
  onLogin: () => void;
  loginLoading: boolean;
}) {
  const label = providerLabel(status.provider);
  const needsLogin = status.authStatus === "unauthenticated";

  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex items-center gap-2 min-w-0">
        {statusIcon(status)}
        <span className="text-sm font-medium">{label}</span>
        {statusBadge(status)}
      </div>
      {needsLogin && (
        <Button
          variant="outline"
          size="sm"
          onClick={onLogin}
          disabled={loginLoading}
          className="h-7 text-xs gap-1.5 shrink-0"
        >
          <LogInIcon className="h-3 w-3" />
          {loginLoading ? "Logging in…" : "Login"}
        </Button>
      )}
    </div>
  );
});

export const ProviderHealthBanner = memo(function ProviderHealthBanner({
  statuses,
  onStatusesUpdated,
}: {
  statuses: ReadonlyArray<ServerProviderStatus>;
  onStatusesUpdated?: (statuses: ServerProviderStatus[]) => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [loginProvider, setLoginProvider] = useState<string | null>(null);

  const hasIssue = statuses.some((s) => s.status !== "ready");
  const allReady = statuses.every((s) => s.status === "ready");

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const api = ensureNativeApi();
      const fresh = await api.provider.refreshStatus();
      onStatusesUpdated?.(fresh as ServerProviderStatus[]);
    } finally {
      setRefreshing(false);
    }
  }, [onStatusesUpdated]);

  const handleLogin = useCallback(
    async (provider: "codex" | "claudeAgent") => {
      setLoginProvider(provider);
      try {
        const api = ensureNativeApi();
        await api.provider.login({ provider });
        // Refresh statuses after login attempt
        const fresh = await api.provider.refreshStatus();
        onStatusesUpdated?.(fresh as ServerProviderStatus[]);
      } finally {
        setLoginProvider(null);
      }
    },
    [onStatusesUpdated],
  );

  if (statuses.length === 0) return null;

  return (
    <div className="pt-3 mx-auto max-w-3xl">
      <Alert variant={hasIssue ? (allReady ? undefined : "warning") : undefined}>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <AlertTitle className="flex items-center gap-2">
              Provider Status
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefresh}
                disabled={refreshing}
                className="h-6 w-6 p-0"
                title="Refresh status"
              >
                <RefreshCwIcon className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              </Button>
            </AlertTitle>
            <AlertDescription>
              <div className="mt-1 space-y-0.5">
                {statuses.map((s) => (
                  <ProviderStatusRow
                    key={s.provider}
                    status={s}
                    onLogin={() => handleLogin(s.provider as "codex" | "claudeAgent")}
                    loginLoading={loginProvider === s.provider}
                  />
                ))}
              </div>
            </AlertDescription>
          </div>
        </div>
      </Alert>
    </div>
  );
});
