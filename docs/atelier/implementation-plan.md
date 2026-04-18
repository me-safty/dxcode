# Atelier Implementation Plan

This plan assumes the architecture in `docs/atelier/architecture-map.md`.

## PR 1: Establish the fork baseline

Goal:

- keep upstream behavior intact
- record local prerequisites
- verify the workspace builds

Status in this workspace:

- copied upstream snapshot into `atelier/`
- installed Bun locally
- `bun install` succeeded
- `bun run build:contracts` succeeded
- `bun run test --filter=@t3tools/contracts` succeeded

## PR 2: Add pi as a first-class backend

Detailed plan:

- `docs/atelier/pr-2-add-pi-provider.md`

Files likely involved:

- `packages/contracts/src/orchestration.ts`
- `packages/contracts/src/model.ts`
- `apps/server/src/provider/Layers/ProviderRegistry.ts`
- `apps/server/src/provider/Layers/ProviderAdapterRegistry.ts`
- new `PiProvider` + `PiAdapter` files under `apps/server/src/provider/Layers/`
- matching service interfaces under `apps/server/src/provider/Services/`

Deliverables:

- add `pi` to `ProviderKind`
- add default display name/model defaults
- implement provider status snapshotting for install/auth/model availability
- implement runtime adapter spike behind the existing provider contract

Exit criteria:

- pi appears in provider status/config payloads
- a pi-backed thread can start and stream canonical runtime events

## PR 3: Create an Atelier-specific UX framing layer

Files likely involved:

- `apps/web/src/components/NoActiveThreadState.tsx`
- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/routes/_chat.index.tsx`
- new view-model helpers under `apps/web/src/atelier/`

Deliverables:

- rename user-facing thread copy to task/work language
- replace the empty state with a Cowork-style landing composer
- introduce folder/project emphasis and agent picker emphasis
- keep existing orchestration/state plumbing

Exit criteria:

- default landing state reads like a knowledge-work app, not a coding tool
- no backend behavior changes required for the UI swap

## PR 4: Hide developer-first surfaces by default

Files likely involved:

- `apps/web/src/components/BranchToolbar.tsx`
- `apps/web/src/components/DiffPanel.tsx`
- `apps/web/src/components/ThreadTerminalDrawer.tsx`
- `apps/web/src/components/chat/*`
- `apps/web/src/components/RightPanelSheet.tsx`

Deliverables:

- remove or gate git, terminal, and diff-heavy affordances behind `Advanced`
- convert runtime/tool events into a simpler progress feed
- preserve underlying functionality for power users

Exit criteria:

- non-technical users can complete a task without encountering git or terminal UI

## PR 5: Artifact-first file experience

Files likely involved:

- project/file list components
- new preview components for `md`, `pdf`, `docx`, `xlsx`, `pptx`, images
- server open-file helpers if needed

Deliverables:

- friendlier file list with type icons and metadata
- preview panel for common deliverables
- "open in native app" affordance

Exit criteria:

- Atelier visibly centers outputs, not diffs

## PR 6: Setup wizard

Files likely involved:

- provider status hooks in web
- new setup dialog components
- provider snapshot metadata additions in server

Deliverables:

- detect installed CLIs
- show install/login status
- present copyable install/login commands
- validate success after login

Exit criteria:

- a non-technical user can connect Claude Code, Codex, or pi without reading repo docs

## Open implementation questions

- pi integration path: SDK vs process/RPC
- whether to keep Cursor/OpenCode visible in Atelier MVP or hide them
- artifact preview library choices for office formats
- whether "task" should fully replace "thread" in URLs and state names, or only in copy
