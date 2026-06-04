import * as Data from "effect/Data";

export class AutomationPluginError extends Data.TaggedError("AutomationPluginError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
