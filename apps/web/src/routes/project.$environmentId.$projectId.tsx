import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { EnvironmentId, ProjectId, ProjectTaskId, type ProjectTask } from "@t3tools/contracts";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleIcon,
  ExternalLinkIcon,
  PlusIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ProjectFavicon } from "../components/ProjectFavicon";
import { resolveThreadStatusPill } from "../components/Sidebar.logic";
import { Button } from "../components/ui/button";
import { ButtonGroup } from "../components/ui/group";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu";
import { SidebarInset } from "../components/ui/sidebar";
import { Textarea } from "../components/ui/textarea";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { toSortableTimestamp } from "../lib/threadSort";
import { cn } from "../lib/utils";
import { newProjectTaskId } from "../lib/utils";
import {
  oppositeTaskStatus,
  taskMoveTarget,
  tasksForStatus,
  taskThreadDraft,
} from "./projectDashboard.logic";
import { projectEnvironment } from "../state/projects";
import { threadEnvironment } from "../state/threads";
import { useEnvironmentQuery } from "../state/query";
import {
  useAllEnvironmentShellsBootstrapped,
  useProject,
  useThreadShellsForProjectRefs,
} from "../state/entities";
import { useAtomCommand } from "../state/use-atom-command";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "../workspaceTitlebar";

type TaskStatus = ProjectTask["status"];

function workspaceTitle(path: string, threads: ReadonlyArray<{ branch: string | null }>) {
  if (path === "") return "Project root";
  return threads.find((thread) => thread.branch !== null)?.branch ?? "Worktree";
}

function updatedTimestamp(thread: { updatedAt: string }) {
  return toSortableTimestamp(thread.updatedAt) ?? Number.NEGATIVE_INFINITY;
}

function errorText(result: unknown): string {
  const error = squashAtomCommandFailure(result as never);
  return error instanceof Error ? error.message : "Request failed.";
}

function ProjectDashboardRoute() {
  const raw = Route.useParams();
  const environmentId = EnvironmentId.make(raw.environmentId);
  const projectId = ProjectId.make(raw.projectId);
  const projectRef = useMemo(
    () => scopeProjectRef(environmentId, projectId),
    [environmentId, projectId],
  );
  const project = useProject(projectRef);
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const navigate = useNavigate();
  const dashboard = useEnvironmentQuery(
    projectEnvironment.dashboard({ environmentId, input: { projectId } }),
  );
  const threads = useThreadShellsForProjectRefs([projectRef]);
  const handleNewThread = useNewThreadHandler();
  const createTask = useAtomCommand(projectEnvironment.createTask, { reportFailure: false });
  const updateTask = useAtomCommand(projectEnvironment.updateTask, { reportFailure: false });
  const moveTask = useAtomCommand(projectEnvironment.moveTask, { reportFailure: false });
  const deleteTask = useAtomCommand(projectEnvironment.deleteTask, { reportFailure: false });
  const restoreThread = useAtomCommand(threadEnvironment.unarchive, { reportFailure: false });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [editingTaskId, setEditingTaskId] = useState<ProjectTaskId | null>(null);

  useEffect(() => {
    if (!bootstrapped || project !== null) return;
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Project not found",
        description: "The project may have been deleted.",
      }),
    );
    void navigate({ to: "/", replace: true });
  }, [bootstrapped, navigate, project]);

  const groups = useMemo(() => {
    if (!project) return [];
    const sorted = threads
      .filter((thread) => thread.archivedAt === null)
      .toSorted(
        (left, right) =>
          updatedTimestamp(right) - updatedTimestamp(left) || right.id.localeCompare(left.id),
      );
    const byPath = new Map<string, typeof sorted>();
    for (const thread of sorted) {
      const key = thread.worktreePath ?? "";
      byPath.set(key, [...(byPath.get(key) ?? []), thread]);
    }
    return [...byPath.entries()].toSorted(([leftPath, leftThreads], [rightPath, rightThreads]) => {
      const timestampDifference =
        updatedTimestamp(rightThreads[0]!) - updatedTimestamp(leftThreads[0]!);
      return timestampDifference || leftPath.localeCompare(rightPath);
    });
  }, [project, threads]);

  const tasks = dashboard.data?.tasks ?? [];
  const runTaskCommand = async (run: () => Promise<unknown>) => {
    const result = await run();
    if ((result as { _tag?: string })._tag === "Failure") {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Task update failed",
          description: errorText(result),
        }),
      );
      return false;
    }
    dashboard.refresh();
    return true;
  };

  const submitTask = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const ok = await runTaskCommand(() =>
      createTask({
        environmentId,
        input: { taskId: newProjectTaskId(), projectId, title: trimmed, description: "" },
      }),
    );
    if (ok) {
      setTitle("");
      setAdding(false);
    }
  };

  if (!project || !dashboard.data) {
    return (
      <SidebarInset className="h-dvh min-h-0 bg-background">
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {dashboard.error ? (
            <div className="text-center">
              <p>Couldn’t load dashboard.</p>
              <Button className="mt-3" size="sm" variant="outline" onClick={dashboard.refresh}>
                Retry
              </Button>
            </div>
          ) : (
            "Loading project…"
          )}
        </div>
      </SidebarInset>
    );
  }

  const taskForm = (
    <form
      className="min-w-0 rounded-xl border bg-card/40 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submitTask();
      }}
    >
      <Textarea
        autoFocus
        className="w-full"
        size="sm"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="What needs doing?"
        aria-label="Task"
      />
      <div className="mt-3 flex gap-2 sm:justify-end">
        <Button
          className="flex-1 sm:flex-none"
          size="sm"
          type="button"
          variant="ghost"
          onClick={() => setAdding(false)}
        >
          Cancel
        </Button>
        <Button className="flex-1 sm:flex-none" size="sm" type="submit" disabled={!title.trim()}>
          Add task
        </Button>
      </div>
    </form>
  );

  const taskSection = (status: TaskStatus) => {
    const sectionTasks = tasksForStatus(tasks, status);
    return (
      <section className="min-w-0" aria-labelledby={`${status}-tasks-title`}>
        <div className="mb-2 flex items-center gap-2">
          {status === "open" ? (
            <CircleIcon className="size-3.5" />
          ) : (
            <CheckIcon className="size-3.5" />
          )}
          <h2 id={`${status}-tasks-title`} className="text-sm font-semibold">
            {status === "open" ? "Open" : "Done"}
          </h2>
          <span className="text-xs text-muted-foreground">{sectionTasks.length}</span>
        </div>
        <div className="space-y-2">
          {sectionTasks.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
              No {status} tasks.
            </p>
          ) : null}
          {sectionTasks.map((task, index) => {
            const linkedThread = task.threadId
              ? (threads.find((thread) => thread.id === task.threadId) ?? null)
              : null;
            const editing = editingTaskId === task.id;
            return (
              <article key={task.id} className="min-w-0 rounded-xl border bg-card/40 p-3">
                {editing ? (
                  <TaskEditor
                    task={task}
                    onCancel={() => setEditingTaskId(null)}
                    onSave={async (text) => {
                      const ok = await runTaskCommand(() =>
                        updateTask({
                          environmentId,
                          input: {
                            taskId: task.id,
                            title: text,
                            description: "",
                          },
                        }),
                      );
                      if (ok) setEditingTaskId(null);
                    }}
                  />
                ) : (
                  <>
                    <button
                      className="block w-full text-left"
                      onClick={() => setEditingTaskId(task.id)}
                      aria-label={`Edit ${task.title}`}
                    >
                      <h3
                        className={cn(
                          "whitespace-pre-wrap break-words text-sm font-medium",
                          status === "done" && "text-muted-foreground line-through",
                        )}
                      >
                        {task.title}
                      </h3>
                      {task.description ? (
                        <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
                          {task.description}
                        </p>
                      ) : null}
                    </button>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {linkedThread ? (
                        <Button
                          size="xs"
                          variant="outline"
                          render={
                            <Link
                              to="/$environmentId/$threadId"
                              params={{ environmentId, threadId: linkedThread.id }}
                            />
                          }
                        >
                          <ExternalLinkIcon className="size-3" /> Open thread
                        </Button>
                      ) : task.threadId ? (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() =>
                            void runTaskCommand(() =>
                              restoreThread({ environmentId, input: { threadId: task.threadId! } }),
                            )
                          }
                        >
                          <RotateCcwIcon className="size-3" /> Restore thread
                        </Button>
                      ) : (
                        <ButtonGroup>
                          <Button
                            size="xs"
                            onClick={() => void startTaskThread(task, null, "local")}
                          >
                            Start thread
                          </Button>
                          <Menu>
                            <MenuTrigger
                              render={
                                <Button
                                  size="icon-xs"
                                  aria-label={`Choose workspace for ${task.title}`}
                                />
                              }
                            >
                              <ChevronDownIcon />
                            </MenuTrigger>
                            <MenuPopup align="end" className="min-w-48">
                              <MenuItem
                                onClick={() => void startTaskThread(task, null, "worktree")}
                              >
                                New worktree
                              </MenuItem>
                              {groups
                                .filter(([path]) => path !== "")
                                .map(([path, groupThreads]) => (
                                  <MenuItem
                                    key={path}
                                    onClick={() => void startTaskThread(task, path, "local")}
                                  >
                                    {workspaceTitle(path, groupThreads)}
                                  </MenuItem>
                                ))}
                            </MenuPopup>
                          </Menu>
                        </ButtonGroup>
                      )}
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Move ${task.title} up`}
                        disabled={index === 0}
                        onClick={() =>
                          void runTaskCommand(() =>
                            moveTask({
                              environmentId,
                              input: {
                                taskId: task.id,
                                beforeTaskId: taskMoveTarget(sectionTasks, index, "up"),
                                status,
                              },
                            }),
                          )
                        }
                      >
                        <ArrowUpIcon />
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Move ${task.title} down`}
                        disabled={index === sectionTasks.length - 1}
                        onClick={() =>
                          void runTaskCommand(() =>
                            moveTask({
                              environmentId,
                              input: {
                                taskId: task.id,
                                beforeTaskId: taskMoveTarget(sectionTasks, index, "down"),
                                status,
                              },
                            }),
                          )
                        }
                      >
                        <ArrowDownIcon />
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() =>
                          void runTaskCommand(() =>
                            moveTask({
                              environmentId,
                              input: {
                                taskId: task.id,
                                beforeTaskId: null,
                                status: oppositeTaskStatus(status),
                              },
                            }),
                          )
                        }
                      >
                        {status === "open" ? (
                          <>
                            <CheckIcon className="size-3" /> Complete
                          </>
                        ) : (
                          <>
                            <RotateCcwIcon className="size-3" /> Reopen
                          </>
                        )}
                      </Button>
                      <Button
                        className="ml-auto"
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Delete ${task.title}`}
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Delete task “${task.title}”? Its thread will not be deleted.`,
                            )
                          )
                            return;
                          void runTaskCommand(() =>
                            deleteTask({ environmentId, input: { taskId: task.id } }),
                          );
                        }}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  </>
                )}
              </article>
            );
          })}
          {status === "open" ? (
            adding ? (
              taskForm
            ) : (
              <Button className="w-full" variant="outline" onClick={() => setAdding(true)}>
                <PlusIcon /> New task
              </Button>
            )
          ) : null}
        </div>
      </section>
    );
  };

  function startTaskThread(
    task: ProjectTask,
    worktreePath: string | null,
    envMode: "local" | "worktree",
  ) {
    return handleNewThread(projectRef, {
      sourceTaskId: task.id,
      draftPrompt: taskThreadDraft(task),
      worktreePath,
      envMode,
    });
  }

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <header
        className={cn(
          "flex min-h-13 items-center gap-3 border-b px-3 sm:px-6",
          COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
        )}
      >
        <ProjectFavicon environmentId={environmentId} cwd={project.workspaceRoot} />
        <h1 className="min-w-0 truncate text-sm font-semibold">{project.title}</h1>
      </header>
      <main className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="mx-auto grid min-w-0 w-full max-w-6xl gap-6 p-3 sm:gap-8 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.9fr)]">
          <section className="min-w-0" aria-labelledby="active-threads-title">
            <h2 id="active-threads-title" className="mb-3 text-sm font-semibold">
              Active threads
            </h2>
            <div className="space-y-4">
              {groups.length === 0 ? (
                <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                  No active threads.
                </p>
              ) : null}
              {groups.map(([path, groupThreads]) => (
                <div key={path || "root"}>
                  <div className="mb-1.5 flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
                    <span className="min-w-0 truncate">{workspaceTitle(path, groupThreads)}</span>
                  </div>
                  <div className="overflow-hidden rounded-xl border">
                    {groupThreads.map((thread) => {
                      const status = resolveThreadStatusPill({ thread });
                      return (
                        <Link
                          key={thread.id}
                          to="/$environmentId/$threadId"
                          params={{ environmentId, threadId: thread.id }}
                          className="flex items-center gap-2 border-b px-3 py-2.5 text-sm last:border-b-0 hover:bg-accent/60"
                        >
                          {status ? (
                            <span
                              className={cn(
                                "size-2 rounded-full",
                                status.dotClass,
                                status.pulse && "animate-status-pulse",
                              )}
                              aria-label={status.label}
                            />
                          ) : (
                            <span className="size-2 rounded-full bg-muted-foreground/25" />
                          )}
                          <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                          {thread.branch ? (
                            <span className="hidden max-w-40 truncate text-xs text-muted-foreground sm:block">
                              {thread.branch}
                            </span>
                          ) : null}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
              <Button
                className="w-full"
                onClick={() =>
                  void handleNewThread(projectRef, { worktreePath: null, envMode: "local" })
                }
              >
                <PlusIcon /> New thread
              </Button>
            </div>
          </section>
          <div className="min-w-0 space-y-7">
            {taskSection("open")}
            {taskSection("done")}
          </div>
        </div>
      </main>
    </SidebarInset>
  );
}

function TaskEditor({
  task,
  onCancel,
  onSave,
}: {
  task: ProjectTask;
  onCancel: () => void;
  onSave: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState(() => taskThreadDraft(task));
  return (
    <div>
      <Textarea
        autoFocus
        size="sm"
        value={text}
        onChange={(event) => setText(event.target.value)}
        aria-label="Task"
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button size="xs" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="xs" disabled={!text.trim()} onClick={() => void onSave(text.trim())}>
          Save
        </Button>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/project/$environmentId/$projectId")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: ProjectDashboardRoute,
});
