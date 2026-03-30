import { ServiceMap } from "effect";

import type { ServerProviderShape } from "./ServerProvider";

export interface DroidProviderShape extends ServerProviderShape {}

export class DroidProvider extends ServiceMap.Service<DroidProvider, DroidProviderShape>()(
  "t3/provider/Services/DroidProvider",
) {}
