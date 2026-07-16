# Environment Server Authentication and Authorization

Status: **Completed and evolved**
Last reviewed: 2026-07-13

## Current model

Environment access is capability-based and shared across browser, desktop, CLI, mobile, SSH-launched, and hosted clients.

- `packages/contracts/src/auth.ts` defines schema-only auth contracts.
- `apps/server/src/auth` owns environment policy, one-time pairing grants, sessions, DPoP support, HTTP routes, and secret storage.
- `packages/client-runtime/src/authorization` and `state/auth.ts` own cross-client authorization behavior.
- `apps/web/src/environments/primary/auth.ts` adapts the browser environment.
- `apps/desktop/src/backend/DesktopLocalEnvironmentAuth.ts` owns trusted local desktop bootstrap.
- `docs/cloud/environment-auth.md` documents current scopes and exchanges.

## Security invariants

- Pairing/bootstrap credentials are short-lived and one-time-use.
- Browser clients exchange bootstrap credentials for an HttpOnly session cookie.
- Non-browser clients use scoped bearer access tokens; credentials are never placed in normal WebSocket URLs.
- WebSocket connections use short-lived tickets derived from an authenticated session.
- Every RPC/HTTP operation checks the required scope; authentication alone does not grant all operations.
- Environment and relay credentials have separate issuers and trust boundaries.
- Revocation and expiry are enforced server-side, and secrets are never persisted in ordinary web state.

## Change requirements

Auth changes require Effect Schema boundary tests, scope escalation/downgrade tests, replay/expiry coverage, and verification across browser-cookie and bearer-token paths. Update `docs/cloud/environment-auth.md` with any contract change.

## Validation

Run auth and authorization tests with `vp test`, use `vp run test` for cross-client contract changes, then run the repository baseline.
