import { useEffect } from "react";

import { mergeProjectThreads } from "~/t3work/hooks/t3work-threadBridge";
import type { ProjectThread } from "~/t3work/t3work-types";

import { hydrateStoredThreads } from "./t3work-projectThreadPersistence";

export function useHydrateStoredThreads(input: {
  setThreads: React.Dispatch<React.SetStateAction<ProjectThread[]>>;
  setThreadsHydrated: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const { setThreads, setThreadsHydrated } = input;

  useEffect(() => {
    let cancelled = false;

    void hydrateStoredThreads()
      .then((threads) => {
        if (cancelled) {
          return;
        }

        setThreads((currentThreads) =>
          currentThreads.length === 0
            ? threads
            : mergeProjectThreads([...threads, ...currentThreads]),
        );
        setThreadsHydrated(true);
      })
      .catch(() => {
        if (!cancelled) {
          setThreadsHydrated(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [setThreads, setThreadsHydrated]);
}
