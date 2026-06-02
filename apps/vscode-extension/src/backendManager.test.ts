import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BackendManager,
  type BackendManagerDependencies,
  resolveMcpToolTimeoutSec,
} from "./backendManager.ts";

const vscodeState = vi.hoisted(() => ({
  workspaceFolderPath: "/workspace",
  activeEditorPath: "/workspace/src/file.ts",
  workspaceFolders: [
    {
      name: "workspace",
      uri: {
        scheme: "file",
        authority: "",
        path: "/workspace",
        fsPath: "/workspace",
      },
    },
  ],
  settings: {} as Record<string, unknown>,
}));

vi.mock("vscode", () => ({
  window: {
    activeTextEditor: {
      document: {
        uri: {
          get fsPath() {
            return vscodeState.activeEditorPath;
          },
          get path() {
            return vscodeState.activeEditorPath;
          },
        },
      },
    },
  },
  workspace: {
    getConfiguration: () => ({
      get: (key: string, fallback?: unknown) =>
        key in vscodeState.settings ? vscodeState.settings[key] : fallback,
    }),
    getWorkspaceFolder: (uri: { fsPath: string }) =>
      vscodeState.workspaceFolders.find((folder) => uri.fsPath.startsWith(folder.uri.fsPath)),
    get workspaceFolders() {
      return vscodeState.workspaceFolders;
    },
  },
}));

function makeOutputChannel() {
  return {
    append: vi.fn(),
    appendLine: vi.fn(),
  };
}

function makeDependencies(
  input: Partial<BackendManagerDependencies> = {},
): BackendManagerDependencies {
  return {
    fetch:
      input.fetch ??
      vi.fn<typeof fetch>(async (requestInput) => {
        const url = new URL(
          requestInput instanceof Request ? requestInput.url : requestInput.toString(),
        );
        if (url.pathname === "/.well-known/t3/environment") {
          return new Response(JSON.stringify({ environmentId: "environment-desktop" }), {
            headers: { "content-type": "application/json" },
            status: 200,
          });
        }
        if (url.pathname === "/api/auth/bootstrap/bearer") {
          return new Response(JSON.stringify({ sessionToken: "desktop-bearer-token" }), {
            headers: { "content-type": "application/json" },
            status: 200,
          });
        }
        if (url.pathname === "/api/vscode/workspace-bootstrap") {
          return new Response(
            JSON.stringify({
              environmentId: "environment-desktop",
              bootstrapProjects: [
                {
                  workspaceFolderKey: "file::/workspace",
                  workspaceFolderName: "workspace",
                  cwd: "/workspace",
                  projectId: "project-workspace",
                  bootstrapThreadId: "thread-latest",
                  isActive: true,
                },
              ],
            }),
            {
              headers: { "content-type": "application/json" },
              status: 200,
            },
          );
        }
        if (url.pathname === "/api/auth/session/revoke") {
          return new Response(JSON.stringify({ revoked: true }), { status: 200 });
        }
        throw new Error(`Unexpected request URL: ${url.href}`);
      }),
    mkdirSync: input.mkdirSync ?? vi.fn(),
    pruneVirtualWorkspaceCache:
      input.pruneVirtualWorkspaceCache ??
      vi.fn(() => ({
        deleted: 0,
        kept: 0,
        errors: 0,
      })),
    randomBytes:
      input.randomBytes ??
      (vi.fn(() =>
        Buffer.from("0123456789abcdef"),
      ) as unknown as typeof import("node:crypto").randomBytes),
    runCommand: input.runCommand ?? vi.fn().mockResolvedValue(undefined),
    readDesktopBackendAdvertisements:
      input.readDesktopBackendAdvertisements ??
      vi.fn(() => ({
        advertisements: [
          {
            version: 1 as const,
            backendId: "desktop-backend-1",
            updatedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 30_000).toISOString(),
            httpBaseUrl: "http://127.0.0.1:3773/",
            bootstrapToken: "desktop-bootstrap-token",
          },
        ],
        malformed: 0,
      })),
    cleanupDesktopBackendAdvertisements: input.cleanupDesktopBackendAdvertisements ?? vi.fn(),
    writeHostMcpAdvertisement: input.writeHostMcpAdvertisement ?? vi.fn(),
    removeHostMcpAdvertisement: input.removeHostMcpAdvertisement ?? vi.fn(),
    cleanupHostMcpAdvertisements:
      input.cleanupHostMcpAdvertisements ?? vi.fn(() => ({ deleted: 0, errors: 0 })),
  };
}

describe("BackendManager", () => {
  let extensionRoot: string;

  beforeEach(() => {
    extensionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-vscode-extension-"));
    vscodeState.settings = {};
    vscodeState.workspaceFolders = [
      {
        name: "workspace",
        uri: {
          scheme: "file",
          authority: "",
          path: vscodeState.workspaceFolderPath,
          fsPath: vscodeState.workspaceFolderPath,
        },
      },
    ];
    vscodeState.activeEditorPath = "/workspace/src/file.ts";
  });

  afterEach(() => {
    fs.rmSync(extensionRoot, { force: true, recursive: true });
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("connects to the advertised desktop backend and advertises VS Code MCP", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ environmentId: "environment-desktop" }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sessionToken: "desktop-bearer-token" }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            environmentId: "environment-desktop",
            bootstrapProjects: [
              {
                workspaceFolderKey: "file::/workspace",
                workspaceFolderName: "workspace",
                cwd: "/workspace",
                projectId: "project-workspace",
                bootstrapThreadId: "thread-latest",
                isActive: true,
              },
            ],
          }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        ),
      )
      .mockResolvedValue(new Response(JSON.stringify({ revoked: true }), { status: 200 }));
    const writeHostMcpAdvertisementMock = vi.fn();
    const manager = new BackendManager(
      { extensionPath: extensionRoot } as never,
      makeOutputChannel() as never,
      makeDependencies({
        fetch: fetchMock,
        writeHostMcpAdvertisement: writeHostMcpAdvertisementMock,
      }),
      {
        ensureStarted: vi.fn().mockResolvedValue({
          name: "t3code-vscode-abc",
          socketPath: "/tmp/t3code-vscode.sock",
        }),
      },
    );

    await expect(manager.ensureStarted()).resolves.toEqual({
      httpBaseUrl: "http://127.0.0.1:3773/",
      wsBaseUrl: "ws://127.0.0.1:3773/",
      bootstrapToken: "desktop-bootstrap-token",
      bearerToken: "desktop-bearer-token",
      cwd: "/workspace",
      t3Home: path.join(os.homedir(), ".t3"),
      environmentId: "environment-desktop",
      workspaceFolders: [
        {
          key: "file::/workspace",
          name: "workspace",
          cwd: "/workspace",
          uriScheme: "file",
          uriAuthority: "",
        },
      ],
      activeWorkspaceFolderKey: "file::/workspace",
      bootstrapProjects: [
        {
          workspaceFolderKey: "file::/workspace",
          workspaceFolderName: "workspace",
          cwd: "/workspace",
          projectId: "project-workspace",
          bootstrapThreadId: "thread-latest",
          isActive: true,
        },
      ],
      initialThreadRoute: "/_chat/environment-desktop/thread-latest",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:3773/.well-known/t3/environment"),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:3773/api/auth/bootstrap/bearer"),
      expect.objectContaining({
        body: JSON.stringify({ credential: "desktop-bootstrap-token" }),
        method: "POST",
      }),
    );
    expect(writeHostMcpAdvertisementMock).toHaveBeenCalledWith({
      t3Home: path.join(os.homedir(), ".t3"),
      advertisement: expect.objectContaining({
        hostKind: "vscode",
        mcpServer: {
          name: "t3code-vscode-abc",
          socketPath: "/tmp/t3code-vscode.sock",
          toolTimeoutSec: 120,
        },
        workspaceFolders: [
          {
            key: "file::/workspace",
            name: "workspace",
            cwd: "/workspace",
            uriScheme: "file",
            uriAuthority: "",
          },
        ],
        activeWorkspaceFolderKey: "file::/workspace",
      }),
    });

    await manager.stop();
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:3773/api/vscode/workspace-bootstrap"),
      expect.objectContaining({
        body: JSON.stringify({
          workspaceFolders: [
            {
              key: "file::/workspace",
              name: "workspace",
              cwd: "/workspace",
              uriScheme: "file",
              uriAuthority: "",
            },
          ],
          activeWorkspaceFolderKey: "file::/workspace",
        }),
        headers: {
          authorization: "Bearer desktop-bearer-token",
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:3773/api/auth/session/revoke"),
      expect.objectContaining({
        headers: {
          authorization: "Bearer desktop-bearer-token",
        },
        method: "POST",
      }),
    );
  });

  it("waits for a refreshed desktop bootstrap ticket after a stale ticket is rejected", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ environmentId: "environment-desktop" }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "stale" }), { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ environmentId: "environment-desktop" }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sessionToken: "desktop-bearer-token" }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ bootstrapProjects: [] }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      );
    const readDesktopBackendAdvertisements = vi
      .fn()
      .mockReturnValueOnce({
        advertisements: [
          {
            version: 1 as const,
            backendId: "desktop-backend-1",
            updatedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 30_000).toISOString(),
            httpBaseUrl: "http://127.0.0.1:3773/",
            bootstrapToken: "stale-ticket",
          },
        ],
        malformed: 0,
      })
      .mockReturnValue({
        advertisements: [
          {
            version: 1 as const,
            backendId: "desktop-backend-1",
            updatedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 30_000).toISOString(),
            httpBaseUrl: "http://127.0.0.1:3773/",
            bootstrapToken: "fresh-ticket",
          },
        ],
        malformed: 0,
      });
    const manager = new BackendManager(
      { extensionPath: extensionRoot } as never,
      makeOutputChannel() as never,
      makeDependencies({
        fetch: fetchMock,
        readDesktopBackendAdvertisements,
      }),
    );

    await expect(manager.ensureStarted()).resolves.toMatchObject({
      bootstrapToken: "fresh-ticket",
      bearerToken: "desktop-bearer-token",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:3773/api/auth/bootstrap/bearer"),
      expect.objectContaining({
        body: JSON.stringify({ credential: "stale-ticket" }),
        method: "POST",
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:3773/api/auth/bootstrap/bearer"),
      expect.objectContaining({
        body: JSON.stringify({ credential: "fresh-ticket" }),
        method: "POST",
      }),
    );
  });

  it("revokes a bearer session when stopped during workspace bootstrap", async () => {
    let bearerSessionCount = 0;
    let workspaceBootstrapCount = 0;
    let resolveFirstWorkspaceBootstrapStarted!: () => void;
    const firstWorkspaceBootstrapStarted = new Promise<void>((resolve) => {
      resolveFirstWorkspaceBootstrapStarted = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(input.toString());
      if (url.pathname === "/.well-known/t3/environment") {
        return new Response(JSON.stringify({ environmentId: "environment-desktop" }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }
      if (url.pathname === "/api/auth/bootstrap/bearer") {
        bearerSessionCount += 1;
        return new Response(
          JSON.stringify({ sessionToken: `desktop-bearer-token-${bearerSessionCount}` }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        );
      }
      if (url.pathname === "/api/vscode/workspace-bootstrap") {
        workspaceBootstrapCount += 1;
        if (workspaceBootstrapCount === 1) {
          resolveFirstWorkspaceBootstrapStarted();
          await new Promise<Response>((_resolve, reject) => {
            const abort = () => reject(new Error("aborted"));
            if (init?.signal?.aborted) {
              abort();
              return;
            }
            init?.signal?.addEventListener("abort", abort, { once: true });
          });
        }
        return new Response(
          JSON.stringify({
            bootstrapProjects: [
              {
                workspaceFolderKey: "file::/workspace",
                workspaceFolderName: "workspace",
                cwd: "/workspace",
                projectId: "project-workspace",
                bootstrapThreadId: `thread-${workspaceBootstrapCount}`,
                isActive: true,
              },
            ],
          }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        );
      }
      if (url.pathname === "/api/auth/session/revoke") {
        return new Response(JSON.stringify({ revoked: true }), { status: 200 });
      }
      throw new Error(`Unexpected request URL: ${url.href}`);
    });
    const manager = new BackendManager(
      { extensionPath: extensionRoot } as never,
      makeOutputChannel() as never,
      makeDependencies({ fetch: fetchMock }),
    );

    const firstStart = manager.ensureStarted();
    await firstWorkspaceBootstrapStarted;
    await manager.stop();
    await expect(firstStart).rejects.toThrow("Desktop backend startup was cancelled.");

    await expect(manager.ensureStarted()).resolves.toMatchObject({
      bearerToken: "desktop-bearer-token-2",
      initialThreadRoute: "/_chat/environment-desktop/thread-2",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:3773/api/auth/session/revoke"),
      expect.objectContaining({
        headers: { authorization: "Bearer desktop-bearer-token-1" },
        method: "POST",
      }),
    );
  });

  it("fails when no desktop backend advertisement is available", async () => {
    const manager = new BackendManager(
      { extensionPath: extensionRoot } as never,
      makeOutputChannel() as never,
      makeDependencies({
        readDesktopBackendAdvertisements: vi.fn(() => ({
          advertisements: [],
          malformed: 0,
        })),
      }),
    );

    await expect(manager.ensureStarted()).rejects.toThrow(
      "T3 Code for VS Code requires the T3 Code desktop app to be running on this machine.",
    );
  });

  it("normalizes MCP tool timeout settings", () => {
    vscodeState.settings["mcp.toolTimeoutSec"] = 2;
    expect(resolveMcpToolTimeoutSec()).toBe(120);

    vscodeState.settings["mcp.toolTimeoutSec"] = 30;
    expect(resolveMcpToolTimeoutSec()).toBe(30);
  });
});
