# Model Normalization Boundaries

Status: **Completed**
Last reviewed: 2026-07-13

## Original intent

Eliminate divergent model aliases and defaults across the desktop process and renderer.

## Current state

The original desktop/renderer split no longer exists. Model responsibilities are intentionally divided by package role:

- `packages/contracts/src/model.ts` owns schema-only model identifiers and wire shapes.
- `packages/shared/src/model.ts` owns reusable normalization and compatibility behavior.
- `packages/client-runtime/src/state/models.ts` owns cross-client reactive model state.
- `apps/server/src/codexModelOptions.ts` owns Codex-specific option discovery.
- `apps/web/src/modelSelection.ts` and `apps/web/src/providerModels.ts` own web presentation and selection behavior.

This is preferable to putting runtime maps in `packages/contracts`, which is now required to remain schema-only.

## Maintenance rules

- Keep provider-neutral identifiers and codecs in contracts.
- Put reusable executable normalization in `packages/shared`.
- Keep provider-specific discovery and fallback behavior in the provider/server boundary.
- Add regression tests next to every normalization layer when aliases or canonical IDs change.

## Validation

Run focused model tests with `vp test`, then the repository baseline in `.plans/README.md`.
