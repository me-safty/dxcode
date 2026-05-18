import { ProjectId } from "@t3tools/contracts";
import {
  projectScriptRuntimeEnv,
  setupProjectScript,
  WORKTREE_SETUP_SCRIPT_RELATIVE_PATHS,
  worktreeSetupScriptCommand,
} from "@t3tools/shared/projectScripts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { TerminalManager } from "../../terminal/Services/Manager.ts";
import {
  type ProjectSetupScriptRunnerInput,
  type ProjectSetupScriptRunnerShape,
  ProjectSetupScriptRunner,
  ProjectSetupScriptRunnerError,
} from "../Services/ProjectSetupScriptRunner.ts";

const joinWorktreePath = (worktreePath: string, relativePath: string) =>
  `${worktreePath.replace(/[\\/]+$/, "")}/${relativePath}`;

const makeProjectSetupScriptRunner = Effect.gen(function* () {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const terminalManager = yield* TerminalManager;
  const fileSystem = yield* FileSystem.FileSystem;

  const resolveSetupScript = Effect.fn("ProjectSetupScriptRunner.resolveSetupScript")(function* (
    input: ProjectSetupScriptRunnerInput,
    scripts: Parameters<typeof setupProjectScript>[0],
  ) {
    const explicitScript = setupProjectScript(scripts);
    if (explicitScript) {
      return explicitScript;
    }

    for (const relativePath of WORKTREE_SETUP_SCRIPT_RELATIVE_PATHS) {
      const scriptPath = joinWorktreePath(input.worktreePath, relativePath);
      const exists = yield* fileSystem.exists(scriptPath);
      if (exists) {
        return {
          id: "worktree-setup",
          name: "Worktree setup",
          command: worktreeSetupScriptCommand(relativePath),
          icon: "configure",
          runOnWorktreeCreate: true,
        } as const;
      }
    }

    return null;
  });

  const runForThread: ProjectSetupScriptRunnerShape["runForThread"] = (input) =>
    Effect.gen(function* () {
      const project =
        (input.projectId
          ? yield* projectionSnapshotQuery
              .getProjectShellById(ProjectId.make(input.projectId))
              .pipe(Effect.map(Option.getOrUndefined))
          : null) ??
        (input.projectCwd
          ? yield* projectionSnapshotQuery
              .getActiveProjectByWorkspaceRoot(input.projectCwd)
              .pipe(Effect.map(Option.getOrUndefined))
          : null) ??
        null;

      if (!project) {
        return yield* new ProjectSetupScriptRunnerError({
          message: "Project was not found for setup script execution.",
        });
      }

      const script = yield* resolveSetupScript(input, project.scripts);
      if (!script) {
        return {
          status: "no-script",
        } as const;
      }

      const terminalId = input.preferredTerminalId ?? `setup-${script.id}`;
      const cwd = input.worktreePath;
      const env = projectScriptRuntimeEnv({
        project: { cwd: project.workspaceRoot },
        worktreePath: input.worktreePath,
      });

      yield* terminalManager.open({
        threadId: input.threadId,
        terminalId,
        cwd,
        worktreePath: input.worktreePath,
        env,
      });
      yield* terminalManager.write({
        threadId: input.threadId,
        terminalId,
        data: `${script.command}\r`,
      });

      return {
        status: "started",
        scriptId: script.id,
        scriptName: script.name,
        terminalId,
        cwd,
      } as const;
    }).pipe(
      Effect.mapError((cause) => {
        if (
          typeof cause === "object" &&
          cause !== null &&
          "_tag" in cause &&
          cause._tag === "ProjectSetupScriptRunnerError"
        ) {
          return cause as ProjectSetupScriptRunnerError;
        }
        const message =
          typeof cause === "object" &&
          cause !== null &&
          "message" in cause &&
          typeof cause.message === "string"
            ? cause.message
            : String(cause);
        return new ProjectSetupScriptRunnerError({ message });
      }),
    );

  return {
    runForThread,
  } satisfies ProjectSetupScriptRunnerShape;
});

export const ProjectSetupScriptRunnerLive = Layer.effect(
  ProjectSetupScriptRunner,
  makeProjectSetupScriptRunner,
);
