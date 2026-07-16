# Version Control Phase 1: VCS Driver Foundation

Status: **Completed**
Last reviewed: 2026-07-13

## Outcome

Local version-control mechanics are behind provider-neutral VCS contracts and server services:

- `packages/contracts/src/vcs.ts` defines schema-only capabilities, repository identity, freshness, results, and typed errors.
- `apps/server/src/vcs/VcsDriver.ts` defines the driver service boundary.
- `VcsDriverRegistry.ts` selects a driver.
- `VcsProcess.ts` owns bounded command execution and output/error limits.
- `GitVcsDriver.ts` and `GitVcsDriverCore.ts` implement Git behavior.
- provisioning, project config, and status broadcasting are separate services.
- `packages/client-runtime/src/state/vcs*.ts` owns cross-client reactive VCS state and command scheduling.

## Invariants

- Local VCS operations do not depend on hosted-provider authentication.
- Capabilities express unsupported operations explicitly.
- Repository detection and freshness are typed and observable.
- Command execution has cancellation, timeout, output limits, and redacted errors.
- Driver contract tests cover all implementations with real temporary repositories where practical.
- Runtime logic belongs outside `packages/contracts`.

## Follow-up policy

New drivers must pass the shared contract harness before UI exposure. Git-specific fallback behavior must remain inside the Git driver and may not leak into generic client state.

## Validation

Run VCS driver, process, registry, and client-runtime state tests with `vp test`, then the repository baseline.
