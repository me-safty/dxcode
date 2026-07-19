import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  EnvironmentId,
  ProjectId,
  ProjectTaskId,
  type ProjectTask,
  type SidebarThreadSortOrder,
} from "@t3tools/contracts";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
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
import { Input } from "../components/ui/input";
import { SidebarInset } from "../components/ui/sidebar";
import { Textarea } from "../components/ui/textarea";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useClientSettings } from "../hooks/useSettings";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { sortThreads } from "../lib/threadSort";
import { cn } from "../lib/utils";
import { newProjectTaskId } from "../lib/utils";
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
  const threadSortOrder = useClientSettings<SidebarThreadSortOrder>(
    (settings) => settings.sidebarThreadSortOrder,
  );
  const handleNewThread = useNewThreadHandler();
  const createTask = useAtomCommand(projectEnvironment.createTask, { reportFailure: false });
  const updateTask = useAtomCommand(projectEnvironment.updateTask, { reportFailure: false });
  const moveTask = useAtomCommand(projectEnvironment.moveTask, { reportFailure: false });
  const deleteTask = useAtomCommand(projectEnvironment.deleteTask, { reportFailure: false });
  const restoreThread = useAtomCommand(threadEnvironment.unarchive, { reportFailure: false });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
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
    const sorted = sortThreads(
      threads.filter((thread) => thread.archivedAt === null),
      threadSortOrder,
    );
    const byPath = new Map<string, typeof sorted>();
    for (const thread of sorted) {
      const key = thread.worktreePath ?? "";
      byPath.set(key, [...(byPath.get(key) ?? []), thread]);
    }
    return [...byPath.entries()].toSorted(([left], [right]) => {
      if (left === "") return -1;
      if (right === "") return 1;
      return left.localeCompare(right);
    });
  }, [project, threadSortOrder, threads]);

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
        input: { taskId: newProjectTaskId(), projectId, title: trimmed, description },
      }),
    );
    if (ok) {
      setTitle("");
      setDescription("");
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

  const taskSection = (status: TaskStatus) => {
    const sectionTasks = tasks
      .filter((task) => task.status === status)
      .toSorted((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    return (
      <section aria-labelledby={`${status}-tasks-title`}>
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
              <article key={task.id} className="rounded-xl border bg-card/40 p-3">
                {editing ? (
                  <TaskEditor
                    task={task}
                    onCancel={() => setEditingTaskId(null)}
                    onSave={async (nextTitle, nextDescription) => {
                      const ok = await runTaskCommand(() =>
                        updateTask({
                          environmentId,
                          input: {
                            taskId: task.id,
                            title: nextTitle,
                            description: nextDescription,
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
                          "text-sm font-medium",
                          status === "done" && "text-muted-foreground line-through",
                        )}
                      >
                        {task.title}
                      </h3>
                      {task.description ? (
                        <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
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
                        <>
                          <Button
                            size="xs"
                            onClick={() => void startTaskThread(task, null, "local")}
                          >
                            Start thread
                          </Button>
                          <Button
                            size="icon-xs"
                            variant="outline"
                            aria-label={`Choose workspace for ${task.title}`}
                            onClick={() => {
                              const worktrees = groups.map(([path]) => path).filter(Boolean);
                              const choice = window.prompt(
                                `Workspace:\n1. New worktree${worktrees.map((path, index) => `\n${index + 2}. ${path}`).join("")}`,
                                "1",
                              );
                              const selected = Number(choice);
                              if (selected === 1) void startTaskThread(task, null, "worktree");
                              else if (worktrees[selected - 2])
                                void startTaskThread(task, worktrees[selected - 2]!, "local");
                            }}
                          >
                            …
                          </Button>
                        </>
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
                                beforeTaskId: sectionTasks[index - 1]!.id,
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
                                beforeTaskId: sectionTasks[index + 2]?.id ?? null,
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
                                status: status === "open" ? "done" : "open",
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
      draftPrompt: `${task.title}\n\n${task.description}`,
      worktreePath,
      envMode,
    });
  }

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <header
        className={cn(
          "flex min-h-13 items-center gap-3 border-b px-4 sm:px-6",
          COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
        )}
      >
        <ProjectFavicon environmentId={environmentId} cwd={project.workspaceRoot} />
        <h1 className="min-w-0 truncate text-sm font-semibold">{project.title}</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <PlusIcon /> Add task
          </Button>
          <Button
            size="sm"
            onClick={() =>
              void handleNewThread(projectRef, { worktreePath: null, envMode: "local" })
            }
          >
            <PlusIcon /> New thread
          </Button>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-6xl gap-8 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.9fr)]">
          <section aria-labelledby="active-threads-title">
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
                  <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <span>
                      {path === ""
                        ? "Project root"
                        : path.split("/").findLast((segment) => segment.length > 0)}
                    </span>
                    {path ? (
                      <span className="min-w-0 truncate font-normal opacity-65">{path}</span>
                    ) : null}
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
                            <span className="max-w-40 truncate text-xs text-muted-foreground">
                              {thread.branch}
                            </span>
                          ) : null}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
          <div className="space-y-7">
            {adding ? (
              <div className="rounded-xl border bg-card/40 p-3">
                <Input
                  autoFocus
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Task title"
                  aria-label="Task title"
                />
                <Textarea
                  className="mt-2"
                  size="sm"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Description"
                  aria-label="Task description"
                />
                <div className="mt-2 flex justify-end gap-2">
                  <Button size="xs" variant="ghost" onClick={() => setAdding(false)}>
                    Cancel
                  </Button>
                  <Button size="xs" disabled={!title.trim()} onClick={() => void submitTask()}>
                    Add task
                  </Button>
                </div>
              </div>
            ) : null}
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
  onSave: (title: string, description: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  return (
    <div>
      <Input
        autoFocus
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        aria-label="Task title"
      />
      <Textarea
        className="mt-2"
        size="sm"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        aria-label="Task description"
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button size="xs" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="xs"
          disabled={!title.trim()}
          onClick={() => void onSave(title.trim(), description)}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/project/$environmentId/$projectId")({
  component: ProjectDashboardRoute,
});
