import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../config.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { normalizeDispatchCommand } from "./Normalizer.ts";
import { OrchestrationLayerLive } from "./runtimeLayer.ts";

const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-normalizer-test-",
});
const TestLayer = Layer.mergeAll(
  OrchestrationLayerLive.pipe(
    Layer.provideMerge(RepositoryIdentityResolver.layer),
    Layer.provideMerge(SqlitePersistenceMemory),
  ),
  WorkspacePaths.layer,
  GitVcsDriver.layer,
).pipe(Layer.provideMerge(ServerConfigLayer), Layer.provideMerge(NodeServices.layer));

const modelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5-codex",
};
const createdAt = "2026-06-14T00:00:00.000Z";

it.layer(TestLayer)("normalizeDispatchCommand section workspaces", (it) => {
  it.effect(
    "initializes sections and assigns clean worktrees to direct and bootstrap threads",
    () =>
      Effect.gen(function* () {
        const engine = yield* OrchestrationEngineService;
        const projectId = ProjectId.make("section-project");
        const directThreadId = ThreadId.make("direct-thread");
        const bootstrapThreadId = ThreadId.make("bootstrap-thread");

        const projectCreate = yield* normalizeDispatchCommand({
          type: "project.create",
          commandId: CommandId.make("create-section"),
          projectId,
          title: "Section",
          workspaceRoot: ".",
          kind: "section",
          defaultModelSelection: modelSelection,
          createdAt,
        });
        if (projectCreate.type !== "project.create") {
          return assert.fail(`Expected project.create, received ${projectCreate.type}`);
        }
        yield* engine.dispatch(projectCreate);

        const directCreate = yield* normalizeDispatchCommand({
          type: "thread.create",
          commandId: CommandId.make("create-direct-thread"),
          threadId: directThreadId,
          projectId,
          title: "Direct",
          modelSelection,
          runtimeMode: "approval-required",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          branch: null,
          worktreePath: null,
          createdAt,
        });
        if (directCreate.type !== "thread.create") {
          return assert.fail(`Expected thread.create, received ${directCreate.type}`);
        }
        assert.isNotNull(directCreate.worktreePath);
        assert.equal(directCreate.branch, `section-thread/${directThreadId}`);
        yield* engine.dispatch(directCreate);

        const workspaceMutationError = yield* normalizeDispatchCommand({
          type: "thread.meta.update",
          commandId: CommandId.make("mutate-section-workspace"),
          threadId: directThreadId,
          branch: "section-thread/another-thread",
          worktreePath: "/tmp/another-section-worktree",
        }).pipe(Effect.flip);
        assert.equal(
          workspaceMutationError.message,
          "Section threads can only switch to another managed section worktree.",
        );

        const bootstrapTurn = yield* normalizeDispatchCommand({
          type: "thread.turn.start",
          commandId: CommandId.make("bootstrap-turn"),
          threadId: bootstrapThreadId,
          message: {
            messageId: MessageId.make("bootstrap-message"),
            role: "user",
            text: "Start",
            attachments: [],
          },
          modelSelection,
          runtimeMode: "approval-required",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          bootstrap: {
            createThread: {
              projectId,
              title: "Bootstrap",
              modelSelection,
              runtimeMode: "approval-required",
              interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
              branch: null,
              worktreePath: null,
              createdAt,
            },
          },
          createdAt,
        });
        if (bootstrapTurn.type !== "thread.turn.start") {
          return assert.fail(`Expected thread.turn.start, received ${bootstrapTurn.type}`);
        }
        assert.isNotNull(bootstrapTurn.bootstrap?.createThread?.worktreePath);
        assert.notEqual(
          bootstrapTurn.bootstrap?.createThread?.worktreePath,
          directCreate.worktreePath,
        );
        const switchTargetBranch = bootstrapTurn.bootstrap?.createThread?.branch;
        const switchTargetWorktreePath = bootstrapTurn.bootstrap?.createThread?.worktreePath;
        if (!switchTargetBranch || !switchTargetWorktreePath) {
          return assert.fail("Expected bootstrap section worktree context.");
        }

        const switchedThread = yield* normalizeDispatchCommand({
          type: "thread.meta.update",
          commandId: CommandId.make("switch-section-workspace"),
          threadId: directThreadId,
          branch: switchTargetBranch,
          worktreePath: switchTargetWorktreePath,
        });
        if (switchedThread.type !== "thread.meta.update") {
          return assert.fail(`Expected thread.meta.update, received ${switchedThread.type}`);
        }
        assert.equal(switchedThread.branch, switchTargetBranch);
        assert.equal(switchedThread.worktreePath, switchTargetWorktreePath);

        yield* engine.dispatch({
          type: "thread.delete",
          commandId: CommandId.make("delete-direct-thread"),
          threadId: directThreadId,
        });
        const events = yield* Stream.runCollect(engine.readEvents(0)).pipe(
          Effect.map((chunk): OrchestrationEvent[] => Array.from(chunk)),
        );
        const deleted = events.find((event) => event.type === "thread.deleted");
        assert.equal(deleted?.type, "thread.deleted");
        if (deleted?.type === "thread.deleted") {
          assert.equal(deleted.payload.sectionWorkspaceRoot, projectCreate.workspaceRoot);
          assert.equal(deleted.payload.worktreePath, directCreate.worktreePath);
        }
      }),
  );
});
