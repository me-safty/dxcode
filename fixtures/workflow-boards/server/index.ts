import { definePlugin, type PluginRegistration } from "@t3tools/plugin-sdk";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
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
      void workflowCapabilityLayers({
        agents,
        databaseClient: database.client,
        environmentsRead,
        filesystem,
        projectionsRead,
        sourceControl,
        terminals,
        vcs,
      });
      const registration: PluginRegistration = {
        migrations: [migration001],
      };
      return registration;
    }).pipe(Effect.mapError(toPluginError)),
});

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
