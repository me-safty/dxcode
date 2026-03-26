# Mobile Remote Access Roadmap

## Target State

- The home desktop remains the single owner of repositories, worktrees, provider runtimes, sessions, and chat history.
- Mobile acts only as a paired remote client.
- Remote transport is HTTPS/WSS only.
- TLS 1.3 is the minimum supported transport version.
- Shared layers are contracts, auth, pairing, transport, and read-model sync.
- Web UI and native mobile UI remain separate presentation layers.

## Supported Secure Connection Modes

- `tailscale-serve`
  - Private tailnet access over HTTPS through Tailscale Serve.
- `direct-tailscale-tls`
  - Direct HTTPS from T3 itself using a Tailscale-issued certificate on `*.ts.net`.
- `reverse-proxy`
  - HTTPS fronted by Caddy or Cloudflare Tunnel, with T3 as the origin.
- `direct-public-tls`
  - Direct HTTPS from T3 itself with operator-provided certificates.
  - This mode is optional and should follow the other modes.

## Phase 1: Remote Server Platform

- Extend server-authoritative settings with a `remote` section.
  - `enabled`
  - `mode`
  - `publicBaseUrl`
  - `listenHost`
  - `listenPort`
  - `tls`
  - `pairing`
  - `sessions`
  - `pairedDevices`
- Replace the current HTTP-only startup path with a transport layer that can run HTTP locally and HTTPS remotely.
- Enforce TLS 1.3 for all remote HTTPS modes.
- Unify authentication across:
  - HTTP routes
  - attachment delivery
  - WebSocket upgrades
- Replace the current query-token remote model with paired-device sessions.
- Add pairing flows:
  - one-time pairing code
  - QR bootstrap
  - session issuance
  - session refresh
  - session revocation
- Add a device registry with per-device revocation and audit metadata.
- Add desktop controls for remote access:
  - enable or disable remote mode
  - show current connection mode
  - show current reachable URL
  - rotate pairing state
  - revoke devices

### Phase 1 Exit Criteria

- A paired client can connect over HTTPS/WSS and operate the server without local repositories on the client device.
- Attachments, snapshots, chat actions, git actions, and terminal actions use the same authenticated session model.
- Raw unauthenticated remote HTTP access is no longer part of the target flow.

## Phase 2: Mobile Web Shell

- Create `apps/mobile` as the long-lived mobile app container.
- Use Expo as the mobile application base.
- Ship the first mobile client as a WebView host for the existing remote web app.
- Keep the shell thin and focused on device integration:
  - secure session storage
  - deep links
  - biometric gate
  - app lifecycle handling
  - network reachability and reconnect UX
  - push-notification entry points if needed later
- Do not duplicate remote business logic in the shell.
- Keep the existing web client as the only rendered product UI in this phase.

### Phase 2 Exit Criteria

- Users can install a mobile app, pair it to a desktop, and continue chats and repo work remotely through the hosted web UI.
- The mobile app owns device integration only, not feature logic.

## Phase 3: Shared Client Core

- Extract a shared remote client package from the current web implementation.
- Keep `packages/contracts` as the source of truth for all RPC, orchestration, and settings schemas.
- Move shared client concerns out of `apps/web` and into a reusable package:
  - connection configuration
  - session bootstrap and refresh
  - WebSocket transport
  - snapshot sync
  - domain event replay
  - terminal event subscriptions
- Keep browser-specific and DOM-specific rendering code in `apps/web`.
- Add React Native platform adapters only where platform behavior differs.

### Phase 3 Exit Criteria

- Web and mobile-native clients can reuse the same remote client core without sharing UI code.
- Deleting the WebView shell later does not require transport or auth redesign.

## Phase 4: Native Mobile Client

- Replace the WebView-first experience with native React Native screens inside the same `apps/mobile` app.
- Deliver native screens in this order:
  - pairing and server selection
  - thread list
  - chat thread
  - composer
  - settings
  - lightweight diff inspection
- Keep advanced repository tooling behind the shared remote client core.
- Add native-first interaction models:
  - platform navigation
  - native sheets
  - native menus
  - safe-area aware layouts
  - keyboard-first mobile composer behavior
- Decide feature-by-feature whether to:
  - implement native UI
  - keep a temporary embedded web fallback
  - postpone mobile support for that capability

### Phase 4 Exit Criteria

- The mobile app no longer depends on the web UI for its primary flows.
- Web shell fallback, if still present, is limited to intentionally deferred features.

## Delivery Rules

- Do not build repository sync for mobile.
- Do not split source-of-truth ownership across desktop and mobile.
- Do not share DOM UI code with native mobile.
- Do share contracts, auth, pairing, transport, and read-model synchronization.
