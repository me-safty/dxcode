import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as Electron from "electron";

const MAX_ACTIVE_NOTIFICATIONS = 64;

export interface ElectronNotificationInput {
  readonly key: string;
  readonly title: string;
  readonly body: string;
  readonly silent: boolean;
  readonly onClick: () => void;
  readonly onFailed: () => void;
}

export class ElectronNotificationError extends Schema.TaggedErrorClass<ElectronNotificationError>()(
  "ElectronNotificationError",
  {
    operation: Schema.Literals(["check-support", "show"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Desktop notification ${this.operation} failed.`;
  }
}

export class ElectronNotification extends Context.Service<
  ElectronNotification,
  {
    readonly isSupported: Effect.Effect<boolean, ElectronNotificationError>;
    readonly show: (
      input: ElectronNotificationInput,
    ) => Effect.Effect<void, ElectronNotificationError>;
  }
>()("@t3tools/desktop/electron/ElectronNotification") {}

function pruneNotifications(notifications: Map<string, Electron.Notification>): void {
  while (notifications.size > MAX_ACTIVE_NOTIFICATIONS) {
    const oldestKey = notifications.keys().next().value;
    if (oldestKey === undefined) return;
    notifications.delete(oldestKey);
  }
}

export const make = Effect.sync(() => {
  const activeNotifications = new Map<string, Electron.Notification>();
  return ElectronNotification.of({
    isSupported: Effect.try({
      try: () => Electron.Notification.isSupported(),
      catch: (cause) => new ElectronNotificationError({ operation: "check-support", cause }),
    }),
    show: (input) =>
      Effect.try({
        try: () => {
          const notification = new Electron.Notification({
            title: input.title,
            body: input.body,
            silent: input.silent,
          });
          const cleanup = () => activeNotifications.delete(input.key);
          notification.once("click", () => {
            cleanup();
            input.onClick();
          });
          notification.once("close", cleanup);
          notification.once("failed", () => {
            cleanup();
            input.onFailed();
          });
          activeNotifications.set(input.key, notification);
          pruneNotifications(activeNotifications);
          notification.show();
        },
        catch: (cause) => new ElectronNotificationError({ operation: "show", cause }),
      }),
  });
});

export const layer = Layer.effect(ElectronNotification, make);
