import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

export const DEFAULT_UPSTREAM_POLICY = "nightly-tags" as const;
export const DEFAULT_UPSTREAM_CHECK_INTERVAL_HOURS = 12;
export const UPSTREAM_STARTUP_DELAY_SECONDS = 30;

export const UpstreamPolicy = Schema.Literals([
  "nightly-tags",
  "upstream-main",
  "stable-tags",
  "manual",
]);
export type UpstreamPolicy = typeof UpstreamPolicy.Type;

export const UpstreamTarget = Schema.Struct({
  policy: Schema.Literal("nightly-tags"),
  tag: TrimmedNonEmptyString,
  commit: TrimmedNonEmptyString,
  remote: Schema.Literal("upstream"),
});
export type UpstreamTarget = typeof UpstreamTarget.Type;

export const NightlyMetadata = Schema.Struct({
  tag: TrimmedNonEmptyString,
  publishedAt: IsoDateTime,
  releaseNotes: Schema.NullOr(Schema.String.check(Schema.isMaxLength(20_000))),
  htmlUrl: Schema.NullOr(TrimmedNonEmptyString),
});
export type NightlyMetadata = typeof NightlyMetadata.Type;

export const UpstreamSyncSessionStatus = Schema.Literals(["ready", "conflicted", "recoverable"]);
export type UpstreamSyncSessionStatus = typeof UpstreamSyncSessionStatus.Type;

export const UpstreamSyncSession = Schema.Struct({
  id: TrimmedNonEmptyString,
  sourceProjectId: ProjectId,
  target: UpstreamTarget,
  remoteTagObject: TrimmedNonEmptyString,
  branch: TrimmedNonEmptyString,
  worktreePath: TrimmedNonEmptyString,
  status: UpstreamSyncSessionStatus,
  conflictFiles: Schema.Array(TrimmedNonEmptyString),
  comparison: Schema.Struct({
    baseCommit: TrimmedNonEmptyString,
    upstreamFileCount: NonNegativeInt,
    dxFileCount: NonNegativeInt,
    overlappingFiles: Schema.Array(TrimmedNonEmptyString),
  }),
  threadId: Schema.NullOr(ThreadId),
  createdAt: IsoDateTime,
});
export type UpstreamSyncSession = typeof UpstreamSyncSession.Type;

export const UpstreamUpdateState = Schema.Union([
  Schema.Struct({ status: Schema.Literal("disabled"), reason: TrimmedNonEmptyString }),
  Schema.Struct({ status: Schema.Literal("paused") }),
  Schema.Struct({ status: Schema.Literal("checking"), checkedAt: Schema.NullOr(IsoDateTime) }),
  Schema.Struct({
    status: Schema.Literal("up-to-date"),
    integratedTag: Schema.NullOr(TrimmedNonEmptyString),
    integratedCommit: TrimmedNonEmptyString,
    checkedAt: IsoDateTime,
  }),
  Schema.Struct({
    status: Schema.Literal("dismissed"),
    target: UpstreamTarget,
    checkedAt: IsoDateTime,
  }),
  Schema.Struct({
    status: Schema.Literal("available"),
    target: UpstreamTarget,
    commitCount: NonNegativeInt,
    newerNightlyCount: NonNegativeInt,
    previousDismissedTag: Schema.NullOr(TrimmedNonEmptyString),
    release: Schema.NullOr(NightlyMetadata),
    checkedAt: IsoDateTime,
  }),
  Schema.Struct({
    status: Schema.Literal("session-active"),
    session: UpstreamSyncSession,
    newerTarget: Schema.NullOr(UpstreamTarget),
  }),
  Schema.Struct({
    status: Schema.Literal("error"),
    message: TrimmedNonEmptyString,
    canRetry: Schema.Boolean,
    checkedAt: Schema.NullOr(IsoDateTime),
  }),
]);
export type UpstreamUpdateState = typeof UpstreamUpdateState.Type;

export const UpstreamNotificationCursor = Schema.Struct({
  policy: UpstreamPolicy,
  dismissedTarget: Schema.NullOr(UpstreamTarget),
  paused: Schema.Boolean,
  activeSessionId: Schema.NullOr(TrimmedNonEmptyString),
});
export type UpstreamNotificationCursor = typeof UpstreamNotificationCursor.Type;

export const UpstreamSyncSettings = Schema.Struct({
  sourceProjectId: Schema.NullOr(ProjectId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  policy: UpstreamPolicy.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_UPSTREAM_POLICY))),
  checkIntervalHours: PositiveInt.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_UPSTREAM_CHECK_INTERVAL_HOURS)),
  ),
  paused: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  includeReleaseNotes: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
});
export type UpstreamSyncSettings = typeof UpstreamSyncSettings.Type;
export const DEFAULT_UPSTREAM_SYNC_SETTINGS: UpstreamSyncSettings = Schema.decodeSync(
  UpstreamSyncSettings,
)({});

const UpstreamFailureFields = {
  operation: TrimmedNonEmptyString,
  message: TrimmedNonEmptyString,
  canRetry: Schema.Boolean,
};

export class UpstreamCheckError extends Schema.TaggedErrorClass<UpstreamCheckError>()(
  "UpstreamCheckError",
  UpstreamFailureFields,
) {}

export class UpstreamPrepareError extends Schema.TaggedErrorClass<UpstreamPrepareError>()(
  "UpstreamPrepareError",
  UpstreamFailureFields,
) {}

export class UpstreamAbortError extends Schema.TaggedErrorClass<UpstreamAbortError>()(
  "UpstreamAbortError",
  UpstreamFailureFields,
) {}

export const UpstreamCheckReason = Schema.Literals(["startup", "poll", "manual"]);
export type UpstreamCheckReason = typeof UpstreamCheckReason.Type;

export const UpstreamCheckInput = Schema.Struct({ reason: UpstreamCheckReason });
export const UpstreamDismissInput = Schema.Struct({ target: UpstreamTarget });
export const UpstreamPrepareInput = Schema.Struct({ target: UpstreamTarget });
export const UpstreamAbortInput = Schema.Struct({ sessionId: TrimmedNonEmptyString });
