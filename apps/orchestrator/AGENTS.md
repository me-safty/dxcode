# AGENTS.md

## Convex Deployment

- For the orchestrator, treat the Convex dev deployment as the canonical live deployment until this project is explicitly declared production-ready.
- Use `apps/orchestrator/.env.local` as the source of truth for the active dev deployment. The current dev site URL is `https://scrupulous-fly-947.convex.site`.
- Do not switch to, debug against, or update stale deployment URLs such as `https://basic-porcupine-321.convex.site` unless the user explicitly asks for that specific deployment.
- Deploy orchestrator changes with `bunx convex dev --once` from `apps/orchestrator`.
- When configuring Slack, Linear, GitHub, or local T3 callbacks, point them at the active Convex dev site URL unless the user explicitly says otherwise.
- If Convex env vars mention old webhook URLs, update the external app configuration and docs toward the active dev deployment rather than assuming those old URLs are the intended target.
