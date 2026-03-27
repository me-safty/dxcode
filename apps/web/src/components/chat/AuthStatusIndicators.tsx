import type { ServerProviderStatus, ServiceAuthStatus } from "@t3tools/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { serverConfigQueryOptions } from "~/lib/serverReactQuery";
import { readNativeApi } from "~/nativeApi";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

type AuthItem = {
  id: string;
  label: string;
  authenticated: boolean;
  available: boolean;
  message?: string | undefined;
  loginAction?: (() => Promise<void>) | undefined;
};

function useAuthItems(): AuthItem[] {
  const { data: config } = useQuery(serverConfigQueryOptions());
  const queryClient = useQueryClient();
  const [loggingIn, setLoggingIn] = useState<string | null>(null);

  const loginProvider = useCallback(
    async (provider: "codex" | "claudeAgent") => {
      const api = readNativeApi();
      if (!api || loggingIn) return;
      setLoggingIn(provider);
      try {
        await api.provider.login({ provider });
        await api.provider.refreshStatus();
        await queryClient.invalidateQueries({ queryKey: ["server", "config"] });
      } finally {
        setLoggingIn(null);
      }
    },
    [loggingIn, queryClient],
  );

  if (!config) return [];

  const items: AuthItem[] = [];

  for (const p of config.providers) {
    items.push({
      id: `provider-${p.provider}`,
      label: p.provider === "codex" ? "Codex" : p.provider === "claudeAgent" ? "Claude" : p.provider,
      authenticated: p.authStatus === "authenticated",
      available: p.available,
      message: p.message,
      loginAction:
        p.authStatus !== "authenticated" && (p.provider === "codex" || p.provider === "claudeAgent")
          ? () => loginProvider(p.provider as "codex" | "claudeAgent")
          : undefined,
    });
  }

  for (const s of config.services) {
    items.push({
      id: `service-${s.service}`,
      label: s.service === "gmail" ? "Gmail" : s.service === "jira" ? "Jira" : s.service === "calendar" ? "Calendar" : s.service,
      authenticated: s.authenticated,
      available: s.available,
      message: s.message,
    });
  }

  return items;
}

export function AuthStatusIndicators() {
  const items = useAuthItems();

  if (items.length === 0) return null;

  const allAuthed = items.every((i) => i.authenticated);
  const noneAuthed = items.every((i) => !i.authenticated);

  return (
    <div className="flex shrink-0 items-center gap-1">
      {items.map((item) => (
        <Tooltip key={item.id}>
          <TooltipTrigger
            render={
              <span
                role="button"
                tabIndex={0}
                className={`inline-flex size-5 items-center justify-center rounded-md transition-colors ${item.loginAction ? "cursor-pointer hover:bg-accent" : "cursor-default"}`}
                onClick={item.loginAction ? () => void item.loginAction!() : undefined}
                aria-label={`${item.label}: ${item.authenticated ? "authenticated" : "not authenticated"}`}
              >
                <span
                  className={`inline-block size-2 rounded-full ${
                    item.authenticated
                      ? "bg-emerald-500"
                      : item.available
                        ? "bg-amber-500"
                        : "bg-red-500"
                  }`}
                />
              </span>
            }
          />
          <TooltipPopup side="bottom">
            <span className="font-medium">{item.label}</span>
            {" — "}
            {item.authenticated ? (
              <span className="text-emerald-400">authenticated</span>
            ) : (
              <span className="text-amber-400">not authenticated</span>
            )}
            {item.message && (
              <span className="block text-[10px] text-muted-foreground">{item.message}</span>
            )}
            {item.loginAction && !item.authenticated && (
              <span className="block text-[10px] text-muted-foreground">Click to log in</span>
            )}
          </TooltipPopup>
        </Tooltip>
      ))}
    </div>
  );
}
