import {
  DeleteStudentWorkspaceInputSchema,
  DeleteStudentWorkspaceResultSchema,
  EnsureStudentWorkspaceInputSchema,
  EnsureStudentWorkspaceResultSchema,
  OpenPathInputSchema,
  OpenPathResultSchema,
  deriveStudentSlug,
} from "@t3tools/contracts";
import { sanitizeStudentSlug } from "@t3tools/shared/slugify";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as ElectronShell from "../../electron/ElectronShell.ts";
import * as DesktopWorkspace from "../../workspace/DesktopWorkspace.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

export const ensureStudentWorkspace = makeIpcMethod({
  channel: IpcChannels.ENSURE_STUDENT_WORKSPACE_CHANNEL,
  payload: EnsureStudentWorkspaceInputSchema,
  result: EnsureStudentWorkspaceResultSchema,
  handler: Effect.fn("desktop.ipc.workspace.ensureStudentWorkspace")(function* (input) {
    const workspace = yield* DesktopWorkspace.DesktopWorkspace;
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const path = yield* Path.Path;

    // Derive slug server-side: deriveStudentSlug(name) + sanitize + id suffix
    const baseSlug = deriveStudentSlug(input.name);
    const sanitizedBase = sanitizeStudentSlug(baseSlug);
    const slug = `${sanitizedBase}-${input.id}`;

    return yield* workspace.ensureStudentWorkspace({ slug }).pipe(
      Effect.match({
        onFailure: (error) => ({
          success: false as const,
          workspacePath: null,
          workspaceFolder: null,
          error: String(error),
        }),
        onSuccess: (res) => ({
          success: true as const,
          workspacePath: path.join(environment.workspaceRoot, res.workspaceFolder),
          workspaceFolder: res.workspaceFolder,
        }),
      }),
    );
  }),
});

export const deleteStudentWorkspace = makeIpcMethod({
  channel: IpcChannels.DELETE_STUDENT_WORKSPACE_CHANNEL,
  payload: DeleteStudentWorkspaceInputSchema,
  result: DeleteStudentWorkspaceResultSchema,
  handler: Effect.fn("desktop.ipc.workspace.deleteStudentWorkspace")(function* (input) {
    const workspace = yield* DesktopWorkspace.DesktopWorkspace;

    return yield* workspace.deleteStudentWorkspace({ workspaceFolder: input.workspaceFolder }).pipe(
      Effect.match({
        onFailure: (error) => ({
          success: false as const,
          error: String(error),
        }),
        onSuccess: () => ({
          success: true as const,
        }),
      }),
    );
  }),
});

export const openPath = makeIpcMethod({
  channel: IpcChannels.OPEN_PATH_CHANNEL,
  payload: OpenPathInputSchema,
  result: OpenPathResultSchema,
  handler: Effect.fn("desktop.ipc.workspace.openPath")(function* (input) {
    const shell = yield* ElectronShell.ElectronShell;
    return yield* shell.openPath(input.path).pipe(
      Effect.match({
        onFailure: (error) => ({
          success: false as const,
          error: String(error),
        }),
        onSuccess: (success) => ({
          success,
          ...(success ? {} : { error: "Failed to open path" }),
        }),
      }),
    );
  }),
});
