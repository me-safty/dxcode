# Bug: adding a project can hang on `Adding...` and time out `orchestration.dispatchCommand`

## Summary

When adding a project from the Projects sidebar in dev, the UI can get stuck on `Adding...` and eventually show:

`Request timed out: orchestration.dispatchCommand`

In this state, the project is not added from the UI and I cannot start a first conversation thread for that project.

## Environment

- T3 Code dev setup
- Reproduced on macOS
- Reproduced with the web app served by Vite and the app server on its separate WebSocket port

## Steps To Reproduce

1. Start T3 Code in dev mode where the web app is served by Vite and the server runs on its own WebSocket port.
2. Open the app.
3. In `Projects`, click `Add project`.
4. Enter a valid workspace path, for example:
   `/Users/magic/wholesomegarden/Codex/Branched+/t3code`
5. Click `Add`.

## Actual Behavior

- The button changes to `Adding...`
- The UI stays there until the client request times out
- The error shown is:
  `Request timed out: orchestration.dispatchCommand`
- Because the project add hangs, I also cannot start the first thread from that flow

## Expected Behavior

- The project should be created immediately
- The UI should navigate into a new thread draft for that project
- The add flow should not depend on the page origin matching the app server WebSocket origin

## Root Cause

The web client can fall back to the current page origin for its WebSocket connection.

In dev, that can mean it connects to the Vite dev server socket instead of the T3 Code app server socket. In my repro:

- page origin / Vite: `ws://localhost:5733`
- app server: `ws://localhost:3773`

So the UI request for `orchestration.dispatchCommand` is sent to the wrong socket target and hangs until timeout. The backend itself is healthy; direct RPC to the app server succeeds for:

- `project.create`
- `thread.create`
- `thread.turn.start`

## Suggested Fix

Centralize server connection resolution and make dev mode prefer the app server socket, not the current page origin.

One robust fallback is:

- use desktop bridge URL if present
- else use `VITE_WS_URL` if present
- else, in localhost dev, infer the paired app server port from the known Vite/app port gap
- only then fall back to the page origin

It is also worth using the same resolved server origin for related HTTP requests like attachment previews and project favicons so the app does not split RPC and asset requests across different origins.

## Notes

I found an adjacent release note in `v0.0.7` that says `fix: settings in sidebar, better add project flow` (#584), but I did not find an indexed GitHub issue that clearly describes this exact timeout/hanging behavior.
