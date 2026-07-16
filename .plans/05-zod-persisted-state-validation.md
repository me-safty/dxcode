# Persisted Client-State Validation and Migration

Status: **Superseded**
Last reviewed: 2026-07-13

## Original intent

Replace manual renderer `localStorage` sanitizers with versioned Zod schemas.

## Current state

The renderer and Zod assumptions are obsolete:

- Durable project/thread state is server-authoritative and projected from `apps/server/src/orchestration` and `apps/server/src/persistence`.
- Shared wire and persistence shapes use Effect Schema in `packages/contracts`.
- Cross-client reactive state lives in `packages/client-runtime/src/state`.
- Web-only preferences and drafts use focused Zustand stores such as `apps/web/src/composerDraftStore.ts`, with explicit migrations for browser-owned state.

## Current policy

- Do not persist a second authoritative copy of orchestration state in the browser.
- Decode network, disk, and IPC input at the owning boundary with Effect Schema.
- Version browser-owned persisted state and make migrations deterministic, idempotent, and tolerant of older optional fields.
- Keep URL/blob lifecycle and other browser runtime work out of schema-only contracts.
- Test corrupt payload fallback and at least one real previous-version migration.

## Validation

Run the affected store migration tests with `vp test`, then the repository baseline.
