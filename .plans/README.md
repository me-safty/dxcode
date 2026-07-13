# Engineering Plans

Last reviewed: 2026-07-13

This directory contains implementation plans and historical design records. It is not the source of truth for shipped behavior. Current behavior lives in code, tests, `AGENTS.md`, and `docs/`.

## How plans are maintained

Every plan declares one of these states:

- **Active**: approved direction with remaining implementation work.
- **Completed**: the intent shipped; current code links replace old file-by-file instructions.
- **Superseded**: the problem is still relevant, but the proposed architecture or toolchain is no longer valid.
- **Historical**: retained only to explain an old migration or review effort.

Plans must use repository-relative paths and the current vocabulary: `apps/web` rather than `apps/renderer`, Effect Schema rather than Zod, and Vite+ (`vp`) rather than Bun/Turbo commands. `packages/contracts` remains schema-only; reusable runtime behavior belongs in `packages/shared` or `packages/client-runtime`.

The baseline completion gate is:

```bash
vp check
vp run typecheck
```

Use `vp test` for focused Vite+ tests and `vp run test` for package-script coverage. Native mobile changes also require `vp run lint:mobile`.

## Active work

| Plan | State | Current focus |
| --- | --- | --- |
| [04: Decompose ChatView](./04-split-chatview-component.md) | Active | Reduce the remaining orchestration and terminal ownership in `ChatView.tsx` without changing behavior. |

## Completed or superseded foundations

| Plans | Current home |
| --- | --- |
| [01](./01-shared-model-normalization.md), [02](./02-typed-ipc-boundaries.md), [05](./05-zod-persisted-state-validation.md) | Effect schemas in `packages/contracts`; runtime normalization in `packages/shared` and `packages/client-runtime`; typed desktop IPC in `apps/desktop/src/ipc`. |
| [03](./03-split-codex-app-server-manager.md), [06](./06-provider-logstream-lifecycle.md), [10](./10-unify-process-session-abstraction.md), [11](./11-effect.md), [12](./12-effect-new.md), [15](./15-effect-server.md) | Effect-scoped server services, provider adapters, terminal services, and dedicated protocol packages. |
| [07](./07-ci-quality-gates.md), [08](./08-precommit-format-and-lint.md), [09](./09-event-state-test-expansion.md), [13](./13-provider-service-integration-tests.md) | Vite+ CI, `vp staged`, and colocated unit/integration tests. |
| [14](./14-server-authoritative-event-sourcing-cleanup.md), [Spec cutover](./spec-1-1-cutover-plan.md), [Spec matrix](./spec-contract-matrix.md) | Server-authoritative orchestration, additive SQLite migrations, projections, reactors, and runtime receipts. |
| [17 runtime](./17-provider-neutral-runtime-determinism.md), [17 Claude](./17-claude-agent.md) | Provider-neutral orchestration plus registered Codex, Claude, Cursor, Grok, and OpenCode adapters. |
| [18 auth](./18-server-auth-model.md), [19 remote](./19-remote-endpoints-hosted-static.md) | Scoped environment auth, WebSocket tickets, saved environments, advertised endpoints, Tailscale, SSH, and hosted pairing. |
| [19 VCS](./19-version-control-phase-1-vcs-driver-foundation.md), [20 source control](./20-version-control-phase-2-source-control-provider-foundation.md), [branch/worktree plans](./git-integration-branch-picker-worktrees.md) | VCS drivers, source-control providers, and atom-backed branch/worktree UX. |
| [Effect Atom](./effect-atom.md) | Effect Atom RPC/state in `packages/client-runtime` and `apps/web`; React Query and the old NativeApi facades are gone. |

## Historical review records

- [PR #89 remediation phases](./16-pr89-review-remediation-phases.md)
- [PR #89 consolidated checklist](./16c-pr89-remediation-checklist.md)

When a completed plan needs new work, create a new active plan or explicitly reopen it with a fresh current-state audit. Do not append new tasks to a historical checklist.
