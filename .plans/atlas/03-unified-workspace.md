# 03 — Unified Workspace

**Phase 1 — the foundation. Build solo, land before the UI parts of 04 & 06.**

## Goal

Today the app (inherited from T3Code) makes the user pick an arbitrary project
folder to chat in. Non-technical tutors don't need that. Replace it with **one
fixed, auto-loaded workspace at `~/tutoratlas`** and strip the folder/project
picker. The agent always runs in the workspace; per-student work roots at that
student's subfolder.

## What the tutor sees

They open the app and land **straight in their workspace** — no "open folder", no
"add project", no environment switcher. Adding/opening a student roots a chat
session at `~/tutoratlas/students/<slug>/`.

## Key approach: neutralize, don't remove

The project/environment/worktree model is load-bearing — sessions, threads, and
dispatch all find their working directory through it (`worktreePath ??
project.workspaceRoot`). **Don't delete the concept.** Auto-create exactly one
hidden project pointing at `~/tutoratlas`, make it the only/default, and hide
every picker. The plumbing stays; the tutor never sees it. Per-student sessions
keep using the existing `worktreePath` mechanism (that's how "Generate materials"
already works).

## File seam

This builds the substrate itself: it creates `~/tutoratlas` and seeds `.atlas/`
(**skills only** — rendering assets like print.css + fonts are bundled in the app,
not the workspace; see `02`). Every other feature reads/writes inside it.

## Build it

1. **Workspace bootstrap service** *(desktop/server)* — resolve the root
   (`~/tutoratlas`, overridable via setting/env); create `~/tutoratlas`,
   `.atlas/skills/{app,personal}/`, `students/` if missing; copy the shipped `app/`
   skills on init with a version stamp; idempotent; expose the path. Use
   `os.homedir()` + `path.join`.
2. **Auto-register one project** at the workspace + auto-create the local
   environment if none exists *(`apps/server/src/serverRuntimeStartup.ts`
   autoBootstrap; `apps/web/src/routes/__root.tsx`)*. Make it the default/only.
3. **Lock the defaults** *(web)* — `useHandleNewThread` resolves `defaultProjectRef`
   to the workspace project; lock `activeEnvironmentId`/project in `store.ts` so it
   can't be switched.
4. **Strip the picker UI** *(web)* — remove Add-Project / folder-browse /
   remote-clone from `CommandPalette.tsx` (+ `CommandPalette.logic.ts`); remove the
   new-project button + project context menu from `Sidebar.tsx`; hide the
   environment switcher.
5. **Fix first-run / empty states** *(web)* — `_chat.index.tsx` no longer prompts
   "connect an environment"; it goes straight into the workspace chat.
6. **Per-student rooting** *(web/desktop)* — `ensureStudentWorkspace` writes under
   `~/tutoratlas/students/<slug>/` with a sanitized slug; confirm "Generate
   materials" roots a thread there.
7. **Smoke test** — fresh launch on a clean machine creates the folder, chat works
   rooted there, no picker is visible anywhere.

## Done when

- [ ] First launch on a clean machine creates `~/tutoratlas` with `.atlas/skills/`
      populated (the shipped `app/` skills).
- [ ] Chat works, rooted at the workspace, with no project/folder/environment
      picker visible.
- [ ] Opening a student roots a session at their `students/<slug>/` subfolder.
- [ ] Re-launch is idempotent (doesn't clobber existing content).

## Cross-OS / risks

`os.homedir()` + `path.join`; robust folder-create error handling; the project/
environment model is load-bearing — neutralize and keep the plumbing, verify
dispatch still falls back to `worktreePath ?? workspaceRoot`. Slug sanitization
lives here (shared with `04`).

## Out of scope

Multiple workspaces; remote/SSH environments; provider onboarding; moving the
roster into per-student files (that's `04`).
