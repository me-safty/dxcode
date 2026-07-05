# pathwayOS Connect Convex

This package is the Convex replacement path for the hosted pathwayOS Connect control plane.

The first implementation keeps Convex account and Connect state separate from remote transport
providers. Clerk plus Convex can support login, account/profile state, and sync features without
Cloudflare. Cloudflare Tunnel/DNS is treated as an optional remote endpoint provider and should only
be invoked when a user explicitly creates or enables a remote connection.

## Local Workflow

```sh
vp install
cd infra/connect-convex
vp run codegen
vp test run
vp run typecheck
```

Use `vp run dev` after the package is connected to a Convex project. Production deploys should use
Convex deploy keys in CI rather than user-local credentials.

Set `PATHWAYOS_CONNECT_URL` to the Convex site URL for new deployments. Existing
`PATHWAYOS_RELAY_URL` and `VITE_PATHWAYOS_RELAY_URL` settings remain supported as compatibility
aliases while the current client runtime is migrated.

## Boundary Rule

Remote provider calls are out of scope for login, profile, account sync, local pairing, and ordinary
environment listing. Provider readiness belongs in Connections/Remote Access UI states.
