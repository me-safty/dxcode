# Major Todos (Post-RLHF)

These are explicitly **after RLHF is complete and approved**. Until then, treat this file as a parking lot for the next major phases.

## 1) Image Creation Support (Multi-Variant)
- Add image generation as a first-class message type in Branched+ (attachments + metadata).
- Support multi-variant generation (e.g., x4) as sibling branches under a single image-generation turn.
- UI:
  - “Try again xN” for images (N variants), with grid preview.
  - Variant navigation on images similar to text message branching.
- Storage:
  - Persist image assets with deduping + metadata (model, prompt, seed, params).
  - Ensure lossless metadata for later import/export.
- Provider abstraction:
  - Pluggable image providers (Codex, later other providers).

## 2) OpenClaw Integration (Reference Implementation)
- Use local `aionai` repo as the OpenClaw reference integration.
- Implement a Branched+ adapter for OpenClaw sessions.
- Achieve feature parity with T3 Code:
  - Edit branching
  - Retry branching
  - Variant navigation
  - Tree visualization
  - RLHF metadata capture
- Ensure OpenClaw mapping preserves lossless metadata (tool-specific fields under origin metadata).

## 3) Unified Branched+ Hub (Multi-Source Memory)
- Build a persistent Branched+ hub DB that aggregates:
  - T3 Code (Codex)
  - OpenClaw (via aionai)
  - Future sources (Gemini, ChatGPT, etc.)
- Event-sourced core:
  - Append-only event log
  - Lossless metadata per source
  - Deterministic reconstruction of the branched graph
- Provide read APIs for UI clients to render a unified workspace.

## 4) Safe Sync (Copy-Only Import)
- Add copy-only importers for:
  - Codex app chat history
  - OpenClaw history (aionai already does this; use as reference)
- Strictly non-destructive imports:
  - No writes back to source apps
  - Idempotent re-import
  - Provenance metadata for auditability

## 5) Cross-Source Conversation Visualization
- Ability to view and branch across imported histories in one UI.
- Highlight source provenance per message/branch.
- Normalize variant navigation across sources.

