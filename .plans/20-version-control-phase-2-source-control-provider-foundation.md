# Version Control Phase 2: Source-Control Providers

Status: **Completed and expanded**
Last reviewed: 2026-07-13

## Outcome

Hosted repository and change-request operations are separate from local VCS drivers.

- `packages/contracts/src/sourceControl.ts` defines provider-neutral wire shapes.
- `apps/server/src/sourceControl/SourceControlProvider.ts` defines the service boundary.
- discovery, registry, repository service, and process/API clients live in `apps/server/src/sourceControl`.
- GitHub, GitLab, Bitbucket, and Azure DevOps providers have dedicated implementations and tests.
- `packages/shared/src/sourceControl.ts` owns reusable URL/reference parsing.
- `packages/client-runtime/src/state/sourceControl.ts` and web source-control state/actions expose provider-neutral UI behavior.

## Invariants

- Local Git status/branch/worktree behavior remains in VCS services.
- Hosted auth, repository metadata, pull/merge requests, reviews, and publishing remain in source-control providers.
- Unsupported capabilities produce typed errors instead of provider-name fallthrough.
- External CLI/API JSON is schema-decoded with useful context and rate/auth failures remain distinguishable.
- Provider discovery is cached/coalesced and explicitly refreshable.
- Secrets and tokens are redacted from logs and user-facing errors.

## Adding a provider

Implement provider discovery/auth, repository resolution, supported change-request operations, reference parsing, and contract tests before enabling UI actions. Capability-gate incomplete operations.

## Validation

Run source-control provider and client state tests with `vp test`, use `vp run test` after contract changes, then run the repository baseline.
