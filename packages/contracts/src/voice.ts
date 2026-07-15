import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const VoiceCredentialStatus = Schema.Struct({
  configured: Schema.Boolean,
});
export type VoiceCredentialStatus = typeof VoiceCredentialStatus.Type;

export const VoiceCredentialInput = Schema.Struct({
  apiKey: TrimmedNonEmptyString,
});
export type VoiceCredentialInput = typeof VoiceCredentialInput.Type;

export const VoiceSessionAccess = Schema.Struct({
  clientSecret: Schema.String,
  expiresAt: Schema.Number,
  websocketUrl: Schema.String,
});
export type VoiceSessionAccess = typeof VoiceSessionAccess.Type;

export const VoiceApiErrorReason = Schema.Literals([
  "credential_not_configured",
  "credential_invalid",
  "upstream_unavailable",
  "secret_store_failed",
]);
export type VoiceApiErrorReason = typeof VoiceApiErrorReason.Type;

export class VoiceApiError extends Schema.TaggedErrorClass<VoiceApiError>()("VoiceApiError", {
  reason: VoiceApiErrorReason,
  message: Schema.String,
}) {}
