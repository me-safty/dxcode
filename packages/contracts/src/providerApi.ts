import * as Schema from "effect/Schema";
export const ProbeCodexUsageInput = Schema.Struct({
  shadowHomePath: Schema.String,
  binaryPath: Schema.String,
});
export type ProbeCodexUsageInput = typeof ProbeCodexUsageInput.Type;

export const CodexUsageWindow = Schema.Struct({
  usedPercent: Schema.Number,
  resetsAt: Schema.optionalKey(Schema.Number),
  windowDurationMins: Schema.optionalKey(Schema.Number),
});
export type CodexUsageWindow = typeof CodexUsageWindow.Type;

export const CodexUsageSnapshot = Schema.Struct({
  email: Schema.optionalKey(Schema.String),
  planType: Schema.optionalKey(Schema.String),
  primary: Schema.optionalKey(CodexUsageWindow),
  secondary: Schema.optionalKey(CodexUsageWindow),
  rateLimitReachedType: Schema.optionalKey(Schema.String),
});
export type CodexUsageSnapshot = typeof CodexUsageSnapshot.Type;

export const ProbeCodexUsageResult = Schema.Struct({
  status: Schema.Literals(["success", "error"]),
  usage: Schema.optionalKey(CodexUsageSnapshot),
  resolvedHomePath: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
});
export type ProbeCodexUsageResult = typeof ProbeCodexUsageResult.Type;

export const LoginCodexAccountInput = Schema.Struct({
  shadowHomePath: Schema.String,
  binaryPath: Schema.String,
});
export type LoginCodexAccountInput = typeof LoginCodexAccountInput.Type;

export const LoginCodexAccountResult = Schema.Struct({
  status: Schema.Literals(["success", "error"]),
  error: Schema.optionalKey(Schema.String),
});
export type LoginCodexAccountResult = typeof LoginCodexAccountResult.Type;

export const ScanCodexProfilesInput = Schema.Struct({
  basePath: Schema.String,
});
export type ScanCodexProfilesInput = typeof ScanCodexProfilesInput.Type;

export const ScanCodexProfilesResult = Schema.Struct({
  status: Schema.Literals(["success", "error"]),
  profiles: Schema.optionalKey(Schema.Array(Schema.String)),
  error: Schema.optionalKey(Schema.String),
});
export type ScanCodexProfilesResult = typeof ScanCodexProfilesResult.Type;
