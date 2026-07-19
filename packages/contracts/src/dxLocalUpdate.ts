import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { UpstreamSyncSession, UpstreamTarget } from "./upstreamSync.ts";

export const DX_REMOTE_CHECK_INTERVAL_HOURS = 12;
export const DX_REMOTE_STARTUP_DELAY_SECONDS = 30;

export const DxBuildProvenance = Schema.Struct({
  flavor: Schema.Literal("dx"),
  sourceCommit: TrimmedNonEmptyString,
  builtAt: IsoDateTime,
  dirty: Schema.Literal(false),
});
export type DxBuildProvenance = typeof DxBuildProvenance.Type;

export const DxArtifactManifest = Schema.Struct({
  artifactPath: TrimmedNonEmptyString,
  sourceCommit: TrimmedNonEmptyString,
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  bundleId: TrimmedNonEmptyString,
});
export type DxArtifactManifest = typeof DxArtifactManifest.Type;

export const DxUpdateReason = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("origin-dx-main"),
    installedCommit: TrimmedNonEmptyString,
    remoteCommit: TrimmedNonEmptyString,
    commitsBehind: NonNegativeInt,
  }),
  Schema.Struct({ kind: Schema.Literal("upstream-nightly"), target: UpstreamTarget }),
]);
export type DxUpdateReason = typeof DxUpdateReason.Type;

export const DxPublishPhase = Schema.Literals([
  "validating",
  "committing-sync",
  "pushing-sync",
  "refreshing-main",
  "fast-forwarding-main",
  "pushing-main",
  "verifying-identity",
]);
export type DxPublishPhase = typeof DxPublishPhase.Type;

export const DxBuildPhase = Schema.Literals([
  "validating-source",
  "building",
  "hashing",
  "validating-artifact",
  "smoke-testing",
]);
export type DxBuildPhase = typeof DxBuildPhase.Type;

export const DxUpdatePhase = Schema.Literals([
  "prepared",
  "verifying",
  "awaiting-publish",
  "publishing",
  "building",
  "awaiting-install",
  "installing",
  "restart-pending",
  "complete",
  "recoverable",
]);
export type DxUpdatePhase = typeof DxUpdatePhase.Type;

export const DxUpdatePlan = Schema.Struct({
  id: TrimmedNonEmptyString,
  sourceProjectId: ProjectId,
  installedCommit: Schema.NullOr(TrimmedNonEmptyString),
  remoteCommitBeforePublish: TrimmedNonEmptyString,
  syncSessionId: Schema.NullOr(TrimmedNonEmptyString),
  reasons: Schema.Array(DxUpdateReason),
  createdAt: IsoDateTime,
});
export type DxUpdatePlan = typeof DxUpdatePlan.Type;

export const DxUpdateSession = Schema.Struct({
  id: TrimmedNonEmptyString,
  sourceCommit: TrimmedNonEmptyString,
  remoteCommitBeforePublish: TrimmedNonEmptyString,
  syncSessionId: Schema.NullOr(TrimmedNonEmptyString),
  artifact: Schema.NullOr(DxArtifactManifest),
  phase: DxUpdatePhase,
});
export type DxUpdateSession = typeof DxUpdateSession.Type;

export const DxLocalUpdateState = Schema.Union([
  Schema.Struct({ status: Schema.Literal("disabled"), reason: TrimmedNonEmptyString }),
  Schema.Struct({ status: Schema.Literal("checking"), checkedAt: Schema.NullOr(IsoDateTime) }),
  Schema.Struct({
    status: Schema.Literal("up-to-date"),
    sourceCommit: TrimmedNonEmptyString,
    checkedAt: IsoDateTime,
  }),
  Schema.Struct({
    status: Schema.Literal("available"),
    reasons: Schema.Array(DxUpdateReason),
    checkedAt: IsoDateTime,
  }),
  Schema.Struct({ status: Schema.Literal("reviewing"), session: UpstreamSyncSession }),
  Schema.Struct({ status: Schema.Literal("verifying"), sessionId: TrimmedNonEmptyString }),
  Schema.Struct({ status: Schema.Literal("awaiting-publish"), sessionId: TrimmedNonEmptyString }),
  Schema.Struct({ status: Schema.Literal("publishing"), phase: DxPublishPhase }),
  Schema.Struct({ status: Schema.Literal("building"), phase: DxBuildPhase }),
  Schema.Struct({ status: Schema.Literal("awaiting-install"), artifact: DxArtifactManifest }),
  Schema.Struct({ status: Schema.Literal("installing") }),
  Schema.Struct({ status: Schema.Literal("restart-pending") }),
  Schema.Struct({
    status: Schema.Literal("error"),
    message: TrimmedNonEmptyString,
    canRetry: Schema.Boolean,
  }),
]);
export type DxLocalUpdateState = typeof DxLocalUpdateState.Type;

const DxUpdateFailureFields = {
  operation: TrimmedNonEmptyString,
  message: TrimmedNonEmptyString,
  canRetry: Schema.Boolean,
};

export class DxUpdateCheckError extends Schema.TaggedErrorClass<DxUpdateCheckError>()(
  "DxUpdateCheckError",
  DxUpdateFailureFields,
) {}

export class DxUpdatePrepareError extends Schema.TaggedErrorClass<DxUpdatePrepareError>()(
  "DxUpdatePrepareError",
  DxUpdateFailureFields,
) {}

export class DxPublishError extends Schema.TaggedErrorClass<DxPublishError>()(
  "DxPublishError",
  DxUpdateFailureFields,
) {}

export const DxUpdateCheckReason = Schema.Literals(["startup", "poll", "manual"]);
export type DxUpdateCheckReason = typeof DxUpdateCheckReason.Type;

export const DxUpdateCheckInput = Schema.Struct({ reason: DxUpdateCheckReason });
export const DxUpdatePrepareInput = Schema.Struct({});
export const DxPublishAndBuildInput = Schema.Struct({ planId: TrimmedNonEmptyString });

export const DxLocalInstallInput = Schema.Struct({
  sessionId: TrimmedNonEmptyString,
  artifact: DxArtifactManifest,
});
export type DxLocalInstallInput = typeof DxLocalInstallInput.Type;

export const DxLocalInstallResult = Schema.Union([
  Schema.Struct({ status: Schema.Literal("started") }),
  Schema.Struct({ status: Schema.Literal("unavailable"), message: TrimmedNonEmptyString }),
]);
export type DxLocalInstallResult = typeof DxLocalInstallResult.Type;
