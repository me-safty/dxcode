# Orchestrator Deployment

This runbook covers the local production topology:

- the T3 server runs on this Windows PC at `127.0.0.1:3773`
- Cloudflare Tunnel `t3code-local` exposes it publicly at `https://t3.olumbe.com`
- Convex calls the local server bridge through that public URL
- Slack and Linear continue to call Convex public HTTP endpoints

## Local Services

Windows Task Scheduler owns the two long-running local services:

```text
t3code-server
  node apps/server/dist/bin.mjs --port 3773 --host 127.0.0.1 --no-browser

t3code-tunnel
  C:\Program Files (x86)\cloudflared\cloudflared.exe tunnel run t3code-local
```

Use the operator command from the repo root to start the server, tunnel, and desktop app:

```cmd
scripts\start-t3code-prod.cmd
```

## Convex Env

Run Convex commands from `apps/orchestrator` with the intended `CONVEX_DEPLOYMENT` selected.

```bash
bunx convex env set --prod T3_EXECUTION_BRIDGE_BASE_URL 'https://t3.olumbe.com'
bunx convex env set --prod T3_EXECUTION_BRIDGE_SHARED_SECRET '<same secret used by local T3 server>'
bunx convex env set --prod LINEAR_DEFAULT_WORKSPACE_ROOT 'C:\Users\Vivek\Affil\t3code'
```

Slack and Linear webhook URLs stay on Convex:

```text
https://<your-convex-site>/slack/webhook
https://<your-convex-site>/linear/webhook
```

Lifecycle callbacks from T3 use:

```text
POST https://<your-convex-site>/t3/task-runtime-events
```

So the local T3 server must have:

```text
ORCHESTRATOR_BASE_URL=https://<your-convex-site>
T3_EXECUTION_BRIDGE_SHARED_SECRET=<same secret configured in Convex>
T3_DEFAULT_PROVIDER_INSTANCE_ID=claudeAgent
T3_DEFAULT_MODEL=claude-sonnet-4-6
```

## Bridge Health Checks

```powershell
schtasks /query /tn t3code-server /fo LIST /v
schtasks /query /tn t3code-tunnel /fo LIST /v
curl.exe -i http://127.0.0.1:3773/
curl.exe -i https://t3.olumbe.com/
curl.exe -i -X POST https://t3.olumbe.com/api/execution/runs/status
```

Expected bridge result without auth:

- `401` means the route exists and the shared secret is configured
- `503` means the route exists but the local server is missing `T3_EXECUTION_BRIDGE_SHARED_SECRET`
- `404` means the route is not in the running server build or the tunnel is not reaching it

## Deploy Convex

From `apps/orchestrator`:

```bash
bun run deploy
```

If Convex reports schema incompatibilities during local bring-up, clear the affected deployment data only after confirming it is the intended development/test deployment.

## End-To-End Smoke

1. Start local infra:

   ```cmd
   scripts\start-t3code-prod.cmd
   ```

2. Confirm the bridge returns `401`, not `404`:

   ```powershell
   curl.exe -i -X POST https://t3.olumbe.com/api/execution/runs/status
   ```

3. Post a tiny dated Slack smoke task in `#testing` that mentions `Engineering Agent`.

4. Post a tiny dated Linear smoke task on a test issue/comment using the configured Linear app.

5. Confirm Convex accepts the webhook, local T3 receives a bridge request, and the originating thread receives a reply.
