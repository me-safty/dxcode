import { Schema } from "effect";

import { ProviderKind, ProviderInteractionMode, ProviderStartOptions } from "./orchestration";
import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas";

export const ProviderCommandExecution = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("provider"),
    operation: Schema.Literals(["review", "compact"]),
  }),
  Schema.Struct({
    kind: Schema.Literal("interaction-mode"),
    interactionMode: ProviderInteractionMode,
  }),
  Schema.Struct({
    kind: Schema.Literal("submit-prompt"),
    prompt: TrimmedNonEmptyString,
    guardFilePath: Schema.optional(TrimmedNonEmptyString),
    guardMessage: Schema.optional(TrimmedNonEmptyString),
  }),
]);
export type ProviderCommandExecution = typeof ProviderCommandExecution.Type;

export const ProviderCommandDefinition = Schema.Struct({
  provider: ProviderKind,
  name: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  supportsInlineArgs: Schema.Boolean,
  availableDuringTask: Schema.Boolean,
  execution: ProviderCommandExecution,
});
export type ProviderCommandDefinition = typeof ProviderCommandDefinition.Type;

export const ServerListProviderCommandsInput = Schema.Struct({
  provider: ProviderKind,
});
export type ServerListProviderCommandsInput = typeof ServerListProviderCommandsInput.Type;

export const ServerListProviderCommandsResult = Schema.Struct({
  commands: Schema.Array(ProviderCommandDefinition),
});
export type ServerListProviderCommandsResult = typeof ServerListProviderCommandsResult.Type;

export const ServerExecuteProviderCommandInput = Schema.Struct({
  threadId: ThreadId,
  provider: ProviderKind,
  commandName: TrimmedNonEmptyString,
  args: Schema.optional(Schema.String),
  providerOptions: Schema.optional(ProviderStartOptions),
});
export type ServerExecuteProviderCommandInput = typeof ServerExecuteProviderCommandInput.Type;

export const ServerExecuteProviderCommandResult = Schema.Struct({
  accepted: Schema.Boolean,
});
export type ServerExecuteProviderCommandResult = typeof ServerExecuteProviderCommandResult.Type;
