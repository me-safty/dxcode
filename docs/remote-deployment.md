# Local T3 Server Deployment

The active production-like setup runs T3 on this Windows PC and exposes it through Cloudflare Tunnel.

## Topology

```text
Convex -> https://t3.olumbe.com -> Cloudflare Tunnel t3code-local -> 127.0.0.1:3773
```

Slack does not call the local T3 server directly. It calls Convex:

```text
https://<your-convex-site>/slack/webhook
```

Convex then calls the local T3 execution bridge at `https://t3.olumbe.com`.

## Windows Tasks

`t3code-server`:

```text
node apps/server/dist/bin.mjs --port 3773 --host 127.0.0.1 --no-browser
```

`t3code-tunnel`:

```text
C:\Program Files (x86)\cloudflared\cloudflared.exe tunnel run t3code-local
```

Start the whole local stack:

```cmd
scripts\start-t3code-prod.cmd
```

## Environment

Local T3 server:

```text
ORCHESTRATOR_BASE_URL=https://<your-convex-site>
T3_EXECUTION_BRIDGE_SHARED_SECRET=<shared-secret>
T3_DEFAULT_PROVIDER_INSTANCE_ID=claudeAgent
T3_DEFAULT_MODEL=claude-sonnet-4-6
```

Convex:

```text
T3_EXECUTION_BRIDGE_BASE_URL=https://t3.olumbe.com
T3_EXECUTION_BRIDGE_SHARED_SECRET=<shared-secret>
LINEAR_DEFAULT_WORKSPACE_ROOT=C:\Users\Vivek\Affil\t3code
```

## Checks

```powershell
schtasks /query /tn t3code-server /fo LIST /v
schtasks /query /tn t3code-tunnel /fo LIST /v
curl.exe -i http://127.0.0.1:3773/
curl.exe -i https://t3.olumbe.com/
curl.exe -i -X POST https://t3.olumbe.com/api/execution/runs/status
```

Expected unauthenticated bridge response:

- `401`: bridge route is live and the shared secret is configured
- `503`: route is live but local T3 is missing `T3_EXECUTION_BRIDGE_SHARED_SECRET`
- `404`: running server build does not include the bridge route, or the tunnel is not reaching it

## Provider Auth

Authenticate Codex/Claude on this Windows user account because the scheduled task runs as this user. The local T3 server launches provider sessions from the same machine and worktree paths.

## Notes

Remote access docs and Tailscale pairing notes can still exist elsewhere, but this file is the active deployment path for the local-PC worker.
