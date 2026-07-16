# Process and Terminal Runtime Boundaries

Status: **Superseded by server-owned runtime services**
Last reviewed: 2026-07-13

## Original intent

Hide child-process and PTY branching behind one desktop `ProcessManager` session interface.

## Current state

Execution no longer belongs to one desktop manager:

- `apps/server/src/processRunner.ts` covers bounded external commands.
- `apps/server/src/terminal` owns long-lived terminal sessions and PTY lifecycle.
- Provider subprocesses are owned by provider adapters and protocol runtimes.
- Desktop-only launch and shell concerns stay in `apps/desktop`.

These boundaries intentionally distinguish bounded commands, interactive terminals, provider protocols, and desktop launchers. A universal runtime-session interface would erase important cancellation, output, persistence, and platform differences.

## Maintenance rules

- Share low-level safe process helpers only when cancellation and output-limit semantics match.
- Keep PTY history/reconnect contracts in the terminal domain.
- Use Effect scopes and typed spawn/exit/timeout errors.
- Test Windows and WSL paths when changing native or shell behavior.

## Validation

Run the affected process/terminal tests with `vp test`, then the repository baseline. Native mobile code is not involved in this plan.
