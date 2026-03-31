import { mkdtempSync } from "node:fs";
import * as FileSystem from "node:fs/promises";
import * as Net from "node:net";
import * as Os from "node:os";
import * as Path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { waitForResources } from "./wait-for-resources.mjs";

const openServers = new Set();

async function createListeningServer() {
  const server = Net.createServer();
  openServers.add(server);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  return server;
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

afterEach(async () => {
  await Promise.all(
    Array.from(openServers, async (server) => {
      openServers.delete(server);
      await closeServer(server);
    }),
  );
});

describe("waitForResources", () => {
  it("fails fast with a clear error when tcpPort is missing", async () => {
    const tmpDir = mkdtempSync(Path.join(Os.tmpdir(), "t3code-wait-for-resources-invalid-port-"));

    await expect(
      waitForResources({
        baseDir: tmpDir,
        files: [],
      }),
    ).rejects.toThrow("waitForResources requires a positive integer tcpPort");
  });

  it("waits until the requested files exist and the tcp port is accepting connections", async () => {
    const tmpDir = mkdtempSync(Path.join(Os.tmpdir(), "t3code-wait-for-resources-"));
    const server = await createListeningServer();
    const { port } = server.address();

    await FileSystem.mkdir(Path.join(tmpDir, "dist-electron"), { recursive: true });
    await FileSystem.mkdir(Path.join(tmpDir, "../server/dist"), { recursive: true });

    setTimeout(() => {
      void FileSystem.writeFile(Path.join(tmpDir, "dist-electron/main.js"), "");
    }, 25);
    setTimeout(() => {
      void FileSystem.writeFile(Path.join(tmpDir, "../server/dist/index.mjs"), "");
    }, 50);

    await expect(
      waitForResources({
        baseDir: tmpDir,
        files: ["dist-electron/main.js", "../server/dist/index.mjs"],
        intervalMs: 10,
        timeoutMs: 1_000,
        tcpHost: "127.0.0.1",
        tcpPort: port,
      }),
    ).resolves.toBeUndefined();
  });

  it("reports the remaining resources when the timeout elapses", async () => {
    const tmpDir = mkdtempSync(Path.join(Os.tmpdir(), "t3code-wait-for-resources-timeout-"));
    const server = await createListeningServer();
    const { port } = server.address();
    openServers.delete(server);
    await closeServer(server);

    await expect(
      waitForResources({
        baseDir: tmpDir,
        files: ["dist-electron/main.js"],
        intervalMs: 10,
        timeoutMs: 40,
        tcpHost: "127.0.0.1",
        tcpPort: port,
        connectTimeoutMs: 10,
      }),
    ).rejects.toThrow(
      `Timed out waiting for desktop dev resources after 40ms: tcp:127.0.0.1:${port}, file:dist-electron/main.js`,
    );
  });
});
