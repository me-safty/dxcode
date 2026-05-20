# T3 Code Production Update Runbook

This machine runs the production-like T3 Code server from this checkout:

```text
C:\Users\Vivek\Affil\t3code
```

The server process runs `apps\server\dist\bin.mjs` on `127.0.0.1:3773`, and Cloudflare Tunnel forwards `https://t3.olumbe.com` to that local port.

## Golden Rule

Do not run an inline server restart from a T3/Slack coding session unless the restart is detached. Restarting the server kills the process that is currently relaying the agent response, so the update can appear to crash even when the build succeeded.

Preferred operators:

- External elevated PowerShell: use the normal updater.
- T3/Slack session: use `-DetachedRestart` and respond before the queued restart fires.

## Normal Update From External PowerShell

Run PowerShell as Administrator:

```powershell
cd C:\Users\Vivek\Affil\t3code
Set-ExecutionPolicy -Scope Process Bypass -Force
.\scripts\update-t3code-server.ps1 -Remote origin -Branch main
```

Use `-SkipGitUpdate` if the checkout is already on the commit you want:

```powershell
.\scripts\update-t3code-server.ps1 -SkipGitUpdate
```

The script:

- refuses to merge over a dirty worktree unless `-AllowDirty` is passed
- runs `bun install`
- runs `bun run build`
- restarts the active `t3code-server` path
- verifies local T3 at `http://127.0.0.1:3773/`
- verifies Cloudflare T3 at `https://t3.olumbe.com/`
- runs `bun run health:orchestrator`

## Update From T3 Or Slack

Use the safe wrapper. It queues the full rebuild in a detached PowerShell process and returns before the server restarts:

```powershell
cd C:\Users\Vivek\Affil\t3code
.\scripts\rebuild-t3code-production-safe.ps1 -Remote origin -Branch main
```

Equivalent package script:

```powershell
bun run server:update:safe -- -Remote origin -Branch main
```

If the code is already pulled and only needs rebuilding/restarting:

```powershell
.\scripts\rebuild-t3code-production-safe.ps1 -SkipGitUpdate
```

After running this wrapper, immediately tell the user that the rebuild was queued and include the log paths printed by the script. Do not keep doing long work in that same T3 session.

The wrapper writes timestamped update logs under `logs\`, then the updater queues a restart helper. The restart helper waits a few seconds, restarts T3, verifies local and Cloudflare reachability, and writes logs here:

```text
logs\t3code-server-detached-restart.log
logs\t3code-server-detached-restart.err.log
```

Do not use `.\scripts\update-t3code-server.ps1` directly from a T3/Slack-launched session unless you explicitly pass `-DetachedRestart`. The wrapper exists so agents have a one-command safe path.

## Restart Only

Use this after a manual build:

```powershell
.\scripts\update-t3code-server.ps1 -RestartOnly
```

Detached restart only:

```powershell
.\scripts\update-t3code-server.ps1 -RestartOnly -DetachedRestartDelaySeconds 5
```

## Health Checks

After restart, the updater checks local and Cloudflare reachability automatically. To verify manually:

```powershell
Get-NetTCPConnection -LocalPort 3773 -State Listen
curl.exe -i http://127.0.0.1:3773/
curl.exe -i https://t3.olumbe.com/
curl.exe -i -X POST https://t3.olumbe.com/api/execution/runs/status
```

Expected bridge status response:

- `401`: route is live and shared-secret auth is active
- `503`: route is live but local server is missing `T3_EXECUTION_BRIDGE_SHARED_SECRET`
- `404`: running build is stale or Cloudflare is not reaching the server

Cloudflare usually does not need a restart for T3 code changes because it only forwards to `127.0.0.1:3773`.
