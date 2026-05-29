# Server-Native External Intake Deployment

The active external-intake topology is server-native. Slack, support email, and
GitHub webhooks call `apps/server` directly through the public T3 URL. Convex is
not in the live request path.

## Topology

```text
Slack Events/Interactivity
Resend inbound email webhooks
GitHub repository webhooks
        |
        v
https://<your-public-t3-url>
        |
Cloudflare Tunnel
        |
127.0.0.1:3773
        |
apps/server
        |
SQLite state + T3 projects/worktrees/provider sessions
```

The external-intake routes are:

```text
GET  https://<your-public-t3-url>/api/external-intake/health
POST https://<your-public-t3-url>/slack/webhook
POST https://<your-public-t3-url>/support-email/resend
POST https://<your-public-t3-url>/github/webhook
```

## WSL Service

The current production-like service runs from the WSL checkout and listens on
`127.0.0.1:3773`:

```bash
cd ~/code/t3code
systemctl --user status t3code-server.service --no-pager
systemctl --user restart t3code-server.service
journalctl --user -u t3code-server.service -n 100 --no-pager
```

Cloudflare Tunnel should forward the public hostname to:

```text
http://127.0.0.1:3773
```

## Environment

Set local service environment in the WSL checkout's ignored `.env.local`.

Required public/server settings:

```text
T3CODE_PUBLIC_BASE_URL=https://<your-public-t3-url>
T3_DEFAULT_PROVIDER_INSTANCE_ID=codex
T3_DEFAULT_MODEL=<model>
```

Required for Slack:

```text
SLACK_SIGNING_SECRET=<Slack app signing secret>
SLACK_BOT_TOKEN=xoxb-...
```

Useful Slack metadata:

```text
SLACK_BOT_USER_ID=<bot user id>
SLACK_BOT_USERNAME=<bot display/user name>
SLACK_WORKSPACE_URL=https://<workspace>.slack.com
```

Required for Resend support-email intake:

```text
RESEND_API_KEY=<Resend API key>
RESEND_WEBHOOK_SECRET=<optional Svix webhook secret>
```

Required for GitHub merged-PR notifications when a secret is configured on the
repository webhook:

```text
GITHUB_WEBHOOK_SECRET=<shared webhook secret>
```

Do not set Convex deployment URLs for the server-native flow. The retired
Convex bridge variables such as `ORCHESTRATOR_BASE_URL`, `CONVEX_URL`, and
`CONVEX_SITE_URL` are not needed.

## Intake Profiles

External intake resolves projects from `T3_INTAKE_PROFILES_JSON` first, then
from already configured T3 projects by matching aliases in the incoming message.

Example:

```text
T3_INTAKE_PROFILES_JSON=[{"id":"nextcard","title":"Nextcard","workspaceRoot":"~/code/nextcard","aliases":["nextcard","next card"],"defaultBaseRef":"dev","setupScript":{"command":"scripts/worktree-setup.sh"},"supportEmail":{"productName":"Nextcard"}}]
```

Profile fields:

- `workspaceRoot`: local repo path used to create worktrees.
- `aliases`: names users can mention in Slack to select the project.
- `defaultBaseRef`: branch/ref used as the worktree base.
- `setupScript.command`: project script to run after worktree creation.
- `supportEmail`: enables support-email routing for that project.

## Slack App Setup

In the Slack app configuration, point Event Subscriptions and Interactivity at:

```text
https://<your-public-t3-url>/slack/webhook
```

Subscribe to app mention and message events needed by the Chat SDK adapter. The
server creates or continues a T3 thread when the bot is mentioned, subscribes to
that Slack thread, and relays assistant replies back into Slack unless the
thread is muted.

## GitHub Setup

Configure a repository webhook on target coding repos:

```text
https://<your-public-t3-url>/github/webhook
```

Use content type `application/json`, configure `GITHUB_WEBHOOK_SECRET` if you
want signature verification, and enable pull request events. When a linked PR is
merged, the server reacts to the Slack task message and posts a merged-PR note.

## Health Checks

Run:

```bash
curl -i http://127.0.0.1:3773/
curl -i https://<your-public-t3-url>/
curl -sS https://<your-public-t3-url>/api/external-intake/health
bun run health:orchestrator
```

Expected bridge auth check:

- `401`: bridge route is live and shared-secret auth is active.
- `503`: bridge route is live but the shared secret is missing.
- `404`: stale build or Cloudflare is not reaching T3.
