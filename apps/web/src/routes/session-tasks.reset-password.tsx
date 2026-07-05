import { TaskResetPassword } from "@clerk/react";
import { createFileRoute } from "@tanstack/react-router";

import { AUTH_COMPLETE_ROUTE, getClerkRouteUrl } from "~/authRoutes";
import {
  AuthComponentFallback,
  AuthRouteShell,
  AuthUnavailableState,
} from "~/components/auth/AuthRouteShell";
import { hasClerkPublicConfig } from "~/cloud/publicConfig";
import { isElectron } from "~/env";

export const Route = createFileRoute("/session-tasks/reset-password")({
  component: ResetPasswordTaskRouteView,
});

function ResetPasswordTaskRouteView() {
  if (!hasClerkPublicConfig()) {
    return <AuthUnavailableState />;
  }

  const authCompleteUrl = getClerkRouteUrl(AUTH_COMPLETE_ROUTE, isElectron);

  return (
    <AuthRouteShell
      description="Finish the required password reset before returning to pathwayOS."
      eyebrow="Required task"
      title="Reset your password"
    >
      <TaskResetPassword
        fallback={<AuthComponentFallback label="Loading password reset..." />}
        redirectUrlComplete={authCompleteUrl}
      />
    </AuthRouteShell>
  );
}
