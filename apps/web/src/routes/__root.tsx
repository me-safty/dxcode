import { QueryClient } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  type ErrorComponentProps,
  useLocation,
} from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { APP_DISPLAY_NAME } from "../branding";
import { StartupPendingSurface } from "../components/StartupPendingSurface";
import {
  ensurePrimaryEnvironmentReady,
  resolveInitialServerAuthGateState,
} from "../environments/primary";

const LazyRootAuthenticatedShell = lazy(async () => {
  const module = await import("../components/RootAuthenticatedShell");
  return { default: module.RootAuthenticatedShell };
});

const LazyRootAuthenticatedShellError = lazy(async () => {
  const module = await import("../components/RootAuthenticatedShell");
  return { default: module.RootAuthenticatedShellError };
});

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  beforeLoad: async () => {
    const [, authGateState] = await Promise.all([
      ensurePrimaryEnvironmentReady(),
      resolveInitialServerAuthGateState(),
    ]);
    return {
      authGateState,
    };
  },
  component: RootRouteView,
  errorComponent: RootRouteErrorView,
  pendingComponent: RootRoutePendingView,
  head: () => ({
    meta: [{ name: "title", content: APP_DISPLAY_NAME }],
  }),
});

function RootRouteView() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const { authGateState } = Route.useRouteContext();

  if (pathname === "/pair") {
    return <Outlet />;
  }

  if (authGateState.status !== "authenticated") {
    return <Outlet />;
  }

  return (
    <Suspense fallback={<RootRoutePendingView />}>
      <LazyRootAuthenticatedShell />
    </Suspense>
  );
}

function RootRouteErrorView(props: ErrorComponentProps) {
  return (
    <Suspense fallback={<RootRoutePendingView />}>
      <LazyRootAuthenticatedShellError error={props.error} reset={props.reset} />
    </Suspense>
  );
}

function RootRoutePendingView() {
  return <StartupPendingSurface />;
}
