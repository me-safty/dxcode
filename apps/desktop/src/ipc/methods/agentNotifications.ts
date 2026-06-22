import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Electron from "electron";

import { ElectronWindow } from "../../electron/ElectronWindow.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

const AgentNotificationRequest = Schema.Struct({
  title: Schema.String,
  body: Schema.String,
  threadId: Schema.String,
  environmentId: Schema.String,
});

// Retain references so notifications are not garbage-collected before the user
// clicks them (Electron does not keep them alive on its own).
const activeNotifications = new Set<Electron.Notification>();

export const showAgentNotification = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SHOW_AGENT_NOTIFICATION_CHANNEL,
  payload: AgentNotificationRequest,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.agentNotifications.show")(function* (request) {
    const electronWindow = yield* ElectronWindow;
    const targetWindow = Option.getOrNull(yield* electronWindow.currentMainOrFirst);

    yield* Effect.sync(() => {
      const notification = new Electron.Notification({
        title: request.title,
        body: request.body,
        silent: true,
      });
      activeNotifications.add(notification);
      notification.on("close", () => activeNotifications.delete(notification));
      notification.on("click", () => {
        activeNotifications.delete(notification);
        if (targetWindow === null || targetWindow.isDestroyed()) return;
        if (targetWindow.isMinimized()) targetWindow.restore();
        if (!targetWindow.isVisible()) targetWindow.show();
        if (process.platform === "darwin") Electron.app.focus({ steal: true });
        targetWindow.focus();
        targetWindow.webContents.send(IpcChannels.AGENT_NOTIFICATION_CLICKED_CHANNEL, {
          threadId: request.threadId,
          environmentId: request.environmentId,
        });
      });
      notification.show();
    });
  }),
});

export const playSystemSound = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PLAY_SYSTEM_SOUND_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.agentNotifications.beep")(function* () {
    yield* Effect.sync(() => {
      Electron.shell.beep();
    });
  }),
});
