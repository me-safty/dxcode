import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

export const desktopUpdateQueryKeys = {
  all: ["desktop", "update"] as const,
  state: () => ["desktop", "update", "state"] as const,
};

export function desktopUpdateStateQueryOptions() {
  return queryOptions({
    queryKey: desktopUpdateQueryKeys.state(),
    queryFn: async () => {
      const bridge = window.desktopBridge;
      if (!bridge || typeof bridge.getUpdateState !== "function") return null;
      return bridge.getUpdateState();
    },
    staleTime: Infinity,
    refetchOnMount: "always",
  });
}

export function useDesktopUpdateState() {
  const queryClient = useQueryClient();
  const query = useQuery(desktopUpdateStateQueryOptions());

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge || typeof bridge.onUpdateState !== "function") return;

    return bridge.onUpdateState((nextState) => {
      // Main-process update pushes are the source of truth. Do not write IPC
      // action result snapshots into this cache because they can lag a newer
      // UPDATE_STATE_CHANNEL transition.
      queryClient.setQueryData(desktopUpdateQueryKeys.state(), nextState);
    });
  }, [queryClient]);

  return query;
}
