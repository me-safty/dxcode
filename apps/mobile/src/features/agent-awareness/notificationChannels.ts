import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export const ANDROID_ACTIVITY_CHANNEL_ID = "t3-connect-activity";
export const ANDROID_ALERTS_CHANNEL_ID = "t3-connect-alerts";

let configured = false;

export async function configureAgentAwarenessNotificationChannels(): Promise<void> {
  if (configured || Platform.OS !== "android") return;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      // Background delivery follows the selected Android channel. Avoid a
      // second sound decision when Expo invokes this handler in the foreground.
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  await Promise.all([
    Notifications.setNotificationChannelAsync(ANDROID_ACTIVITY_CHANNEL_ID, {
      name: "T3 Connect activity",
      description: "Quiet live status updates for active T3 Code agents.",
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: null,
      vibrationPattern: null,
      showBadge: false,
    }),
    Notifications.setNotificationChannelAsync(ANDROID_ALERTS_CHANNEL_ID, {
      name: "T3 Connect alerts",
      description: "Approvals, input requests, completions, and failures.",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
      vibrationPattern: [0, 250, 150, 250],
      showBadge: true,
    }),
  ]);
  configured = true;
}
