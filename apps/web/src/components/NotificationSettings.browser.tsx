import "../index.css";

import {
  ORCHESTRATION_WS_METHODS,
  type OrchestrationReadModel,
  type ProjectId,
  type ServerConfig,
  type ThreadId,
  type WsWelcomePayload,
  WS_CHANNELS,
  WS_METHODS,
} from "@t3tools/contracts";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { ws, http, HttpResponse } from "msw";
import { setupWorker } from "msw/browser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { getRouter } from "../router";

const PROJECT_ID = "project-settings" as ProjectId;
const THREAD_ID = "thread-settings" as ThreadId;
const NOW_ISO = "2026-03-16T12:00:00.000Z";
const APP_SETTINGS_STORAGE_KEY = "t3code:app-settings:v1";

interface TestFixture {
  snapshot: OrchestrationReadModel;
  serverConfig: ServerConfig;
  welcome: WsWelcomePayload;
}

type NotificationStub = {
  permission: NotificationPermission;
  requestPermission: ReturnType<typeof vi.fn<() => Promise<NotificationPermission>>>;
};

function NotificationStubConstructor(
  this: Notification,
  _title: string,
  _options?: NotificationOptions,
) {}

let fixture: TestFixture;
let pushSequence = 1;

const wsLink = ws.link(/ws(s)?:\/\/.*/);

function createSnapshot(): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    updatedAt: NOW_ISO,
    projects: [
      {
        id: PROJECT_ID,
        title: "Project",
        workspaceRoot: "/repo/project",
        defaultModel: "gpt-5.4",
        scripts: [],
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: THREAD_ID,
        projectId: PROJECT_ID,
        title: "Thread",
        model: "gpt-5.4",
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: "main",
        worktreePath: null,
        latestTurn: null,
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        deletedAt: null,
        messages: [],
        activities: [],
        proposedPlans: [],
        checkpoints: [],
        session: {
          threadId: THREAD_ID,
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: NOW_ISO,
        },
      },
    ],
  };
}

function createServerConfig(): ServerConfig {
  return {
    cwd: "/repo/project",
    keybindingsConfigPath: "/repo/project/.t3code-keybindings.json",
    keybindings: [],
    issues: [],
    providers: [
      {
        provider: "codex",
        status: "ready",
        available: true,
        authStatus: "authenticated",
        checkedAt: NOW_ISO,
      },
    ],
    availableEditors: [],
  };
}

function buildFixture(): TestFixture {
  return {
    snapshot: createSnapshot(),
    serverConfig: createServerConfig(),
    welcome: {
      cwd: "/repo/project",
      projectName: "Project",
      bootstrapProjectId: PROJECT_ID,
      bootstrapThreadId: THREAD_ID,
    },
  };
}

function resolveWsRpc(tag: string): unknown {
  if (tag === ORCHESTRATION_WS_METHODS.getSnapshot) {
    return fixture.snapshot;
  }
  if (tag === WS_METHODS.serverGetConfig) {
    return fixture.serverConfig;
  }
  if (tag === WS_METHODS.gitListBranches) {
    return {
      isRepo: true,
      hasOriginRemote: true,
      branches: [{ name: "main", current: true, isDefault: true, worktreePath: null }],
    };
  }
  if (tag === WS_METHODS.gitStatus) {
    return {
      branch: "main",
      hasWorkingTreeChanges: false,
      workingTree: { files: [], insertions: 0, deletions: 0 },
      hasUpstream: true,
      aheadCount: 0,
      behindCount: 0,
      pr: null,
    };
  }
  if (tag === WS_METHODS.projectsSearchEntries) {
    return { entries: [], truncated: false };
  }
  return {};
}

const worker = setupWorker(
  wsLink.addEventListener("connection", ({ client }) => {
    pushSequence = 1;
    client.send(
      JSON.stringify({
        type: "push",
        sequence: pushSequence++,
        channel: WS_CHANNELS.serverWelcome,
        data: fixture.welcome,
      }),
    );
    client.addEventListener("message", (event) => {
      const rawData = event.data;
      if (typeof rawData !== "string") {
        return;
      }

      let request: { id: string; body: { _tag: string } };
      try {
        request = JSON.parse(rawData);
      } catch {
        return;
      }

      const method = request.body?._tag;
      if (typeof method !== "string") {
        return;
      }

      client.send(
        JSON.stringify({
          id: request.id,
          result: resolveWsRpc(method),
        }),
      );
    });
  }),
  http.get("*/api/project-favicon", () => new HttpResponse(null, { status: 204 })),
);

async function waitForElement<T extends Element>(
  query: () => T | null,
  errorMessage: string,
): Promise<T> {
  let element: T | null = null;
  await vi.waitFor(
    () => {
      element = query();
      expect(element, errorMessage).toBeTruthy();
    },
    { timeout: 8_000, interval: 16 },
  );
  return element!;
}

async function mountSettingsRoute(): Promise<{ cleanup: () => Promise<void> }> {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.inset = "0";
  document.body.appendChild(host);

  const router = getRouter(createMemoryHistory({ initialEntries: ["/settings"] }));
  const screen = await render(<RouterProvider router={router} />, { container: host });
  await waitForElement(
    () => document.querySelector<HTMLElement>('[aria-label="System notifications"]'),
    "Settings page should render the notifications switch",
  );

  return {
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

function readStoredSettings(): Record<string, unknown> | null {
  const raw = window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

function createNotificationStub(
  nextPermission: NotificationPermission,
): NotificationStub & typeof Notification {
  const stub = NotificationStubConstructor as unknown as NotificationStub & typeof Notification;
  stub.permission = "default";
  stub.requestPermission = vi.fn(async () => {
    stub.permission = nextPermission;
    return nextPermission;
  });
  return stub;
}

beforeAll(async () => {
  await worker.start({
    serviceWorker: {
      url: "/mockServiceWorker.js",
    },
  });
});

afterAll(async () => {
  await worker.stop();
});

beforeEach(() => {
  fixture = buildFixture();
  pushSequence = 1;
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("notification settings", () => {
  it("requests notification permission and persists enabled state only when granted", async () => {
    const fakeNotification = createNotificationStub("granted");

    vi.stubGlobal("Notification", fakeNotification);

    const { cleanup } = await mountSettingsRoute();
    try {
      const switchEl = await waitForElement(
        () => document.querySelector<HTMLElement>('[aria-label="System notifications"]'),
        "System notifications switch should exist",
      );

      switchEl.click();

      await vi.waitFor(() => {
        expect(fakeNotification.requestPermission).toHaveBeenCalledTimes(1);
        expect(switchEl.getAttribute("aria-checked")).toBe("true");
        expect(readStoredSettings()?.enableSystemNotifications).toBe(true);
      });
    } finally {
      await cleanup();
    }
  });

  it("keeps notifications disabled when permission is denied", async () => {
    const fakeNotification = createNotificationStub("denied");

    vi.stubGlobal("Notification", fakeNotification);

    const { cleanup } = await mountSettingsRoute();
    try {
      const switchEl = await waitForElement(
        () => document.querySelector<HTMLElement>('[aria-label="System notifications"]'),
        "System notifications switch should exist",
      );

      switchEl.click();

      await vi.waitFor(() => {
        expect(fakeNotification.requestPermission).toHaveBeenCalledTimes(1);
        expect(switchEl.getAttribute("aria-checked")).toBe("false");
        expect(readStoredSettings()?.enableSystemNotifications ?? false).toBe(false);
      });
    } finally {
      await cleanup();
    }
  });
});
