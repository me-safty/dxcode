# Top 12 Fixes: Security, Stability, Usability & Completeness

Prioritized list of the most impactful fixes for the t3code codebase. No new features — only fixes for existing vulnerabilities, crashes, and broken/incomplete behavior.

---

## 1. Auth Token Leaked to Terminal Processes [SECURITY - CRITICAL]

**Problem:** The WebSocket auth token (`T3CODE_AUTH_TOKEN`) is passed to every spawned terminal process via `process.env`. The terminal environment blocklist only filters `PORT`, `ELECTRON_RENDERER_PORT`, and `ELECTRON_RUN_AS_NODE`.

Any command run in a terminal — including AI agent tool calls — can read `T3CODE_AUTH_TOKEN` from the environment and use it to impersonate the WebSocket client.

**Files:**
- `apps/server/src/terminal/Layers/Manager.ts` — line 38 (`TERMINAL_ENV_BLOCKLIST`)
- `apps/desktop/src/main.ts` — lines 928, 1322-1324 (token set in `process.env`)

**Fix:** Add `T3CODE_AUTH_TOKEN` and `T3CODE_DESKTOP_WS_URL` to the blocklist.

---

## 2. Duplicate Credential Parsing in wsServer.ts [SECURITY - HIGH]

**Problem:** Three WebSocket handlers (`jiraTransition`, `jiraListSecDeskRequestTypes`, `jiraCreateSecDeskRequest`) read `~/.netrc` directly with inline `fs.readFileSync` and regex parsing, bypassing the centralized `JiraService` auth layer. This means:
- Credentials are parsed in 4 separate places (3 inline + 1 service layer)
- The inline regex is fragile (single-line assumption, hardcoded domain)
- Errors expose the hardcoded `mediafly.atlassian.net` domain

**Files:**
- `apps/server/src/wsServer.ts` — lines 1076, 1118, 1150

**Fix:** Route all three handlers through `JiraService` like the existing `jiraList`, `jiraGet`, and `jiraSearch` handlers do.

---

## 3. Thread Deletion Crash: "All fibers interrupted without error" [STABILITY - CRITICAL]

**Problem:** Deleting a thread crashes the entire server. The `thread.deleted` handler in `ProviderCommandReactor` calls `providerService.stopSession()` with `Effect.catchAll(() => Effect.void)`, which silently swallows all errors including fiber interruption cascades. When the provider session has active fibers (running turns, streaming responses), the forced stop triggers scope cleanup that interrupts child fibers without an explicit error — causing the Effect runtime to crash.

**Files:**
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts` — lines 726-733
- `apps/server/src/provider/Layers/ProviderService.ts` — lines 449-461 (stopSession)
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` — lines 554-568

**Fix:** Replace `catchAll(() => Effect.void)` with `catchCause` that logs the failure. Ensure the provider adapter's active turn is awaited/interrupted cleanly before the session directory entry is removed. Consider adding a short grace period or using `Effect.disconnect` to prevent the scope interruption from propagating.

---

## 4. SQLite Missing busy_timeout [STABILITY - HIGH]

**Problem:** WAL mode is enabled but no `PRAGMA busy_timeout` is set. Multiple concurrent writers (ProjectionPipeline, CheckpointReactor, ProviderRuntimeIngestion) compete for the WAL lock. When one fiber is writing, others get `SQLITE_BUSY` instantly instead of retrying — causing silent data loss or unhandled errors.

**Files:**
- `apps/server/src/persistence/Layers/Sqlite.ts` — lines 32-33

**Fix:** Add `PRAGMA busy_timeout = 5000;` after the WAL pragma.

---

## 5. Jira Import Partial Failure Leaves Orphaned State [STABILITY/USABILITY - HIGH]

**Problem:** `handleImportJiraTicket` performs 8 sequential async operations (create directory, write files, dispatch project.create, update metadata, create thread, send context, transition ticket) inside a single try/catch. If any middle step fails, earlier steps are not rolled back. This leaves orphaned project directories, half-created projects in the DB, or threads without metadata.

**Files:**
- `apps/web/src/components/Sidebar.tsx` — lines 712-819

**Fix:** Add cleanup logic in the catch block that reverses completed steps (delete project directory, dispatch project.delete if created). At minimum, show the user which step failed so they can recover manually.

---

## 6. Forked Effect Streams Die Silently [STABILITY - HIGH]

**Problem:** `ProviderRuntimeIngestion.start()` forks two scoped effects that process provider events and domain events. Neither has error handling. If either stream fails (PubSub error, adapter crash), the fiber dies silently — runtime events stop processing with no alerts, and the worker's `drain()` hangs forever.

**Files:**
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts` — lines 1234-1246

**Fix:** Add `Effect.catchCause` to both forked streams that logs the failure and optionally restarts the stream.

---

## 7. CheckpointReactor Swallows All Errors [STABILITY/USABILITY - HIGH]

**Problem:** The checkpoint revert flow has 6 separate `Effect.catch(() => Effect.void)` blocks that silently swallow errors. When a user clicks "Revert to checkpoint" and it fails, they get no feedback — the UI simply does nothing.

**Files:**
- `apps/server/src/orchestration/Layers/CheckpointReactor.ts` — lines 572, 583, 592, 607, 624, 639

**Fix:** Replace silent catches with `Effect.tapError` that logs warnings. Surface revert failures to the user as a toast/activity message.

---

## 8. Race Condition in Thread Provider Options Maps [STABILITY - MEDIUM]

**Problem:** Two plain `Map` objects (`threadProviderOptions`, `threadModelOptions`) are accessed from multiple concurrent fibers without synchronization. One fiber writes during `sendTurnForThread`, another reads during `processDomainEvent` for `runtime-mode-set`. This can cause lost updates, stale reads, or undefined options being passed to `ensureSessionForThread`.

**Files:**
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts` — lines 161-162, 391-395, 701-707

**Fix:** Replace with `Ref<Map<...>>` for thread-safe access, or use a `SynchronizedRef`.

---

## 9. SecDeskModal Silent Best-Effort Failures [USABILITY - MEDIUM]

**Problem:** After successfully creating a SECDESK ticket, two follow-up operations (append to summary.md, post Jira comment) fail silently with `.catch(() => {})`. The user has no way to know these failed, leading to inconsistent state — the SECDESK ticket exists but the link isn't in summary.md and the Jira comment wasn't posted.

**Files:**
- `apps/web/src/components/SecDeskModal.tsx` — lines 95, 102

**Fix:** Show a warning toast listing which follow-up operations failed, so the user can manually complete them.

---

## 10. MutationObserver Memory Leak in Terminal Drawer [STABILITY - MEDIUM]

**Problem:** `ThreadTerminalDrawer` creates a `MutationObserver` to watch for theme changes on `document.documentElement`, but never calls `themeObserver.disconnect()` on component unmount. The observer keeps firing callbacks that reference the destroyed terminal instance.

**Files:**
- `apps/web/src/components/ThreadTerminalDrawer.tsx` — lines 462-471

**Fix:** Add `themeObserver.disconnect()` to the useEffect cleanup function.

---

## 11. Missing ticketKey on Pre-Import Projects [USABILITY - MEDIUM]

**Problem:** Projects created before the Jira import feature have `ticketKey = NULL` even though their titles contain the ticket key (e.g., "CE-15113: ..."). This causes: the Jira dropdown filter to not exclude them, SECDESK links to not associate properly, and Jira link buttons to not appear. The client-side filter was patched to also parse titles, but the root data is still wrong.

**Files:**
- `apps/web/src/components/Sidebar.tsx` — line 698 (filter)
- `apps/server/src/orchestration/` — project creation flow

**Fix:** Add a server-side migration or startup hook that backfills `ticket_key` and `jira_url` for any project whose title matches `^[A-Z]+-\d+:` but has NULL ticket_key.

---

## 12. WebSocket Listener Errors Silently Swallowed [STABILITY - MEDIUM]

**Problem:** In the WebSocket transport layer, channel listener errors are caught and silently discarded. If a listener throws (e.g., due to stale state after reconnection), the UI becomes silently desynchronized from the server. There's also no heartbeat mechanism to detect stale connections.

**Files:**
- `apps/web/src/wsTransport.ts` — lines 208-213

**Fix:** Add `console.error` logging in the catch block. Consider adding a heartbeat ping/pong mechanism to detect and recover from stale connections.

---

## Priority Matrix

| # | Category | Severity | Effort | Impact |
|---|----------|----------|--------|--------|
| 1 | Security | Critical | Low | Auth token accessible to all terminal processes |
| 2 | Security | High | Medium | Credential handling fragmented across 4 locations |
| 3 | Stability | Critical | High | Server crashes on thread deletion |
| 4 | Stability | High | Low | SQLite writes fail under concurrent load |
| 5 | Stability | High | Medium | Partial Jira imports leave broken state |
| 6 | Stability | High | Medium | Event processing stops silently |
| 7 | Usability | High | Low | Checkpoint revert fails with no feedback |
| 8 | Stability | Medium | Medium | Race condition in shared maps |
| 9 | Usability | Medium | Low | SECDESK follow-ups fail silently |
| 10 | Stability | Medium | Low | Observer never disconnected |
| 11 | Usability | Medium | Low | Old projects missing Jira metadata |
| 12 | Stability | Medium | Low | WS errors hidden from diagnostics |

---

*Generated 2026-03-26. Findings based on static analysis of the codebase — some issues may have additional runtime context not captured here.*
