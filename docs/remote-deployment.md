# Local Server Remote Access

The supported remote-access path exposes the local T3 server through a public
URL. External platforms call that public URL directly.

```text
Slack / Resend / GitHub
        |
        v
https://<your-public-t3-url>
        |
Cloudflare Tunnel
        |
http://127.0.0.1:3773
        |
apps/server
```

Use the full deployment runbook for setup details:

[Server-Native External Intake Deployment](./orchestrator-deployment.md)

Useful checks:

```bash
curl -i http://127.0.0.1:3773/
curl -i https://<your-public-t3-url>/
curl -sS https://<your-public-t3-url>/api/external-intake/health
```

Webhook URLs:

```text
https://<your-public-t3-url>/slack/webhook
https://<your-public-t3-url>/support-email/resend
https://<your-public-t3-url>/github/webhook
```
