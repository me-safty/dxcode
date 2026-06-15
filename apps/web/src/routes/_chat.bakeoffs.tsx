import { createFileRoute } from "@tanstack/react-router";

import { BakeoffsView } from "../components/RunsView";

export const Route = createFileRoute("/_chat/bakeoffs")({
  component: BakeoffsView,
});
