# Provider Event Logging Lifecycle

Status: **Completed and superseded by scoped server services**
Last reviewed: 2026-07-13

## Original intent

Give a desktop `ProviderManager` explicit log-stream ownership and shutdown behavior.

## Current state

Provider runtime ownership moved to `apps/server`. Logging is separated into `ProviderEventLoggers.ts`, `EventNdjsonLogger.ts`, and provider-specific adapters under `apps/server/src/provider/Layers`. Provider sessions and loggers are acquired through the server layer graph and released by Effect scopes rather than an Electron `dispose()` call.

## Maintenance rules

- Open files and subscriptions with scoped acquisition/release.
- Preserve ordering and flush behavior on normal shutdown, interruption, and failed startup.
- Keep provider-native payload logging adapter-local and redact credentials before serialization.
- Test finalization and logger failure isolation; logging failure must not kill provider event ingestion.

## Validation

Run provider logger and lifecycle tests with `vp test`, then the repository baseline.
