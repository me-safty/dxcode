import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import type { ModelInfo, SessionEvent } from "@github/copilot-sdk";
import { Effect, Layer } from "effect";
import { expect, vi } from "vitest";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { TextGeneration } from "../Services/TextGeneration.ts";
import { makeCopilotTextGenerationLive } from "./CopilotTextGeneration.ts";

class FakeCopilotSession {
  public readonly sendImpl = vi.fn(
    async (_input: {
      prompt: string;
      attachments?: Array<{ type: "file"; path: string; displayName?: string }>;
      mode?: "enqueue" | "immediate";
    }) => {
      this.onEvent?.({
        id: "turn-start",
        timestamp: new Date().toISOString(),
        parentId: null,
        type: "assistant.turn_start",
        data: { turnId: "turn-1" },
      });
      this.onEvent?.({
        id: "assistant-message",
        timestamp: new Date().toISOString(),
        parentId: "turn-start",
        type: "assistant.message",
        data: {
          messageId: "message-1",
          content: this.messageContent,
        },
      });
      this.onEvent?.({
        id: "turn-end",
        timestamp: new Date().toISOString(),
        parentId: "assistant-message",
        type: "assistant.turn_end",
        data: { turnId: "turn-1" },
      });
      return "message-1";
    },
  );
  public readonly getMessagesImpl = vi.fn(
    async (): Promise<ReadonlyArray<SessionEvent>> => [
      {
        id: "assistant-message",
        timestamp: new Date().toISOString(),
        parentId: null,
        type: "assistant.message",
        data: {
          messageId: "message-1",
          content: this.messageContent,
        },
      },
    ],
  );
  public readonly destroyImpl = vi.fn(async () => undefined);
  public onEvent: ((event: SessionEvent) => void) | undefined;

  constructor(public messageContent: string) {}

  send(input: {
    prompt: string;
    attachments?: Array<{ type: "file"; path: string; displayName?: string }>;
    mode?: "enqueue" | "immediate";
  }) {
    return this.sendImpl(input);
  }

  getMessages() {
    return this.getMessagesImpl();
  }

  destroy() {
    return this.destroyImpl();
  }
}

class FakeCopilotClient {
  public readonly startImpl = vi.fn(async () => undefined);
  public readonly stopImpl = vi.fn(async () => [] as Error[]);
  public readonly listModelsImpl = vi.fn(async (): Promise<ReadonlyArray<ModelInfo>> => []);
  public readonly createSessionImpl = vi.fn(
    async (
      config: { onEvent?: ((event: SessionEvent) => void) | undefined } & Record<string, unknown>,
    ) => {
      this.session.onEvent = config.onEvent;
      return this.session;
    },
  );

  constructor(public readonly session: FakeCopilotSession) {}

  start() {
    return this.startImpl();
  }

  stop() {
    return this.stopImpl();
  }

  listModels() {
    return this.listModelsImpl();
  }

  createSession(
    config: { onEvent?: ((event: SessionEvent) => void) | undefined } & Record<string, unknown>,
  ) {
    return this.createSessionImpl(config);
  }
}

function makeModelInfo(input: {
  id: string;
  name: string;
  supportedReasoningEfforts?: ReadonlyArray<"low" | "medium" | "high" | "xhigh">;
}) {
  return input as unknown as import("@github/copilot-sdk").ModelInfo;
}

const session = new FakeCopilotSession(
  JSON.stringify({
    subject: "  Add Copilot text generation. ",
    body: "- updated settings\n- added routing",
  }),
);
const client = new FakeCopilotClient(session);
let lastClientFactoryOptions: unknown;

const CopilotTextGenerationTestLayer = makeCopilotTextGenerationLive({
  clientFactory: (options) => {
    lastClientFactoryOptions = options;
    return client;
  },
}).pipe(
  Layer.provideMerge(ServerSettingsService.layerTest()),
  Layer.provideMerge(
    ServerConfig.layerTest(process.cwd(), {
      prefix: "t3code-copilot-text-generation-test-",
    }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

it.layer(CopilotTextGenerationTestLayer)("CopilotTextGenerationLive", (it) => {
  it.effect("generates and sanitizes commit messages", () =>
    Effect.gen(function* () {
      client.listModelsImpl.mockReset();
      client.createSessionImpl.mockClear();
      session.sendImpl.mockClear();
      lastClientFactoryOptions = undefined;
      client.listModelsImpl.mockResolvedValue([
        makeModelInfo({
          id: "gpt-5.4-mini",
          name: "GPT-5.4 Mini",
          supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
        }),
      ]);

      const textGeneration = yield* TextGeneration;
      const generated = yield* textGeneration.generateCommitMessage({
        cwd: process.cwd(),
        branch: "feature/copilot-text-generation",
        stagedSummary: "M apps/server/src/git/Layers/CopilotTextGeneration.ts",
        stagedPatch: "diff --git a/file b/file",
        modelSelection: {
          provider: "copilot",
          model: "gpt-5.4-mini",
        },
      });

      expect(generated.subject).toBe("Add Copilot text generation");
      expect(generated.body).toBe("- updated settings\n- added routing");
      const sessionConfig = client.createSessionImpl.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(sessionConfig.model).toBe("gpt-5.4-mini");
      expect(sessionConfig.reasoningEffort).toBe("low");
      expect(sessionConfig.workingDirectory).toBe(process.cwd());
      expect(lastClientFactoryOptions).toMatchObject({
        cwd: process.cwd(),
        logLevel: "error",
      });
      expect(session.sendImpl.mock.calls[0]?.[0]).toMatchObject({
        mode: "immediate",
      });
    }),
  );

  it.effect("uses configured binary path and config dir for Copilot text generation", () =>
    Effect.gen(function* () {
      client.listModelsImpl.mockReset();
      client.createSessionImpl.mockClear();
      client.startImpl.mockClear();
      lastClientFactoryOptions = undefined;
      client.listModelsImpl.mockResolvedValue([
        makeModelInfo({
          id: "gpt-5.4",
          name: "GPT-5.4",
          supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
        }),
      ]);

      const serverSettings = yield* ServerSettingsService;
      yield* serverSettings.updateSettings({
        providers: {
          copilot: {
            binaryPath: "/tmp/copilot",
            configDir: "/tmp/copilot-config",
          },
        },
      });

      const textGeneration = yield* TextGeneration;
      yield* textGeneration.generateCommitMessage({
        cwd: process.cwd(),
        branch: null,
        stagedSummary: "M README.md",
        stagedPatch: "diff --git a/README.md b/README.md",
        modelSelection: {
          provider: "copilot",
          model: "gpt-5.4",
          options: { reasoningEffort: "high" },
        },
      });

      const sessionConfig = client.createSessionImpl.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(lastClientFactoryOptions).toMatchObject({
        cliPath: "/tmp/copilot",
        cwd: process.cwd(),
        logLevel: "error",
      });
      expect(sessionConfig.configDir).toBe("/tmp/copilot-config");
      expect(sessionConfig.reasoningEffort).toBe("high");
    }),
  );
});
