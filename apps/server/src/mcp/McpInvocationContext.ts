import {
  type EnvironmentId,
  PreviewAutomationUnavailableError,
  type ProviderInstanceId,
  type ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export type McpCapability = "preview" | "orchestration" | "scheduled-tasks";

export interface McpInvocationScope {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerSessionId: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly capabilities: ReadonlySet<McpCapability>;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export class McpInvocationContext extends Context.Service<
  McpInvocationContext,
  McpInvocationScope
>()("t3/mcp/McpInvocationContext") {}

export class McpCapabilityUnavailableError extends Schema.TaggedErrorClass<McpCapabilityUnavailableError>()(
  "McpCapabilityUnavailableError",
  {
    capability: TrimmedNonEmptyString,
    environmentId: TrimmedNonEmptyString,
    threadId: TrimmedNonEmptyString,
    providerSessionId: TrimmedNonEmptyString,
    providerInstanceId: TrimmedNonEmptyString,
  },
) {
  override get message(): string {
    return `MCP credential does not grant the ${this.capability} capability.`;
  }
}

export const requireMcpCapability = Effect.fn("mcp.requireCapability")(function* (
  capability: "preview",
) {
  const invocation = yield* McpInvocationContext;
  if (!invocation.capabilities.has(capability)) {
    return yield* new PreviewAutomationUnavailableError({
      capability,
      environmentId: invocation.environmentId,
      threadId: invocation.threadId,
      providerSessionId: invocation.providerSessionId,
      providerInstanceId: invocation.providerInstanceId,
    });
  }
  return invocation;
});

export const requireMognetCapability = Effect.fn("mcp.requireMognetCapability")(function* (
  capability: Exclude<McpCapability, "preview">,
) {
  const invocation = yield* McpInvocationContext;
  if (!invocation.capabilities.has(capability)) {
    return yield* new McpCapabilityUnavailableError({
      capability,
      environmentId: invocation.environmentId,
      threadId: invocation.threadId,
      providerSessionId: invocation.providerSessionId,
      providerInstanceId: invocation.providerInstanceId,
    });
  }
  return invocation;
});
