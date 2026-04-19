# Next Steps — Workbench Handoff

Snapshot: 2026-04-18

## Current State

The product-facing rebrand is in place:

- **Workbench** is now the product name across the visible app shell, marketing shell, and key settings/update surfaces.
- **Console / Consoles** is now the user-facing language for the sidebar grouping and the right-side task/files surface.
- The right rail has already been rebuilt into a stacked console model with viewer takeover and quick edit behavior.

The next phase is **deeper identity cleanup**, but the planning layer should stay ahead of mechanics. This doc is the guide for that sequencing.

## What Is Already Shipped

### 1. Fork + provider foundation

- fork baseline landed from upstream T3 Code
- pi is a first-class provider alongside Claude Code and Codex
- provider/model plumbing is working end-to-end

### 2. Task-entry and console evolution

- landing composer polish landed
- folder-first task creation is in place
- the old `WorkspacePanel` has been replaced by the newer stacked right rail / viewer takeover model

### 3. Visible rebrand

- Workbench branding is in the live UI and marketing shell
- user-facing `Workspaces` labels were moved to `Console` / `Consoles`
- targeted unit/browser checks passed after the rebrand and again after the console refactor commit

## Product Vocabulary To Preserve

These rules should guide every future rename:

- **Workbench** = product, app, public identity
- **Console / Consoles** = user-facing task/files surface and sidebar grouping
- **Workspace** = internal working-directory and worktree terminology

Do **not** mechanically rename every `workspace*` symbol just because the public product language changed. Many of those names are technically correct and should stay.

## Immediate Priority Order

### 1. Planning/docs consistency

Finish aligning planning and dev-focus materials first:

- root design brief should live as `Workbench-design-brief.md`
- handoff docs should live under `docs/workbench/`
- comments or scripts that are purely onboarding-facing should be updated when they influence future contributors' mental model

Goal: anyone joining the repo should understand the Workbench vision before they read implementation details.

### 2. Mechanical identity rename plan

Before editing imports and package names, lock these decisions:

- package scope strategy: `@t3tools/*` → `@workbench/*`
- CLI strategy: keep `t3` for compatibility, or rename to `workbench` and add compatibility handling
- data-dir strategy: preserve `~/.t3`, alias it, or migrate to `~/.workbench`
- env-var strategy: preserve `T3CODE_*`, alias it, or migrate to `WORKBENCH_*`
- release identity: when and how public package/release names change

This should be treated as a deliberate migration plan, not a search-and-replace exercise.

### 3. Slash-command/internal naming cleanup

There are still internal "Atelier" names around slash-command structures and some storage keys. These are lower-risk than package/import churn, but they should be grouped thoughtfully:

- rename only when it improves clarity
- separate user-visible cleanup from broad mechanical refactors
- avoid mixing semantic renames with package/import migration in one massive diff

## Deep Identity Rename: Recommended Execution Order

### Phase A — low-risk mechanical identity

- `package.json` names and workspace package names
- TypeScript path aliases
- import specifiers
- desktop `productName` and adjacent packaging metadata

Target outcome: developers and build artifacts refer to Workbench more consistently, without yet touching persistence/migration concerns.

### Phase B — CLI and public command surface

- server package/binary name
- helper scripts and docs that invoke the CLI
- any pairing/auth/setup instructions that currently assume `t3`

This phase should include a compatibility stance, not just a rename.

### Phase C — persistence and migration

- data directory behavior
- legacy compatibility lookup order
- env-var aliases or migration
- user-facing release notes for the transition

This is the riskiest phase and should be handled with explicit backward-compatibility rules.

## Rename Non-Targets

Leave these alone unless a concrete bug or ambiguity requires change:

- `workspaceRoot`
- `WorkspaceEntries`, `WorkspaceFileSystem`, and related server-side services
- worktree-related names
- filesystem-oriented "workspace" error text when it is literally about the current folder/worktree

These are technical terms, not product-branding mistakes.

## Open Questions

1. Should Workbench keep the current long-lived git branch name during the migration, or create a fresh long-lived `workbench` branch once the deeper identity pass starts?
2. Should we introduce dual support for `@t3tools/*` and `@workbench/*` briefly, or perform the package/import rename atomically?
3. Should the first deep rename PR stop before CLI/data-dir changes, or include the binary rename too?
4. Is the best persistence strategy "preserve `.t3` indefinitely" or "migrate with compatibility fallbacks"?

## Suggested Next Implementation Slice

The next concrete coding slice should be:

1. update the planning/dev-focus artifacts to Workbench language
2. prepare the mechanical rename inventory
3. execute package/import scope renames in one focused pass
4. run full typecheck/test verification before touching CLI/data-dir behavior

That ordering keeps conceptual risk low while still moving the repo toward a coherent identity.

## Resume Checklist

1. Confirm the tree is clean.
2. Read [Workbench-design-brief.md](/Users/jlm/Projects/T3-Cowork/Workbench-design-brief.md:1).
3. Read [next-steps.md](/Users/jlm/Projects/T3-Cowork/atelier/docs/workbench/next-steps.md:1).
4. Decide the compatibility strategy for package scope, CLI naming, and persistence naming.
5. Start the deeper identity rename with one category at a time, not all at once.
