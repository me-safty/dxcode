# Server-native external intake

Status: Accepted.

External platform intake now lives in `apps/server` instead of Convex. Slack,
support email, and GitHub webhooks call the public T3 URL directly, and the
server stores external thread links, event receipts, delivery receipts, Chat SDK
state, and PR artifact links in its SQLite database.

This keeps the product closer to upstream T3 Code: a single server owns local
projects, worktrees, provider sessions, and external-platform coordination. It
also makes the open-source mental model smaller because a user can run one
server with a public tunnel instead of operating a second Convex deployment.

Consequences:

- Slack intake uses the Chat SDK adapter boundary so additional platforms can
  be added by adding adapters around the same `ExternalChat`/`ExternalIntake`
  seam.
- Project routing is configuration-driven through intake profiles and existing
  T3 projects, not hardcoded to one local machine or product.
- Support-email triage, PR creation, and Linear issue creation are prompt-led
  agent behavior where possible.
- GitHub merged-PR notifications are server-side integration behavior because
  they need durable mapping from PR URLs to T3/Slack threads.
- Convex remains historical code only until it is removed; it is not part of
  the live server-native external intake path.
