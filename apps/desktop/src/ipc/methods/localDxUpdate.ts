import { DxLocalInstallInput, DxLocalInstallResult } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as LocalDxInstaller from "../../localUpdate/LocalDxInstaller.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const installLocalDxUpdate = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.DX_LOCAL_UPDATE_INSTALL_CHANNEL,
  payload: DxLocalInstallInput,
  result: DxLocalInstallResult,
  handler: Effect.fn("desktop.ipc.localDxUpdate.install")(function* (input) {
    const installer = yield* LocalDxInstaller.LocalDxInstaller;
    return yield* installer.install(input);
  }),
});
