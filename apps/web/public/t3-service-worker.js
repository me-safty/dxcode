const DEFAULT_NOTIFICATION_TITLE = "T3 Code";
const DEFAULT_NOTIFICATION_URL = "/";
const NOTIFICATION_CLICK_MESSAGE_TYPE = "t3.notification-click";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  const payload = readPushPayload(event);
  const title = payload.title || DEFAULT_NOTIFICATION_TITLE;
  const notification = {
    body: payload.body || undefined,
    icon: "/pwa-192.png",
    badge: "/pwa-192.png",
    tag: payload.tag || "t3code",
    data: {
      url: payload.url || DEFAULT_NOTIFICATION_URL,
    },
  };

  event.waitUntil(self.registration.showNotification(title, notification));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = resolveNotificationUrl(event.notification.data?.url);

  event.waitUntil(openNotificationUrl(url));
});

function readPushPayload(event) {
  if (!event.data) {
    return {};
  }

  try {
    return event.data.json();
  } catch {
    return {};
  }
}

function resolveNotificationUrl(rawUrl) {
  try {
    const url = new URL(rawUrl || DEFAULT_NOTIFICATION_URL, self.location.origin);
    return url.origin === self.location.origin
      ? url.href
      : new URL(DEFAULT_NOTIFICATION_URL, self.location.origin).href;
  } catch {
    return new URL(DEFAULT_NOTIFICATION_URL, self.location.origin).href;
  }
}

async function openNotificationUrl(url) {
  const clients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  const targetClient = selectNotificationClient(clients, url);

  if (!targetClient) {
    return self.clients.openWindow(url);
  }

  if ("focus" in targetClient) {
    const focusedClient = await targetClient.focus();
    postNotificationClickMessage(focusedClient || targetClient, url);
    return focusedClient;
  }

  postNotificationClickMessage(targetClient, url);
  return undefined;
}

function postNotificationClickMessage(client, url) {
  if (!client || !("postMessage" in client)) {
    return;
  }

  const message = {
    type: NOTIFICATION_CLICK_MESSAGE_TYPE,
    url,
    openedAt: Date.now(),
  };

  // Client.postMessage from a service worker does not accept a target origin.
  // oxlint-disable-next-line require-post-message-target-origin
  client.postMessage(message);
}

function selectNotificationClient(clients, url) {
  const sameOriginClients = clients.filter((client) => isSameOriginUrl(client.url));
  return (
    sameOriginClients.find((client) => client.url === url) ||
    sameOriginClients.find((client) => client.focused) ||
    sameOriginClients.find((client) => client.visibilityState === "visible") ||
    sameOriginClients[0] ||
    null
  );
}

function isSameOriginUrl(url) {
  try {
    return new URL(url).origin === self.location.origin;
  } catch {
    return false;
  }
}
