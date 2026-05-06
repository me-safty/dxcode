import type { DesktopEnvironmentBootstrap } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as DesktopBackendManager from "../desktopBackendManager.ts";

export interface DesktopLocalEnvironmentShape {
  readonly bootstrap: Effect.Effect<Option.Option<DesktopEnvironmentBootstrap>>;
}

export class DesktopLocalEnvironment extends Context.Service<
  DesktopLocalEnvironment,
  DesktopLocalEnvironmentShape
>()("t3/desktop/LocalEnvironment") {}

function toWebSocketBaseUrl(httpBaseUrl: URL): string {
  const url = new URL(httpBaseUrl.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

export const layer = Layer.effect(
  DesktopLocalEnvironment,
  Effect.gen(function* () {
    const backendManager = yield* DesktopBackendManager.DesktopBackendManager;

    return DesktopLocalEnvironment.of({
      bootstrap: backendManager.currentConfig.pipe(
        Effect.map(
          // oxlint-disable-next-line oxc/no-map-spread
          Option.map((config) => {
            const bootstrap = config.bootstrap;
            return {
              label: "Local environment",
              httpBaseUrl: config.httpBaseUrl.href,
              wsBaseUrl: toWebSocketBaseUrl(config.httpBaseUrl),
              ...(bootstrap.desktopBootstrapToken
                ? { bootstrapToken: bootstrap.desktopBootstrapToken }
                : {}),
            };
          }),
        ),
      ),
    });
  }),
);
