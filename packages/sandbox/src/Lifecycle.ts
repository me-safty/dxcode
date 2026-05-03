import type { SandboxLifecycleStatus } from "@t3tools/contracts";

export const SANDBOX_TERMINAL_STATUSES = [
  "archived",
  "failed",
  "terminated",
] as const satisfies ReadonlyArray<SandboxLifecycleStatus>;

export const SANDBOX_ACTIVE_STATUSES = [
  "requested",
  "queued",
  "provisioning",
  "starting",
  "ready",
  "running",
  "idle",
  "archiving",
] as const satisfies ReadonlyArray<SandboxLifecycleStatus>;

const ALLOWED_TRANSITIONS: ReadonlyMap<
  SandboxLifecycleStatus,
  ReadonlySet<SandboxLifecycleStatus>
> = new Map([
  ["requested", new Set(["queued", "provisioning", "starting", "failed", "terminated"])],
  ["queued", new Set(["provisioning", "starting", "failed", "terminated"])],
  ["provisioning", new Set(["starting", "ready", "failed", "terminated"])],
  ["starting", new Set(["ready", "running", "failed", "terminated"])],
  ["ready", new Set(["running", "idle", "archiving", "failed", "terminated"])],
  ["running", new Set(["ready", "idle", "archiving", "failed", "terminated"])],
  ["idle", new Set(["running", "archiving", "failed", "terminated"])],
  ["archiving", new Set(["archived", "failed", "terminated"])],
  ["archived", new Set()],
  ["failed", new Set(["queued", "provisioning", "starting", "archiving", "terminated"])],
  ["terminated", new Set()],
]);

export function isTerminalSandboxStatus(status: SandboxLifecycleStatus): boolean {
  return (SANDBOX_TERMINAL_STATUSES as ReadonlyArray<SandboxLifecycleStatus>).includes(status);
}

export function isActiveSandboxStatus(status: SandboxLifecycleStatus): boolean {
  return (SANDBOX_ACTIVE_STATUSES as ReadonlyArray<SandboxLifecycleStatus>).includes(status);
}

export function isRecoverableSandboxStatus(status: SandboxLifecycleStatus): boolean {
  return status === "failed" || status === "queued" || status === "provisioning";
}

export function canTransitionSandboxLifecycle(
  from: SandboxLifecycleStatus,
  to: SandboxLifecycleStatus,
): boolean {
  return from === to || (ALLOWED_TRANSITIONS.get(from)?.has(to) ?? false);
}

export function transitionSandboxLifecycle(
  from: SandboxLifecycleStatus,
  to: SandboxLifecycleStatus,
): SandboxLifecycleStatus {
  if (!canTransitionSandboxLifecycle(from, to)) {
    throw new Error(`Invalid Sandbox lifecycle transition: ${from} -> ${to}`);
  }
  return to;
}
