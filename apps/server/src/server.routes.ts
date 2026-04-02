import { Layer } from "effect";

import { attachmentsRouteLayer, projectFaviconRouteLayer, staticAndDevRouteLayer } from "./http";
import { websocketRpcRouteLayer } from "./ws";

export const makeRoutesLayer = Layer.mergeAll(
  attachmentsRouteLayer,
  projectFaviconRouteLayer,
  staticAndDevRouteLayer,
  websocketRpcRouteLayer,
);
