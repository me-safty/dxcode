import { Link } from "@tanstack/react-router";
import { CloudOffIcon, KeyRoundIcon } from "lucide-react";
import type { ReactNode } from "react";

import { APP_DISPLAY_NAME } from "~/branding";
import { AUTH_COMPLETE_ROUTE } from "~/authRoutes";
import { Button } from "../ui/button";

interface AuthRouteShellProps {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}

export function AuthRouteShell({
  eyebrow,
  title,
  description,
  children,
  footer,
}: AuthRouteShellProps) {
  return (
    <main className="grid min-h-dvh bg-background text-foreground lg:grid-cols-[minmax(0,0.95fr)_minmax(360px,0.7fr)]">
      <section className="flex min-h-0 flex-col justify-between border-border border-b bg-card/40 px-6 py-6 lg:border-r lg:border-b-0 lg:px-10 lg:py-9">
        <div>
          <Link
            aria-label={`Back to ${APP_DISPLAY_NAME}`}
            className="inline-flex items-center gap-2 rounded-md text-sm font-semibold outline-none ring-ring focus-visible:ring-2"
            to={AUTH_COMPLETE_ROUTE}
          >
            <span className="flex size-7 items-center justify-center rounded-lg border bg-background text-[13px] shadow-sm/5">
              P
            </span>
            <span>{APP_DISPLAY_NAME}</span>
          </Link>
        </div>

        <div className="my-14 max-w-xl lg:my-0">
          <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
            {eyebrow}
          </p>
          <h1 className="mt-4 text-balance font-semibold text-4xl tracking-tight sm:text-5xl">
            {title}
          </h1>
          <p className="mt-4 max-w-lg text-base leading-7 text-muted-foreground">{description}</p>
        </div>

        <p className="max-w-md text-xs leading-5 text-muted-foreground/75">
          Your local pathwayOS pairing stays separate from your cloud account. Clerk only manages
          identity, profile, and pathwayOS Connect access.
        </p>
      </section>

      <section className="flex min-h-0 items-center justify-center px-4 py-8 sm:px-8">
        <div className="w-full max-w-md">
          <div className="rounded-xl border bg-card p-4 shadow-sm/5 sm:p-5">{children}</div>
          {footer ? (
            <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

export function AuthUnavailableState() {
  return (
    <AuthRouteShell
      description="This build does not include the public Clerk configuration needed for pathwayOS account sign-in."
      eyebrow="Account unavailable"
      title="Cloud account sign-in is not configured"
      footer={
        <Button render={<Link to={AUTH_COMPLETE_ROUTE} />} size="sm" variant="outline">
          Return to pathwayOS
        </Button>
      }
    >
      <div className="flex items-start gap-3 rounded-lg border border-warning/25 bg-warning/8 p-3 text-sm">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background text-warning-foreground">
          <CloudOffIcon className="size-4" />
        </div>
        <div>
          <p className="font-medium text-foreground">Clerk is disabled for this build.</p>
          <p className="mt-1 text-muted-foreground">
            Add the public Clerk publishable key to enable account screens.
          </p>
        </div>
      </div>
    </AuthRouteShell>
  );
}

export function AuthComponentFallback({ label }: { readonly label: string }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
      <div className="flex size-10 items-center justify-center rounded-lg border bg-muted/40 text-muted-foreground">
        <KeyRoundIcon className="size-4" />
      </div>
      <p className="text-sm font-medium text-foreground">{label}</p>
      <p className="max-w-xs text-sm text-muted-foreground">Clerk is preparing the account flow.</p>
    </div>
  );
}
