import { useEffect, useState } from "react";

import { Button } from "../ui/button";

type PwaRegisterModule = {
  readonly registerSW: (options?: {
    readonly immediate?: boolean;
    readonly onNeedRefresh?: () => void;
    readonly onOfflineReady?: () => void;
  }) => (reloadPage?: boolean) => Promise<void>;
};

export function PwaUpdateBanner() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [updateServiceWorker, setUpdateServiceWorker] = useState<
    ((reloadPage?: boolean) => Promise<void>) | null
  >(null);

  useEffect(() => {
    if (!import.meta.env.PROD) {
      return;
    }

    let cancelled = false;

    void import("virtual:pwa-register")
      .then((module: PwaRegisterModule) => {
        if (cancelled) {
          return;
        }

        const update = module.registerSW({
          immediate: true,
          onNeedRefresh: () => {
            setNeedRefresh(true);
          },
        });
        setUpdateServiceWorker(() => update);
      })
      .catch(() => {
        // PWA registration is optional when the plugin did not emit the virtual module.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!needRefresh || !updateServiceWorker) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="pwa-update-banner"
      className="fixed top-0 inset-x-0 z-40 flex items-center justify-between gap-3 border-b border-border/60 bg-background/95 px-4 py-2.5 text-xs backdrop-blur-xl pt-[max(0.5rem,env(safe-area-inset-top))]"
    >
      <p className="text-foreground/90">Update available</p>
      <Button
        type="button"
        size="xs"
        variant="outline"
        onClick={() => {
          void updateServiceWorker(true);
        }}
      >
        Reload
      </Button>
    </div>
  );
}
