---
name: remote-service-redeploy
description: Rebuild and redeploy this repository's server/web app on a personal remote computer reachable over SSH, then verify a Cloudflare tunnel-backed public domain. Use when asked to update, redeploy, restart, repair, or validate a remote service running from a Git checkout behind cloudflared.
---

# Remote Service Redeploy

Use this workflow to update a remote personal computer that hosts this repo through an SSH-accessible checkout and exposes the app with Cloudflare Tunnel.

## Inputs

Resolve these before making changes. Use user-provided values when available; otherwise discover them read-only over SSH.

- `<ssh-target>`: SSH target such as `user@host`.
- `<repo-dir>`: remote Git checkout path.
- `<service-name>`: user or system service that runs the built app.
- `<tunnel-service-name>`: cloudflared service name.
- `<domain>`: public hostname.
- `<port>`: local origin port behind cloudflared.

Do not hardcode personal hostnames, usernames, passwords, domains, or local paths in committed files. Never put passwords in shell commands, logs, scripts, or docs.

## Local Preparation

1. Confirm the local branch and working tree.
2. Run required repository checks before committing:

```bash
vp check
vp run typecheck
```

3. Commit and push the intended changes.

```bash
git status --short
git add <files>
git commit -m "<message>"
git push origin <branch>
```

## Remote Update

SSH to the remote. If a password is needed, enter it only through the interactive prompt.

```bash
ssh <ssh-target>
```

Inside the remote shell:

```bash
set -e
cd <repo-dir>
git status --short
git branch --show-current
git fetch origin <branch>
git pull --ff-only origin <branch>
```

If dependencies may be stale after the pull, run the repo's package install command. For this repo:

```bash
vp install
```

Build the production artifacts used by the service:

```bash
vp run build
```

Restart only the service that serves the app:

```bash
systemctl --user restart <service-name>
sleep 3
systemctl --user --no-pager --full status <service-name>
curl --max-time 10 -fsS -o /tmp/app-local.html -w 'local code=%{http_code} bytes=%{size_download}\n' http://127.0.0.1:<port>/
```

## Cloudflare Tunnel Verification

Verify cloudflared is active:

```bash
systemctl --user --no-pager --full status <tunnel-service-name>
curl --max-time 10 -fsS -o /tmp/app-public.html -w 'public code=%{http_code} bytes=%{size_download}\n' https://<domain>/
```

If the public domain intermittently hangs while the local origin is reliable, inspect Cloudflare tunnel connectors. Multiple active connectors for one hostname can load-balance traffic between a healthy origin and a stale origin.

Use cloudflared with the configured tunnel and origin certificate paths. Keep credentials redacted in user-facing output.

```bash
cloudflared tunnel --config <cloudflared-config.yml> info <tunnel-id>
```

Expected healthy state: one intended connector, or multiple connectors that all point to reachable origins. If there is a stale connector on another OS or host, stop or disable that connector. If it cannot be stopped safely, create a new tunnel for the active machine, route `<domain>` to it, update the cloudflared service config, and restart the tunnel service.

Example service-level checks:

```bash
systemctl --user is-active <service-name>
systemctl --user is-active <tunnel-service-name>
for i in 1 2 3 4 5; do
  curl --connect-timeout 5 --max-time 12 -fsS -o /tmp/app-public-$i.html \
    -w "try $i code=%{http_code} time=%{time_total} bytes=%{size_download}\n" \
    https://<domain>/ || true
done
```

## Health Checks

Run any repo-specific health script after the service and tunnel are up. For this repo:

```bash
T3CODE_HEALTH_TIMEOUT_MS=10000 node scripts/orchestrator-health-check.ts
```

Treat the public app as not fully fixed until:

- Local origin returns HTTP 200.
- Public domain returns HTTP 200 repeatedly, not just once.
- API health routes return expected status/body.
- WebSocket or auth routes fail only in expected ways for unauthenticated probes.
- Browser-level loading is verified when the user reports UI loading problems.

## Browser Verification

For "stuck loading" reports, do not rely only on `curl /`. Open `https://<domain>/` in the in-app browser or another browser, then inspect:

- Console errors.
- Failed asset requests.
- Failed API requests.
- WebSocket connection failures.
- Whether the app root renders beyond the initial loading state.

If `curl` is stable but the browser is not, check browser-only concerns such as cached stale assets, auth/session state, WebSocket upgrade behavior, CORS, and service worker/cache behavior.

## Final Report

Report only concrete state:

- Commit pushed.
- Remote checkout commit.
- Build result.
- Restarted services.
- Local and public HTTP results.
- Health script result.
- Any residual warnings or known non-blocking issues.
