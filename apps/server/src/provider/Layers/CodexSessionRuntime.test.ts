import assert from "node:assert/strict";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { it as effectIt } from "@effect/vitest";
import { describe, it } from "vite-plus/test";
import { ThreadId } from "@t3tools/contracts";
import * as CodexErrors from "effect-codex-app-server/errors";
import * as CodexRpc from "effect-codex-app-server/rpc";

import {
  CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
  CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
} from "../CodexDeveloperInstructions.ts";
import {
  buildTurnStartParams,
  formatCodexModelForProvider,
  isRecoverableThreadResumeError,
  openCodexThread,
  resolveCodexModelProvider,
} from "./CodexSessionRuntime.ts";
const isCodexAppServerRequestError = Schema.is(CodexErrors.CodexAppServerRequestError);

function makeThreadOpenResponse(
  threadId: string,
): CodexRpc.ClientRequestResponsesByMethod["thread/start"] {
  return {
    cwd: "/tmp/project",
    model: "gpt-5.3-codex",
    modelProvider: "openai",
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandbox: { type: "danger-full-access" },
    thread: {
      id: threadId,
      createdAt: "2026-04-18T00:00:00.000Z",
      source: { session: "cli" },
      turns: [],
      status: {
        state: "idle",
        activeFlags: [],
      },
    },
  } as unknown as CodexRpc.ClientRequestResponsesByMethod["thread/start"];
}

describe("buildTurnStartParams", () => {
  it("includes plan collaboration mode when requested", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "full-access",
        prompt: "Make a plan",
        model: "gpt-5.3-codex",
        effort: "medium",
        interactionMode: "plan",
      }),
    );

    assert.deepStrictEqual(params, {
      threadId: "provider-thread-1",
      approvalPolicy: "never",
      sandboxPolicy: {
        type: "dangerFullAccess",
      },
      input: [
        {
          type: "text",
          text: "Make a plan",
        },
      ],
      model: "gpt-5.3-codex",
      effort: "medium",
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-5.3-codex",
          reasoning_effort: "medium",
          developer_instructions: CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
        },
      },
    });
  });

  it("includes default collaboration mode and image attachments", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "auto-accept-edits",
        prompt: "Implement it",
        model: "gpt-5.3-codex",
        interactionMode: "default",
        attachments: [
          {
            type: "image",
            url: "data:image/png;base64,abc",
          },
        ],
      }),
    );

    assert.deepStrictEqual(params, {
      threadId: "provider-thread-1",
      approvalPolicy: "on-request",
      sandboxPolicy: {
        type: "workspaceWrite",
      },
      input: [
        {
          type: "text",
          text: "Implement it",
        },
        {
          type: "image",
          url: "data:image/png;base64,abc",
        },
      ],
      model: "gpt-5.3-codex",
      collaborationMode: {
        mode: "default",
        settings: {
          model: "gpt-5.3-codex",
          reasoning_effort: "medium",
          developer_instructions: CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
        },
      },
    });
  });

  it("omits collaboration mode when interaction mode is absent", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "approval-required",
        prompt: "Review",
      }),
    );

    assert.deepStrictEqual(params, {
      threadId: "provider-thread-1",
      approvalPolicy: "untrusted",
      sandboxPolicy: {
        type: "readOnly",
      },
      input: [
        {
          type: "text",
          text: "Review",
        },
      ],
    });
  });
});

describe("isRecoverableThreadResumeError", () => {
  it("matches missing thread errors", () => {
    assert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Thread does not exist",
        }),
      ),
      true,
    );
  });

  it("ignores non-recoverable resume errors", () => {
    assert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Permission denied",
        }),
      ),
      false,
    );
  });

  it("ignores unrelated missing-resource errors that do not mention threads", () => {
    assert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Config file not found",
        }),
      ),
      false,
    );
    assert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Model does not exist",
        }),
      ),
      false,
    );
  });
});

describe("openCodexThread", () => {
  it("falls back to thread/start when resume fails recoverably", async () => {
    const calls: Array<{ method: "thread/start" | "thread/resume"; payload: unknown }> = [];
    const started = makeThreadOpenResponse("fresh-thread");
    const client = {
      request: <M extends "thread/start" | "thread/resume">(
        method: M,
        payload: CodexRpc.ClientRequestParamsByMethod[M],
      ) => {
        calls.push({ method, payload });
        if (method === "thread/resume") {
          return Effect.fail(
            new CodexErrors.CodexAppServerRequestError({
              code: -32603,
              errorMessage: "thread not found",
            }),
          );
        }
        return Effect.succeed(started as CodexRpc.ClientRequestResponsesByMethod[M]);
      },
    };

    const opened = await Effect.runPromise(
      openCodexThread({
        client,
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "full-access",
        cwd: "/tmp/project",
        requestedModel: "gpt-5.3-codex",
        serviceTier: undefined,
        resumeThreadId: "stale-thread",
        modelProvider: undefined,
      }),
    );

    assert.equal(opened.thread.id, "fresh-thread");
    assert.deepStrictEqual(
      calls.map((call) => call.method),
      ["thread/resume", "thread/start"],
    );
  });

  it("propagates non-recoverable resume failures", async () => {
    const client = {
      request: <M extends "thread/start" | "thread/resume">(
        method: M,
        _payload: CodexRpc.ClientRequestParamsByMethod[M],
      ) => {
        if (method === "thread/resume") {
          return Effect.fail(
            new CodexErrors.CodexAppServerRequestError({
              code: -32603,
              errorMessage: "timed out waiting for server",
            }),
          );
        }
        return Effect.succeed(
          makeThreadOpenResponse("fresh-thread") as CodexRpc.ClientRequestResponsesByMethod[M],
        );
      },
    };

    await assert.rejects(
      Effect.runPromise(
        openCodexThread({
          client,
          threadId: ThreadId.make("thread-1"),
          runtimeMode: "full-access",
          cwd: "/tmp/project",
          requestedModel: "gpt-5.3-codex",
          serviceTier: undefined,
          resumeThreadId: "stale-thread",
          modelProvider: undefined,
        }),
      ),
      (error: unknown) =>
        isCodexAppServerRequestError(error) &&
        error.errorMessage === "timed out waiting for server",
    );
  });
});

describe("formatCodexModelForProvider", () => {
  it("prefixes models with openai. when routed through Amazon Bedrock", () => {
    assert.equal(formatCodexModelForProvider("gpt-5.5", "amazon-bedrock"), "openai.gpt-5.5");
    assert.equal(
      formatCodexModelForProvider("gpt-5.3-codex", "amazon-bedrock"),
      "openai.gpt-5.3-codex",
    );
  });

  it("leaves already provider-qualified ids untouched", () => {
    assert.equal(formatCodexModelForProvider("openai.gpt-5.5", "amazon-bedrock"), "openai.gpt-5.5");
    assert.equal(
      formatCodexModelForProvider("anthropic.claude-opus-4-8", "amazon-bedrock"),
      "anthropic.claude-opus-4-8",
    );
  });

  it("passes models through unchanged for the default (non-Bedrock) provider", () => {
    assert.equal(formatCodexModelForProvider("gpt-5.5", undefined), "gpt-5.5");
    assert.equal(formatCodexModelForProvider("gpt-5.5", "openai"), "gpt-5.5");
  });

  it("returns undefined when no model is provided", () => {
    assert.equal(formatCodexModelForProvider(undefined, "amazon-bedrock"), undefined);
  });
});

describe("resolveCodexModelProvider", () => {
  const makeClient = (
    response: CodexRpc.ClientRequestResponsesByMethod["account/read"],
  ): Parameters<typeof resolveCodexModelProvider>[0] => ({
    request: () => Effect.succeed(response),
  });

  effectIt.effect("returns amazon-bedrock when the account is Amazon Bedrock", () =>
    Effect.gen(function* () {
      const provider = yield* resolveCodexModelProvider(
        makeClient({ account: { type: "amazonBedrock" }, requiresOpenaiAuth: false }),
      );
      assert.equal(provider, "amazon-bedrock");
    }),
  );

  effectIt.effect("returns undefined for a ChatGPT/OpenAI account", () =>
    Effect.gen(function* () {
      const provider = yield* resolveCodexModelProvider(
        makeClient({ account: { type: "apiKey" }, requiresOpenaiAuth: false }),
      );
      assert.equal(provider, undefined);
    }),
  );

  effectIt.effect("returns undefined (never blocks the session) when account/read fails", () =>
    Effect.gen(function* () {
      const provider = yield* resolveCodexModelProvider({
        request: () =>
          Effect.fail(
            new CodexErrors.CodexAppServerRequestError({
              code: -32603,
              errorMessage: "account read failed",
            }),
          ),
      });
      assert.equal(provider, undefined);
    }),
  );
});

describe("buildTurnStartParams with Bedrock provider", () => {
  effectIt.effect("prefixes the turn model id when modelProvider is amazon-bedrock", () =>
    Effect.gen(function* () {
      const params = yield* buildTurnStartParams({
        threadId: "thread-1",
        runtimeMode: "full-access",
        prompt: "hi",
        model: "gpt-5.5",
        modelProvider: "amazon-bedrock",
      });
      assert.equal(params.model, "openai.gpt-5.5");
    }),
  );

  effectIt.effect("leaves the turn model id unchanged without a Bedrock provider", () =>
    Effect.gen(function* () {
      const params = yield* buildTurnStartParams({
        threadId: "thread-1",
        runtimeMode: "full-access",
        prompt: "hi",
        model: "gpt-5.5",
      });
      assert.equal(params.model, "gpt-5.5");
    }),
  );
});
