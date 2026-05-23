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

function normalizePathname(pathname) {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function clientMatchesNotificationUrl(clientUrl, notificationUrl) {
  try {
    const client = new URL(clientUrl);
    const target = new URL(notificationUrl);
    return (
      client.origin === target.origin &&
      normalizePathname(client.pathname) === normalizePathname(target.pathname) &&
      client.search === target.search &&
      client.hash === target.hash
    );
  } catch {
    return false;
  }
}

async function openNotificationUrl(url) {
  const clients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  const sameOriginClients = clients.filter((client) => isSameOriginUrl(client.url));
  if (sameOriginClients.length === 0) {
    return self.clients.openWindow(url);
  }

  const targetClient = selectNotificationClient(sameOriginClients, url);
  return focusClientAndPostNotificationClick(targetClient, url);
}

async function focusClientAndPostNotificationClick(client, url) {
  if ("focus" in client) {
    const focusedClient = await client.focus();
    postNotificationClickMessage(focusedClient || client, url);
    return focusedClient;
  }

  postNotificationClickMessage(client, url);
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

function selectNotificationClient(sameOriginClients, url) {
  return (
    sameOriginClients.find((client) => clientMatchesNotificationUrl(client.url, url)) ||
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
