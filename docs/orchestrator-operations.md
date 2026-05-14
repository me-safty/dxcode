# Orchestrator Operations Runbook

This runbook is for the current Vevin pilot topology:

- Convex dev is the canonical live orchestrator deployment until production cutover.
- Slack and GitHub webhooks point at the active Convex site URL.
- Local T3 runs on this Windows machine and is exposed through Cloudflare at `https://t3.olumbe.com`.

Use this with `apps/orchestrator/AGENTS.md` and `docs/orchestrator-deployment.md`.

## Fast Triage

Start with the durable Convex event log:

```powershell
cd C:\Users\Vivek\Affil\t3code\apps\orchestrator
bunx convex run observability:listRecent -- '{ "limit": 25 }'
```

Useful filters:

```powershell
bunx convex run observability:listRecent -- '{ "source": "slack", "limit": 25 }'
bunx convex run observability:listRecent -- '{ "source": "github", "limit": 25 }'
bunx convex run observability:listRecent -- '{ "source": "t3", "limit": 25 }'
bunx convex run observability:listRecent -- '{ "severity": "error", "limit": 50 }'
bunx convex run observability:listRecent -- '{ "externalId": "T123:C123:1770000000.000000", "limit": 50 }'
```

Task-scoped logs:

```powershell
bunx convex run observability:listRecent -- '{ "taskId": "<convex task id>", "limit": 100 }'
bunx convex run taskEvents:listTaskEvents -- '{ "taskId": "<convex task id>", "limit": 100 }'
```

`orchestratorEvents` is the cross-cutting audit log. It includes events that may not have a task yet, such as ignored Slack messages, unlinked GitHub deliveries, and webhook auth failures.

`taskEvents` is the task-scoped idempotency and lifecycle log. It records claims, delivered replies, PR ensure results, and work-session lifecycle events.

## Slack Message Received But No Reply

1. Confirm the webhook reached Convex:

   ```powershell
   bunx convex run observability:listRecent -- '{ "source": "slack", "limit": 50 }'
   ```

2. Look for these events:
   - `http.slack-webhook.received`
   - `slack.webhook.action-received`
   - `slack.message.received`
   - `slack.policy.accepted`
   - `task-intake.store.resolved`
   - `task-intake.runtime.materialize-started` or `task-intake.runtime.continue-started`

3. If you see `slack.policy.ignored`, inspect `payloadJson.reason`.

   Expected ignore reasons include:
   - `slack_thread_aside`
   - `slack_thread_muted`
   - `slack_thread_other_user_mention`
   - `slack_ambient_without_task_thread`

4. If `slack.policy.accepted` exists but no runtime event follows, inspect errors:

   ```powershell
   bunx convex run observability:listRecent -- '{ "severity": "error", "limit": 50 }'
   ```

5. Check active Convex logs:

   ```powershell
   cd C:\Users\Vivek\Affil\t3code\apps\orchestrator
   bunx convex logs
   ```

## Open T3 Card Missing

1. Find the accepted Slack event:

   ```powershell
   bunx convex run observability:listRecent -- '{ "source": "slack", "limit": 50 }'
   ```

2. Expected event sequence for a new task:
   - `slack.reply.acknowledged`
   - `task-intake.runtime.materialize-completed`
   - `slack.reply.task-started-card-delivered`

3. If materialization completed but the card did not post, look for:
   - `slack.reply.task-started-card-failed`
   - `task-started-status-reply.failed` in `taskEvents`

4. If the card posted without a useful URL, confirm Convex env:

   ```powershell
   bunx convex env list
   ```

   Required:

   ```text
   T3_WEB_APP_BASE_URL=https://t3.olumbe.com
   T3_EXECUTION_BRIDGE_BASE_URL=https://t3.olumbe.com
   ```

## Assistant Message Not Relayed

1. Confirm T3 called Convex:

   ```powershell
   bunx convex run observability:listRecent -- '{ "kind": "http.t3-assistant-message.received", "limit": 25 }'
   ```

2. Expected delivery sequence:
   - `http.t3-assistant-message.received`
   - `task-intake.assistant-message-reply.claimed`
   - `task-intake.assistant-message-reply.delivery-started`
   - `task-intake.assistant-message-reply.delivered`

3. If no HTTP event exists, inspect local T3 logs and bridge callback env:

   ```text
   ORCHESTRATOR_BASE_URL=https://scrupulous-fly-947.convex.site
   T3_EXECUTION_BRIDGE_SHARED_SECRET=<same secret configured in Convex>
   ```

4. If the claim count is zero, inspect task links:

   ```powershell
   bunx convex run taskExternalLinks:listTaskExternalLinks -- '{ "taskId": "<convex task id>" }'
   ```

   The Slack thread link should be present and not muted.

## PR Card Missing

1. Confirm the terminal lifecycle callback:

   ```powershell
   bunx convex run observability:listRecent -- '{ "kind": "http.t3-runtime-event.received", "limit": 50 }'
   ```

2. Expected sequence:
   - `http.t3-runtime-event.received` with `type: completed`
   - `t3.pr.ensure-requested`
   - `t3.pr.ensure-completed`
   - `task-intake.pr-status-reply.claimed`
   - `task-intake.pr-status-reply.delivered`

3. If PR ensure reports `waiting_for_changes`, the agent finished without file changes.

4. If PR ensure failed, inspect:

   ```powershell
   bunx convex run observability:listRecent -- '{ "kind": "t3.pr.ensure-completed", "limit": 20 }'
   bunx convex run observability:listRecent -- '{ "severity": "error", "limit": 50 }'
   ```

5. Confirm local GitHub auth on the T3 host:

   ```powershell
   gh auth status
   ```

## Deployment URL Wrong Or Missing

1. Confirm GitHub sent deployment events:

   ```powershell
   bunx convex run observability:listRecent -- '{ "source": "github", "kind": "github.deployment-status.parsed", "limit": 50 }'
   ```

2. Expected sequence:
   - `http.github-webhook.received`
   - `github.deployment-status.parsed`
   - `github.deployment-status.delivery-claiming`
   - `github.deployment-status.delivery-claimed`
   - `github.deployment-status.slack-delivered`

3. If you see `github.deployment-status.unlinked`, GitHub delivered the event before Convex had a PR record for that head SHA, or the SHA does not match the linked PR.

4. If the URL is commit-specific, inspect the `delivery-claiming` payload:
   - `originalUrl`
   - `branchUrl`
   - `environment`
   - `headBranch`

   `branchUrl` is what Slack should receive.

5. Dashboard URLs such as `https://vercel.com/...` should be filtered before parsing.

## PR Merged Reaction Missing

1. Confirm GitHub `pull_request` webhooks are configured for the repo.

2. Query merged events:

   ```powershell
   bunx convex run observability:listRecent -- '{ "source": "github", "kind": "github.pull-request.merged-parsed", "limit": 25 }'
   ```

3. Expected sequence:
   - `github.pull-request.merged-parsed`
   - `github.pull-request.merge-delivery-claimed`
   - `github.pull-request.merge-slack-delivery-started`
   - `github.pull-request.merge-slack-delivered`

4. If you see `github.pull-request.unlinked`, Convex does not have a `githubPullRequests` row matching `owner/repo#number`.

5. If delivery failed, inspect the error payload. Reaction failures usually mean the original Slack message id could not be reconstructed from the Slack thread external id.

## Local T3 Or Cloudflare Down

Check Windows scheduled tasks:

```powershell
schtasks /query /tn t3code-server /fo LIST /v
schtasks /query /tn t3code-tunnel /fo LIST /v
```

Check local and tunnel reachability:

```powershell
curl.exe -i http://127.0.0.1:3773/
curl.exe -i https://t3.olumbe.com/
curl.exe -i -X POST https://t3.olumbe.com/api/execution/runs/status
```

Expected unauthenticated bridge result:

- `401`: route exists and shared secret is configured
- `503`: route exists but local server is missing `T3_EXECUTION_BRIDGE_SHARED_SECRET`
- `404`: running server build does not include the bridge route, or Cloudflare is not reaching it

For active local development:

```cmd
bun run dev:local-cloudflare
```

Stop or pause the `t3code-server` scheduled task first so the hot-reload server can bind `3773`.

## Replay Notes

GitHub redelivery is safe for supported events because Slack delivery is guarded by `taskEvents` claim keys:

- deployment-ready keys include task, deployment identity, resolved URL, and source link
- PR-merged keys include task, PR identity, and source link
- PR status cards are keyed by work session, PR identity, and source link

Use GitHub's webhook redelivery UI for a real replay. The orchestrator should record the redelivery in `orchestratorEvents` while suppressing duplicate Slack posts if the claim was already delivered.
