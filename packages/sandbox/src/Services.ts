import type {
  SandboxServiceDescriptor,
  SandboxServiceId,
  SandboxServiceKind,
  SandboxServiceRequest,
  SandboxServiceStatus,
} from "@t3tools/contracts";

export interface NormalizedSandboxServiceRequest {
  readonly serviceId: SandboxServiceId;
  readonly kind: SandboxServiceKind;
  readonly required: boolean;
  readonly label?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface SandboxServiceReadiness {
  readonly ready: boolean;
  readonly requiredReady: boolean;
  readonly requiredTotal: number;
  readonly requiredReadyCount: number;
  readonly optionalTotal: number;
  readonly optionalReadyCount: number;
  readonly failed: ReadonlyArray<SandboxServiceDescriptor>;
  readonly degraded: ReadonlyArray<SandboxServiceDescriptor>;
}

function serviceKey(kind: SandboxServiceKind, occurrence: number): SandboxServiceId {
  return (occurrence === 1 ? kind : `${kind}-${occurrence}`) as SandboxServiceId;
}

function isReadyStatus(status: SandboxServiceStatus): boolean {
  return status === "ready";
}

export function normalizeSandboxServiceRequests(
  requests: ReadonlyArray<SandboxServiceRequest> | undefined,
): ReadonlyArray<NormalizedSandboxServiceRequest> {
  const occurrenceByKind = new Map<SandboxServiceKind, number>();
  return (requests ?? []).map((request) => {
    const nextOccurrence = (occurrenceByKind.get(request.kind) ?? 0) + 1;
    occurrenceByKind.set(request.kind, nextOccurrence);
    const normalized: {
      serviceId: SandboxServiceId;
      kind: SandboxServiceKind;
      required: boolean;
      label?: string;
      metadata?: Record<string, unknown>;
    } = {
      serviceId: request.serviceId ?? serviceKey(request.kind, nextOccurrence),
      kind: request.kind,
      required: request.required,
    };
    if (request.label !== undefined) {
      normalized.label = request.label;
    }
    if (request.metadata !== undefined) {
      normalized.metadata = request.metadata;
    }
    return normalized;
  });
}

export function areRequiredSandboxServicesReady(input: {
  readonly requested: ReadonlyArray<NormalizedSandboxServiceRequest>;
  readonly descriptors: ReadonlyArray<SandboxServiceDescriptor>;
}): boolean {
  const byId = new Map(input.descriptors.map((service) => [service.serviceId, service]));
  return input.requested
    .filter((request) => request.required)
    .every((request) => isReadyStatus(byId.get(request.serviceId)?.status ?? "requested"));
}

export function getSandboxServiceReadiness(input: {
  readonly requested: ReadonlyArray<NormalizedSandboxServiceRequest>;
  readonly descriptors: ReadonlyArray<SandboxServiceDescriptor>;
}): SandboxServiceReadiness {
  const byId = new Map(input.descriptors.map((service) => [service.serviceId, service]));
  const required = input.requested.filter((request) => request.required);
  const optional = input.requested.filter((request) => !request.required);
  const requiredReadyCount = required.filter((request) =>
    isReadyStatus(byId.get(request.serviceId)?.status ?? "requested"),
  ).length;
  const optionalReadyCount = optional.filter((request) =>
    isReadyStatus(byId.get(request.serviceId)?.status ?? "requested"),
  ).length;
  const failed = input.descriptors.filter((service) => service.status === "failed");
  const degraded = input.descriptors.filter((service) => service.status === "degraded");

  return {
    requiredTotal: required.length,
    requiredReadyCount,
    optionalTotal: optional.length,
    optionalReadyCount,
    requiredReady: requiredReadyCount === required.length,
    ready: requiredReadyCount === required.length && failed.length === 0,
    failed,
    degraded,
  };
}
