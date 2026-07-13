# Remote Environments and Hosted Pairing

Status: **Completed and expanded**
Last reviewed: 2026-07-13

## Current state

Remote connectivity is modeled as saved environments plus advertised endpoints rather than one hard-coded server URL.

- `packages/shared/src/advertisedEndpoint.ts` owns reusable endpoint selection semantics.
- `packages/client-runtime/src/environment/endpoint.ts` owns cross-client endpoint handling.
- `apps/desktop/src/backend/tailscaleEndpointProvider.ts` discovers desktop Tailscale endpoints.
- `packages/ssh` and desktop SSH environment modules manage remote launch and port forwarding.
- `apps/server/src/cloud/ManagedEndpointRuntime.ts` owns managed endpoint runtime behavior.
- `docs/user/remote-access.md` documents LAN, Tailscale, hosted web, CLI, and SSH flows.

The hosted app connects directly to a paired backend; it is not a traffic proxy. HTTPS-hosted pages require HTTPS/WSS-compatible backend endpoints because browsers block mixed content.

## Invariants

- Pairing links carry a one-time credential in the URL fragment, not the query string.
- Endpoint preference is based on stable endpoint identity/type, not a transient IP string.
- Loopback, LAN, Tailnet, HTTPS, SSH-forwarded, and managed endpoints remain explicit choices.
- Reachability and transport security are surfaced honestly; an endpoint is not advertised as hosted-web compatible unless verified.
- Tailscale is an optional endpoint provider, not a core architecture dependency.

## Future endpoint providers

New tunnel providers must implement the existing endpoint and authorization boundaries, include cleanup/restart behavior, and avoid creating a second pairing model.

## Validation

Run endpoint, auth, SSH, and managed-runtime tests with `vp test`, then the repository baseline.
