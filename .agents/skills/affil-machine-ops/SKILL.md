---
name: affil-machine-ops
description: >
  Deploy T3 Code to the production machine, manage the service, update env vars,
  and debug issues. Use when deploying, debugging the production machine,
  checking logs, restarting the service, or updating environment configuration.
  Triggers on: "deploy", "ssh", "machine", "production", "restart service",
  "check logs", "update env", "ship it", "push to prod".
---

# Affil Machine Ops

## Prerequisites

All machine details are in `.env.machine` (gitignored). Read it before running any commands.
If it doesn't exist, copy `.env.machine.example` and fill in the values.

```bash
source .env.machine
```

Every command below uses these variables. The SSH shorthand:

```bash
SSH_CMD="ssh -i $MACHINE_SSH_KEY -o StrictHostKeyChecking=no $MACHINE_SSH_USER@$MACHINE_SSH_HOST"
```

## Architecture

- **Systemd service** (`$MACHINE_T3_SERVICE`) runs `node dist/bin.mjs serve` on `127.0.0.1:$MACHINE_T3_PORT`
- **Caddy** reverse-proxies `$MACHINE_PUBLIC_HOSTNAME` → `127.0.0.1:$MACHINE_T3_PORT` with auto-TLS
- **Env file** at `$MACHINE_ENV_FILE` is loaded by systemd via `EnvironmentFile=`
- **Convex orchestrator** deploys separately to `$CONVEX_SITE_URL`
- **Workspaces** at `$MACHINE_WORKSPACE_ROOT`
- **State/DB** at `$MACHINE_T3CODE_HOME`

## Deploy T3 Server

```bash
source .env.machine

# 1. Build
bun run build

# 2. Rsync server + web dist
rsync -avz --delete \
  -e "ssh -i $MACHINE_SSH_KEY -o StrictHostKeyChecking=no" \
  apps/server/dist/ $MACHINE_SSH_USER@$MACHINE_SSH_HOST:$MACHINE_T3_REPO_PATH/apps/server/dist/

rsync -avz --delete \
  -e "ssh -i $MACHINE_SSH_KEY -o StrictHostKeyChecking=no" \
  apps/web/dist/ $MACHINE_SSH_USER@$MACHINE_SSH_HOST:$MACHINE_T3_REPO_PATH/apps/web/dist/

# 3. Restart
$SSH_CMD "sudo systemctl restart $MACHINE_T3_SERVICE"

# 4. Verify
$SSH_CMD "systemctl is-active $MACHINE_T3_SERVICE && curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$MACHINE_T3_PORT/"
```

## Deploy Convex Orchestrator

```bash
cd apps/orchestrator && npx convex deploy --yes
```

## Service Management

```bash
source .env.machine
SSH_CMD="ssh -i $MACHINE_SSH_KEY -o StrictHostKeyChecking=no $MACHINE_SSH_USER@$MACHINE_SSH_HOST"

$SSH_CMD "systemctl status $MACHINE_T3_SERVICE --no-pager"          # status
$SSH_CMD "sudo systemctl restart $MACHINE_T3_SERVICE"               # restart
$SSH_CMD "sudo systemctl stop $MACHINE_T3_SERVICE"                  # stop
$SSH_CMD "journalctl -u $MACHINE_T3_SERVICE --no-pager -n 100"      # logs
$SSH_CMD "journalctl -u $MACHINE_T3_SERVICE -f --no-pager"          # follow logs
```

## Update Environment Variables

```bash
$SSH_CMD "cat $MACHINE_ENV_FILE"                                              # view
$SSH_CMD "echo 'NEW_VAR=value' | sudo tee -a $MACHINE_ENV_FILE"              # append
$SSH_CMD "sudo systemctl daemon-reload && sudo systemctl restart $MACHINE_T3_SERVICE"  # apply
```

## Health Checks

```bash
source .env.machine

# T3 internal
$SSH_CMD "curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:$MACHINE_T3_PORT/"

# T3 external (through Caddy)
curl -s -o /dev/null -w "%{http_code}\n" https://$MACHINE_PUBLIC_HOSTNAME/

# Convex health
curl -s -o /dev/null -w "%{http_code}\n" $CONVEX_SITE_URL/health

# Bridge auth (expect 401 = configured, 503 = secret missing)
curl -s -X POST https://$MACHINE_PUBLIC_HOSTNAME/api/execution/runs -o /dev/null -w "%{http_code}\n"
```

## Debugging Checklist

1. Service running? `$SSH_CMD "systemctl is-active $MACHINE_T3_SERVICE"`
2. Recent logs? `$SSH_CMD "journalctl -u $MACHINE_T3_SERVICE --no-pager -n 100"`
3. Port listening? `$SSH_CMD "ss -tlnp | grep $MACHINE_T3_PORT"`
4. Caddy running? `$SSH_CMD "systemctl is-active caddy"`
5. Env correct? `$SSH_CMD "cat $MACHINE_ENV_FILE"`
6. Disk/memory? `$SSH_CMD "df -h / && free -h"`
7. Bridge env? `$SSH_CMD "grep -E 'ORCHESTRATOR|BRIDGE' $MACHINE_ENV_FILE"`
