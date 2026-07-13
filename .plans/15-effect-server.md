# Effect-Native Server Runtime

Status: **Completed and superseded**
Last reviewed: 2026-07-13

## Original intent

Rewrite server startup and remaining Git/terminal managers around Effect services, potentially using experimental socket APIs.

## Current state

The server entrypoint and service graph are Effect-native. `apps/server/src/ws.ts` exposes the typed RPC/WebSocket surface, while domain runtime modules own scoped startup and shutdown. Git concerns are split between `apps/server/src/vcs`, `apps/server/src/git`, and `apps/server/src/sourceControl`; terminals live in `apps/server/src/terminal`.

The repository is Node 24/pnpm 11 based. Server implementation may use platform-specific Effect modules, but plans must not assume Bun or prescribe an unstable socket API without a current source audit.

## Maintenance rules

- Use the existing server runtime composition and typed RPC/HTTP APIs.
- Treat experimental Effect APIs as version-coupled; inspect `.repos/effect-smol` before adoption.
- Keep bounded commands, PTYs, VCS operations, and provider protocols as distinct services.
- Prove scoped cleanup and cancellation in tests.

## Validation

Run affected server tests with `vp test`, then the repository baseline.
