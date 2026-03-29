import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/settings/about")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/general", replace: true });
  },
});
