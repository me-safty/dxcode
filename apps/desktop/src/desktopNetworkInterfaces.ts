import * as OS from "node:os";

import { Context, Effect, Layer } from "effect";

import type { DesktopNetworkInterfaces } from "./serverExposure.ts";

export interface DesktopNetworkInterfacesServiceShape {
  readonly read: Effect.Effect<DesktopNetworkInterfaces>;
}

export class DesktopNetworkInterfacesService extends Context.Service<
  DesktopNetworkInterfacesService,
  DesktopNetworkInterfacesServiceShape
>()("t3/desktop/NetworkInterfaces") {}

export const DesktopNetworkInterfacesLive = Layer.succeed(DesktopNetworkInterfacesService, {
  read: Effect.sync(() => OS.networkInterfaces()),
} satisfies DesktopNetworkInterfacesServiceShape);
