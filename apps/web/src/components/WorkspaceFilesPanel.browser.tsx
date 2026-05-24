import "../index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EnvironmentId, type EnvironmentApi } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { createElement, type ReactNode } from "react";

import {
  __resetEnvironmentApiOverridesForTests,
  __setEnvironmentApiOverrideForTests,
} from "../environmentApi";
import {
  __resetWorkspaceFilePanelStateForTests,
  openWorkspaceFileExplorer,
  openWorkspaceFilePreview,
} from "../workspaceFilePreview";
import { WorkspaceFilesPanel } from "./WorkspaceFilesPanel";

vi.mock("../environments/runtime", () => ({
  addSavedEnvironment: vi.fn(),
  connectDesktopSshEnvironment: vi.fn(),
  disconnectSavedEnvironment: vi.fn(),
  ensureEnvironmentConnectionBootstrapped: vi.fn(),
  getEnvironmentHttpBaseUrl: vi.fn(() => "http://environment.test"),
  getPrimaryEnvironmentConnection: vi.fn(() => null),
  getSavedEnvironmentRecord: vi.fn(() => null),
  getSavedEnvironmentRuntimeState: vi.fn(() => null),
  hasSavedEnvironmentRegistryHydrated: vi.fn(() => true),
  listSavedEnvironmentRecords: vi.fn(() => []),
  readEnvironmentConnection: vi.fn(() => null),
  reconnectSavedEnvironment: vi.fn(),
  removeSavedEnvironment: vi.fn(),
  requireEnvironmentConnection: vi.fn(() => {
    throw new Error("Environment connection not found.");
  }),
  resetEnvironmentServiceForTests: vi.fn(),
  resetSavedEnvironmentRegistryStoreForTests: vi.fn(),
  resetSavedEnvironmentRuntimeStoreForTests: vi.fn(),
  resolveEnvironmentHttpUrl: vi.fn(),
  startEnvironmentConnectionService: vi.fn(),
  subscribeEnvironmentConnections: vi.fn(() => () => undefined),
  useSavedEnvironmentRegistryStore: vi.fn(() => ({})),
  useSavedEnvironmentRuntimeStore: vi.fn(() => ({})),
  waitForSavedEnvironmentRegistryHydration: vi.fn(async () => undefined),
}));

vi.mock("@pierre/diffs/react", async () => {
  const React = await import("react");

  return {
    Virtualizer: ({
      children,
      className,
      contentClassName,
    }: {
      children: ReactNode;
      className?: string;
      contentClassName?: string;
    }) =>
      React.createElement(
        "div",
        {
          className,
          "data-testid": "workspace-file-virtualizer",
          style: { height: "100%", overflow: "auto" },
        },
        React.createElement("div", { className: contentClassName }, children),
      ),
    File: (props: { file: { contents: string } }) =>
      React.createElement("pre", { "data-testid": "workspace-file-render" }, props.file.contents),
  };
});

const ENVIRONMENT_ID = EnvironmentId.make("environment-files-panel-browser");
const WORKSPACE_ROOT = "/repo/project";

function createMockEnvironmentApi(): EnvironmentApi {
  return {
    projects: {
      listDirectoryEntries: vi.fn(async (input: { directoryPath?: string }) => ({
        entries:
          input.directoryPath === "src"
            ? [{ kind: "file", path: "src/App.tsx", parentPath: "src" }]
            : [
                { kind: "directory", path: "src" },
                { kind: "file", path: "README.md" },
              ],
        truncated: false,
      })),
      readFile: vi.fn(async (input: { relativePath: string }) => ({
        relativePath: input.relativePath,
        contents: "export const component = true;\n",
        sizeBytes: 31,
        truncated: false,
      })),
      searchEntries: vi.fn(async () => ({
        entries: [{ kind: "file", path: "src/App.tsx", parentPath: "src" }],
        truncated: false,
      })),
      writeFile: vi.fn(),
    },
  } as unknown as EnvironmentApi;
}

function createPreviewTarget(relativePath = "src/App.tsx") {
  return {
    environmentId: ENVIRONMENT_ID,
    cwd: WORKSPACE_ROOT,
    displayPath: relativePath,
    relativePath,
  };
}

async function renderFilesPanel(input: { initialize?: () => void } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  const host = document.createElement("div");
  host.style.height = "320px";
  host.style.width = "720px";
  document.body.append(host);

  if (input.initialize) {
    input.initialize();
  } else {
    openWorkspaceFileExplorer({
      environmentId: ENVIRONMENT_ID,
      cwd: WORKSPACE_ROOT,
      projectName: "project",
    });
  }

  const screen = await render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(WorkspaceFilesPanel, {
        mode: "sidebar",
        onReturnToDiff: vi.fn(),
      }),
    ),
    { container: host },
  );

  return {
    async cleanup() {
      await screen.unmount();
      queryClient.clear();
      host.remove();
    },
  };
}

describe("WorkspaceFilesPanel", () => {
  afterEach(() => {
    __resetEnvironmentApiOverridesForTests();
    __resetWorkspaceFilePanelStateForTests();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("previews explorer file clicks in the same panel and returns to preserved explorer state", async () => {
    const api = createMockEnvironmentApi();
    __setEnvironmentApiOverrideForTests(ENVIRONMENT_ID, api);
    const mounted = await renderFilesPanel();
    try {
      await page.getByRole("button", { name: "src" }).click();
      await vi.waitFor(() => {
        expect(api.projects.listDirectoryEntries).toHaveBeenCalledWith({
          cwd: WORKSPACE_ROOT,
          directoryPath: "src",
          limit: 500,
        });
      });

      await page.getByPlaceholder("Search files").fill("App");
      await page.getByRole("button", { name: "src/App.tsx" }).click();

      await expect.element(page.getByText("export const component = true;")).toBeInTheDocument();
      await expect.element(page.getByRole("button", { name: "Back to explorer" })).toBeVisible();

      await page.getByRole("button", { name: "Back to explorer" }).click();
      await expect
        .element(page.getByRole("button", { name: "Back to file viewer" }))
        .not.toBeInTheDocument();
      const searchInput = document.querySelector<HTMLInputElement>(
        'input[placeholder="Search files"]',
      );
      expect(searchInput?.value).toBe("App");

      await page.getByPlaceholder("Search files").fill("");
      await expect.element(page.getByRole("button", { name: "src" })).toBeVisible();
      await expect.element(page.getByRole("button", { name: "App.tsx" })).toBeVisible();
    } finally {
      await mounted.cleanup();
    }
  });

  it("uses a one-step file viewer breadcrumb only when explorer is opened from preview", async () => {
    __setEnvironmentApiOverrideForTests(ENVIRONMENT_ID, createMockEnvironmentApi());
    const mounted = await renderFilesPanel({
      initialize: () => openWorkspaceFilePreview(createPreviewTarget()),
    });
    try {
      await expect.element(page.getByText("export const component = true;")).toBeInTheDocument();

      await page.getByRole("button", { name: "Show file explorer" }).click();
      await expect.element(page.getByRole("button", { name: "Back to file viewer" })).toBeVisible();

      await page.getByRole("button", { name: "Back to file viewer" }).click();
      await expect.element(page.getByText("export const component = true;")).toBeInTheDocument();
      await expect
        .element(page.getByRole("button", { name: "Back to file viewer" }))
        .not.toBeInTheDocument();
    } finally {
      await mounted.cleanup();
    }
  });

  it("does not show stale file viewer back navigation when explorer opens directly", async () => {
    __setEnvironmentApiOverrideForTests(ENVIRONMENT_ID, createMockEnvironmentApi());
    const mounted = await renderFilesPanel({
      initialize: () => {
        openWorkspaceFilePreview(createPreviewTarget("README.md"));
        openWorkspaceFileExplorer({
          environmentId: ENVIRONMENT_ID,
          cwd: WORKSPACE_ROOT,
          projectName: "project",
        });
      },
    });
    try {
      await expect.element(page.getByPlaceholder("Search files")).toBeVisible();
      await expect
        .element(page.getByRole("button", { name: "Back to file viewer" }))
        .not.toBeInTheDocument();
    } finally {
      await mounted.cleanup();
    }
  });
});
