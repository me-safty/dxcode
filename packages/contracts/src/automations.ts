/**
 * Automations contracts - schemas shared by the localhost MCP tools and the
 * management WS RPCs.
 *
 * An automation is a cron-scheduled job that, when it fires, sends a user
 * message into an existing thread to make that thread's agent start a turn.
 * Automations are created conversationally by an agent (via MCP) and managed
 * from the web UI (via WS RPC).
 *
 * @module automations
 */
import * as Schema from "effect/Schema";

import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const AUTOMATIONS_WS_METHODS = {
  list: "automations.list",
  create: "automations.create",
  delete: "automations.delete",
  setEnabled: "automations.setEnabled",
} as const;

/**
 * Branded identifier for an automation. Generated server-side as a UUID.
 */
export const AutomationId = TrimmedNonEmptyString.pipe(Schema.brand("AutomationId"));
export type AutomationId = typeof AutomationId.Type;

/**
 * A persisted automation as surfaced to clients and MCP callers.
 */
export const Automation = Schema.Struct({
  id: AutomationId,
  /** Thread the automation was created from (origin / default target). */
  originThreadId: ThreadId,
  /** Thread the scheduled message is delivered to. */
  targetThreadId: ThreadId,
  /** Standard 5/6-field cron expression. */
  cronExpression: TrimmedNonEmptyString,
  /** IANA timezone the cron expression is evaluated in; null = server local. */
  timezone: Schema.NullOr(TrimmedNonEmptyString),
  /** Message text delivered to the target thread on each fire. */
  messageText: TrimmedNonEmptyString,
  enabled: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  /** Next scheduled fire time (ISO 8601). */
  nextRunAt: IsoDateTime,
  /** Last time the automation actually dispatched a turn, if ever. */
  lastRunAt: Schema.NullOr(IsoDateTime),
  /** Last error encountered while firing, if any. */
  lastError: Schema.NullOr(Schema.String),
});
export type Automation = typeof Automation.Type;

/**
 * Input for creating an automation. `targetThreadId` defaults to the origin
 * thread when omitted (the MCP route fills it from the request path).
 */
export const CreateAutomationInput = Schema.Struct({
  originThreadId: ThreadId,
  targetThreadId: Schema.optional(ThreadId),
  cronExpression: TrimmedNonEmptyString,
  timezone: Schema.optional(TrimmedNonEmptyString),
  messageText: TrimmedNonEmptyString,
});
export type CreateAutomationInput = typeof CreateAutomationInput.Type;

export const AutomationsListInput = Schema.Struct({
  /** When provided, only automations whose origin is this thread. */
  originThreadId: Schema.optional(ThreadId),
});
export type AutomationsListInput = typeof AutomationsListInput.Type;

export const AutomationsList = Schema.Struct({
  automations: Schema.Array(Automation),
});
export type AutomationsList = typeof AutomationsList.Type;

export const AutomationsDeleteInput = Schema.Struct({
  id: AutomationId,
});
export type AutomationsDeleteInput = typeof AutomationsDeleteInput.Type;

export const AutomationsSetEnabledInput = Schema.Struct({
  id: AutomationId,
  enabled: Schema.Boolean,
});
export type AutomationsSetEnabledInput = typeof AutomationsSetEnabledInput.Type;

/**
 * Domain error for automation operations (validation, persistence, unknown id).
 */
export class AutomationsError extends Schema.TaggedErrorClass<AutomationsError>()(
  "AutomationsError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
