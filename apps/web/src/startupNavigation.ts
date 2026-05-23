import type { ThreadId } from "@t3tools/contracts";

import type { NotificationNavigationTarget } from "./push/notificationNavigation";

export function shouldNavigateToStartupBootstrapThread(input: {
  readonly pathname: string;
  readonly bootstrapThreadId: ThreadId;
  readonly handledBootstrapThreadId: string | null;
  readonly lastNotificationNavigationTarget: NotificationNavigationTarget | null;
  readonly isStandalonePwa: boolean;
}): boolean {
  if (input.lastNotificationNavigationTarget !== null) {
    return false;
  }

  if (input.isStandalonePwa) {
    return false;
  }

  if (input.pathname !== "/") {
    return false;
  }

  return input.handledBootstrapThreadId !== input.bootstrapThreadId;
}
