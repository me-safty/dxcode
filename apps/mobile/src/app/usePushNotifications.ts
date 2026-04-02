import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { useEffect, useState } from "react";
import { Platform } from "react-native";

const DEFAULT_ANDROID_CHANNEL_ID = "default";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export interface PushNotificationsState {
  readonly expoPushToken: string | null;
  readonly permissionStatus: Notifications.PermissionStatus | null;
  readonly lastNotification: Notifications.Notification | null;
  readonly lastNotificationResponse: Notifications.NotificationResponse | null;
}

function easProjectId(): string | null {
  const extra = Constants.expoConfig?.extra;
  const eas = extra?.eas;

  if (!eas || typeof eas !== "object" || !("projectId" in eas)) {
    return null;
  }

  return typeof eas.projectId === "string" ? eas.projectId : null;
}

async function configureAndroidNotificationChannel(): Promise<void> {
  if (Platform.OS !== "android") {
    return;
  }

  await Notifications.setNotificationChannelAsync(DEFAULT_ANDROID_CHANNEL_ID, {
    name: "Default",
    importance: Notifications.AndroidImportance.DEFAULT,
    showBadge: true,
    enableVibrate: true,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#E6F4FE",
  });
}

async function registerForPushNotificationsAsync(): Promise<{
  expoPushToken: string | null;
  permissionStatus: Notifications.PermissionStatus;
}> {
  await configureAndroidNotificationChannel();

  const existingPermissions = await Notifications.getPermissionsAsync();
  let permissionStatus = existingPermissions.status;

  if (permissionStatus !== "granted") {
    const requestedPermissions = await Notifications.requestPermissionsAsync();
    permissionStatus = requestedPermissions.status;
  }

  if (permissionStatus !== "granted") {
    return {
      expoPushToken: null,
      permissionStatus,
    };
  }

  const projectId = easProjectId();
  if (!projectId) {
    return {
      expoPushToken: null,
      permissionStatus,
    };
  }

  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    return {
      expoPushToken: token.data,
      permissionStatus,
    };
  } catch {
    return {
      expoPushToken: null,
      permissionStatus,
    };
  }
}

export function usePushNotifications(): PushNotificationsState {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<Notifications.PermissionStatus | null>(
    null,
  );
  const [lastNotification, setLastNotification] = useState<Notifications.Notification | null>(null);
  const [lastNotificationResponse, setLastNotificationResponse] =
    useState<Notifications.NotificationResponse | null>(null);

  useEffect(() => {
    let isMounted = true;

    void registerForPushNotificationsAsync().then((registration) => {
      if (!isMounted) {
        return;
      }

      setExpoPushToken(registration.expoPushToken);
      setPermissionStatus(registration.permissionStatus);
    });

    const notificationSubscription = Notifications.addNotificationReceivedListener(
      (notification) => {
        setLastNotification(notification);
      },
    );
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        setLastNotification(response.notification);
        setLastNotificationResponse(response);
      },
    );

    return () => {
      isMounted = false;
      notificationSubscription.remove();
      responseSubscription.remove();
    };
  }, []);

  return {
    expoPushToken,
    permissionStatus,
    lastNotification,
    lastNotificationResponse,
  };
}
