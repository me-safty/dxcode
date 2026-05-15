import { createFileRoute } from "@tanstack/react-router";
import { T3workRouteSurface } from "~/t3work/t3work-route-surface";

export const Route = createFileRoute("/t3work/projects/$projectId/threads/$threadId")({
  component: T3workRouteSurface,
});
