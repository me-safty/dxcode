import type { ExecutionEnvironmentWebClient } from "@t3tools/contracts";

type MobileWebClientHintProps = {
  readonly webClient: ExecutionEnvironmentWebClient | undefined;
};

export function MobileWebClientHint({ webClient }: MobileWebClientHintProps) {
  if (webClient === "vite-dev-proxy") {
    return (
      <div
        data-testid="mobile-access-live-dev-hint"
        className="mb-3 space-y-1.5 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5"
      >
        <p className="inline-flex items-center gap-1.5 text-[11px] font-medium text-foreground">
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-primary uppercase">
            Live dev
          </span>
        </p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          UI updates when you refresh on your phone. No reinstall needed.
        </p>
      </div>
    );
  }

  if (webClient === "static-bundle") {
    return (
      <div
        data-testid="mobile-access-static-bundle-hint"
        className="mb-3 space-y-1.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5"
      >
        <p className="text-[11px] font-medium text-foreground">Production build</p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Rebuild the web and server client after UI changes, then refresh or reinstall the app on
          your phone.
        </p>
        <p className="font-mono text-[10px] text-muted-foreground/70">
          apps/web: bun run build · apps/server: bun run build
        </p>
      </div>
    );
  }

  return null;
}
