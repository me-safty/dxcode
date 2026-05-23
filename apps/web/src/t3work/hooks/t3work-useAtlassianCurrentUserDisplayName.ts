import { useEffect, useState } from "react";

import { useBackend } from "~/t3work/backend/t3work-index";

export function useAtlassianCurrentUserDisplayName(accountId?: string): string | undefined {
  const backend = useBackend();
  const [displayName, setDisplayName] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    if (!backend || !accountId) {
      setDisplayName(undefined);
      return () => {
        cancelled = true;
      };
    }

    void backend.atlassian
      .listAccounts()
      .then((accounts) => {
        if (cancelled) return;
        setDisplayName(accounts.find((account) => account.id === accountId)?.label);
      })
      .catch(() => {
        if (cancelled) return;
        setDisplayName(undefined);
      });

    return () => {
      cancelled = true;
    };
  }, [accountId, backend]);

  return displayName;
}
