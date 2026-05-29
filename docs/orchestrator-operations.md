# External Intake Operations

This runbook covers the server-native external intake in `apps/server`. Slack,
support email, and GitHub webhooks should call the public T3 URL directly; do
not route the live flow through Convex.

## Fast Triage

Start with the local service and public health endpoint:

```bash
cd ~/code/t3code
systemctl --user status t3code-server.service --no-pager
curl -sS https://<your-public-t3-url>/api/external-intake/health
bun run health:orchestrator
```

The external intake health response reports the active environment and webhook
URLs. It also reports Slack adapter configuration, including missing required
env vars.

Inspect recent server logs:

```bash
journalctl --user -u t3code-server.service -n 150 --no-pager
```

## Slack Message Received But No Reply

1. Confirm Slack is configured:

   ```bash
   curl -sS https://<your-public-t3-url>/api/external-intake/health
   ```

   `chatAdapters.slack.configured` must be `true`.

2. Confirm the Slack app uses:

   ```text
   https://<your-public-t3-url>/slack/webhook
   ```

3. Check the user message:
   - New Slack threads must mention the bot.
   - New Slack threads must mention a project alias unless there is only one
     configured T3 project.
   - Follow-up messages are only consumed after the bot has subscribed to the
     Slack thread.

4. Check ignored-message policy:
   - `aside - ...` messages are ignored.
   - Muted threads ignore ambient messages.
   - Mentions of other Slack users are ignored to avoid interrupting human
     conversations.

5. Read logs for project resolution, worktree creation, setup-script, and
   assistant relay failures:

   ```bash
   journalctl --user -u t3code-server.service -n 300 --no-pager
   ```

## Project Resolution

Project selection is controlled by:

```text
T3_INTAKE_PROFILES_JSON
T3_INTAKE_DEFAULT_BASE_REF
```

Each profile can provide aliases, a workspace root, a target branch/ref, a
setup script, and support-email settings. If no profile matches, Slack intake
falls back to configured T3 projects and matches message text against project
titles and repository names.

## Support Email Intake

Resend should call:

```text
https://<your-public-t3-url>/support-email/resend
```

Required env:

```text
RESEND_API_KEY=<Resend API key>
RESEND_WEBHOOK_SECRET=<optional Svix webhook secret>
T3_INTAKE_PROFILES_JSON=<profile with supportEmail>
```

The server fetches the full email from Resend, maps it to a support-enabled
profile, creates or continues a T3 thread, and prompts the agent to triage. The
default support prompt tells the agent to create a Linear issue only when triage
determines the email is a real product bug.

## Mute And Aside

Slack thread controls are implemented in server policy:

- Prefix a message with `aside -` to keep it out of the T3 thread.
- Mention the bot with `mute`, `stop replying`, or similar wording to mute.
- Mention the bot with `unmute`, `resume replies`, or similar wording to resume.

Mute state is stored in the server SQLite external integration tables.

## Assistant Replies

Assistant messages emitted by the orchestration engine are relayed back to all
linked Slack threads unless the link is muted. Delivery receipts prevent
duplicate Slack posts for the same T3 message.

If replies are not appearing:

```bash
journalctl --user -u t3code-server.service -n 300 --no-pager
```

Look for relay warnings that mention `external intake failed to relay assistant
message to Slack`.

## GitHub PR Merged

GitHub should call:

```text
https://<your-public-t3-url>/github/webhook
```

When the agent posts a GitHub PR URL in its assistant message, the server records
that PR as an external artifact. When GitHub later sends a merged pull request
event for the same PR, the server reacts to the linked Slack task message and
posts a merge note in the Slack thread.

If merge notifications do not appear:

- Confirm the agent response included the PR URL.
- Confirm the GitHub webhook secret matches `GITHUB_WEBHOOK_SECRET`, if set.
- Confirm the webhook includes pull request events.
- Check server logs for `unlinked_pr` or Slack delivery warnings.

## Updating

See [t3code-production-update.md](./t3code-production-update.md) for the
rebuild/restart path. After every update, verify:

```bash
bun run health:orchestrator
curl -sS https://<your-public-t3-url>/api/external-intake/health
```
