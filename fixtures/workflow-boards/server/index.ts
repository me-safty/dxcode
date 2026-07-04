import { definePlugin, type PluginRegistration } from "@t3tools/plugin-sdk";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { migration001 } from "./migrations/001_WorkflowSchema.ts";
import { WorkflowTerminalsCapability } from "./workflow/Services/ScriptCancelRegistry.ts";
import {
  WorkflowEnvironmentsReadCapability,
  WorkflowFilesystemCapability,
  WorkflowSourceControlCapability,
  WorkflowVcsCapability,
} from "./workflow/Services/WorkflowCapabilities.ts";
import {
  WorkflowAgentsCapability,
  WorkflowProjectionsReadCapability,
} from "./workflow/Services/WorkflowAgentPort.ts";
import { WorkflowGitHubPoller } from "./workflow/Services/WorkflowGitHubPoller.ts";
import { WorkflowRecovery } from "./workflow/Services/WorkflowRecovery.ts";
import { WorkflowRuntimeLive } from "./workflow/WorkflowRuntimeLive.ts";

const toPluginError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

export default definePlugin({
  register: (hostApi) =>
    Effect.gen(function* () {
      // Acquire required capabilities so activation fails loudly if the
      // manifest ever drops a declaration recovery/runtime code relies on.
      const database = yield* hostApi.database;
      const filesystem = yield* hostApi.filesystem;
      const agents = yield* hostApi.agents;
      const projectionsRead = yield* hostApi.projectionsRead;
      const vcs = yield* hostApi.vcs;
      const terminals = yield* hostApi.terminals;
      const sourceControl = yield* hostApi.sourceControl;
      const environmentsRead = yield* hostApi.environmentsRead;
      const appLayer = WorkflowRuntimeLive.pipe(
        Layer.provide(
          workflowCapabilityLayers({
            agents,
            databaseClient: database.client,
            environmentsRead,
            filesystem,
            projectionsRead,
            sourceControl,
            terminals,
            vcs,
          }),
        ),
      );
      const registration: PluginRegistration = {
        migrations: [migration001],
        services: [
          {
            name: "workflow-runtime",
            run: () => runWorkflowRuntimeService(appLayer),
          },
        ],
      };
      return registration;
    }).pipe(Effect.mapError(toPluginError)),
});

export const runWorkflowRuntimeService = <ROut, E>(
  appLayer: Layer.Layer<ROut, E, never>,
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    return yield* Effect.gen(function* () {
      const context = yield* Layer.buildWithScope(appLayer, scope);
      const recovery = Context.get(
        context as Context.Context<ROut | WorkflowRecovery>,
        WorkflowRecovery,
      );
      // TODO(A4): switch to the RPC-gated continue-anyway recovery policy once
      // the workflow plugin has the A4 RPC layer. Until then, keep recovery
      // fatal after a small bounded retry to avoid flapping on transient DB
      // hiccups.
      yield* recovery
        .recover()
        .pipe(
          Effect.retry(
            Schedule.recurs(2).pipe(Schedule.addDelay(() => Effect.succeed(Duration.seconds(1)))),
          ),
        );
      const poller = Context.get(
        context as Context.Context<ROut | WorkflowGitHubPoller>,
        WorkflowGitHubPoller,
      );
      yield* poller.start().pipe(Effect.provideService(Scope.Scope, scope));
      return yield* Effect.never;
    }).pipe(Effect.ensuring(Scope.close(scope, Exit.void).pipe(Effect.ignore)));
  }).pipe(Effect.mapError(toPluginError));

type WorkflowCapabilityLayerInput = {
  readonly agents: WorkflowAgentsCapability["Service"];
  readonly databaseClient: SqlClient.SqlClient;
  readonly environmentsRead: WorkflowEnvironmentsReadCapability["Service"];
  readonly filesystem: WorkflowFilesystemCapability["Service"];
  readonly projectionsRead: WorkflowProjectionsReadCapability["Service"];
  readonly sourceControl: WorkflowSourceControlCapability["Service"];
  readonly terminals: WorkflowTerminalsCapability["Service"];
  readonly vcs: WorkflowVcsCapability["Service"];
};

export const workflowCapabilityLayers = (input: WorkflowCapabilityLayerInput) =>
  Layer.mergeAll(
    Layer.succeed(SqlClient.SqlClient, input.databaseClient),
    Layer.succeed(WorkflowAgentsCapability, input.agents),
    Layer.succeed(WorkflowProjectionsReadCapability, input.projectionsRead),
    Layer.succeed(WorkflowVcsCapability, input.vcs),
    Layer.succeed(WorkflowTerminalsCapability, input.terminals),
    Layer.succeed(WorkflowSourceControlCapability, input.sourceControl),
    Layer.succeed(WorkflowEnvironmentsReadCapability, input.environmentsRead),
    Layer.succeed(WorkflowFilesystemCapability, input.filesystem),
  );
