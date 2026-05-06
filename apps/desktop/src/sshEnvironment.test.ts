import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { assert, describe, it } from "@effect/vitest";
import { NetService } from "@t3tools/shared/Net";
import { SshPasswordPromptError } from "@t3tools/ssh/errors";
import { Effect, FileSystem, Layer, Path } from "effect";

import {
  DesktopSshEnvironmentBridge,
  type DesktopSshBridgeIpcMain,
  DesktopSshEnvironmentManager,
  discoverDesktopSshHostsEffect,
  isSshPasswordPromptCancellation,
} from "./sshEnvironment.ts";

function makeTempHomeDir() {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.makeTempDirectoryScoped({ prefix: "t3-ssh-env-test-" });
  });
}

class TestIpcMain implements DesktopSshBridgeIpcMain {
  readonly handlers = new Map<
    string,
    (event: unknown, ...args: readonly unknown[]) => unknown | Promise<unknown>
  >();

  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }

  handle(
    channel: string,
    listener: (event: unknown, ...args: readonly unknown[]) => unknown | Promise<unknown>,
  ): void {
    this.handlers.set(channel, listener);
  }
}

describe("sshEnvironment", () => {
  it("treats password prompt timeouts as cancellable authentication prompts", () => {
    assert.equal(
      isSshPasswordPromptCancellation(
        new SshPasswordPromptError({
          message: "SSH authentication timed out for devbox.",
        }),
      ),
      true,
    );
  });

  it.effect("wires desktop host discovery through the ssh package runtime", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const homeDir = yield* makeTempHomeDir();
      const sshDir = path.join(homeDir, ".ssh");
      yield* fs.makeDirectory(path.join(sshDir, "config.d"), { recursive: true });
      yield* fs.writeFileString(
        path.join(sshDir, "config"),
        ["Host devbox", "  HostName devbox.example.com", "Include config.d/*.conf", ""].join("\n"),
      );
      yield* fs.writeFileString(
        path.join(sshDir, "config.d", "team.conf"),
        [
          "Host staging",
          "  HostName staging.example.com",
          "Host *",
          "  ServerAliveInterval 30",
          "",
        ].join("\n"),
      );
      yield* fs.writeFileString(
        path.join(sshDir, "known_hosts"),
        [
          "known.example.com ssh-ed25519 AAAA",
          "|1|hashed|entry ssh-ed25519 AAAA",
          "[bastion.example.com]:2222 ssh-ed25519 AAAA",
          "",
        ].join("\n"),
      );

      const hosts = yield* discoverDesktopSshHostsEffect({ homeDir });
      assert.deepEqual(hosts, [
        {
          alias: "bastion.example.com",
          hostname: "bastion.example.com",
          username: null,
          port: null,
          source: "known-hosts",
        },
        {
          alias: "devbox",
          hostname: "devbox",
          username: null,
          port: null,
          source: "ssh-config",
        },
        {
          alias: "known.example.com",
          hostname: "known.example.com",
          username: null,
          port: null,
          source: "known-hosts",
        },
        {
          alias: "staging",
          hostname: "staging",
          username: null,
          port: null,
          source: "ssh-config",
        },
      ]);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("runs SSH IPC handlers with the captured Effect context", () =>
    Effect.gen(function* () {
      const ipcMain = new TestIpcMain();
      const bridge = yield* DesktopSshEnvironmentBridge;

      yield* bridge.registerIpcHandlers(ipcMain);

      const discoverHosts = ipcMain.handlers.get("desktop:discover-ssh-hosts");
      assert.ok(discoverHosts);

      const hosts = yield* Effect.promise(() => Promise.resolve(discoverHosts({})));
      assert.deepEqual(hosts, [
        {
          alias: "devbox",
          hostname: "devbox.example.com",
          username: null,
          port: null,
          source: "ssh-config",
        },
      ]);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          DesktopSshEnvironmentBridge.layer({ getMainWindow: () => null }),
          Layer.succeed(
            DesktopSshEnvironmentManager,
            DesktopSshEnvironmentManager.of({
              discoverHosts: () =>
                Effect.succeed([
                  {
                    alias: "devbox",
                    hostname: "devbox.example.com",
                    username: null,
                    port: null,
                    source: "ssh-config" as const,
                  },
                ]),
              ensureEnvironment: () => Effect.die("unexpected ensureEnvironment"),
              disconnectEnvironment: () => Effect.die("unexpected disconnectEnvironment"),
            }),
          ),
          NodeServices.layer,
          NodeHttpClient.layerUndici,
          NetService.layer,
        ),
      ),
      Effect.scoped,
    ),
  );
});
